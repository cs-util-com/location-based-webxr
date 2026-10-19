import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { sameJson } from "./same-json.js";

/**
 * Why these properties matter: the example tests pin the cases someone
 * thought of; these pin the contract over any JSON value. The same data
 * with its keys in another order is the same; whatever plain
 * `JSON.stringify` calls equal, this does too (it only ever forgives key
 * order); and the answer does not depend on which side is which.
 */

/** The same value with every object's keys in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([k, v]) => [k, reversedKeys(v)]),
  );
}

describe("sameJson (properties)", () => {
  it("a value equals itself with its keys in another order", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(sameJson(v, reversedKeys(v))).toBe(true);
      }),
    );
  });

  it("equal by JSON.stringify implies equal here: a value and its JSON round trip", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const copy: unknown = JSON.parse(JSON.stringify(v));
        expect(sameJson(v, copy)).toBe(true);
      }),
    );
  });

  it("the answer is symmetric", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        expect(sameJson(a, b)).toBe(sameJson(b, a));
      }),
    );
  });

  it("a changed leaf is a change, wherever it sits", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.integer(), { minKeys: 1 }),
        (record) => {
          const [key] = Object.keys(record);
          const changed = { ...record, [key!]: record[key!]! + 1 };
          expect(sameJson({ geo: record }, { geo: changed })).toBe(false);
        },
      ),
    );
  });
});
