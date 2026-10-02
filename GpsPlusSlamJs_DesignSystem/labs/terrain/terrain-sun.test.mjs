/**
 * Tests for the terrain lab's sun term (globe round-5 plan 2026-10-01-0945
 * §3.3 "One light first").
 *
 * Why this file matters: the relief's sun must be the globe's sun, and the
 * relief's lit flat ground must be what the globe draws for the same ground,
 * or the hand-over between them is a visible jump that no colour approach
 * can hide. The frame turn is checked against the standard solar-geometry
 * formulas (an independent derivation, not this code's own), the light
 * against three's Lambert model at the globe's intensity, and the one
 * direct term that the later cloud-shadow port dims is pinned as the ONLY
 * place visibility enters.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  farColour,
  linearToSrgb,
  neutralToneMap,
  srgbToLinear,
} from "./terrain-far-field.js";
import { NATURAL, SWISS, singleLightShade } from "./terrain-styles.js";
import {
  GLOBE_SUN,
  MAP_KEY_LIGHT,
  SKY_FILL,
  reliefNormal,
  skyLevel,
  sunDirect,
  sunEnu,
  sunEnuFromGlobe,
  sunLight,
  sunLitColour,
  SUN_GLSL,
  sunDownNote,
  sunRelativeShade,
} from "./terrain-sun.js";

const DEG = Math.PI / 180;
const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

/** A seeded generator, so a failing property case can be replayed. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * The sun's elevation and azimuth (clockwise from north) at a place, from
 * the sub-solar point, by the textbook spherical-trigonometry formulas (the
 * ones the framework's `solarPosition` uses, with the hour angle as the
 * longitude difference). Independent of `sunEnuFromGlobe`'s vector algebra.
 */
function textbookSun(latDeg, lngDeg, decDeg, subLngDeg) {
  const lat = latDeg * DEG;
  const dec = decDeg * DEG;
  const hour = (lngDeg - subLngDeg) * DEG;
  const el = Math.asin(
    Math.sin(lat) * Math.sin(dec) +
      Math.cos(lat) * Math.cos(dec) * Math.cos(hour),
  );
  const az =
    Math.atan2(
      Math.sin(hour),
      Math.cos(hour) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
    ) + Math.PI;
  return { el, az };
}

/** The globe's own input: the sun as seen at 0°N 0°E for a sub-solar point. */
function globeObservation(decDeg, subLngDeg) {
  return textbookSun(0, 0, decDeg, subLngDeg);
}

const angleBetween = (a, b) =>
  Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

describe("the globe's sun in the place's frame", () => {
  // The globe lab lights the Earth with `solarPosition(ms, 0, 0)` turned to
  // ECEF; the relief must be lit by that SAME sun, so it takes the same
  // input and only changes frame.
  it("puts an overhead sun at 0°N 0°E straight up there and straight down at the antipode", () => {
    const overhead = { elevationRad: Math.PI / 2, azimuthRad: 0 };
    const up = sunEnuFromGlobe(overhead, 0, 0);
    [0, 0, 1].forEach((v, i) => close(up[i], v, 1e-12, `up[${i}]`));
    const down = sunEnuFromGlobe(overhead, 0, 180);
    [0, 0, -1].forEach((v, i) => close(down[i], v, 1e-12, `down[${i}]`));
    // 90° east of the sub-solar point it is evening: the sun is due west, on
    // the horizon.
    const west = sunEnuFromGlobe(overhead, 0, 90);
    [-1, 0, 0].forEach((v, i) => close(west[i], v, 1e-12, `west[${i}]`));
  });

  it("agrees with the textbook elevation and azimuth anywhere (property, 2000 cases)", () => {
    const next = random(20261001);
    for (let k = 0; k < 2000; k++) {
      const dec = -23.44 + 46.88 * next();
      const subLng = -180 + 360 * next();
      const lat = -85 + 170 * next();
      const lng = -180 + 360 * next();
      const { el, az } = globeObservation(dec, subLng);
      const got = sunEnuFromGlobe(
        { elevationRad: el, azimuthRad: az },
        lat,
        lng,
      );
      const want = textbookSun(lat, lng, dec, subLng);
      const expected = sunEnu({ elevationRad: want.el, azimuthRad: want.az });
      close(Math.hypot(...got), 1, 1e-12, `unit length, case ${k}`);
      assert.ok(
        angleBetween(got, expected) < 1e-6,
        `case ${k}: ${angleBetween(got, expected) / DEG}° off`,
      );
    }
  });

  it("refuses a non-finite angle or place", () => {
    const sun = { elevationRad: 0.5, azimuthRad: 1 };
    assert.throws(
      () => sunEnuFromGlobe({ ...sun, elevationRad: NaN }, 0, 0),
      RangeError,
    );
    assert.throws(() => sunEnuFromGlobe(sun, Infinity, 0), RangeError);
    assert.throws(() => sunEnuFromGlobe(sun, 0, NaN), RangeError);
  });
});

