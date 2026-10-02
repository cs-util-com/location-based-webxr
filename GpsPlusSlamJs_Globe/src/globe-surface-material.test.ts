/**
 * Why this test matters: the night lights, the water glint and the clouds
 * are one string patch on three's physical shader. Two failures would be
 * silent in a browser: a three upgrade that renames a chunk (the term just
 * disappears), and a shared texture stored ON a tile material (the tile
 * renderer disposes every texture it finds on a material when that tile
 * unloads, so the first unload would blank the night lights on every
 * tile). So the patch is checked on copies of three's REAL shader source,
 * each anchor exactly once, a missing one refused by name, and the tile
 * material is checked to carry no texture but its own map. The cloud drift
 * (round-2 plan 2026-09-26-2055 M3f) moves only the clouds: its offset must
 * reach the cloud sample and nothing else, and the clock-to-offset mapping
 * must stay exact at today's epoch milliseconds.
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  GLOBE_CLOUD_DRIFT_DEG_PER_S,
  GLOBE_SURFACE_CACHE_KEY,
  GLOBE_SURFACE_TUNING,
  applyGlobeSurface,
  cloudLonOffsetRad,
  createGlobeSurfaceUniforms,
  patchGlobeSurfaceShader,
  GLOBE_FADE_GLSL,
  globeFadeKeeps,
} from "./globe-surface-material.js";
import { SKY_FILL, SKY_LEVEL_GLSL } from "./sky-level.js";

/** A fresh copy of the shader three compiles for MeshStandardMaterial. */
function standardShader(): THREE.WebGLProgramParametersWithUniforms {
  const lib = THREE.ShaderLib.standard;
  return {
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
  } as THREE.WebGLProgramParametersWithUniforms;
}

const textures = () => ({
  night: new THREE.Texture(),
  clouds: new THREE.Texture(),
});

const count = (text: string, needle: string): number =>
  text.split(needle).length - 1;

describe("createGlobeSurfaceUniforms", () => {
  it("holds the two maps, a unit sun and the tuning defaults", () => {
    const t = textures();
    const u = createGlobeSurfaceUniforms(t);
    expect(u.uNight.value).toBe(t.night);
    expect(u.uClouds.value).toBe(t.clouds);
    // The water is the tiles' alpha now, not a map (DEC-GL4-6).
    expect("uWater" in u).toBe(false);
    expect(u.uSunEcef.value.length()).toBeCloseTo(1, 12);
    expect(u.uNightGain.value).toBe(GLOBE_SURFACE_TUNING.nightGain);
    // The owner's night lights (round-4 plan DEC-GL4-1).
    expect(GLOBE_SURFACE_TUNING.nightGain).toBe(0.7);
    expect(u.uWaterRoughness.value).toBe(GLOBE_SURFACE_TUNING.waterRoughness);
    expect(u.uCloudOpacity.value).toBe(GLOBE_SURFACE_TUNING.cloudOpacity);
    expect(u.uCloudLonOffset.value).toBe(0);
    // The reference image's looks (round-4 plan DEC-GL4-8): off by default.
    expect(u.uGrade.value).toBe(0);
    expect(u.uCloudRelief.value).toBe(0);
    expect(u.uTwilight.value).toBe(0);
    // The band's cross-fade: the relief's share of the pixels, 0 (the
    // globe alone) until the page sets it.
    expect(u.uCarrierShare.value).toBe(0);
  });
});

