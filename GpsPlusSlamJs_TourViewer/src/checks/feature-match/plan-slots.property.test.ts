import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  doneCount,
  MAX_EXTRA,
  MAX_SPOTS,
  nextStep,
  slotList,
  slotStatus,
  type PairLike,
} from "./plan-slots";

const lightArb = fc.constantFrom(
  null,
  "ok",
  "not-darker",
  "too-dark-a",
  "too-dark-b",
  "changed",
) as fc.Arbitrary<PairLike["light"]>;
const pairArb: fc.Arbitrary<PairLike> = fc.record({
  a: fc.constantFrom(null, { greyMean: 1 }),
  b: fc.constantFrom(null, { greyMean: 1 }),
  light: lightArb,
});

describe("plan slots, for any counts and pairs", () => {
  // Why: the ids name zip folders and pairs-record keys; a duplicate would
  // let two pairs overwrite each other.
  it("gives unique ids, light pairs first, at most the caps", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 9 }),
        fc.integer({ min: -5, max: 20 }),
        (s, x) => {
          const list = slotList(s, x);
          const ids = list.map((l) => l.id);
          expect(new Set(ids).size).toBe(ids.length);
          expect(list.length).toBeGreaterThanOrEqual(14);
          expect(list.length).toBeLessThanOrEqual(
            3 * MAX_SPOTS + 11 + MAX_EXTRA,
          );
          const firstOther = list.findIndex((l) => !l.key.startsWith("1"));
          expect(
            list.slice(firstOther).every((l) => !l.key.startsWith("1")),
          ).toBe(true);
        },
      ),
    );
  });

  // Why: the primary button never points at a done pair, never offers the
  // current pair as "missing", and ends only when nothing else is open.
  it("steps only to pairs not done and ends only when nothing else is open", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.array(pairArb, { minLength: 30, maxLength: 30 }),
        fc.integer({ min: -1, max: 30 }),
        (s, x, raw, cur) => {
          const list = slotList(s, x);
          const pairs = Object.fromEntries(
            list.map((l, i) => [l.id, raw[i] as PairLike]),
          );
          const step = nextStep(list, pairs, cur);
          const done = doneCount(list, pairs);
          expect(done).toBeLessThanOrEqual(list.length);
          const st = list.map((l) => slotStatus(pairs[l.id]));
          const openElsewhere = st.some(
            (x, i) => i !== cur && (x === "missing" || x === "half"),
          );
          const notDoneAfter = st.some((x, i) => i > cur && x !== "done");
          expect(step.kind === "end").toBe(!openElsewhere && !notDoneAfter);
          expect(done < list.length || step.kind === "end").toBe(true);
          const index = step.kind === "end" ? -1 : step.index;
          expect(step.kind === "end" || st[index] !== "done").toBe(true);
          expect(step.kind !== "next" || index > cur).toBe(true);
          expect(step.kind !== "missing" || index !== cur).toBe(true);
        },
      ),
    );
  });
});
