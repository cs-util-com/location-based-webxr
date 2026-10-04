/**
 * The cloud shell (round-6 plan 2026-10-04-1050 G6-2, DEC-G6-3).
 *
 * Why this test matters: painted into the ground's colour, the clouds made
 * the relief a black-and-white relief under a passing cloud and stuck to the
 * ground at a flat view (owner, 2026-10-04). On their own shell they float
 * at a height above the ground, with the same look as the paint: the same
 * cloud sample and shade (the shared GLSL), the same drift, opacity and
 * twilight. These tests pin the shell's shape (the ellipsoid raised by the
 * height on every axis), its height's refusals, its blending (transparent,
 * no depth write, both faces, so it reads from above and below), and that
 * its shader reads the shared blocks rather than copies of them.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createGlobeCloudShell } from "./globe-cloud-shell.js";
import {
  GLOBE_CLOUD_GLSL,
  GLOBE_TWILIGHT_GLSL,
  createGlobeSurfaceUniforms,
} from "./globe-surface-material.js";

const A = 6_378_137;
const B = 6_356_752.314245;

function standardShader(): THREE.WebGLProgramParametersWithUniforms {
  const lib = THREE.ShaderLib.standard;
  return {
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
  } as THREE.WebGLProgramParametersWithUniforms;
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

function shell() {
  const uniforms = createGlobeSurfaceUniforms({
    night: new THREE.Texture(),
    clouds: new THREE.Texture(),
  });
  return { uniforms, s: createGlobeCloudShell({ uniforms, radii: [A, A, B] }) };
}

describe("createGlobeCloudShell", () => {
  it("is the ellipsoid raised by the height on every axis, with the poles on z", () => {
    const { s, uniforms } = shell();
    s.setHeightM(9_000);
    expect(s.mesh.scale.toArray()).toEqual([A + 9_000, A + 9_000, B + 9_000]);
    expect(s.heightM()).toBe(9_000);
    // The ground's shadow reads the same height.
    expect(uniforms.uCloudShellM.value).toBe(9_000);
    const pos = s.mesh.geometry.getAttribute("position");
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
    expect(maxZ).toBeCloseTo(1, 6);
  });

  it("refuses a height that is not finite and >= 0", () => {
    const { s } = shell();
    for (const h of [-1, Number.NaN, Infinity]) {
      expect(() => s.setHeightM(h)).toThrow(RangeError);
    }
  });

  it("blends over the ground, from above and below, without writing depth", () => {
    const { s } = shell();
    const m = s.mesh.material;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.side).toBe(THREE.DoubleSide);
    expect(m.customProgramCacheKey()).toBe(
      "gps-plus-slam-globe-cloud-shell-v1",
    );
  });

  it("draws the shared cloud sample and twilight, coloured by the shade, with the cloud as its alpha", () => {
    const { s, uniforms } = shell();
    const shader = standardShader();
    s.mesh.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const fs = shader.fragmentShader;
    expect(count(fs, GLOBE_CLOUD_GLSL)).toBe(1);
    expect(count(fs, GLOBE_TWILIGHT_GLSL)).toBe(1);
    expect(fs).toContain(
      "diffuseColor = vec4( mix( vec3( 1.0 ), globeCloudShade, uCloudRelief ), globeCloud * uCloudOpacity * uShellShare );",
    );
    expect(fs).not.toContain("uNight");
    // The shared uniform objects, so the drift and the look move together.
    for (const name of [
      "uClouds",
      "uCloudLonOffset",
      "uCloudOpacity",
      "uCloudRelief",
      "uSunEcef",
      "uSunWorld",
      "uTwilight",
      "uGrade",
    ] as const) {
      expect(shader.uniforms[name]).toBe(uniforms[name]);
    }
    // The geodetic normal of the raised ellipsoid, from the unit sphere.
    expect(shader.vertexShader).toContain(
      "vGeoNormal = normalize( position / uShellRadii );",
    );
  });

  it("draws its share of the clouds, hidden at 0, refusing a share outside 0-1", () => {
    const { s } = shell();
    expect(s.mesh.visible).toBe(false);
    s.setShare(0.4);
    expect(s.share()).toBe(0.4);
    expect(s.mesh.visible).toBe(true);
    const shader = standardShader();
    s.mesh.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms["uShellShare"]?.value).toBe(0.4);
    s.setShare(0);
    expect(s.mesh.visible).toBe(false);
    for (const bad of [-0.1, 1.1, Number.NaN]) {
      expect(() => s.setShare(bad)).toThrow(RangeError);
    }
  });

  it("frees its geometry and material", () => {
    const { s } = shell();
    let freed = 0;
    s.mesh.geometry.addEventListener("dispose", () => freed++);
    s.mesh.material.addEventListener("dispose", () => freed++);
    s.dispose();
    expect(freed).toBe(2);
  });
});