describe("the sun's direct term (the one the cloud shadow dims)", () => {
  const sun = sunEnu({ elevationRad: 30 * DEG, azimuthRad: 200 * DEG });

  it("is the sun's height sine on flat ground, as the globe's dot(N, L)", () => {
    close(
      sunDirect(reliefNormal(0, 0, 1), sun),
      Math.sin(30 * DEG),
      1e-12,
      "flat",
    );
  });

  it("is never negative: a face turned from the sun, or a sun below the horizon, gets none", () => {
    const night = sunEnu({ elevationRad: -10 * DEG, azimuthRad: 0 });
    assert.equal(sunDirect(reliefNormal(0, 0, 1), night), 0);
    // A steep face looking north while the sun stands in the south-south-west.
    assert.equal(sunDirect(reliefNormal(0, -5, 1), sun), 0);
  });

  it("scales linearly with the visibility, and visibility 0 removes it", () => {
    const next = random(7);
    for (let k = 0; k < 200; k++) {
      const n = reliefNormal(next() * 2 - 1, next() * 2 - 1, 1 + next());
      const v = next();
      close(sunDirect(n, sun, v), v * sunDirect(n, sun), 1e-12, `case ${k}`);
    }
    assert.equal(sunDirect(reliefNormal(0, 0, 1), sun, 0), 0);
  });
});

