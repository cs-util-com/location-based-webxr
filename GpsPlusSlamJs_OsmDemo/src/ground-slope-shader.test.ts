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
} from "./ground-slope-shader.js";

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
    installGroundSlope(material, { uSlope: { value: 1 } });
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
    installGroundSlope(material, { uSlope: { value: 1 } });

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
    const uniforms = { uSlope: { value: 0 } };
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
    installGroundSlope(material, { uSlope: { value: 1 } });
    expect(material.version).toBeGreaterThan(0);
  });
});
