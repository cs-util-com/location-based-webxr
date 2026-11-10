/**
 * The slope shader patch: its anchors exist, and it does not eat the hook it
 * chains onto.
 *
 * WHY THESE TESTS MATTER MORE THAN THEY LOOK. Neither of them checks a pixel —
 * CI has no GPU. They check the two ways a string patch fails SILENTLY, and both
 * have precedent in this repo:
 *
 * - **An anchor that moved.** `String.replace` with a missing needle returns the
 *   input unchanged, so the patch simply does not happen: the ground renders
 *   plain, no error is logged, and every pixel test that only asks "did
 *   something draw" stays green. A three upgrade renaming a chunk is exactly how
 *   that arrives, and it would arrive at a user's GPU rather than in CI.
 * - **A hook that replaced another.** `material.onBeforeCompile` is ONE
 *   function. The ground already carries `installGroundDisplacement`, so an
 *   assignment here would throw the displacement away — the terrain would
 *   flatten, in GPU mode only, with nothing reported. That is the same shape as
 *   the W20 outage: correct-looking output, green suite, missing feature.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  SLOPE_SHADER_ANCHORS,
  installGroundSlope,
  setGroundSlopeColours,
  slopeColourUniforms,
} from "./ground-slope-shader.js";
import { DEFAULT_GROUND_SLOPE_COLOURS } from "./ground-slope-colours.js";

/** A shader object shaped like the one three hands `onBeforeCompile`. */
function shaderStub(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe("the slope patch's anchors", () => {
  it("all exist in three's own standard shader", () => {
    // THE TEST THAT MAKES STRING PATCHING SURVIVABLE. If a three upgrade renames
    // a chunk, this goes red in CI rather than producing an untreated ground on
    // a user's machine with no error at all.
    for (const anchor of SLOPE_SHADER_ANCHORS.vertex) {
      expect(THREE.ShaderLib.standard.vertexShader).toContain(anchor);
    }
    for (const anchor of SLOPE_SHADER_ANCHORS.fragment) {
      expect(THREE.ShaderLib.standard.fragmentShader).toContain(anchor);
    }
  });

  it("uses `opaque_fragment`, which is the name in this three version", () => {
    // Named explicitly because the OLD name — `output_fragment` — is what most
    // examples on the internet still use, and it no longer exists. A patch
    // written against it would be a silent no-op.
    expect(THREE.ShaderLib.standard.fragmentShader).not.toContain(
      "#include <output_fragment>",
    );
  });
});

describe("installGroundSlope", () => {
  it("actually rewrites both shaders", () => {
    const material = new THREE.MeshStandardMaterial();
    installGroundSlope(material, {
      uSlope: { value: 1 },
      ...slopeColourUniforms(),
    });
    const shader = shaderStub();
    material.onBeforeCompile.call(
      material,
      shader,
      undefined as unknown as THREE.WebGLRenderer,
    );
    expect(shader.vertexShader).toContain("vGroundWorldNormal");
    expect(shader.fragmentShader).toContain("vGroundWorldNormal");
    expect(shader.fragmentShader).toContain("fwidth");
  });

  it("CHAINS onto an existing hook instead of replacing it", () => {
    // The ground already carries the displacement patch. Replacing its hook
    // would flatten the terrain in GPU mode with nothing reported.
    const material = new THREE.MeshStandardMaterial();
    const first = vi.fn((shader: { vertexShader: string }) => {
      shader.vertexShader = `// displacement\n${shader.vertexShader}`;
    });
    material.onBeforeCompile = first;
    installGroundSlope(material, {
      uSlope: { value: 1 },
      ...slopeColourUniforms(),
    });

    const shader = shaderStub();
    material.onBeforeCompile.call(
      material,
      shader,
      undefined as unknown as THREE.WebGLRenderer,
    );
    expect(first).toHaveBeenCalledTimes(1);
    // Both patches present: the earlier one's marker AND ours.
    expect(shader.vertexShader).toContain("// displacement");
    expect(shader.vertexShader).toContain("vGroundWorldNormal");
  });

  it("shares the uniform object, so one write reaches every material", () => {
    // The ground has two materials (plain and ramp) and both are patched. A
    // copied uniform would make the toggle work on one of them.
    const uniforms = { uSlope: { value: 0 }, ...slopeColourUniforms() };
    const material = new THREE.MeshStandardMaterial();
    installGroundSlope(material, uniforms);
    const shader = shaderStub();
    material.onBeforeCompile.call(
      material,
      shader,
      undefined as unknown as THREE.WebGLRenderer,
    );
    expect(shader.uniforms["uSlope"]).toBe(uniforms.uSlope);
  });

  it("marks the material for recompilation", () => {
    // Materials are cached by program. Without this the patch never reaches the
    // GPU — another way to get a silent no-op.
    const material = new THREE.MeshStandardMaterial();
    material.needsUpdate = false;
    installGroundSlope(material, {
      uSlope: { value: 1 },
      ...slopeColourUniforms(),
    });
    expect(material.version).toBeGreaterThan(0);
  });
});

describe("the slope colours (colour schemes plan 2026-11-10-0841 section 4.4)", () => {
  it("default to exactly the literals the shader carried", () => {
    // WHY: the default scheme must leave the default look unchanged; the
    // colours became uniforms only so other schemes can move them.
    expect(DEFAULT_GROUND_SLOPE_COLOURS).toEqual({
      cool: [0.1, 0.25, 0.35],
      warm: [0.35, 0.2, 0.15],
      isoline: [0.62, 0.74, 0.92],
      rim: [0.2, 0.2, 0.2],
    });
    const u = slopeColourUniforms();
    expect(u.uSlopeCool.value.toArray()).toEqual([0.1, 0.25, 0.35]);
    expect(u.uSlopeRim.value.toArray()).toEqual([0.2, 0.2, 0.2]);
  });

  it("are read from uniforms, no literal left in the patch", () => {
    // WHY: a literal left behind would ignore the scheme on that one term.
    const material = new THREE.MeshStandardMaterial();
    installGroundSlope(material, {
      uSlope: { value: 1 },
      ...slopeColourUniforms(),
    });
    const shader = shaderStub();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    for (const name of [
      "uSlopeCool",
      "uSlopeWarm",
      "uSlopeIsoline",
      "uSlopeRim",
    ]) {
      expect(shader.fragmentShader).toContain(`uniform vec3 ${name};`);
      expect(shader.uniforms[name]).toBeDefined();
    }
    expect(shader.fragmentShader).not.toContain("vec3(0.62, 0.74, 0.92)");
    expect(shader.fragmentShader).not.toContain("vec3(0.10, 0.25, 0.35)");
  });

  it("are written in place by setGroundSlopeColours, and refused out of range", () => {
    // WHY: a scheme switch writes the shared uniform objects (no recompile);
    // a channel outside [0, 1] is a scheme typo and must not reach the GPU.
    const uniforms = { uSlope: { value: 1 }, ...slopeColourUniforms() };
    const cool = uniforms.uSlopeCool;
    setGroundSlopeColours(uniforms, {
      ...DEFAULT_GROUND_SLOPE_COLOURS,
      cool: [0.5, 0.5, 0.5],
    });
    expect(uniforms.uSlopeCool).toBe(cool);
    expect(cool.value.toArray()).toEqual([0.5, 0.5, 0.5]);
    for (const bad of [
      [-0.1, 0, 0],
      [0, 1.1, 0],
      [0, 0, Number.NaN],
    ] as const) {
      expect(() =>
        setGroundSlopeColours(uniforms, {
          ...DEFAULT_GROUND_SLOPE_COLOURS,
          rim: bad,
        }),
      ).toThrow(RangeError);
    }
    // Nothing written by a refused call.
    expect(uniforms.uSlopeRim.value.toArray()).toEqual([0.2, 0.2, 0.2]);
  });
});
