import { describe, expect, it } from "vitest";

import { sameJson } from "./same-json.js";

/**
 * Why these tests matter: a tour's frames are compared with the written
 * file's to count changes and to guard leaving the page. Key order is how
 * a value was BUILT, not what it is, so it must never count as a change;
 * everything else JSON would tell apart still must.
 */
describe("sameJson", () => {
  it("ignores the order of an object's keys, at any depth", () => {
    expect(
      sameJson(
        { id: "s", geo: { lat: 1, lon: 2, alt: 3, headingDeg: 90 } },
        { geo: { headingDeg: 90, alt: 3, lon: 2, lat: 1 }, id: "s" },
      ),
    ).toBe(true);
    expect(
      sameJson(
        [{ a: 1, b: [{ c: 2, d: 3 }] }],
        [{ b: [{ d: 3, c: 2 }], a: 1 }],
      ),
    ).toBe(true);
  });

  it("tells apart a changed value, a missing key and another array order", () => {
    expect(sameJson({ lat: 1, lon: 2 }, { lat: 1, lon: 2.0000001 })).toBe(
      false,
    );
    expect(sameJson({ lat: 1, lon: 2 }, { lat: 1 })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: [1] }, { a: 1 })).toBe(false);
  });

  it("keeps JSON's semantics: an undefined-valued key is absent", () => {
    expect(sameJson({ a: 1, title: undefined }, { a: 1 })).toBe(true);
    expect(sameJson(undefined, undefined)).toBe(true);
    expect(sameJson(null, undefined)).toBe(false);
  });

  // Why: a parsed tour file can carry an own "__proto__" key. Copying it
  // into a plain object hit the prototype setter, so the key dropped out of
  // the serialization and two versions differing only under it read as the
  // same (the property test found it: {"__proto__":0,"":0}).
  it("tells apart values that differ only under an own __proto__ key", () => {
    const a: unknown = JSON.parse('{"__proto__":1}');
    const b: unknown = JSON.parse('{"__proto__":2}');
    expect(sameJson(a, b)).toBe(false);
    expect(sameJson({ geo: a }, { geo: b })).toBe(false);
    expect(sameJson(a, JSON.parse('{"__proto__":1}'))).toBe(true);
  });
});
