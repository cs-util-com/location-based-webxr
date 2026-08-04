import { describe, expect, it } from "vitest";

import { POI_MODELS } from "gps-plus-slam-osm";

import { galleryPositions, rowLabel } from "./gallery.js";

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
    // The pad is 6.4 m and the pitch is 11.2 m, so no two centres may be closer
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
    // That is still true, and MORE so since the owner asked for three times the
    // clear ground: fifty kinds at an 11.2 m pitch is a 549 m row, up from 400.
    // It was reversed under DEC-R6-32 because the square grid used Z for its own
    // rows, so variants had nowhere unambiguous to go: a variant placed behind a
    // kind would land on the kind in the next row. Panning is now part of using
    // the page, accepted deliberately — and the wider gaps make it more panning,
    // which is the trade the owner chose knowing the page.
    const flat = galleryPositions(fifty).flat();
    const width =
      Math.max(...flat.map((at) => at.x)) - Math.min(...flat.map((at) => at.x));
    const depth =
      Math.max(...flat.map((at) => at.z)) - Math.min(...flat.map((at) => at.z));
    // Spelled as pad + gap rather than as a pitch constant, so this reads as the
    // same arithmetic the layout does instead of as a number to re-copy.
    expect(width).toBeCloseTo(49 * (6.4 + 1.6 * 3), 6);
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

describe("what the catalogue shows", () => {
  /**
   * WHY THIS TEST EXISTS, and it is not a layout test. The page's whole job is
   * to show EVERY modelled kind — it is the only place in the repo where a
   * human can see what a "bicycle parking" or a "hunting stand" actually looks
   * like at real scale. A kind silently missing from the sheet is invisible:
   * the page still renders, still looks correct, and simply does not contain
   * the thing you went there to check.
   *
   * It used to assert the shape of a COMPARISON — how many liked alternatives
   * stood behind each kind — because the page existed to help the owner choose.
   * They chose (DEC-R7b-2a), the winners were adopted, and the losers are
   * deleted, so what is worth pinning now is coverage rather than depth.
   */
  const kinds = [...POI_MODELS.values()].map((model) => model.kind);

  it("gives every modelled kind exactly one pad", () => {
    const positions = galleryPositions(kinds.map(() => 1));
    expect(positions).toHaveLength(kinds.length);
    for (const slots of positions) expect(slots).toHaveLength(1);
  });

  it("shows all fifty kinds, so nothing is unreviewable", () => {
    // A floor rather than an equality: adding a model should not fail this, but
    // dropping one from the registry without noticing should.
    expect(kinds.length).toBeGreaterThanOrEqual(50);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("rowLabel — the catalogue's label", () => {
  /**
   * WHY THIS SHRANK TO ONE LINE (DEC-R7b-2a). The page used to show every kind's
   * liked alternatives beside the shipped model, and the label carried the
   * source letter plus a `← chosen` mark so the next look at the gallery
   * double-checked a verdict that had been transcribed by ear.
   *
   * The verdict has been adopted — the winners ARE the shipped models — and the
   * losing geometry is deleted, so there is no second thing on the pad to name
   * and no second table to check against. What is left is a catalogue, and a
   * catalogue entry is its kind.
   */
  it("labels an entry with its kind and nothing else", () => {
    expect(rowLabel("amenity=toilets")).toBe("amenity=toilets");
    expect(rowLabel("amenity=cafe")).toBe("amenity=cafe");
  });

  it("adds no marker, because there is nothing left to mark", () => {
    // Guards against the old behaviour coming back by accident: a "← chosen"
    // mark would now be claiming a comparison that no longer exists.
    expect(rowLabel("amenity=bench")).not.toContain("←");
  });
});
