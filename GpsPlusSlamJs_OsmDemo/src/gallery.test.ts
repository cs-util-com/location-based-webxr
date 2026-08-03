import { describe, expect, it } from "vitest";

import { galleryPositions } from "./gallery.js";

/**
 * The gallery's layout arithmetic (W7, DEC-R6-32).
 *
 * WHY THIS IS THE ONLY UNIT-TESTED PART. `buildGallery` needs a `WebGLRenderer`
 * and cannot be constructed here — the same constraint `building-view` lives
 * under. What CAN be wrong without a GPU is the layout: models overlapping each
 * other, or the whole sheet drifting off-centre so the default camera frames
 * half of it. Both look like "the page is broken" rather than like a layout bug.
 *
 * The e2e half — that the page loads, draws something, and logs no error — is in
 * `osm-demo.spec.js`.
 */

describe("galleryPositions", () => {
  const fifty = Array.from({ length: 50 }, () => 1);

  it("gives every kind and every variant its own place", () => {
    const rows = galleryPositions([1, 3, 2]);
    const flat = rows.flat();
    expect(flat).toHaveLength(6);
    expect(new Set(flat.map((at) => `${at.x},${at.z}`)).size).toBe(6);
  });

  it("keeps pads from overlapping, on BOTH axes", () => {
    // The pad is 6.4 m and the pitch is 8 m, so no two centres may be closer
    // than the pad width. A fuel-station canopy overhanging its neighbour's
    // bench is exactly the confusion this page exists to remove — and with
    // variants on z that now has to hold between a kind and its own alternatives
    // as well as between neighbouring kinds.
    const flat = galleryPositions([3, 3, 1, 2]).flat();
    for (let i = 0; i < flat.length; i += 1) {
      for (let j = i + 1; j < flat.length; j += 1) {
        const a = flat[i];
        const b = flat[j];
        if (a === undefined || b === undefined) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(6.4);
      }
    }
  });

  it("puts variants BEHIND the shipped model, not in front of it", () => {
    // Index 0 is the model the demo actually draws. The default camera sits on
    // +z looking at the origin, so the incumbent has to be the nearest of the
    // row or the comparison opens with an alternative in front of it.
    const [row] = galleryPositions([3]);
    if (row === undefined) throw new Error("no row");
    expect(row[0]?.z).toBeGreaterThan(row[1]?.z ?? Infinity);
    expect(row[1]?.z).toBeGreaterThan(row[2]?.z ?? Infinity);
  });

  it("keeps every variant of one kind on the same x", () => {
    // The whole point of the z axis carrying variants: "next kind" and "next
    // variant" have to be different movements, or the sheet reads as one long
    // undifferentiated row.
    for (const row of galleryPositions([1, 4, 2])) {
      expect(new Set(row.map((at) => at.x)).size).toBeLessThanOrEqual(1);
    }
  });

  it("centres the sheet on the origin", () => {
    // The default camera looks at (0,0,0). A sheet laid out from the origin
    // OUTWARD rather than around it puts most of the models off screen on first
    // load, which reads as "only twelve models exist".
    const flat = galleryPositions([1, 3, 1, 2, 1]).flat();
    const xs = flat.map((at) => at.x);
    const zs = flat.map((at) => at.z);
    expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2)).toBeLessThan(
      0.001,
    );
    expect(Math.abs((Math.min(...zs) + Math.max(...zs)) / 2)).toBeLessThan(
      0.001,
    );
  });

  it("IS a single long row of kinds, which reverses the old square grid", () => {
    // THE OLD RULE SAID THE OPPOSITE, and the reversal is kept visible rather
    // than deleted. It read:
    //
    //   "A 1x50 strip is a valid grid and a useless one: it cannot be framed,
    //    and comparing the first model with the last needs a camera journey."
    //
    // That is still true — fifty kinds at an 8 m pitch is a 400 m row. It was
    // reversed under DEC-R6-32 because the square grid used Z for its own rows,
    // so variants had nowhere unambiguous to go: a variant placed behind a kind
    // would land on the kind in the next row. Panning is now part of using the
    // page, accepted deliberately.
    const flat = galleryPositions(fifty).flat();
    const width =
      Math.max(...flat.map((at) => at.x)) - Math.min(...flat.map((at) => at.x));
    const depth =
      Math.max(...flat.map((at) => at.z)) - Math.min(...flat.map((at) => at.z));
    expect(width).toBeCloseTo(49 * 8, 6);
    expect(depth).toBe(0);
  });

  it("handles the degenerate counts without dividing by zero", () => {
    // Not hypothetical: the counts come from data, and a filter applied upstream
    // one day could hand this an empty list or a kind with no variants at all.
    expect(galleryPositions([])).toEqual([]);
    expect(galleryPositions([1])).toEqual([[{ x: 0, z: 0 }]]);
    expect(galleryPositions([0])).toEqual([[]]);
  });
});
