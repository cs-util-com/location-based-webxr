/**
 * The printed side length's field, in centimetres (polish round M0b, A15:
 * "0.16 m" read as a strange number for a poster).
 *
 * Why these tests matter: five modules read this one field, and every one
 * of them works in metres - the pose solve's unit. A reader that forgot to
 * convert would measure the world a hundred times too large, silently. So
 * the conversion lives here once, and the field's text is never read
 * anywhere else.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { readSideM, writeSideM } from "./printed-side.js";

const field = (value: string) => ({ value });

describe("readSideM", () => {
  it("reads centimetres as metres", () => {
    expect(readSideM(field("18"))).toBe(0.18);
    expect(readSideM(field("5.5"))).toBeCloseTo(0.055, 12);
  });

  it("reads an empty or broken field as not a size", () => {
    for (const bad of ["", " ", "abc", "-3", "0", "Infinity"]) {
      expect(readSideM(field(bad)), bad).toBeNaN();
    }
  });
});

describe("writeSideM", () => {
  it("writes metres as centimetres, to a tenth", () => {
    const f = field("");
    writeSideM(f, 0.18);
    expect(f.value).toBe("18");
    writeSideM(f, 0.1534);
    expect(f.value).toBe("15.3");
  });

  it("round-trips any size to a tenth of a centimetre (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 2000 }), (mm10) => {
        // mm10 tenths of a millimetre... as metres, on the field's grid.
        const m = Math.round(mm10) / 10 / 100;
        const f = field("");
        writeSideM(f, m);
        expect(readSideM(f)).toBeCloseTo(m, 9);
      }),
    );
  });
});
