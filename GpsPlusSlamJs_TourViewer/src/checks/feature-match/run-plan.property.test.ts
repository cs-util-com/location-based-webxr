import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { slotList } from "./plan-slots";
import {
  EMPTY_PLAN,
  maxSequence,
  parsePlan,
  planReducer,
  planText,
  type PlanAction,
} from "./run-plan";

const slotArb = fc.constantFrom(
  "1a-s1",
  "1b-s1",
  "1c-s2",
  "2a-s1",
  "x1-s1",
  "9z-s1",
);
const actionArb: fc.Arbitrary<PlanAction> = fc.oneof(
  fc.record({
    type: fc.constant("photo" as const),
    slot: slotArb,
    which: fc.constantFrom("a" as const, "b" as const),
    photo: fc.record({
      id: fc.constantFrom("p1", "p2", "p3", "p4"),
      width: fc.constantFrom(0, 320, 640),
      height: fc.constant(240),
      source: fc.constant({ width: 640, height: 480 }),
      greyMean: fc.constantFrom(0, 2, 60, 120, 250),
    }),
  }),
  fc.record({
    type: fc.constant("lost" as const),
    slot: slotArb,
    which: fc.constantFrom("a" as const, "b" as const),
  }),
  fc.record({
    type: fc.constant("size" as const),
    spots: fc.integer({ min: 0, max: 4 }),
    extra: fc.integer({ min: -1, max: 3 }),
  }),
  fc.record({
    type: fc.constant("move" as const),
    index: fc.integer({ min: -1, max: 30 }),
  }),
  fc.record({
    type: fc.constant("keep" as const),
    id: fc.constantFrom("k1", "k2", "k3"),
    name: fc.constantFrom("", "a.zip", "b.zip"),
    slot: slotArb,
  }),
  fc.record({
    type: fc.constant("downloaded" as const),
    ids: fc.subarray(["k1", "k2", "k3"]),
  }),
  fc.constant({ type: "run-downloaded" as const }),
  fc.constant({ type: "drop-downloaded" as const }),
  fc.constant({ type: "reset" as const }),
  fc.record({
    type: fc.constant("settings" as const),
    settings: fc.record(
      {
        save: fc.constantFrom("each", "end", "x"),
        countdown: fc.constantFrom(0, 3, 4, 5),
        sound: fc.boolean(),
      },
      { requiredKeys: [] },
    ),
  }),
);

describe("the run plan, for any action sequence", () => {
  // Why: these are the rules every view leans on: a refused action leaves
  // the very same object (the store's `accepted`), numbers never fall and
  // never pass the running number, slots and files stay inside the list,
  // and what is written reads back unchanged.
  it("keeps its invariants and survives a write and read", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
        let plan = EMPTY_PLAN;
        let sequence = 0;
        for (const a of actions) {
          const next = planReducer(plan, sequence, a);
          expect(next.sequence).toBeGreaterThanOrEqual(sequence);
          expect(next.plan !== plan || next.sequence === sequence).toBe(true);
          plan = next.plan;
          sequence = next.sequence;
          const ids = new Set(
            slotList(plan.spots, plan.extra).map((s) => s.id),
          );
          expect(Object.keys(plan.slots).every((k) => ids.has(k))).toBe(true);
          expect(plan.current).toBeLessThan(ids.size);
          expect(maxSequence(plan)).toBeLessThanOrEqual(sequence);
          const keptIds = plan.kept.map((k) => k.id);
          expect(new Set(keptIds).size).toBe(keptIds.length);
          expect(plan.kept.every((k) => ids.has(k.slot))).toBe(true);
          expect(parsePlan(planText(plan))).toEqual(plan);
        }
      }),
    );
  });
});
