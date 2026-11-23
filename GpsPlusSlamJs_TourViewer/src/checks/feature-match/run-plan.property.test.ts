import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  EMPTY_PLAN,
  parsePlan,
  planReducer,
  planShots,
  planText,
  type PlanAction,
} from "./run-plan";

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
});