describe("the sun-lit light", () => {
  const next = random(42);
  const randomSun = () =>
    sunEnu({
      elevationRad: (2 + 86 * next()) * DEG,
      azimuthRad: 2 * Math.PI * next(),
    });

  // The globe has no sky light: its flat ground reflects dot(N, L). Wherever
  // the sun stands above the sky floor, the relief's sky fill is sized so
  // open flat ground in full sun gets exactly that, whatever the shadow
  // share and the floor, so the two agree at the hand-over by day.
  it("gives open flat ground the globe's dot(N, L) for every shadow share while the sun is above the floor (property)", () => {
    let judged = 0;
    for (let k = 0; k < 600; k++) {
      const sun = randomSun();
      const shadow = next();
      const skyFloor = next();
      if (sun[2] < skyFloor) continue;
      judged += 1;
      close(
        sunLight(reliefNormal(0, 0, 1), sun, { shadow, svf: 1, skyFloor }),
        sun[2],
        1e-12,
        `case ${k}`,
      );
    }
    assert.ok(judged > 100, `only ${judged} cases above the floor`);
    // The default floor too, at the comparison's day sun (66°).
    const day = sunEnu({ elevationRad: 66.3 * DEG, azimuthRad: 3 });
    close(
      sunLight(reliefNormal(0, 0, 1), day, { shadow: 0.8 }),
      day[2],
      1e-12,
      "day, default floor",
    );
  });

  it("is pure Lambert at shadow 1 and pure sky at shadow 0", () => {
    const sun = randomSun();
    const n = reliefNormal(0.4, -0.2, 1.6);
    close(
      sunLight(n, sun, { shadow: 1, svf: 0.7 }),
      sunDirect(n, sun),
      1e-12,
      "1",
    );
    close(
      sunLight(n, sun, { shadow: 0, svf: 0.7 }),
      0.7 * skyLevel(sun[2]),
      1e-12,
      "0",
    );
  });

  // DEC-GL5-11: the old fill, (1 - shadow) x sin(h) x svf, vanished with a
  // low sun (0.2 x sin 11° on the Alps, under one 8-bit level), so the
  // shadowed faces went black. The fill now reads the sky level, which
  // holds the floor while the sun is up. The change is bounded: nothing
  // moves where the sun stands above the floor (midday), and below it the
  // light rises by exactly (1 - shadow) x svf x (floor - sin h).
  it("changes the light only below the floor, by a declared amount (property)", () => {
    for (let k = 0; k < 500; k++) {
      const sun = randomSun();
      const n = reliefNormal(next() - 0.5, next() - 0.5, 1 + next());
      const shadow = next();
      const svf = next();
      const skyFloor = next();
      const old = sunLight(n, sun, { shadow, svf, skyFloor: 0 });
      const now = sunLight(n, sun, { shadow, svf, skyFloor });
      close(
        now - old,
        (1 - shadow) * svf * Math.max(0, skyFloor - sun[2]),
        1e-12,
        `case ${k}`,
      );
    }
  });

  it("gives a face in full shadow the floor's sky at a low sun, not the sun's sliver", () => {
    const low = sunEnu({ elevationRad: 11.2 * DEG, azimuthRad: 290 * DEG });
    // A steep face turned from the sun (north-east facing at an evening sun).
    const n = reliefNormal(-1.5, -1.5, 1.6);
    assert.equal(sunDirect(n, low), 0);
    const skyFloor = 0.5;
    close(
      sunLight(n, low, { shadow: 0.8, svf: 0.8, skyFloor }),
      0.2 * 0.8 * skyFloor,
      1e-12,
      "shadowed face",
    );
  });

  // The cloud-shadow port's contract: a cloud dims the direct share only;
  // the sky fill stays, so a shadowed field is darker but never black. It
  // holds for every floor: the sky level never reads the visibility.
  it("lets the visibility dim only the direct share (property)", () => {
    for (let k = 0; k < 300; k++) {
      const sun = randomSun();
      const n = reliefNormal(next() - 0.5, next() - 0.5, 1 + next());
      const shadow = next();
      const svf = 0.5 + 0.5 * next();
      const v = next();
      const skyFloor = next();
      const lit = sunLight(n, sun, { shadow, svf, skyFloor });
      const dimmed = sunLight(n, sun, {
        shadow,
        svf,
        visibility: v,
        skyFloor,
      });
      close(
        lit - dimmed,
        shadow * (1 - v) * sunDirect(n, sun),
        1e-12,
        `case ${k}`,
      );
      assert.ok(dimmed <= lit + 1e-15, `case ${k}: brighter under a cloud`);
    }
  });

  it("refuses a shadow share outside 0-1", () => {
    const sun = randomSun();
    assert.throws(() => sunLight([0, 0, 1], sun, { shadow: 1.5 }), RangeError);
    assert.throws(() => sunLight([0, 0, 1], sun, { shadow: NaN }), RangeError);
  });
});

