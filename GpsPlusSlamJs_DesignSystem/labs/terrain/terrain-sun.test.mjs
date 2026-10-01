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
  reliefNormal,
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

  // The globe has no sky light: its flat ground reflects dot(N, L). The
  // relief's sky fill is sized so open flat ground in full sun gets exactly
  // that, whatever the shadow share, so the two agree at the hand-over.
  it("gives open flat ground the globe's dot(N, L) for every shadow share (property)", () => {
    for (let k = 0; k < 300; k++) {
      const sun = randomSun();
      const shadow = next();
      close(
        sunLight(reliefNormal(0, 0, 1), sun, { shadow, svf: 1 }),
        sun[2],
        1e-12,
        `case ${k}`,
      );
    }
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
    close(sunLight(n, sun, { shadow: 0, svf: 0.7 }), 0.7 * sun[2], 1e-12, "0");
  });

  // The cloud-shadow port's contract: a cloud dims the direct share only;
  // the sky fill stays, so a shadowed field is darker but never black.
  it("lets the visibility dim only the direct share (property)", () => {
    for (let k = 0; k < 300; k++) {
      const sun = randomSun();
      const n = reliefNormal(next() - 0.5, next() - 0.5, 1 + next());
      const shadow = next();
      const svf = 0.5 + 0.5 * next();
      const v = next();
      const lit = sunLight(n, sun, { shadow, svf });
      const dimmed = sunLight(n, sun, { shadow, svf, visibility: v });
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
    assert.match(note, /#time=/);
    assert.match(sunDownNote(0), /below the horizon here,/);
    assert.equal(sunDownNote(Number.NaN), null);
  });
});

describe("the cloud-shadow seat in the shader (review 2026-10-01-1650 m4)", () => {
  // Every direct sun term must go through `terrainSunVisibility`, so the
  // cloud-shadow port dims all of them. The far field once lit its texels
  // with the bare `max(0.0, uSun.z)`, bypassing the seat. In the shader the
  // bare sun height may appear only in `sunLight`'s sky fill (deliberately
  // undimmed, see terrain-sun.js.md) and in the relative shade's floor.
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
    // SUN_GLSL: exactly one, the sky fill in sunLight.
    const glsl = SUN_GLSL;
    assert.equal(bare(glsl).length, 1);
    assert.match(glsl, /\(1\.0 - shadow\) \* max\(0\.0, uSun\.z\) \* svf/);
  });
});
