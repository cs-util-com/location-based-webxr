import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  EMPTY_PLAN,
  parsePlan,
  planPhotos,
  planReducer,
  planShots,
  planText,
  type PlanAction,
  type RunPlan,
} from "./run-plan";
import { needsRetake, nextOpen } from "./scenes";

const shotArb = fc.constantFrom(
  "light-s1/L1",
  "light-s1/L2",
  "light-s2/L4",
  "flat-s1/F1",
  "flat-s1/F2",
  "deep-s1/D3",
  "own-1/X1",
  "own-9/X1",
  "nope",
);
const actionArb: fc.Arbitrary<PlanAction> = fc.oneof(
  fc.record({
    type: fc.constant("photo" as const),
    shot: shotArb,
    photo: fc.record({
      id: fc.constantFrom("p1", "p2", "p3", "p4"),
      width: fc.constantFrom(0, 320, 640),
      height: fc.constant(240),
      source: fc.constant({ width: 640, height: 480 }),
      greyMean: fc.constantFrom(0, 2, 60, 120, 250),
    }),
  }),
  fc.record({ type: fc.constant("lost" as const), shot: shotArb }),
  fc.record({
    type: fc.constant("size" as const),
    spots: fc.integer({ min: 0, max: 4 }),
    extra: fc.integer({ min: -1, max: 3 }),
  }),
  fc.record({
    type: fc.constant("move" as const),
    index: fc.integer({ min: -1, max: 40 }),
  }),
  fc.record({
    type: fc.constant("settings" as const),
    settings: fc.constantFrom<Record<string, unknown>>(
      { countdown: 0 },
      { capture: "tap" },
      { save: "each" },
    ),
  }),
  fc.constant({ type: "reset" as const }),
);

/** What a photo action did: refused (the same plan), or its take and position. */
const photoStep = (p: RunPlan, next: RunPlan, shot: string) =>
  next === p
    ? { refused: true }
    : { take: next.shots[shot]?.take, current: next.current };

/** What the photo rule says that action must do. */
function expectedStep(p: RunPlan, a: PlanAction & { type: "photo" }) {
  const list = planShots(p);
  const index = list.findIndex((s) => s.id === a.shot);
  if (index < 0 || a.photo.width <= 0) return { refused: true };
  const take = (p.shots[a.shot]?.take ?? 0) + 1;
  const photos = planPhotos({
    ...p,
    shots: { ...p.shots, [a.shot]: { photo: a.photo, take } },
  });
  const current =
    index !== p.current
      ? p.current
      : needsRetake(a.shot, photos)
        ? index
        : (nextOpen(list, photos, index) ?? index);
  return { take, current };
}

describe("run plan properties", () => {
  // Why: any sequence of taps keeps the run inside its list and every
  // stored shot a shot of the list, and the plan survives storage.
  it("keeps current and every record inside the list, and round-trips", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
        let p = EMPTY_PLAN;
        for (const a of actions) {
          p = planReducer(p, a);
          const ids = planShots(p).map((s) => s.id);
          expect(p.current >= 0 && p.current < ids.length).toBe(true);
          for (const id of Object.keys(p.shots)) {
            expect(ids).toContain(id);
          }
        }
        expect(parsePlan(planText(p))).toEqual(p);
      }),
    );
  });

  // Why: the walk through the shots is the reducer's main rule and both
  // views trust it; a unit test pins a few paths, this pins every path:
  // an accepted photo of the current shot moves on unless its light check
  // failed, a photo of any other shot leaves the position alone, the take
  // rises by one, and a refused photo changes nothing at all.
  it("walks the shots by the photo rule", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
        let p: RunPlan = EMPTY_PLAN;
        const got: unknown[] = [];
        const want: unknown[] = [];
        for (const a of actions) {
          const next = planReducer(p, a);
          if (a.type === "photo") {
            got.push(photoStep(p, next, a.shot));
            want.push(expectedStep(p, a));
          }
          p = next;
        }
        expect(got).toEqual(want);
      }),
    );
  });
});