describe("the sky level (the fill's light, DEC-GL5-11)", () => {
  const zOf = (deg) => Math.sin(deg * DEG);

  it("declares its parameters: a floor in 0-1 and a civil twilight", () => {
    assert.ok(SKY_FILL.floor > 0 && SKY_FILL.floor <= 1, `${SKY_FILL.floor}`);
    assert.equal(SKY_FILL.twilightDeg, 6);
    assert.ok(Object.isFrozen(SKY_FILL));
  });

  // The default (0.5) was chosen from the browser sweep (results
  // 2026-10-02, floors 0-1 at a 66° and an 11° sun on the Alps): the
  // largest floor whose low-sun relief is still at least as contrasty as
  // the noon relief (CV) at 30 and 10 km, and the least that lifts the
  // darkest tenth above 10 of 255 at both. Its declared consequences:
  it("leaves every sun above 30° alone and more than doubles a shadowed face's sky at 11°", () => {
    const shadowed = (deg, skyFloor) =>
      sunLight(
        reliefNormal(-1.5, -1.5, 1.6),
        sunEnu({ elevationRad: deg * DEG, azimuthRad: 290 * DEG }),
        { shadow: 0.8, svf: 0.85, skyFloor },
      );
    for (const deg of [30.01, 45, 66.3, 90]) {
      assert.equal(skyLevel(zOf(deg)), skyLevel(zOf(deg), 0), `${deg}°`);
    }
    assert.ok(shadowed(11.2) >= 2 * shadowed(11.2, 0));
  });

  it("is the sun's height above the floor, and the floor between it and the horizon", () => {
    for (const floor of [0, 0.2, 0.5, 0.8, 1]) {
      for (const deg of [0, 2, 11.2, 30, 66.3, 90]) {
        close(
          skyLevel(zOf(deg), floor),
          Math.max(zOf(deg), floor),
          1e-12,
          `floor ${floor}, ${deg}°`,
        );
      }
    }
  });

  it("fades through the twilight to nothing", () => {
    const floor = 0.6;
    assert.equal(skyLevel(zOf(-SKY_FILL.twilightDeg), floor), 0);
    assert.equal(skyLevel(zOf(-30), floor), 0);
    assert.equal(skyLevel(-1, floor), 0);
    const mid = skyLevel(zOf(-3), floor);
    assert.ok(mid > 0 && mid < floor, `${mid}`);
    // A shorter or longer twilight moves where it ends.
    assert.equal(skyLevel(zOf(-4), floor, 3), 0);
    assert.ok(skyLevel(zOf(-4), floor, 9) > 0);
  });

  // A sky that brightened as the sun sank would be a defect a viewer reads
  // as a flicker at dusk.
  it("never falls as the sun rises (property)", () => {
    const next = random(1102);
    for (let k = 0; k < 500; k++) {
      const floor = next();
      const a = -0.3 + 1.3 * next();
      const b = a + 0.3 * next();
      assert.ok(
        skyLevel(a, floor) <= skyLevel(b, floor) + 1e-15,
        `case ${k}: ${a} -> ${b} at floor ${floor}`,
      );
    }
  });

  it("refuses a floor outside 0-1 and a twilight that is not positive", () => {
    assert.throws(() => skyLevel(0.5, 1.2), RangeError);
    assert.throws(() => skyLevel(0.5, -0.1), RangeError);
    assert.throws(() => skyLevel(0.5, NaN), RangeError);
    assert.throws(() => skyLevel(0.5, 0.5, 0), RangeError);
    assert.throws(
      () => sunLight([0, 0, 1], [0, 0, 1], { shadow: 0.5, skyFloor: 2 }),
      RangeError,
    );
  });
});

