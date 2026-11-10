/**
 * The land-use tint on a three.js ground material: a texture over the build
 * window and a fragment patch that multiplies the ground's diffuse colour by
 * the painted class colour, fading to the neutral ground over the last
 * `fadeM` metres of the window (a port of O2's `tintGround`; city objects
 * plan 2026-11-07-2315 M3).
 *
 * @see ground-tint.ts.md
 */

import * as THREE from "three";

import type { GroundTint } from "../mesh/ground-tint.js";

/** O2's fade to the plain ground at the window's edge, metres. */
export const GROUND_TINT_FADE_M = 40;

/** What `applyGroundTint` returns: the switch and the cleanup. */
export interface AppliedGroundTint {
  /** Turns the tint on or off without recompiling (a uniform). */
  setEnabled(on: boolean): void;
  /** Frees the texture and gives the material back its own shader and colour. */
  dispose(): void;
}

/** Options of `applyGroundTint`. */
export interface ApplyGroundTintOptions {
  readonly fadeM?: number;
  readonly enabled?: boolean;
  /** Max anisotropy for the texture; the renderer's cap is a good value. */
  readonly anisotropy?: number;
}

/**
 * The tint's texture: each texel the sRGB colour of its class, row 0 the
 * south edge (three's `flipY` is off for data textures, so row 0 is v = 0).
 */
export function groundTintTexture(
  tint: GroundTint,
  anisotropy = 1,
): THREE.DataTexture {
  const { width, height, classes, palette } = tint;
  if (classes.length !== width * height) {
    throw new RangeError("ground tint classes do not match its size");
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < classes.length; i++) {
    const rgb = palette[classes[i] ?? 0] ?? palette[0] ?? 0;
    rgba[i * 4] = (rgb >> 16) & 0xff;
    rgba[i * 4 + 1] = (rgb >> 8) & 0xff;
    rgba[i * 4 + 2] = rgb & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(rgba, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** The tint uniforms of one material (see `tintUniformsOf`). */
interface TintUniforms {
  readonly groundTint: { value: THREE.Texture | null };
  readonly groundOrigin: { value: THREE.Vector2 };
  readonly groundSize: { value: THREE.Vector2 };
  readonly groundNeutral: { value: THREE.Vector3 };
  readonly groundFade: { value: number };
  readonly groundOn: { value: number };
  /** The application whose values these are; an older handle is inert. */
  owner: object | undefined;
}

/**
 * ONE SET OF UNIFORM OBJECTS PER MATERIAL, reused by every application.
 * three.js runs `onBeforeCompile` only when the material has no program for
 * its cache key yet, and then keeps binding the uniforms of THAT compile. A
 * rebuild disposes one tint and applies the next under the same key, so the
 * program compiled for the first tint is reused; fresh uniform objects per
 * application would leave it sampling the first, freed texture.
 */
const tintUniformsOf = new WeakMap<THREE.Material, TintUniforms>();

function uniformsFor(material: THREE.Material): TintUniforms {
  let uniforms = tintUniformsOf.get(material);
  if (uniforms === undefined) {
    uniforms = {
      groundTint: { value: null },
      groundOrigin: { value: new THREE.Vector2() },
      groundSize: { value: new THREE.Vector2() },
      groundNeutral: { value: new THREE.Vector3() },
      groundFade: { value: GROUND_TINT_FADE_M },
      groundOn: { value: 1 },
      owner: undefined,
    };
    tintUniformsOf.set(material, uniforms);
  }
  return uniforms;
}

/**
 * Patches `material` (a lit three material whose world xz plane is east and
 * minus north, the render convention) to draw `tint`. Sets the material's
 * colour to white: the neutral ground comes from the tint's palette, so the
 * ground has one colour owner. Chains an existing `onBeforeCompile`.
 */
export function applyGroundTint(
  material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial,
  tint: GroundTint,
  options: ApplyGroundTintOptions = {},
): AppliedGroundTint {
  const fadeM = options.fadeM ?? GROUND_TINT_FADE_M;
  if (!(fadeM >= 0) || !Number.isFinite(fadeM)) {
    throw new RangeError(`fadeM must be a finite number >= 0, got ${fadeM}`);
  }
  const texture = groundTintTexture(tint, options.anisotropy);
  const neutral = new THREE.Color(tint.palette[0] ?? 0);
  const previousColour = material.color.clone();
  const uniforms = uniformsFor(material);
  const handle = {};
  uniforms.owner = handle;
  uniforms.groundTint.value = texture;
  uniforms.groundOrigin.value.set(tint.originX, tint.originY);
  uniforms.groundSize.value.set(
    tint.width * tint.texelM,
    tint.height * tint.texelM,
  );
  uniforms.groundNeutral.value.set(neutral.r, neutral.g, neutral.b);
  uniforms.groundFade.value = Math.max(0.01, fadeM);
  const live = (): boolean => uniforms.owner === handle;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, {
      groundTint: uniforms.groundTint,
      groundOrigin: uniforms.groundOrigin,
      groundSize: uniforms.groundSize,
      groundNeutral: uniforms.groundNeutral,
      groundFade: uniforms.groundFade,
      groundOn: uniforms.groundOn,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vGroundXZ;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "varying vec2 vGroundXZ;",
          "uniform sampler2D groundTint;",
          "uniform vec2 groundOrigin;",
          "uniform vec2 groundSize;",
          "uniform vec3 groundNeutral;",
          "uniform float groundFade;",
          "uniform float groundOn;",
        ].join("\n"),
      )
      .replace(
        "#include <map_fragment>",
        [
          "#include <map_fragment>",
          "vec2 groundEnu = vec2(vGroundXZ.x, -vGroundXZ.y);",
          "vec2 groundUv = (groundEnu - groundOrigin) / groundSize;",
          "vec3 groundPaint = texture2D(groundTint, groundUv).rgb;",
          "vec2 groundEdge = min(groundEnu - groundOrigin, groundOrigin + groundSize - groundEnu);",
          "float groundInside = smoothstep(0.0, groundFade, min(groundEdge.x, groundEdge.y)) * groundOn;",
          "diffuseColor.rgb *= mix(groundNeutral, groundPaint, groundInside);",
        ].join("\n"),
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|ground-tint`;
  // Off (groundOn 0) the patch multiplies by the neutral everywhere, which
  // is exactly the plain ground, so the material stays white in both states.
  const setEnabled = (on: boolean): void => {
    if (live()) uniforms.groundOn.value = on ? 1 : 0;
  };
  setEnabled(options.enabled !== false);
  material.color.set(0xffffff);
  material.needsUpdate = true;
  return {
    setEnabled,
    dispose() {
      texture.dispose();
      if (!live()) return;
      uniforms.owner = undefined;
      uniforms.groundTint.value = null;
      material.onBeforeCompile = previous;
      material.customProgramCacheKey = previousKey;
      material.color.copy(previousColour);
      material.needsUpdate = true;
    },
  };
}
