import { describe, expect, it } from "vitest";

import type { MeshData } from "./mesh-data.js";

import { isBuildingScalePoi } from "./poi-building-overlap.js";
import { POI_MODELS, poiModelFor } from "./poi-models.js";
import {
  POI_COLUMN_HEIGHT_M,
  POI_MARKER_MAX_HEIGHT_M,
  POI_SYMBOL_HEIGHT_M,
  POI_SYMBOL_SPAN_M,
} from "./poi-primitives.js";
import { POI_MODEL_LIMIT } from "./poi-ranking.js";

/**
 * Every POI model is non-degenerate (W7, closes half of F28).
 *
 * WHY THESE TESTS MATTER, and it is a specific gap rather than a general one.
 * DEC-R4-14 shipped fifty procedural models with **no contact sheet**, accepting
 * in writing that _"a tag that appears at none of the six fixture sites ships
 * without ever having been looked at"_. F28 then recorded the consequence
 * bluntly: _"the fifty POI models were judged by no one."_
 *
 * The gallery page (`gallery.html`) is the half only a person can do. This file
 * is the half a machine can, and the two answer different questions: a human
 * looking at a grid sees "the bench is too tall", while these catch the models a
 * human would never notice because they draw NOTHING — an empty mesh renders as
 * absence, and absence at a site with no such POI is indistinguishable from
 * correct behaviour.
 *
 * The height check is not redundant with the height being DERIVED. It is derived
 * from the mesh, so a model that accidentally built nothing gets a consistent,
 * self-agreeing height of zero — the two-sources-of-truth defect removed, and
 * the wrong answer preserved.
 */

const entries = [...POI_MODELS.values()];

