/**
 * The AR building look — "Double-sided X-ray pulse", ported from the owner's
 * chosen shader-lab variant (2026-08-16).
 *
 * **An interior-safe luminous shell**: both faces glow, brighter at grazing
 * angles, with a slow breathing pulse offset per building so the city does not
 * pulse as one organism.
 *
 * **WHY IT IS AR-ONLY.** It is additive and writes no depth, so it brightens
 * whatever is behind it — which is the point over a camera passthrough and wrong
 * over the desktop view's sky gradient, where it would wash out against a lit
 * background and lose the depth ordering the desktop view depends on.
 *
 * **THE THREE FLAGS ARE THE EFFECT, not decoration.**
 * - `DoubleSide` is what makes it *interior-safe*: standing inside a building
 *   you see its back faces glow instead of looking through a hole. It also
 *   roughly doubles the fragments on the largest mesh in the scene.
 * - `AdditiveBlending` is what makes it read as light rather than as paint.
 * - `depthWrite: false` is what stops overlapping shells from occluding each
 *   other wrongly — and, accepted by the owner, means the route line, the NPC
 *   agent and POI markers now show *through* buildings.
 *
 * ⚠️ **The one risk that cannot be checked from a desk**: additive blending
 * brightens the camera feed, so on a bright daylit street the glow may wash out
 * to near-invisible. The variant was judged against a procedural backdrop.
 *
 * ⚠️ **THIS MATERIAL IS NOT GRADED LIKE THE REST OF THE AR SCENE, and that is
 * a fact rather than a preference** (PR #313 review). `ar-scene-environment.ts`
 * sets `renderer.toneMapping = AR_TONE_MAPPING` and an exposure, but three.js
 * applies tone mapping and the linear→sRGB encode to a `ShaderMaterial` only if
 * the fragment source *contains* `#include <tonemapping_fragment>` and
 * `#include <colorspace_fragment>` — it SUBSTITUTES those chunks, it never
 * injects them. Neither appears here (nor anywhere in this package), so
 * `gl_FragColor` is written raw. Two consequences: the tint is built with
 * `setHSL(..., THREE.SRGBColorSpace)`, which converts into Linear-sRGB, and
 * writing that straight to an sRGB target renders it darker and less saturated
 * than the HSL picked in the lab; and the shell is the one thing in the scene
 * not passing through ACES at exposure. Whether that is the approved look — the
 * lab may itself have been ungraded — is an open question, filed as
 * `docs/2026-08-17-2220-ar-shell-colour-pipeline-followup.md`. Stated here so
 * the file stops reading as if it lived under the same grade as its neighbours.
 *
 * @see ar-building-material.ts.md
 */

import * as THREE from "three";

/**
 * The owner's chosen parameters, from the shader-lab UI on 2026-08-16.
 *
 * The lab's own defaults are recorded beside each one, because they differ in
 * ways that change the look and a later reader would otherwise assume the lab
 * defaults were kept.
 */
export const AR_SHELL_PARAMS = {
  /** Overall strength. Lab default 0.34. */
  opacity: 0.3,
  /**
   * Rim falloff exponent. Lab default 1.7.
   *
   * **0.80 is a much BROADER glow**, not a thin silhouette rim — most of each
   * face lights rather than just its edge. This is the single largest departure
   * from the lab defaults and the main reason the chosen look reads as a solid
   * luminous shell rather than an outline.
   */
  rimPower: 0.8,
  /** Extra strength on back faces, which is what fills interiors. Lab 0.62. */
  backBoost: 0.77,
  /** Radians/second-ish of breathing. Lab 1.3 — the choice is SLOWER. */
  pulseSpeed: 0.8,
  /** Depth of the breath. Lab 0.32 — the choice is DEEPER. */
  pulseAmount: 0.51,
  /** Base hue/sat/light — cyan. Lab was 0.78/0.68/0.68, a violet. */
  hue: 0.52,
  saturation: 0.76,
  lightness: 0.56,
  /**
   * How much each building's feature-class colour pulls the tint (owner
   * decision 2026-08-16 — "mix feature colour into the tint").
   *
   * **0 reproduces the approved screenshot exactly**: one cyan for the whole
   * city. 1 is pure class colour and loses the look's identity. The default is a
   * deliberate middle: the palette's class distinctions stay legible in AR —
   * which is what `feature-colours.test.ts` exists to protect — while the scene
   * still reads as cyan.
   */
  colourMix: 0.35,
} as const;