describe("the map styles under the sun", () => {
  // Styles B and D are shaded by `singleLightShade` (flat 1). Under the sun
  // they read `sunRelativeShade`, which must BE that shade for the same
  // light, so switching the light to the sun changes only its direction.
  it("equals singleLightShade for the same light (property, 500 cases)", () => {
    const next = random(99);
    for (let k = 0; k < 500; k++) {
      const azDeg = 360 * next();
      const elDeg = 5 + 80 * next();
      const gx = 3 * (next() - 0.5);
      const gy = 3 * (next() - 0.5);
      const gain = 0.5 + 2 * next();
      const sun = sunEnu({
        elevationRad: elDeg * DEG,
        azimuthRad: azDeg * DEG,
      });
      close(
        sunRelativeShade(reliefNormal(gx, gy, gain), sun),
        singleLightShade(gx, gy, gain, azDeg, elDeg),
        1e-9,
        `case ${k}`,
      );
    }
  });

  it("is the classic north-west light, 45° up, for the map lights", () => {
    const fixed = sunEnu({ elevationRad: 45 * DEG, azimuthRad: 315 * DEG });
    MAP_KEY_LIGHT.forEach((v, i) => close(v, fixed[i], 1e-12, `[${i}]`));
  });

  // Review 2026-10-01-1650 m7: the map key light had two sources (literals
  // here, the azimuths in the styles). It is now style B's light, and style
  // D, which the shader lights with the same uniform, must agree with it.
  it("is style B's light, and style D's is the same", () => {
    const b = sunEnu({
      elevationRad: NATURAL.lightAltitudeDeg * DEG,
      azimuthRad: NATURAL.lightAzimuthDeg * DEG,
    });
    assert.deepEqual([...MAP_KEY_LIGHT], b);
    assert.equal(SWISS.lightAzimuthDeg, NATURAL.lightAzimuthDeg);
    assert.equal(SWISS.lightAltitudeDeg, NATURAL.lightAltitudeDeg);
  });

  it("stays finite with the sun on or below the horizon (no division by zero)", () => {
    for (const el of [0, -5, -90]) {
      const sun = sunEnu({ elevationRad: el * DEG, azimuthRad: 1 });
      const s = sunRelativeShade(reliefNormal(0.3, 0.1, 1), sun);
      assert.ok(Number.isFinite(s) && s >= 0, `${el}: ${s}`);
      assert.equal(
        sunRelativeShade(reliefNormal(0, 0, 1), sun),
        0,
        `${el} flat`,
      );
    }
  });
});

describe("the sun-lit colour (what the globe draws)", () => {
  it("is three's Lambert at the globe's intensity, through its tone mapping", () => {
    const albedo = [0.31, 0.42, 0.22];
    const light = 0.8;
    const lin = albedo
      .map(srgbToLinear)
      .map((v) => (v * GLOBE_SUN.intensity * light) / Math.PI);
    // Compared in sRGB: three's encoding exponent (0.41666) is not the
    // exact inverse of its decoding, so a round trip would add 3e-6.
    const want = neutralToneMap(lin).map((v) => linearToSrgb(Math.max(0, v)));
    const got = sunLitColour(albedo, light);
    want.forEach((v, i) => close(got[i], v, 1e-12, `[${i}]`));
  });

  // One implementation (DEC-H3): the far field's colour at a straight-down
  // sun is the sun-lit colour at light 1.
  it("is the far field's colour for the same light", () => {
    const albedo = [0.5, 0.36, 0.2];
    assert.deepEqual(sunLitColour(albedo, 1), farColour(albedo));
    assert.deepEqual(sunLitColour(albedo, 0.4), farColour(albedo, 0.4));
  });

  // Review 2026-10-01-1650 nit: the relief follows the globe lab's
  // `sunIntensity` key. The intensity and the light multiply, so a page at
  // another intensity is the default page at a scaled light, and the
  // default IS the globe's.
  it("takes the sun's intensity, defaulting to the globe's", () => {
    const albedo = [0.4, 0.3, 0.2];
    assert.deepEqual(
      sunLitColour(albedo, 0.6, GLOBE_SUN.intensity),
      sunLitColour(albedo, 0.6),
    );
    const scaled = sunLitColour(albedo, (0.6 * 3) / GLOBE_SUN.intensity);
    sunLitColour(albedo, 0.6, 3).forEach((v, i) =>
      close(v, scaled[i], 1e-12, `[${i}]`),
    );
  });

  it("is black with no light and never lighter with less light (property)", () => {
    assert.deepEqual(sunLitColour([0.6, 0.6, 0.6], 0), [0, 0, 0]);
    const next = random(5);
    for (let k = 0; k < 300; k++) {
      const albedo = [next(), next(), next()];
      const a = next();
      const b = a + next() * 0.5;
      const lo = sunLitColour(albedo, a);
      const hi = sunLitColour(albedo, b);
      lo.forEach((v, i) => assert.ok(v <= hi[i] + 1e-12, `case ${k} [${i}]`));
    }
  });
});

