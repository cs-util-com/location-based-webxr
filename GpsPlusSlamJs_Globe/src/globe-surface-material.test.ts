/**
 * Why this test matters: the night lights, the water glint and the clouds
 * are one string patch on three's physical shader. Two failures would be
 * silent in a browser: a three upgrade that renames a chunk (the term just
 * disappears), and a shared texture stored ON a tile material (the tile
 * renderer disposes every texture it finds on a material when that tile
 * unloads, so the first unload would blank the night lights on every
 * tile). So the patch is checked on copies of three's REAL shader source,
 * each anchor exactly once, a missing one refused by name, and the tile
 * material is checked to carry no texture but its own map.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  GLOBE_SURFACE_CACHE_KEY,
  GLOBE_SURFACE_TUNING,
  applyGlobeSurface,
  createGlobeSurfaceUniforms,
  patchGlobeSurfaceShader,
} from "./globe-surface-material.js";

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
  water: new THREE.Texture(),
  clouds: new THREE.Texture(),
});

const count = (text: string, needle: string): number =>
  text.split(needle).length - 1;

describe("createGlobeSurfaceUniforms", () => {
  it("holds the three maps, a unit sun and the tuning defaults", () => {
    const t = textures();
    const u = createGlobeSurfaceUniforms(t);
    expect(u.uNight.value).toBe(t.night);
    expect(u.uWater.value).toBe(t.water);
    expect(u.uClouds.value).toBe(t.clouds);
    expect(u.uSunEcef.value.length()).toBeCloseTo(1, 12);
    expect(u.uNightGain.value).toBe(GLOBE_SURFACE_TUNING.nightGain);
    expect(u.uWaterRoughness.value).toBe(GLOBE_SURFACE_TUNING.waterRoughness);
    expect(u.uCloudOpacity.value).toBe(GLOBE_SURFACE_TUNING.cloudOpacity);
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
      "uWater",
      "uClouds",
      "uNightGain",
      "uWaterRoughness",
      "uCloudOpacity",
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
      at("globeNight * uNightGain"),
    );
    expect(at("globeNight * uNightGain")).toBeLessThan(
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
    expect(count(fs, "textureGrad(")).toBe(3);
    expect(fs).not.toMatch(/texture\( u(Night|Water|Clouds)/);
  });

  it("refuses a shader missing an anchor, or holding one twice, naming it", () => {
    for (const anchor of [
      "#include <common>",
      "#include <alphamap_fragment>",
      "#include <roughnessmap_fragment>",
      "#include <emissivemap_fragment>",
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
