import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  currentShot,
  currentSurface,
  featureMatchActions as A,
  featureMatchReducer,
  flatPhase,
  initialFeatureMatchState,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import { POSES, SURFACE_CLASSES } from "./flat-target";

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

const planPhoto = fc.record({
  id: fc.constantFrom("p1", "p2", "p3"),
  width: fc.oneof(fc.integer({ min: 1, max: 2000 }), fc.constant(0)),
  height: fc.integer({ min: 1, max: 2000 }),
  source: fc.constant({ width: 1920, height: 1080 }),
  greyMean: fc.oneof(
    fc.double({ min: 0, max: 255, noNaN: true }),
    fc.constant(-1),
  ),
});

const SHOTS = ["light-s1/L1", "light-s1/L2", "light-s1/L3", "flat-s1/F1"];

/** Every action of runs, saves and shot photos, valid or not. */
const busyAction: fc.Arbitrary<FeatureMatchAction> = fc.oneof(
  fc
    .record({ shot: fc.constantFrom(...SHOTS), photo: planPhoto })
    .map((p) => A.planShotTaken(p)),
  fc.constantFrom(...SHOTS).map((s) => A.planShotLost(s)),
  fc
    .constantFrom("synthetic" as const, "speed" as const)
    .map((k) => A.runStarted(k)),
  fc.string({ maxLength: 4 }).map((t) => A.runProgressed(t)),
  fc.constant(A.runFinished({ text: "done" })),
  fc.constant(A.runZipStarted()),
  fc
    .constantFrom("idle" as const, "saved" as const, "failed" as const)
    .map((phase) => A.runZipEnded({ phase, text: phase })),
  fc.constant(A.planReset()),
);

describe("one run or save at a time, properties", () => {
  // Why: these are the rules the page's buttons rely on; any action order
  // a user can produce must keep them.
  it("keeps busy, the run kind and the zip consistent", () => {
    fc.assert(
      fc.property(fc.array(busyAction, { maxLength: 40 }), (actions) => {
        for (const s of states(actions)) {
          expect(s.busy === "running").toBe(s.running !== null);
          // "saving" is exactly the run zip in preparation.
          expect(s.busy === "saving").toBe(s.runZip.phase === "preparing");
        }
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
      .record({ shot: fc.constantFrom(...SHOTS), photo: guidedPhoto })
      .map((p) => A.planShotTaken(p)),
    fc.integer({ min: -1, max: 14 }).map((i) => A.planMoved(i)),
    fc
      .option(
        fc.record({
          shot: fc.constantFrom(...SHOTS),
          left: fc.integer({ min: 0, max: 5 }),
        }),
      )
      .map((c) => A.guidedCountSet(c)),
    fc
      .constantFrom("synthetic" as const, "speed" as const)
      .map((k) => A.runStarted(k)),
    fc.constant(A.runFinished({ text: "done" })),
    fc.constant(A.planReset()),
  );

  // Why: the camera button trusts the countdown; a countdown for a shot
  // that is not on screen, or during a run, would take the wrong photo.
  it("keeps the countdown on the current shot, idle and at least 1", () => {
    fc.assert(
      fc.property(fc.array(guidedAction, { maxLength: 40 }), (actions) => {
        for (const s of states(actions)) {
          const { count } = s.guided;
          if (count) {
            expect(count.shot).toBe(currentShot(s.plan)?.id);
            expect(count.left).toBeGreaterThanOrEqual(1);
            expect(s.busy).toBe("idle");
          }
        }
      }),
    );
  });
});
