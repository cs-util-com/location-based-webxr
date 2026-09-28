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
  STYLE_SHADOW,
  TERRAIN_PLACES,
  fieldSpec,
  readTerrainParams,
} from "./terrain-params.js";
import { TERRAIN_STYLES } from "./terrain-styles.js";

describe("the Appalachians place", () => {
  // DEC-TR-3 and plan §9 finding 8: the Blue Ridge, a 256 km region at z8.
  it("is a 256 km square over the Blue Ridge at z8", () => {
    const p = TERRAIN_PLACES.appalachians;
    assert.deepEqual(p.centre, { lat: 37.9, lng: -79.2 });
    assert.equal(p.halfExtentM, 128_000);
    assert.equal(p.zoom, 8);
  });
});

describe("the Alps place", () => {
  // DEC-TR-3 and plan §5 T2 (style B's snow is checked on the Alps): the
  // same 256 km square at z8, centred on z8 tile 134/90 so the region and
  // its padding fit in 3 x 3 tiles (the pipeline test checks the set).
  it("is a 256 km square over the central Alps at z8", () => {
    const p = TERRAIN_PLACES.alps;
    assert.deepEqual(p.centre, { lat: 46.56, lng: 9.14 });
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

  // A place or style the lab does not have falls back, and says so.
  it("falls back to the Appalachians and style A, with a note", () => {
    const p = readTerrainParams("place=moon&style=watercolour");
    assert.equal(p.place, "appalachians");
    assert.equal(p.style, "pastel");
    assert.equal(p.notes.length, 2);
  });

  it("reads every style of DEC-TR-2/6 and the Alps", () => {
    for (const id of Object.keys(TERRAIN_STYLES)) {
      assert.equal(readTerrainParams(`style=${id}`).style, id);
    }
    assert.equal(readTerrainParams("place=alps").place, "alps");
  });

  // Each style has its own shading strength; a `shadow` key overrides it
  // for any style, so a link the owner tuned keeps its value.
  it("uses the style's own shadow unless the hash sets one", () => {
    for (const id of Object.keys(TERRAIN_STYLES)) {
      assert.equal(readTerrainParams(`style=${id}`).shadow, STYLE_SHADOW[id]);
      assert.equal(readTerrainParams(`style=${id}&shadow=0.3`).shadow, 0.3);
    }
    assert.equal(
      readTerrainParams("style=clay&shadow=7").shadow,
      STYLE_SHADOW.clay,
    );
  });

  // Plan §9 finding 11: the far field is off by default (style A matches
  // the screenshots), style C is "far field on", any style can switch it.
  it("turns the far field on for style C or far=1 only", () => {
    assert.equal(readTerrainParams("").farOn, false);
    assert.equal(readTerrainParams("style=globe").farOn, true);
    assert.equal(readTerrainParams("style=natural&far=1").farOn, true);
    assert.equal(readTerrainParams("style=natural").farOn, false);
  });

  it("refuses a far-field blend whose low altitude is not under its high one", () => {
    const p = readTerrainParams("style=globe&farHigh=200&farLow=400");
    assert.deepEqual([p.farHigh, p.farLow], [1500, 300]);
    assert.equal(p.notes.length, 1);
    const ok = readTerrainParams("style=globe&farHigh=1000&farLow=100");
    assert.deepEqual([ok.farHigh, ok.farLow, ok.notes.length], [1000, 100, 0]);
  });
});