/**
 * The tunable set, widened to `number`.
 *
 * `AR_SHELL_PARAMS` is `as const` so each value keeps its literal type and a
 * reader sees the chosen number in the type itself — but that also makes
 * `Partial<typeof AR_SHELL_PARAMS>` reject any OTHER number, which is exactly
 * what an override is for. Mapped to `number` here so `{ colourMix: 0 }` — the
 * escape hatch back to the approved single-cyan look — actually typechecks.
 */
export type ArShellParams = {
  -readonly [K in keyof typeof AR_SHELL_PARAMS]: number;
};

/**
 * Vertex stage.
 *
 * `color` is declared explicitly rather than via `vertexColors: true`: on a raw
 * `ShaderMaterial` that flag only injects defines for three's own chunks, which
 * this shader does not use.
 */
const VERTEX_SHADER = /* glsl */ `
  attribute float aHeight01;
  attribute float aFeatureRand;
  attribute vec3 color;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vHeight01;
  varying float vRand;
  varying vec3 vVertexColor;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vHeight01 = aHeight01;
    vRand = aFeatureRand;
    vVertexColor = color;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * Fragment stage — variant 9, with the colour mix added.
 *
 * `viewFacing` uses `abs(dot(N, V))` so a back face is as lit as a front one at
 * the same angle; the front/back distinction is carried by `uBackBoost` alone.
 */
const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  uniform vec3 uTint;
  uniform float uTime, uOpacity, uRimPower, uBackBoost, uPulseSpeed, uPulseAmount, uColourMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vHeight01;
  varying float vRand;
  varying vec3 vVertexColor;

  float viewFacing() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    return abs(dot(normalize(vWorldNormal), V));
  }

  void main() {
    float rim = pow(1.0 - viewFacing(), uRimPower);
    float pulse = 1.0 + uPulseAmount * sin(uTime * uPulseSpeed + vHeight01 * 5.0 + vRand * 6.2831);
    float sideBoost = gl_FrontFacing ? 1.0 : (1.0 + uBackBoost);
    float energy = uOpacity * (0.16 + 0.84 * rim) * pulse * sideBoost;
    vec3 tint = mix(uTint, vVertexColor, uColourMix);
    gl_FragColor = vec4(tint * energy, clamp(energy, 0.0, 1.0));
  }
`;

/** The material plus the one thing the frame loop has to drive. */
export interface ArBuildingMaterial {
  readonly material: THREE.ShaderMaterial;
  /** Advance the breathing. `seconds` is the frame clock, not wall time. */
  setTime(seconds: number): void;
}

/**
 * Build the AR shell material.
 *
 * @param params override any of {@link AR_SHELL_PARAMS} — used by tests and by
 *   any future in-AR tuning UI.
 */
export function createArBuildingMaterial(
  params: Partial<ArShellParams> = {},
): ArBuildingMaterial {
  const p = { ...AR_SHELL_PARAMS, ...params };
  const tint = new THREE.Color().setHSL(
    p.hue,
    p.saturation,
    p.lightness,
    THREE.SRGBColorSpace,
  );

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTint: { value: tint },
      uTime: { value: 0 },
      uOpacity: { value: p.opacity },
      uRimPower: { value: p.rimPower },
      uBackBoost: { value: p.backBoost },
      uPulseSpeed: { value: p.pulseSpeed },
      uPulseAmount: { value: p.pulseAmount },
      uColourMix: { value: p.colourMix },
    },
  });
  // ONE PASS, not three's default two-pass transparency. With additive blending
  // and no depth write there is nothing for a back-then-front pass to order, so
  // the second pass is pure fragment cost on the scene's largest mesh.
  material.forceSinglePass = true;

  return {
    material,
    setTime(seconds: number): void {
      // GUARDED. A non-finite clock would make `sin` NaN and blank every
      // building. The frame loop hands `elapsed` — the rAF timestamp in
      // seconds, PAGE-relative rather than session-relative, so it is already
      // large on the first frame of a session entered late. (`dt` is the one
      // that starts at 0; `xr-frame-loop.ts` records that reading `elapsed`
      // as session-relative already cost a consumer a real defect.) Monotonic,
      // never negative, and only ever fed to `sin`, so the magnitude does not
      // matter here — only finiteness does.
      if (!Number.isFinite(seconds)) return;
      (material.uniforms["uTime"] as { value: number }).value = seconds;
    },
  };
}
