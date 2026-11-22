import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  currentSurface,
  featureMatchActions as A,
  featureMatchReducer,
  flatPhase,
  initialFeatureMatchState,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import { POSES, SURFACE_CLASSES } from "./flat-target";
import { shotDue } from "./plan-slots";
import { planSlots } from "./run-plan";

const photo = fc.record({
  id: fc.constantFrom("p1", "p2", "p3"),
  width: fc.oneof(fc.integer({ min: 1, max: 2000 }), fc.constant(0)),
  height: fc.integer({ min: 1, max: 2000 }),
  source: fc.constant({ width: 1920, height: 1080 }),
  greyMean: fc.oneof(
    fc.double({ min: 0, max: 255, noNaN: true }),
    fc.constant(-1),
  ),
});

/** Every action of the photo pair flow, valid or not. */
const pageAction: fc.Arbitrary<FeatureMatchAction> = fc.oneof(
  fc
    .record({
      pair: fc.constantFrom("1a", "1b", "1c", "2a", "other", "flat", "zz"),
      spot: fc.integer({ min: 0, max: 4 }),
    })
    .map((p) => A.selectorChanged(p)),
  fc
    .record({ which: fc.constantFrom("a" as const, "b" as const), photo })
    .map((p) => A.photoTaken(p)),
  fc
    .constantFrom("camera" as const, "synthetic" as const, "speed" as const)
    .map((k) => A.runStarted(k)),
  fc.string({ maxLength: 4 }).map((t) => A.runProgressed(t)),
  fc.constant(A.cameraRunWithdrawn()),
  fc
    .record({
      text: fc.constant("done"),
      resultsId: fc.constantFrom("r1", null),
    })
    .map((p) => A.runFinished(p)),
  fc.constant(A.saveStarted()),
  fc.constant(A.saveFinished([{ id: "u1", file: "a.zip", text: "zip" }])),
  fc.constant(A.saveFailed()),
  fc.constant(A.filesDownloaded()),
  fc.constant(A.flatExited()),
);

const start = (): FeatureMatchState =>
  initialFeatureMatchState({ session: "s" });

/** Every state on the way, the start included. */
const states = (
  actions: readonly FeatureMatchAction[],
): FeatureMatchState[] => {
  const out = [start()];
  for (const a of actions) {
    out.push(featureMatchReducer(out.at(-1) ?? start(), a));
  }
  return out;
};

describe("photo pair flow properties", () => {
  // Why: these are the rules the page's buttons rely on; any action order
  // a user can produce must keep them.
  it("keeps busy, numbering, photos and offered files consistent", () => {
    fc.assert(
      fc.property(fc.array(pageAction, { maxLength: 40 }), (actions) => {
        const all = states(actions);
        for (const [i, s] of all.entries()) {
          expect(s.busy === "running").toBe(s.running !== null);
          expect(s.progress.advancedFor).toBeLessThanOrEqual(
            s.progress.sequence,
          );
          // Photo B never without A.
          expect(s.photos.b === null || s.photos.a !== null).toBe(true);
          expect(s.pairInProgress?.sequence ?? 0).toBeLessThanOrEqual(
            s.progress.sequence,
          );
          // Results only for a finished camera run.
          expect(s.resultsId === null || s.cameraRun === "done").toBe(true);
          // Offered files only when saved and idle.
          expect(s.offered.length === 0 || (s.saved && s.busy === "idle")).toBe(
            true,
          );
          // The running number never goes back.
          expect(s.progress.sequence).toBeGreaterThanOrEqual(
            all[i - 1]?.progress.sequence ?? 0,
          );
        }
      }),
    );
  });

  // Why: the retake rule - an accepted photo B always belongs to a pair
  // whose files were never downloaded, so it never reuses saved names.
  it("never lets a new photo B join a pair already downloaded", () => {
    fc.assert(
      fc.property(fc.array(pageAction, { maxLength: 40 }), (actions) => {
        const all = states(actions);
        for (let i = 1; i < all.length; i++) {
          const a = actions[i - 1]!;
          const s = all[i]!;
          const acceptedB =
            A.photoTaken.match(a) &&
            a.payload.which === "b" &&
            s !== all[i - 1];
          expect(
            !acceptedB ||
              (s.pairInProgress?.sequence ?? -1) > s.progress.advancedFor,
          ).toBe(true);
        }
      }),
    );
  });

  // Why: a second tap on a downloaded link must move nothing.
  it("advances once per pair: a second download changes nothing", () => {
    fc.assert(
      fc.property(fc.array(pageAction, { maxLength: 40 }), (actions) => {
        const once = featureMatchReducer(
          states(actions).at(-1) ?? start(),
          A.filesDownloaded(),
        );
        expect(featureMatchReducer(once, A.filesDownloaded())).toBe(once);
      }),
    );
  });

  // Why: a failed light check keeps the selector on the pair to retake.
  it("keeps the pair on a download whose light check failed", () => {
    fc.assert(
      fc.property(fc.array(pageAction, { maxLength: 40 }), (actions) => {
        const before = states(actions).at(-1) ?? start();
        const after = featureMatchReducer(before, A.filesDownloaded());
        const kept =
          after !== before && before.light !== null && before.light !== "ok";
        expect(!kept || after.progress.pair === before.progress.pair).toBe(
          true,
        );
        expect(!kept || after.pairNote?.kind === "kept").toBe(true);
      }),
    );
  });
});