describe("the globe's intensity", () => {
  // DEC-H3 across a package boundary the lab cannot import from under
  // `node --test` (TypeScript): the copy is held to the globe's source.
  it("is the globe surface's own sunIntensity", () => {
    const source = readFileSync(
      new URL(
        "../../../GpsPlusSlamJs_Globe/src/globe-surface.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const m = /sunIntensity:\s*([0-9.]+)/.exec(source);
    assert.ok(m, "globe-surface.ts declares sunIntensity");
    assert.equal(Number(m[1]), GLOBE_SUN.intensity);
  });
});

describe("the sun-down note (review 2026-10-01-1650 m3)", () => {
  // The imagery styles open under the globe's sun at the clock's present,
  // so at night they open black. The page says why instead of looking
  // broken; while the sun is up it says nothing.
  it("speaks only with the sun on or below the horizon, naming the time", () => {
    assert.equal(sunDownNote(0.2, 0), null);
    assert.equal(sunDownNote(1e-9), null);
    const t = Date.parse("2026-06-21T23:00:00Z");
    const note = sunDownNote(-0.3, t);
    assert.match(note, /below the horizon/);
    assert.match(note, /2026-06-21 23:00 UTC/);
    // The sky fill fades through the twilight (DEC-GL5-11), so just below
    // the horizon the relief is dim, not black: the note says so.
    assert.match(note, /twilight/);
    assert.match(note, /#time=/);
    assert.match(sunDownNote(0), /below the horizon here,/);
    assert.equal(sunDownNote(Number.NaN), null);
  });
});

describe("the cloud-shadow seat in the shader (review 2026-10-01-1650 m4)", () => {
  // Every direct sun term must go through `terrainSunVisibility`, so the
  // cloud-shadow port dims all of them. The far field once lit its texels
  // with the bare `max(0.0, uSun.z)`, bypassing the seat. In the shader the
  // bare sun height may appear only in the sky level, which `sunLight`'s
  // fill reads (deliberately undimmed, see terrain-sun.js.md), and in the
  // relative shade's floor.
  it("has no direct sun term outside the seat", () => {
    // Read as text, by a joined path: a `new URL("./x.js", import.meta.url)`
    // reads to knip as an import, which would pull the material's `three`
    // into the package's dependency check.
    const material = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "terrain-material.js"),
      "utf8",
    );
    const bare = (text) => text.match(/max\(0\.0, uSun\.z\)/g) ?? [];
    assert.deepEqual(bare(material), [], "terrain-material.js");
    // SUN_GLSL: exactly one, in the sky level the fill reads.
    const glsl = SUN_GLSL;
    assert.equal(bare(glsl).length, 1);
    assert.match(
      glsl,
      /float skyLevel\(\) \{[^}]*max\(max\(0\.0, uSun\.z\), uSkyFloor \* fade\)/,
    );
    assert.match(glsl, /\(1\.0 - shadow\) \* skyLevel\(\) \* svf/);
    // The visibility never reaches the sky level.
    const sky = /float skyLevel\(\) \{[^}]*\}/.exec(glsl)[0];
    assert.doesNotMatch(sky, /visibility|terrainSunVisibility/);
  });

  // The floor reaches the shader as a uniform the page sets from the hash's
  // `sky` key; an undeclared uniform would not compile, and one never set
  // would stay at its default whatever the link says.
  it("is fed the page's sky floor", () => {
    const material = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "terrain-material.js"),
      "utf8",
    );
    assert.match(material, /uniform float uSkyFloor;/);
    assert.match(material, /uSkyFloor: \{ value: SKY_FILL\.floor \}/);
    assert.match(material, /u\.uSkyFloor\.value = params\.sky;/);
  });

  // The shader's twilight is the reference's, one number.
  it("fades the sky over the reference's twilight", () => {
    const m = /const float TWILIGHT_Z = ([0-9.]+);/.exec(SUN_GLSL);
    assert.ok(m, "SUN_GLSL declares TWILIGHT_Z");
    close(Number(m[1]), Math.sin(SKY_FILL.twilightDeg * DEG), 1e-8, "z");
  });
});
