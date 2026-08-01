import { describe, expect, it } from "vitest";

import { POI_MODELS, poiModelFor } from "./poi-models.js";
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
    // (see F33): all four exceptions are BUILDINGS mapped as POI nodes. `poi.ts`
    // marks nodes only, and a hospital or a church is routinely mapped as BOTH a
    // node and a building way — so these four draw a 9–15 m block inside the
    // building that `buildings.ts` already extruded from the same feature. That
    // is R5-7's defect in a second place: coarse geometry standing inside a
    // detailed model. Not fixed here; W3 fixed it for nested building outlines
    // only, and this is a different owner.
    const tall = entries
      .filter((model) => model.heightM > 8)
      .map((model) => `${model.kind}=${model.heightM.toFixed(1)}`)
      .sort();
    expect(tall).toEqual([
      "amenity=hospital=15.3",
      "amenity=place_of_worship=12.0",
      "leisure=sports_centre=9.0",
      "tourism=hotel=13.5",
    ]);
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