const cls = fc.constantFrom(...SURFACE_CLASSES.map((c) => c.id));
const point = fc.record({
  x: fc.double({ min: 0, max: 400, noNaN: true }),
  y: fc.double({ min: 0, max: 300, noNaN: true }),
});

const flatAction: fc.Arbitrary<FeatureMatchAction> = fc.oneof(
  fc.constant(A.flatOpened()),
  fc.constant(A.flatClosed()),
  fc.record({ cls, original: fc.boolean() }).map((p) => A.flatSurfaceAdded(p)),
  fc.integer({ min: 1, max: 3 }).map((id) => A.flatSurfaceSelected(id)),
  fc.constant(A.flatOverview()),
  fc.constantFrom(...POSES.map((p) => p.id)).map((p) => A.flatPoseChosen(p)),
  fc.constant(A.flatReferenceTaken({ id: "f1", width: 400, height: 300 })),
  fc.constant(A.flatReferenceDropped()),
  point.map((p) => A.flatTapped(p)),
  fc.constant(A.flatPreviewMade({ id: "f2", width: 200, height: 150 })),
  fc.constant(A.flatCornersRedone()),
  fc.constant(A.flatReferenceAccepted()),
  fc.double({ min: 0, max: 255, noNaN: true }).map((m) => A.flatShotTaken(m)),
  fc.constant(A.flatShotRemoved()),
  fc.constant(A.flatSavingStarted()),
  fc
    .record({
      surface: fc.integer({ min: 1, max: 3 }),
      shots: fc.integer({ min: 0, max: 6 }),
    })
    .map((p) =>
      A.flatSavingEnded({
        prepared: { ...p, urlId: "u1", name: "z.zip", text: "t" },
        status: "ready",
      }),
    ),
  fc.constant(A.flatSaved()),
);

describe("flat target capture properties", () => {
  // Why: a prepared zip is offered only for the surface on screen and the
  // shots it holds; anything else is a Save link to stale photos.
  it("keeps a prepared zip only for the current surface and its shots", () => {
    fc.assert(
      fc.property(fc.array(flatAction, { maxLength: 50 }), (actions) => {
        for (const s of states(actions)) {
          const f = s.flat;
          expect(f.taps.length).toBeLessThanOrEqual(4);
          // A preview only from four taps.
          expect(f.preview === null || f.taps.length === 4).toBe(true);
          const cur = currentSurface(f);
          expect(
            f.prepared === null ||
              (flatPhase(f) === "poses" &&
                f.prepared.surface === cur?.id &&
                f.prepared.shots === cur.shots.length),
          ).toBe(true);
        }
      }),
    );
  });
});

describe("guided capture state properties", () => {
  const guidedPhoto = fc.record({
    id: fc.constantFrom("g1", "g2"),
    width: fc.constant(640),
    height: fc.constant(480),
    source: fc.constant({ width: 1280, height: 720 }),
    greyMean: fc.double({ min: 0, max: 255, noNaN: true }),
  });
  const guidedAction: fc.Arbitrary<FeatureMatchAction> = fc.oneof(
    fc
      .record({
        slot: fc.constantFrom("1a-s1", "1b-s1", "2a-s1"),
        which: fc.constantFrom("a" as const, "b" as const),
        photo: guidedPhoto,
      })
      .map((p) => A.planPhotoTaken(p)),
    fc.integer({ min: -1, max: 4 }).map((i) => A.planMoved(i)),
    fc
      .constantFrom("a" as const, "b" as const)
      .map((w) => A.guidedRetakeToggled(w)),
    fc
      .option(
        fc.record({
          shot: fc.constantFrom("a" as const, "b" as const),
          left: fc.integer({ min: 0, max: 5 }),
        }),
      )
      .map((c) => A.guidedCountSet(c)),
    fc
      .constantFrom("plan" as const, "speed" as const)
      .map((k) => A.runStarted(k)),
    fc.constant(A.runFinished({ text: "done", resultsId: "r1" })),
    fc.constant(A.planReset()),
  );

  // Why: the camera button trusts these two fields; a retake target on a
  // photo the pair lacks, or a countdown for a photo that is not due,
  // would take the wrong photo or none.
  it("keeps the retake target on a held photo and the countdown on the due one", () => {
    fc.assert(
      fc.property(fc.array(guidedAction, { maxLength: 40 }), (actions) => {
        for (const s of states(actions)) {
          const slot = planSlots(s.plan)[s.plan.current]!;
          const rec = s.plan.slots[slot.id];
          const { retake, count } = s.guided;
          expect(!retake || Boolean(rec?.[retake])).toBe(true);
          expect(count ? count.shot : null).toBe(
            count ? shotDue(rec, retake) : null,
          );
          expect(!count || count.left >= 1).toBe(true);
          expect(s.running !== "plan" || s.planRun?.slot !== undefined).toBe(
            true,
          );
        }
      }),
    );
  });
});