describe("the POI model contract", () => {
  it("has a model for every kind the ranking asked for", () => {
    // The ranking picks the top N by global usage; the models are written to
    // match it. A mismatch means a kind is ranked in and silently unmodelled —
    // which falls back to no marker at all rather than to a placeholder.
    expect(POI_MODELS.size).toBe(POI_MODEL_LIMIT);
  });

  it("keys every model by its own kind", () => {
    // The map is built from `entry.kind`, so a copy-paste that left the previous
    // kind string in place would silently overwrite one model with another and
    // the count above would still pass.
    for (const model of entries) {
      expect(poiModelFor(model.kind)).toBe(model);
    }
  });

  it("gives every model geometry that actually exists", () => {
    // AN EMPTY MESH RENDERS AS NOTHING, which at a site with no such POI is
    // indistinguishable from working correctly. This is the check F28 says was
    // never made.
    const empty = entries.filter(
      (model) =>
        model.mesh.positions.length === 0 || model.mesh.indices.length === 0,
    );
    expect(empty.map((model) => model.kind)).toEqual([]);
  });

  it("gives every model a positive height", () => {
    // Derived from the mesh, so zero means the geometry is flat or absent rather
    // than that someone typed the wrong number.
    const flat = entries.filter((model) => !(model.heightM > 0));
    expect(flat.map((model) => model.kind)).toEqual([]);
  });

  it("keeps street furniture at street-furniture scale, and names every exception", () => {
    // The scale trap DEC-R4-14 named: "a bench the size of a kiosk". A loose
    // upper bound would pass a units error, so the taller models are PINNED by
    // name instead — any new one has to be added here deliberately.
    //
    // WHAT THE PINNED LIST REVEALED, and it is a finding rather than a formality
    // (see F33): every exception is a BUILDING mapped as a POI node. `poi.ts`
    // marks nodes only, and a hospital or a church is routinely mapped as BOTH a
    // node and a building way — so these draw an 8–15 m block inside the
    // building that `buildings.ts` already extruded from the same feature. That
    // is R5-7's defect in a second place: coarse geometry standing inside a
    // detailed model. Not fixed here; W3 fixed it for nested building outlines
    // only, and this is a different owner.
    //
    // THE PREDICATE IS CALLED, NOT RESTATED, and that is the whole point of this
    // version (DEC-S9). It read `model.heightM > 8` while `isBuildingScalePoi`
    // suppresses at `>= 8` — a disagreement on exactly one value, invisible for
    // as long as no model sat on it. Round 8 then adopted `amenity=bank` at a
    // target height of exactly 8.0 m, so the production rule began suppressing
    // FIVE kinds while this guard kept asserting four and stayed green. A bank
    // node inside a building had been vanishing ever since, undocumented.
    //
    // So the list this pins is now, by construction, the set the renderer
    // actually suppresses. `poi-building-overlap.ts`'s header claims a fifth
    // building-scale model would be "covered without anyone remembering to
    // update a list" — that was true of the rule and false of its test, and this
    // is what makes it true of both.
    const tall = entries
      .filter((model) => isBuildingScalePoi(model.kind))
      .map((model) => `${model.kind}=${model.heightM.toFixed(1)}`)
      .sort();
    expect(tall).toEqual([
      // Exactly on the 8 m threshold, and only caught once this test started
      // asking the production predicate instead of restating it.
      "amenity=bank=8.0",
      "leisure=sports_centre=9.0",
      // THIS LIST SHRINKS AS THE PORT LANDS, and that is the plan working seen
      // from the other end. `tourism=hotel` (13.5 m) left with batch A;
      // `amenity=hospital` (15.3) and `amenity=place_of_worship` (12.0) left
      // with batch C. Each is now a ~2.5 m symbol, so drawing it inside its own
      // building is no longer a duplicate volume but the label that building was
      // missing. It should reach EMPTY once all 27 are ported, at which point
      // the suppression rule has nothing left to suppress.
    ]);
  });

  describe("the family-S markers (DEC-S3, DEC-S4, DEC-S21)", () => {
    const familyS = entries.filter((entry) => entry.symbol !== undefined);

    it("has at least one, so the rest of this block cannot pass vacuously", () => {
      // A filter over an empty list satisfies every `for` below it. This is the
      // guard that makes the others mean something, and it is the shape round 8
      // was caught by twice.
      expect(familyS.length).toBeGreaterThan(0);
    });

    it("stands every symbol marker inside the shared envelope", () => {
      // DEC-S3 fixes the family at one height; DEC-S21 made that a CEILING
      // rather than an equality, because the envelope's span clamp binds first
      // for a wide symbol and leaves it shorter. So the assertion is a band: no
      // taller than column plus a full symbol, and no shorter than the column
      // itself plus something.
      for (const model of familyS) {
        expect(model.heightM).toBeLessThanOrEqual(
          POI_MARKER_MAX_HEIGHT_M + 1e-3,
        );
        expect(model.heightM).toBeGreaterThan(POI_COLUMN_HEIGHT_M);
      }
    });

    it("gives every symbol geometry that stands alone, base at zero", () => {
      // THE ASSERTION DEC-S4 EXISTS FOR. Half the time the symbol is drawn with
      // no column under it, floating over a building's roof, so a `symbol` that
      // is empty or that starts at the column top is unusable in exactly the
      // case the whole plan is for — and it would look perfectly fine in the
      // gallery, which is where it would otherwise be judged.
      for (const model of familyS) {
        const symbol = model.symbol as MeshData;
        expect(symbol.positions.length).toBeGreaterThan(0);
        expect(symbol.indices.length).toBeGreaterThan(0);
        let lowest = Infinity;
        let highest = -Infinity;
        for (let i = 1; i < symbol.positions.length; i += 3) {
          lowest = Math.min(lowest, symbol.positions[i] as number);
          highest = Math.max(highest, symbol.positions[i] as number);
        }
        expect(lowest).toBeCloseTo(0, 5);
        expect(highest).toBeLessThanOrEqual(POI_SYMBOL_HEIGHT_M + 1e-6);
        expect(highest).toBeGreaterThan(0);
      }
    });

    it("keeps the symbol's bounding box independent of the column", () => {
      // The mechanical form of "reads on its own": the symbol's own extent must
      // not be the merged marker's. If a port ever merged the column INTO the
      // symbol — the obvious mistake when copying a source that draws both
      // together — this is what would catch it, since the symbol's height would
      // suddenly match the marker's.
      for (const model of familyS) {
        const symbol = model.symbol as MeshData;
        let highest = -Infinity;
        for (let i = 1; i < symbol.positions.length; i += 3) {
          highest = Math.max(highest, symbol.positions[i] as number);
        }
        expect(highest).toBeLessThan(
          model.heightM - POI_COLUMN_HEIGHT_M + 1e-6,
        );
        expect(symbol.triangleCount).toBeLessThan(model.mesh.triangleCount);
      }
    });

    it("fits every symbol inside the envelope's span, not just its height", () => {
      // The clamp that made the height a range. A symbol wider than this is a
      // billboard on a 1.6 m post, which is the failure mode DEC-S21 rejected
      // "scale to height only" for.
      for (const model of familyS) {
        const symbol = model.symbol as MeshData;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < symbol.positions.length; i += 3) {
          minX = Math.min(minX, symbol.positions[i] as number);
          maxX = Math.max(maxX, symbol.positions[i] as number);
          minZ = Math.min(minZ, symbol.positions[i + 2] as number);
          maxZ = Math.max(maxZ, symbol.positions[i + 2] as number);
        }
        expect(Math.max(maxX - minX, maxZ - minZ)).toBeLessThanOrEqual(
          POI_SYMBOL_SPAN_M + 1e-6,
        );
      }
    });
  });

  it("produces only finite vertex positions", () => {
    // A NaN position silently drops triangles rather than reporting anything —
    // the same failure `site-geometry.test.ts` guards for buildings.
    for (const model of entries) {
      const bad = [...model.mesh.positions].filter(
        (value) => !Number.isFinite(value),
      );
      expect(bad).toEqual([]);
    }
  });

  it("indexes only vertices that exist", () => {
    // An out-of-range index is undefined behaviour in WebGL: it draws garbage or
    // nothing, depending on the driver, which is the worst kind of failure to
    // debug from a screenshot.
    for (const model of entries) {
      const vertexCount = model.mesh.positions.length / 3;
      const bad = [...model.mesh.indices].filter(
        (index) => index < 0 || index >= vertexCount,
      );
      expect(bad).toEqual([]);
    }
  });

  it("stands every model ON the ground rather than through it", () => {
    // The hunting stand shipped with its cabin at base 0, sitting around its
    // legs' feet — a hide at ground level (round-4 summary §2.3). Caught then by
    // a height check; pinned here so it stays caught.
    for (const model of entries) {
      let lowest = Infinity;
      for (let i = 1; i < model.mesh.positions.length; i += 3) {
        lowest = Math.min(lowest, model.mesh.positions[i] as number);
      }
      // A small tolerance: a kerb or a pad may sit fractionally below zero.
      expect(lowest).toBeGreaterThanOrEqual(-0.5);
    }
  });

  it("gives every model a colour in the packed 0xrrggbb range", () => {
    // A five-digit hex literal in the road palette parsed as a dark blue and
    // would have rendered service roads near-black (round-4 summary §2.3). Same
    // literal, same trap, different table.
    for (const model of entries) {
      expect(model.colour).toBeGreaterThanOrEqual(0);
      expect(model.colour).toBeLessThanOrEqual(0xffffff);
      expect(Number.isInteger(model.colour)).toBe(true);
    }
  });
});
