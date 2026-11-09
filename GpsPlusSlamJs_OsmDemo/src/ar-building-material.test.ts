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
  FLAT_ROOF_TONES,
  PITCHED_ROOF_TONES,
  WALL_TONES,
  srgbToLinear,
} from "gps-plus-slam-osm";

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

/**
 * Why these tests matter: the building chunks carry LINEAR vertex colours
 * since r1158 (`linearChunkColours`), and the owner chose to keep them and
 * raise each consumer's light ("Korrekt lassen, Licht anheben"). This shell
 * is unlit and writes `gl_FragColor` raw (no colour-space chunk), so it has
 * no light to raise: mixing the linear colour in raw made walls about 12 %
 * and roofs about 19 % darker than on main. The fix encodes the vertex
 * colour back to sRGB before the mix, with three's own `sRGBTransferOETF`
 * (in every `ShaderMaterial`'s fragment prefix), which restores exactly the
 * value main mixed in. A shader cannot run here, so the source is pinned and
 * the arithmetic is mirrored: three's OETF on the library's linear tones
 * gives the palette's sRGB tones back, and the mixed tint's luma is main's.
 */
describe("the AR shell's vertex colour, encoded back to sRGB", () => {
  /** three's `sRGBTransferOETF`, per channel, as its GLSL writes it. */
  const oetf = (v: number) =>
    v <= 0.0031308 ? v * 12.92 : 1.055 * v ** 0.41666 - 0.055;
  const channels = (rgb: number) => [
    ((rgb >> 16) & 0xff) / 255,
    ((rgb >> 8) & 0xff) / 255,
    (rgb & 0xff) / 255,
  ];
  const luma = ([r, g, b]: number[]) =>
    0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  const tones = [
    ["walls", WALL_TONES],
    ["pitched roofs", PITCHED_ROOF_TONES],
    ["flat roofs", FLAT_ROOF_TONES],
  ] as const;

  it("encodes the vertex colour with three's OETF before the mix", () => {
    const { material } = createArBuildingMaterial();
    const source = material.fragmentShader.replace(/\s+/g, " ");
    expect(source).toContain("sRGBTransferOETF(vec4(vVertexColor, 1.0)).rgb");
    // Never mixed in raw: every read of the varying is the encoded one.
    expect(source.match(/vVertexColor/g)).toHaveLength(2);
  });

  it("gives back the palette's sRGB tones from the library's linear ones", () => {
    for (const [, set] of tones) {
      for (const tone of set) {
        for (const c of channels(tone)) {
          expect(Math.abs(oetf(srgbToLinear(c)) - c)).toBeLessThan(0.5 / 255);
        }
      }
    }
  });

  it("mixes the tint to main's luma, where the raw linear colour was darker", () => {
    const { material } = createArBuildingMaterial();
    const tint = material.uniforms["uTint"]?.value as THREE.Color;
    const mix = AR_SHELL_PARAMS.colourMix;
    const shell = (rgb: number[]) =>
      luma(
        [tint.r, tint.g, tint.b].map(
          (t, i) => t * (1 - mix) + (rgb[i] ?? 0) * mix,
        ),
      );
    for (const [what, set] of tones) {
      let main = 0;
      let raw = 0;
      let encoded = 0;
      for (const tone of set) {
        const srgb = channels(tone);
        const linear = srgb.map(srgbToLinear);
        main += shell(srgb);
        raw += shell(linear);
        encoded += shell(linear.map(oetf));
      }
      // The defect the encode removes: measurably darker than main.
      expect(raw / main, what).toBeLessThan(0.9);
      expect(Math.abs(encoded / main - 1), what).toBeLessThan(0.002);
    }
  });
});
