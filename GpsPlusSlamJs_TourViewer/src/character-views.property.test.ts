import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { beckonNext, lineReadingMs, readingFloor } from "./character-views";

describe("character views (properties)", () => {
  /**
   * Why this property matters: the beckon never points at the station he
   * stands at nor at one already done, and under "any" order it exists
   * only when one station remains.
   */
  it("beckons only at an undone other station", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("fixed" as const, "any" as const),
        fc.array(fc.constantFrom("waiting", "found", "done"), { maxLength: 8 }),
        fc.nat(9),
        (order, states, at) => {
          const stations = states.map((state, i) => ({
            id: `s${String(i)}`,
            state,
          }));
          const current = `s${String(at)}`;
          const next = beckonNext({ order, stations }, current);
          const undone = stations.filter(
            (s) => s.id !== current && s.state !== "done",
          );
          // Fixed order: the first undone other station; any order: the
          // one undone station left, and none while several are.
          const want =
            order === "any"
              ? undone.length === 1
                ? (undone[0]?.id ?? null)
                : null
              : (undone[0]?.id ?? null);
          expect(next).toBe(want);
          expect(next).not.toBe(current);
        },
      ),
    );
  });

  /** Why this property matters: the reading time bounds the lineEnd wait
   *  for any caption, and the reading floor never shrinks the text. */
  it("bounds the reading time and never lets the floor shrink text", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 600 }),
        fc.double({ noNaN: false }),
        (text, d) => {
          const ms = lineReadingMs(text);
          expect(ms).toBeGreaterThanOrEqual(1500);
          expect(ms).toBeLessThanOrEqual(60_000);
          expect(readingFloor(d)).toBeGreaterThanOrEqual(1);
        },
      ),
    );
  });
});
