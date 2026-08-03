import { describe, expect, it } from "vitest";

import { POI_MODELS, poiVariantsFor } from "gps-plus-slam-osm";

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

describe("what the gallery actually offers to compare", () => {
  /**
   * WHY THIS TEST EXISTS, and it is not a layout test. The 51 ported variants
   * are worth exactly what the owner can SEE side by side, and the thing that
   * decides that is how many rows deep each kind goes. A kind with one row is a
   * model nobody is choosing between; a kind with four is a real comparison.
   *
   * The port is finished, so this pins the shape of the comparison the owner is
   * being asked to judge. If a later change to `POI_VARIANTS` or to the
   * shared-mesh filter quietly collapses a multi-row kind back to one, the
   * gallery would still render and still look correct — and the comparison
   * would simply be gone. That is the failure this catches.
   */
  const rows = [...POI_MODELS.values()].map((model) => ({
    kind: model.kind,
    // The same filter `buildGallery` applies: the seven §4 rebuilds are
    // re-exposed as their own `L` variant, and showing one mesh twice under two
    // labels is not a comparison.
    depth:
      1 +
      poiVariantsFor(model.kind).filter((v) => v.mesh !== model.mesh).length,
  }));

  it("gives 34 of the 50 kinds more than one model to choose between", () => {
    // 34 is every kind the owner named, which is the whole point: each one gets
    // its liked version(s) standing beside the incumbent. The remaining 16 were
    // never mentioned, so there is nothing to compare and one row is correct.
    // A FLOOR rather than an equality — adding a variant is progress, losing
    // one is the regression this guards.
    const multi = rows.filter((r) => r.depth > 1);
    expect(multi.length).toBeGreaterThanOrEqual(34);
  });

  it("puts four rows on the kind three prototypes disagreed about", () => {
    // `amenity=fast_food` is liked from B, G and M — the deepest disagreement
    // in the owner's notes, and therefore the single best test of DEC-V5: if
    // scaling a diorama model to the shipped height preserves what was liked,
    // it has to hold across three sources at once.
    const fastFood = rows.find((r) => r.kind === "amenity=fast_food");
    expect(fastFood?.depth).toBe(4);
  });

  it("never shows one kind more rows than the sheet can lay out", () => {
    // `galleryPositions` recedes variants along Z from a shared origin, so an
    // unbounded depth would push a row into the next kind's pad. Six is well
    // inside the pitch; this is the guard, not a prediction.
    for (const row of rows) expect(row.depth).toBeLessThanOrEqual(6);
  });

  it("leaves no kind without at least the shipped model", () => {
    expect(rows.every((r) => r.depth >= 1)).toBe(true);
    expect(rows).toHaveLength(50);
  });
});

describe("pad spacing", () => {
  it("leaves three times the clear ground the first layout did", () => {
    // THE OWNER'S ONE GLOBAL NOTE on the first gallery: "insgesamt bitte mehr
    // Abstand zwischen den Kacheln, mindestens dreimal so viel Platz lassen".
    // The original pitch was 8 m over a 6.4 m pad — a 1.6 m gap, which reads as
    // a grid of touching tiles rather than as one candidate per pad.
    //
    // Asserted as a GAP rather than as a pitch, because the pitch is meaningless
    // without the pad size beside it: someone who later grows the pad would
    // satisfy a pitch assertion while closing the gap back up.
    const rows = galleryPositions([1, 1, 1]);
    const first = rows[0]?.[0];
    const second = rows[1]?.[0];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const gap = Math.abs((second?.x as number) - (first?.x as number)) - 6.4;
    expect(gap).toBeGreaterThanOrEqual(1.6 * 3);
  });

  it("opens up the receding axis by the same amount, not just the row", () => {
    // Variants recede on Z, so a gap widened only on X would leave each kind's
    // own alternatives as cramped as before — and those are the ones actually
    // being compared against each other.
    const slots = galleryPositions([3])[0];
    expect(slots).toBeDefined();
    const gap =
      Math.abs((slots?.[1]?.z as number) - (slots?.[0]?.z as number)) - 6.4;
    expect(gap).toBeGreaterThanOrEqual(1.6 * 3);
  });
});

describe("rowLabel — showing the owner's verdict back to them", () => {
  /**
   * WHY THE PAGE CARRIES THE VERDICT. 34 kinds were decided aloud in one pass
   * and transcribed by ear. A mis-transcription is invisible in a table and
   * obvious on the model it is attached to, so marking the chosen row makes the
   * next look at the gallery a check of the RECORD as well as of the models.
   */
  it("marks the row the owner chose", () => {
    expect(rowLabel("amenity=cafe", "L", 4)).toContain("← chosen");
    expect(rowLabel("amenity=cafe", "D", 4)).not.toContain("← chosen");
  });

  it("marks the incumbent when the incumbent won", () => {
    // Q-V1 anticipated this and it happened twice. "shipped" has to be markable
    // or those two kinds would read as undecided.
    expect(rowLabel("amenity=bench", "shipped", 2)).toContain("← chosen");
    expect(rowLabel("amenity=bench", "D", 2)).not.toContain("← chosen");
  });

  it("leaves an undecided kind unmarked rather than defaulting to shipped", () => {
    // `amenity=parking` and `leisure=swimming_pool` were unjudgeable because of
    // the DEC-V6 scale defect, and `amenity=pharmacy` was never mentioned.
    // "Not yet decided" and "the incumbent won" are different states, and
    // collapsing them would quietly manufacture three verdicts.
    for (const kind of [
      "amenity=parking",
      "leisure=swimming_pool",
      "amenity=pharmacy",
    ]) {
      expect(rowLabel(kind, "shipped", 3)).not.toContain("← chosen");
    }
  });

  it("drops the source suffix for a kind with nothing to compare", () => {
    // A single-row kind has no alternative, so " · shipped" would be noise on
    // 16 of the 50 pads.
    expect(rowLabel("amenity=toilets", "shipped", 1)).toBe("amenity=toilets");
  });
});