describe("patchGlobeSurfaceShader", () => {
  it("adds each term exactly once, after its anchor, on three's real shader", () => {
    const shader = standardShader();
    const uniforms = createGlobeSurfaceUniforms(textures());
    patchGlobeSurfaceShader(shader, uniforms);
    const vs = shader.vertexShader;
    const fs = shader.fragmentShader;
    expect(count(vs, "varying vec3 vGeoNormal;")).toBe(1);
    expect(count(vs, "vGeoNormal = objectNormal;")).toBe(1);
    expect(count(fs, "varying vec3 vGeoNormal;")).toBe(1);
    for (const name of [
      "uSunEcef",
      "uNight",
      "uClouds",
      "uNightGain",
      "uWaterRoughness",
      "uCloudOpacity",
      "uCloudLonOffset",
      "uGrade",
      "uCloudRelief",
      "uTwilight",
      "uSunWorld",
    ]) {
      expect(shader.uniforms[name]).toBe(
        uniforms[name as keyof typeof uniforms],
      );
    }
    // Each term sits after its chunk, and the chunks keep their order.
    const at = (s: string) => fs.indexOf(s);
    expect(at("#include <alphamap_fragment>")).toBeLessThan(
      at("globeCloud * uCloudOpacity"),
    );
    expect(at("#include <roughnessmap_fragment>")).toBeLessThan(
      at("uWaterRoughness, globeWater"),
    );
    expect(at("#include <emissivemap_fragment>")).toBeLessThan(
      at("totalEmissiveRadiance += globeNight"),
    );
    expect(at("totalEmissiveRadiance += globeNight")).toBeLessThan(
      at("#include <lights_fragment_begin>"),
    );
    // The overlay's colour is in diffuseColor before the clouds cover it.
    expect(at("#include <map_fragment>")).toBeLessThan(
      at("globeCloud * uCloudOpacity"),
    );
  });

  it("samples with the smaller of two longitude gradients (no seam at 180°)", () => {
    const shader = standardShader();
    patchGlobeSurfaceShader(shader, createGlobeSurfaceUniforms(textures()));
    const fs = shader.fragmentShader;
    expect(fs).toContain("fract( globeU + 0.5 )");
    expect(count(fs, "textureGrad(")).toBe(2);
    expect(fs).not.toMatch(/texture\( u(Night|Clouds)/);
  });

  it("moves only the clouds by the drift offset, with the seam fix's gradients", () => {
    const shader = standardShader();
    patchGlobeSurfaceShader(shader, createGlobeSurfaceUniforms(textures()));
    const fs = shader.fragmentShader;
    expect(count(fs, "uniform float uCloudLonOffset;")).toBe(1);
    // The cloud sample is shifted west by the offset (radians to turns),
    // with the SAME gradients as the other maps: the shift is continuous,
    // so the repeat-wrapped cloud map has no seam of its own.
    expect(fs).toContain(
      "textureGrad( uClouds, globeUv - vec2( uCloudLonOffset * 0.15915494309189535, 0.0 ), globeDx, globeDy )",
    );
    expect(count(fs, "uCloudLonOffset")).toBe(2);
    expect(fs).toContain("textureGrad( uNight, globeUv, globeDx, globeDy )");
  });

  // Why (round-4 plan 2026-09-28-2105 DEC-GL4-6): the 2048 px global mask
  // (about 20 km a pixel) put the water's low roughness, and with it the
  // sun's glint, onto the land beside every coast: the owner's bright line.
  // The imagery tiles now carry the mask in their alpha, at the imagery's
  // resolution; the patch reads it from the tile's colour BEFORE anything
  // else uses the alpha, and sets it back to opaque, so no tile turns
  // translucent over water.
  it("reads the water from the tile's alpha, then makes the tile opaque again", () => {
    const shader = standardShader();
    patchGlobeSurfaceShader(shader, createGlobeSurfaceUniforms(textures()));
    const fs = shader.fragmentShader;
    expect(fs).toContain("float globeWater = 1.0 - diffuseColor.a;");
    // No global mask sampler is left (uWaterRoughness stays).
    expect(fs).not.toMatch(/\buWater\b/);
    const at = (s: string) => fs.indexOf(s);
    expect(at("#include <map_fragment>")).toBeLessThan(
      at("float globeWater = 1.0 - diffuseColor.a;"),
    );
    expect(at("float globeWater = 1.0 - diffuseColor.a;")).toBeLessThan(
      at("diffuseColor.a = 1.0;"),
    );
    expect(at("diffuseColor.a = 1.0;")).toBeLessThan(
      at("uWaterRoughness, globeWater"),
    );
  });

  // Why (round-4 plan 2026-09-28-2105 DEC-GL4-8): the reference image's
  // blue grade, its shaded clouds and its soft blue-grey night with warm
  // lights are each one uniform, 0 by default, so the owner compares each
  // against its own OFF. A term multiplied by its switch everywhere it acts
  // is what makes OFF exactly the look before: checked on the source, and
  // in the browser against pixels (globe-look.smoke.spec.mjs).
  it("scales each look term by its own switch", () => {
    const shader = standardShader();
    patchGlobeSurfaceShader(shader, createGlobeSurfaceUniforms(textures()));
    const fs = shader.fragmentShader;
    for (const name of ["uGrade", "uCloudRelief", "uTwilight"]) {
      expect(count(fs, `uniform float ${name};`)).toBe(1);
    }
    expect(fs).toContain("uGrade * 0.7");
    // Review m4: the sun on screen comes from the WORLD-space sun (the
    // view matrix maps world directions), not from the ECEF one.
    expect(fs).toContain("viewMatrix * vec4( uSunWorld, 0.0 )");
    expect(fs).not.toContain("viewMatrix * vec4( uSunEcef, 0.0 )");
    expect(fs).toContain("mix( vec3( 1.0 ), globeCloudShade, uCloudRelief )");
    expect(fs).toContain("mix( vec3( 1.0 ), GLOBE_WARM_LIGHTS, uTwilight )");
    expect(fs).toContain("uTwilight * diffuseColor.rgb");
    // The clouds are still whitened by the opacity, now towards their shade.
    expect(fs).toContain("globeCloud * uCloudOpacity");
  });

  // Why (DEC-GL5-11, F1 brief): the relief takes the sky's fill at a low
  // sun (the share of the light that is not direct, times the sky level),
  // the flat globe did not, so at 11 degrees the relief's flat ground read
  // 0.255 of a zenith sun against the globe's 0.194. The globe's surface,
  // and through it the relief's tiles, now reads the Globe package's one
  // sky level: the direct diffuse keeps `1 - share`, the sky gives
  // `share x skyLevel`, in the sun light's own units. With the floor at 0
  // the fill is the geodetic sun height, which is the flat globe's own
  // direct term: the look before, which the look pins use.
  it("fills from the shared sky level, in the sun's units, after the lights", () => {
    const uniforms = createGlobeSurfaceUniforms(textures());
    expect(uniforms.uSkyFloor.value).toBe(SKY_FILL.floor);
    expect(uniforms.uSkyShare.value).toBe(GLOBE_SURFACE_TUNING.skyShare);
    // 1 - the relief's direct share (the terrain lab's 0.8, DEC-GL5-5).
    expect(GLOBE_SURFACE_TUNING.skyShare).toBeCloseTo(0.2, 12);
    const shader = standardShader();
    patchGlobeSurfaceShader(shader, uniforms);
    const fs = shader.fragmentShader;
    expect(shader.uniforms.uSkyFloor).toBe(uniforms.uSkyFloor);
    expect(shader.uniforms.uSkyShare).toBe(uniforms.uSkyShare);
    expect(count(fs, SKY_LEVEL_GLSL)).toBe(1);
    expect(fs).toContain("reflectedLight.directDiffuse *= 1.0 - uSkyShare;");
    expect(fs).toContain(
      "reflectedLight.indirectDiffuse += uSkyShare * skyLevelOf( globeNdl, uSkyFloor ) * directionalLights[ 0 ].color * BRDF_Lambert( material.diffuseContribution );",
    );
    const at = (s: string) => fs.indexOf(s);
    expect(at("#include <lights_fragment_end>")).toBeLessThan(
      at("reflectedLight.directDiffuse *= 1.0 - uSkyShare;"),
    );
    // The geodetic sun height is declared before it is read.
    expect(at("float globeNdl =")).toBeLessThan(at("skyLevelOf( globeNdl"));
    // Only with the sun light present: its uniform exists only then.
    const fill = fs.slice(at("reflectedLight.directDiffuse *= 1.0"));
    expect(fs.slice(0, at("reflectedLight.directDiffuse *= 1.0"))).toMatch(
      /#if NUM_DIR_LIGHTS > 0\s*$/,
    );
    expect(fill).toMatch(/^[^#]*#endif/);
  });

  // Why (one-scene plan §3.2; F1): in the altitude band the globe's own
  // tiles and the relief's tiles both draw, and each pixel must go to
  // exactly one of them: a dither threshold against the relief's share,
  // the globe keeping the pixels at or above it and the relief (its tiles
  // define GLOBE_FADE_SIDE 1) the ones below. No blending, so no sorting
  // and no double-lit pixels; the discard comes first, before any work.
  it("discards by a screen dither against the relief's share, first, on the globe's side by default", () => {
    const shader = standardShader();
    const uniforms = createGlobeSurfaceUniforms(textures());
    patchGlobeSurfaceShader(shader, uniforms);
    const fs = shader.fragmentShader;
    expect(shader.uniforms.uCarrierShare).toBe(uniforms.uCarrierShare);
    expect(count(fs, GLOBE_FADE_GLSL)).toBe(1);
    expect(fs).toContain(
      ["#ifndef GLOBE_FADE_SIDE", "#define GLOBE_FADE_SIDE 0", "#endif"].join(
        String.fromCharCode(10),
      ),
    );
    const at = (x: string) => fs.indexOf(x);
    expect(at("#include <clipping_planes_fragment>")).toBeLessThan(
      at("if ( !globeFadeKeeps("),
    );
    expect(at("if ( !globeFadeKeeps(")).toBeLessThan(
      at("#include <map_fragment>"),
    );
  });

  it("refuses a shader missing an anchor, or holding one twice, naming it", () => {
    for (const anchor of [
      "#include <common>",
      "#include <alphamap_fragment>",
      "#include <roughnessmap_fragment>",
      "#include <emissivemap_fragment>",
      "#include <lights_fragment_end>",
      "#include <clipping_planes_fragment>",
    ]) {
      const missing = standardShader();
      missing.fragmentShader = missing.fragmentShader.replace(anchor, "");
      expect(() =>
        patchGlobeSurfaceShader(
          missing,
          createGlobeSurfaceUniforms(textures()),
        ),
      ).toThrow(anchor);
      const twice = standardShader();
      twice.fragmentShader = twice.fragmentShader.replace(
        anchor,
        `${anchor}\n${anchor}`,
      );
      expect(() =>
        patchGlobeSurfaceShader(twice, createGlobeSurfaceUniforms(textures())),
      ).toThrow(anchor);
    }
    const noNormal = standardShader();
    noNormal.vertexShader = noNormal.vertexShader.replace(
      "#include <beginnormal_vertex>",
      "",
    );
    expect(() =>
      patchGlobeSurfaceShader(noNormal, createGlobeSurfaceUniforms(textures())),
    ).toThrow("#include <beginnormal_vertex>");
  });
});

describe("cloudLonOffsetRad", () => {
  const TURN = 2 * Math.PI;
  const wrapped = (a: number) => ((a % TURN) + TURN) % TURN;

  it("is the drift rate times the scene's seconds, wrapped into [0, 2π)", () => {
    expect(cloudLonOffsetRad(0, 1)).toBe(0);
    expect(cloudLonOffsetRad(90_000, 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(cloudLonOffsetRad(-90_000, 1)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(cloudLonOffsetRad(Date.parse("2026-03-20T12:00:00Z"), 0)).toBe(0);
    expect(GLOBE_CLOUD_DRIFT_DEG_PER_S).toBeGreaterThan(0);
  });

  it("moves by exactly rate x elapsed between two instants, at today's epoch", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1.5e12, max: 2.5e12 }),
        fc.integer({ min: 0, max: 3_600_000 }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (t, elapsed, rate) => {
          const a = cloudLonOffsetRad(t, rate);
          const b = cloudLonOffsetRad(t + elapsed, rate);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThan(TURN);
          const expected = wrapped(((rate * elapsed) / 1000) * (Math.PI / 180));
          const miss = Math.abs(wrapped(b - a) - expected);
          // Equal modulo a turn, to 1e-6 rad (about 6 m on the ground).
          expect(Math.min(miss, TURN - miss)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("refuses a non-finite instant or rate", () => {
    expect(() => cloudLonOffsetRad(Number.NaN, 1)).toThrow(RangeError);
    expect(() => cloudLonOffsetRad(0, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});

describe("applyGlobeSurface", () => {
  it("shares one program and keeps every shared texture off the material", () => {
    const uniforms = createGlobeSurfaceUniforms(textures());
    const map = new THREE.Texture();
    const a = new THREE.MeshStandardMaterial({ map });
    const b = new THREE.MeshStandardMaterial();
    applyGlobeSurface(a, uniforms);
    applyGlobeSurface(b, uniforms);
    expect(a.customProgramCacheKey()).toBe(GLOBE_SURFACE_CACHE_KEY);
    expect(b.customProgramCacheKey()).toBe(GLOBE_SURFACE_CACHE_KEY);
    const texturesOn = (m: THREE.Material) =>
      Object.entries(m).filter(([, v]) => v instanceof THREE.Texture);
    expect(texturesOn(a).map(([k]) => k)).toEqual(["map"]);
    expect(texturesOn(b)).toEqual([]);
    // The hook patches whatever shader three hands it.
    const shader = standardShader();
    a.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uNight).toBe(uniforms.uNight);
  });
});

describe("globeFadeKeeps, the shader's dither split", () => {
  // Why: the two carriers must tile the screen between them at every
  // share: for any dither value exactly one side keeps the pixel, the
  // globe everything at share 0 and the relief everything at share 1.
  it("gives every pixel to exactly one side, at any share", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (d, share) => {
          const globe = globeFadeKeeps(d, share, 0);
          const relief = globeFadeKeeps(d, share, 1);
          expect(globe !== relief).toBe(true);
        },
      ),
    );
    for (const d of [0, 0.3, 0.999]) {
      expect(globeFadeKeeps(d, 0, 0)).toBe(true);
      expect(globeFadeKeeps(d, 1, 1)).toBe(true);
    }
  });
});
