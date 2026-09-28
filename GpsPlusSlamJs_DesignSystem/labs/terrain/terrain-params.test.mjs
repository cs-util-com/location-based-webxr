/**
 * Tests for the terrain lab's place, field and hash parameters (terrain plan
 * 2026-09-27-0605 §4 "The control plate and the hash", DEC-TR-3/4, §9
 * findings 9, 14 and 20).
 *
 * Why this file matters: the hash is the lab's one state, so a link the
 * owner sends reproduces a view. A malformed or out-of-range value must read
 * as the default, never as NaN reaching a shader uniform (a NaN height
 * removes the whole draw with no error). The field's geometry is pinned
 * because the padding ring must cover the sky-view march, or the region's
 * edge darkens for no reason in the terrain.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  FIELD,
  PARAMS,
  TERRAIN_PLACES,
  fieldSpec,
  readTerrainParams,
} from "./terrain-params.js";

describe("the Appalachians place", () => {
  // DEC-TR-3 and plan §9 finding 8: the Blue Ridge, a 256 km region at z8.
  it("is a 256 km square over the Blue Ridge at z8", () => {
    const p = TERRAIN_PLACES.appalachians;
    assert.deepEqual(p.centre, { lat: 37.9, lng: -79.2 });
    assert.equal(p.halfExtentM, 128_000);
    assert.equal(p.zoom, 8);
  });
});

describe("fieldSpec", () => {
  const spec = fieldSpec(TERRAIN_PLACES.appalachians);

  // The grid is metric ENU at about the z8 texel pitch (482 m at 37.9° N),
  // posts on both edges, with the padding ring around the drawn region.
  it("grids the region and its padding at the post spacing", () => {
    assert.equal(spec.extentM, 136_000);
    assert.equal(spec.side, 545);
    assert.equal((spec.extentM * 2) / (spec.side - 1), FIELD.spacingM);
  });

  // Plan §9 finding 14: the padding ring is at least the sky-view search
  // radius, or the march reads past the data and the region's edge darkens.
  // The march is FIELD.svfSteps, the one value the lab runs: the hash sets
  // the directions only (32 steps would need 16 km of padding).
  it("pads at least the sky-view march the lab runs", () => {
    assert.ok(
      FIELD.padM >= FIELD.svfSteps * FIELD.spacingM,
      `${FIELD.padM} m < ${FIELD.svfSteps} x ${FIELD.spacingM} m`,
    );
  });
  it("gives the hash no key for the march's steps", () => {
    assert.ok(!("steps" in PARAMS) && !("svfSteps" in PARAMS));
  });
  it("pads at least three blur sigmas", () => {
    assert.ok(FIELD.padM >= 3 * FIELD.reliefSigmaM);
  });
});

describe("readTerrainParams", () => {
  it("reads an empty hash as every default: the slider at 2, auto off", () => {
    const p = readTerrainParams("");
    assert.equal(p.exag, 2);
    assert.equal(p.auto, 0);
    assert.equal(p.place, "appalachians");
    assert.equal(p.style, "pastel");
    assert.equal(p.camera, null);
    assert.equal(p.preset, null);
    for (const [name, { fallback }] of Object.entries(PARAMS)) {
      assert.equal(p[name], fallback, name);
    }
  });

  it("reads values inside their ranges", () => {
    const p = readTerrainParams("exag=5.5&auto=1&svf=16&green=0.3");
    assert.deepEqual([p.exag, p.auto, p.svf, p.green], [5.5, 1, 16, 0.3]);
  });

  // Out of range, empty or malformed: the default, never NaN.
  for (const bad of [
    "exag=0",
    "exag=11",
    "exag=",
    "exag=abc",
    "exag=Infinity",
  ]) {
    it(`reads ${bad} as the default`, () => {
      assert.equal(readTerrainParams(bad).exag, PARAMS.exag.fallback);
    });
  }

  it("reads a camera only when all three of alt, tilt and head are valid", () => {
    assert.deepEqual(readTerrainParams("alt=20000&tilt=70&head=20").camera, {
      altitudeM: 20_000,
      tiltDeg: 70,
      headingDeg: 20,
    });
    assert.equal(readTerrainParams("alt=20000&tilt=70").camera, null);
    assert.equal(readTerrainParams("alt=-5&tilt=70&head=20").camera, null);
    assert.equal(readTerrainParams("alt=20000&tilt=95&head=20").camera, null);
  });

  it("names a preset only when it exists", () => {
    assert.equal(readTerrainParams("preset=fly").preset, "fly");
    assert.equal(readTerrainParams("preset=top").preset, "top");
    assert.equal(readTerrainParams("preset=moon").preset, null);
  });

  // T1 has one place and one style; anything else falls back, and says so.
  it("falls back to the Appalachians and style A, with a note", () => {
    const p = readTerrainParams("place=gps&style=swiss");
    assert.equal(p.place, "appalachians");
    assert.equal(p.style, "pastel");
    assert.equal(p.notes.length, 2);
  });
});
