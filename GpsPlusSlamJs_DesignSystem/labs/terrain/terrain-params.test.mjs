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
  GPS_PLACE,
  PARAMS,
  IMAGERY_STYLES,
  LOOK_DEFAULTS,
  STYLE_LIGHT,
  TERRAIN_PLACES,
  fieldSpec,
  pixelRatioFor,
  placeFor,
  readTerrainParams,
} from "./terrain-params.js";
import { GLOBE_SUN } from "./terrain-far-field.js";
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

describe("the northern Germany place", () => {
  // DEC-TR-3's flat region, centred on z8 tile 134/82 (3 x 3 tiles).
  it("is a 256 km square over the lower Elbe and the coast at z8", () => {
    const p = TERRAIN_PLACES.germany;
    assert.deepEqual(p.centre, { lat: 53.75, lng: 9.14 });
    assert.equal(p.halfExtentM, 128_000);
    assert.equal(p.zoom, 8);
  });
});

describe("placeFor and the GPS place", () => {
  it("returns a committed place by its id", () => {
    assert.equal(placeFor("alps", null), TERRAIN_PLACES.alps);
    assert.equal(placeFor("alps", { lat: 1, lng: 2 }), TERRAIN_PLACES.alps);
  });
  // DEC-TR-3: the GPS place is the same 256 km z8 region around the fix.
  it("builds the GPS place around a fix", () => {
    const p = placeFor(GPS_PLACE, { lat: 50.94, lng: 6.96 });
    assert.deepEqual(p.centre, { lat: 50.94, lng: 6.96 });
    assert.equal(p.id, "gps");
    assert.equal(p.halfExtentM, TERRAIN_PLACES.appalachians.halfExtentM);
    assert.equal(p.zoom, 8);
  });
  // Before a press of the pin there is no fix: no region, never a guess.
  it("has no GPS place without a valid fix", () => {
    assert.equal(placeFor(GPS_PLACE, null), null);
    assert.equal(placeFor(GPS_PLACE, { lat: Number.NaN, lng: 1 }), null);
    assert.equal(placeFor("moon", null), null);
  });
  // Plan §9 finding 20: the hash says place=gps, never coordinates.
  it("reads place=gps from the hash without a note", () => {
    const p = readTerrainParams("place=gps");
    assert.equal(p.place, "gps");
    assert.deepEqual(p.notes, []);
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
  it("reads an empty hash as every default: the slider at 3, auto off", () => {
    const p = readTerrainParams("");
    assert.equal(p.exag, 3);
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

  // Review 2026-09-29 B1: an `in` lookup also finds the objects' inherited
  // properties, so `#place=toString` read as a place (a function, whose
  // region side is NaN) and `#style=constructor` fed a function into the
  // shader's style switch. Only the tables' own keys are places and styles.
  it("refuses inherited property names as a place or a style", () => {
    for (const name of ["toString", "constructor", "__proto__", "valueOf"]) {
      const p = readTerrainParams(`place=${name}&style=${name}`);
      assert.equal(p.place, "appalachians", `place=${name}`);
      assert.equal(p.style, "pastel", `style=${name}`);
      assert.equal(p.notes.length, 2, `notes for ${name}`);
      assert.equal(placeFor(name, null), null, `placeFor(${name})`);
      assert.equal(p.shadow, LOOK_DEFAULTS.shadow, `shadow for ${name}`);
    }
  });

  it("reads every style of DEC-TR-2/6 and the Alps", () => {
    for (const id of Object.keys(TERRAIN_STYLES)) {
      assert.equal(readTerrainParams(`style=${id}`).style, id);
    }
    assert.equal(readTerrainParams("place=alps").place, "alps");
    assert.equal(readTerrainParams("place=germany").place, "germany");
  });

  // DEC-GL5-5 (globe round-5 plan 2026-10-01-0945 §8): the owner's look
  // values, shadow 0.8, slope gain 1.6 and exaggeration 3, are the lab's
  // defaults for EVERY style, so every style opens as the owner tuned it.
  it("opens every style at the owner's look values (DEC-GL5-5)", () => {
    assert.deepEqual(LOOK_DEFAULTS, { shadow: 0.8, shade: 1.6, exag: 3 });
    for (const id of Object.keys(TERRAIN_STYLES)) {
      const p = readTerrainParams(`style=${id}`);
      assert.deepEqual(
        [p.shadow, p.shade, p.exag],
        [LOOK_DEFAULTS.shadow, LOOK_DEFAULTS.shade, LOOK_DEFAULTS.exag],
        id,
      );
    }
  });

  // A `shadow` key overrides the owner's default for any style, so a link
  // the owner tuned keeps its value; out of range reads as the default.
  it("uses the owner's shadow unless the hash sets one", () => {
    for (const id of Object.keys(TERRAIN_STYLES)) {
      assert.equal(readTerrainParams(`style=${id}&shadow=0.3`).shadow, 0.3);
    }
    assert.equal(
      readTerrainParams("style=clay&shadow=7").shadow,
      LOOK_DEFAULTS.shadow,
    );
  });

  // Review 2026-10-01-1650 nit: the relief's sun follows the globe lab's
  // `sunIntensity` key (same name, range and default), so a link tuned
  // there lights both alike.
  it("reads the globe lab's sunIntensity key, default the globe's 5", () => {
    assert.equal(readTerrainParams("").sunIntensity, GLOBE_SUN.intensity);
    assert.equal(readTerrainParams("sunIntensity=3.5").sunIntensity, 3.5);
    assert.equal(
      readTerrainParams("sunIntensity=9").sunIntensity,
      GLOBE_SUN.intensity,
    );
  });

  // Review 2026-10-01-1650 M1: a measurement read from pixels must not
  // change with the viewer's screen, so `dpr` pins the drawing buffer's
  // pixel ratio; with no key the device's applies, capped at 2.
  it("pins the pixel ratio with dpr, else follows the device capped at 2", () => {
    assert.equal(readTerrainParams("").dpr, 0);
    assert.equal(readTerrainParams("dpr=1").dpr, 1);
    assert.equal(pixelRatioFor(1, 3), 1);
    assert.equal(pixelRatioFor(2, 1), 2);
    assert.equal(pixelRatioFor(0, 1.5), 1.5);
    assert.equal(pixelRatioFor(0, 3), 2);
    assert.equal(pixelRatioFor(0, Number.NaN), 1);
    assert.equal(pixelRatioFor(0, 0), 1);
  });

  // Globe round-5 §3.3: the sun is a choice beside the map lights. Each
  // style has its own default (the map styles keep their lights, so every
  // committed view is unchanged); a `light` key overrides it for any style.
  it("uses the style's own light unless the hash sets one", () => {
    for (const id of Object.keys(TERRAIN_STYLES)) {
      assert.equal(readTerrainParams(`style=${id}`).light, STYLE_LIGHT[id], id);
      assert.equal(readTerrainParams(`style=${id}&light=1`).light, 1, id);
      assert.equal(readTerrainParams(`style=${id}&light=0`).light, 0, id);
      assert.equal(
        readTerrainParams(`style=${id}&light=2`).light,
        STYLE_LIGHT[id],
        `${id} out of range`,
      );
    }
    assert.equal(STYLE_LIGHT.pastel, 0);
    // The imagery styles are the globe's colours, so the globe's sun.
    assert.equal(STYLE_LIGHT["globe-albedo"], 1);
    assert.equal(STYLE_LIGHT["globe-bands"], 1);
  });

  // Globe round-5 §3.3: the imagery is fetched for the far field and for
  // every style coloured from it, and for nothing else.
  it("loads the globe's imagery for the far field and the imagery styles only", () => {
    assert.equal(readTerrainParams("").imageryOn, false);
    assert.equal(readTerrainParams("style=natural").imageryOn, false);
    assert.equal(readTerrainParams("style=globe").imageryOn, true);
    assert.equal(readTerrainParams("style=natural&far=1").imageryOn, true);
    for (const id of IMAGERY_STYLES) {
      assert.equal(readTerrainParams(`style=${id}`).imageryOn, true, id);
      assert.equal(readTerrainParams(`style=${id}`).farOn, false, id);
    }
  });

  it("reads globe-bands' band width in the swept 100-800 m", () => {
    assert.equal(readTerrainParams("").band, 300);
    assert.equal(readTerrainParams("band=100").band, 100);
    assert.equal(readTerrainParams("band=800").band, 800);
    assert.equal(readTerrainParams("band=50").band, 300);
    assert.deepEqual([...IMAGERY_STYLES], ["globe-albedo", "globe-bands"]);
  });

  it("reads globe-albedo's detail weight in 0-1", () => {
    assert.equal(readTerrainParams("").detail, 0.5);
    assert.equal(readTerrainParams("detail=0").detail, 0);
    assert.equal(readTerrainParams("detail=1").detail, 1);
    assert.equal(readTerrainParams("detail=1.5").detail, 0.5);
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
