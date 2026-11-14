import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  isPartialOverpassAnswer,
  partialOverpassRemark,
} from "./overpass-source.js";

// Why these tests matter: the remark test decides whether a whole tile is
// refused. An empty or whitespace remark says nothing about a cut answer
// and must pass; any other remark, of any type, must be refused (fail
// closed), and the text it yields for the log is one bounded line whatever
// an operator wrote.
describe("partialOverpassRemark", () => {
  it("refuses exactly the remarks with content, as one bounded line", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2_000 }), (remark) => {
        const text = partialOverpassRemark({ elements: [], remark });
        const hasContent = remark.trim() !== "";
        expect(text !== undefined).toBe(hasContent);
        expect(isPartialOverpassAnswer({ remark })).toBe(hasContent);
        expect(text ?? "").not.toMatch(/[\r\n]/);
        expect((text ?? "").length).toBeLessThanOrEqual(201);
      }),
    );
  });

  it("refuses a remark that is not a string, and passes an answer without one", () => {
    for (const remark of [0, 1, true, null, {}, ["x"]]) {
      expect(isPartialOverpassAnswer({ remark })).toBe(true);
      expect(partialOverpassRemark({ remark })).toBeDefined();
    }
    expect(partialOverpassRemark({ elements: [] })).toBeUndefined();
    expect(partialOverpassRemark(null)).toBeUndefined();
    expect(partialOverpassRemark("remark")).toBeUndefined();
  });
});
