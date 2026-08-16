/**
 * Why these tests matter: a shader cannot be proved correct without a GPU, but
 * three of its failure modes are provable here and all three are silent.
 *
 * - The three material flags ARE the effect. `DoubleSide` is what makes it safe
 *   to stand inside a building, additive is what makes it read as light,
 *   `depthWrite: false` is what stops shells occluding each other wrongly. Any
 *   one of them reverting looks like a styling change rather than a bug.
 * - Every uniform the fragment shader reads must exist. A missing one compiles
 *   to a default of 0 in some drivers and throws in others — either way the
 *   look is silently wrong rather than absent.
 * - `uTime` must reject a non-finite clock. The frame loop hands `elapsed`,
 *   which is 0 after a reset by contract; a NaN would make `sin` NaN and blank
 *   every building at once.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  AR_SHELL_PARAMS,
  createArBuildingMaterial,
} from "./ar-building-material.js";

describe("createArBuildingMaterial", () => {
  it("keeps the three flags that ARE the effect", () => {
    const { material } = createArBuildingMaterial();
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    // Depth TESTING stays on: shells should still be hidden by the terrain and
    // by anything that does write depth.
    expect(material.depthTest).toBe(true);
    expect(material.forceSinglePass).toBe(true);
  });

  it("supplies every uniform the fragment shader reads", () => {
    // Derived from the shader source rather than hand-listed, so adding a
    // uniform to the GLSL without wiring it cannot pass.
    const { material } = createArBuildingMaterial();
    const declared = [
      ...material.fragmentShader.matchAll(/uniform\s+\w+\s+([^;]+);/g),
    ].flatMap((m) => (m[1] ?? "").split(",").map((n) => n.trim()));

    expect(declared.length).toBeGreaterThan(5);
    for (const name of declared) {
      expect(material.uniforms[name]).toBeDefined();
    }
  });

  it("declares the two vertex attributes the geometry supplies", () => {
    // These names must match `mesh-layers.ts`'s setAttribute calls exactly; a
    // mismatch leaves the attribute undefined and the pulse frozen at phase 0.
    const { material } = createArBuildingMaterial();
    expect(material.vertexShader).toContain("attribute float aHeight01;");
    expect(material.vertexShader).toContain("attribute float aFeatureRand;");
    // And `color`, declared explicitly because `vertexColors: true` only injects
    // defines for three's own shader chunks, which this shader does not use.
    expect(material.vertexShader).toContain("attribute vec3 color;");
  });

  it("uses the owner's chosen parameters, not the shader lab's defaults", () => {
    // The lab's rimPower was 1.7; 0.80 is a much broader glow, and reverting it
    // would look like a subtle styling difference rather than the wrong shader.
    const { material } = createArBuildingMaterial();
    expect(material.uniforms["uRimPower"]?.value).toBeCloseTo(0.8, 6);
    expect(material.uniforms["uOpacity"]?.value).toBeCloseTo(0.3, 6);
    expect(material.uniforms["uBackBoost"]?.value).toBeCloseTo(0.77, 6);
    expect(material.uniforms["uPulseSpeed"]?.value).toBeCloseTo(0.8, 6);
    expect(material.uniforms["uPulseAmount"]?.value).toBeCloseTo(0.51, 6);
  });

  it("mixes the feature colour by default, and can reproduce the screenshot exactly", () => {
    // Owner decision: class colours stay legible in AR. Mix 0 is the escape
    // hatch back to the single cyan that was approved.
    expect(AR_SHELL_PARAMS.colourMix).toBeGreaterThan(0);
    const plain = createArBuildingMaterial({ colourMix: 0 });
    expect(plain.material.uniforms["uColourMix"]?.value).toBe(0);
  });

  it("advances the pulse clock", () => {
    const shell = createArBuildingMaterial();
    shell.setTime(12.5);
    expect(shell.material.uniforms["uTime"]?.value).toBe(12.5);
  });

  it("REFUSES a non-finite clock rather than blanking the city", () => {
    const shell = createArBuildingMaterial();
    shell.setTime(3);
    shell.setTime(Number.NaN);
    shell.setTime(Number.POSITIVE_INFINITY);
    expect(shell.material.uniforms["uTime"]?.value).toBe(3);
  });
});
