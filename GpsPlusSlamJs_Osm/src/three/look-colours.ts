/**
 * Draws a chunk's colour looks (`MeshChunk.lookColours`, a city baked in up
 * to four colour schemes) as one mesh whose colour a uniform mixes: the K
 * Uint8 look codes per vertex replace the Float32 `color` attribute, the
 * vertex shader decodes each code through a shared 256x2 float texture of
 * `LOOK_COLOUR_DECODE` and sums them by the `trimWeights` vec4, and the
 * fragment shader multiplies the mix where three's vertex colour would be.
 *
 * One `LookMix` is shared by every chunk material of a city, so moving a
 * blend of looks (a time of day) is one uniform write, never a rebuild.
 *
 * @see look-colours.ts.md
 */

import * as THREE from "three";

import {
  LOOK_COLOUR_DECODE,
  type LookColourDecode,
} from "../mesh/chunk-meshes.js";
import { MAX_CITY_LOOKS } from "../mesh/colour-scheme.js";

/**
 * The shared mix of a city's look materials. `trimWeights` is the weight of
 * each look already multiplied by that look's brightness trim (so it need
 * not sum to 1), for the mesh shader only; unused looks are 0.
 */
export interface LookMix {
  readonly trimWeights: { readonly value: THREE.Vector4 };
}

/** A mix on look 0 at weight 1: what a fixed build of look 0 draws. */
export function createLookMix(): LookMix {
  return { trimWeights: { value: new THREE.Vector4(1, 0, 0, 0) } };
}

/**
 * Sets the trim-folded weights, one per look (1 to 4, the rest 0). Each
 * must be finite and >= 0; RangeError otherwise, leaving the mix unchanged.
 */
export function setTrimWeights(mix: LookMix, weights: readonly number[]): void {
  const list = checkedWeightList(weights, "trim weights");
  if (list.length === 0 || list.length > MAX_CITY_LOOKS) {
    throw new RangeError(
      `trim weights need 1 to ${MAX_CITY_LOOKS} entries, got ${list.length}`,
    );
  }
  mix.trimWeights.value.set(
    list[0] ?? 0,
    list[1] ?? 0,
    list[2] ?? 0,
    list[3] ?? 0,
  );
}

/**
 * `weights` when it is an array of finite numbers >= 0 (the trim weights
 * here, the trees' look weights in `tree-looks.ts`); RangeError naming
 * `what` otherwise.
 */
export function checkedWeightList(
  weights: unknown,
  what: string,
): readonly number[] {
  if (!Array.isArray(weights)) {
    throw new RangeError(`${what} must be an array`);
  }
  const list: readonly unknown[] = weights;
  for (const w of list) {
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
      throw new RangeError(`${what} must be finite and >= 0, got ${String(w)}`);
    }
  }
  return list as readonly number[];
}

let decodeTexture: THREE.DataTexture | undefined;

/**
 * `LOOK_COLOUR_DECODE` as a 256x2 R32F texture, nearest: row 0 the linear
 * decode, row 1 the raw one. Made on first use and shared by every look
 * material of every city, so it is never disposed (512 floats).
 */
export function lookDecodeTexture(): THREE.DataTexture {
  if (decodeTexture !== undefined) return decodeTexture;
  decodeTexture = new THREE.DataTexture(
    Float32Array.from(LOOK_COLOUR_DECODE),
    256,
    2,
    THREE.RedFormat,
    THREE.FloatType,
  );
  decodeTexture.magFilter = THREE.NearestFilter;
  decodeTexture.minFilter = THREE.NearestFilter;
  decodeTexture.generateMipmaps = false;
  decodeTexture.needsUpdate = true;
  return decodeTexture;
}

const ROWS: Record<LookColourDecode, number> = { linear: 0, raw: 1 };
const LANES = ["x", "y", "z", "w"] as const;

/** The vertex shader's declarations and decode for `looks` looks on `row`. */
function vertexHead(looks: number, row: number): string {
  return [
    `#define LOOK_DECODE_ROW ${row}`,
    ...Array.from(
      { length: looks },
      (_, k) => `attribute vec3 lookColour${k};`,
    ),
    "uniform vec4 trimWeights;",
    "uniform highp sampler2D lookDecode;",
    "varying vec3 vLookColour;",
    "float lookDecodedChannel(float code) {",
    "  return texelFetch(lookDecode, ivec2(int(code * 255.0 + 0.5), LOOK_DECODE_ROW), 0).r;",
    "}",
    "vec3 lookDecoded(vec3 code) {",
    "  return vec3(lookDecodedChannel(code.r), lookDecodedChannel(code.g), lookDecodedChannel(code.b));",
    "}",
  ].join("\n");
}

/** The vertex shader's mix line for `looks` looks. */
function vertexMix(looks: number): string {
  const terms = Array.from(
    { length: looks },
    (_, k) => `trimWeights.${LANES[k] ?? "x"} * lookDecoded(lookColour${k})`,
  );
  return `vLookColour = ${terms.join(" + ")};`;
}

/**
 * Puts `lookColours` (one Uint8 RGB code per vertex and look, as the mesh
 * builders write them) on `geometry` as `lookColour0..K-1`, normalised,
 * removes its `color` attribute, and patches `material` to draw their mix
 * by `mix.trimWeights`, decoded on the `decode` row (`linear` for
 * buildings, `raw` for roads, as their `colors` are). The material's own
 * vertex colours are switched off; its `color` still multiplies (the noon
 * gain). A hook or cache key already on the material is chained, never
 * replaced. RangeError for no looks, more than four, or a buffer that is
 * not three codes per vertex of the geometry's `position`.
 */
export function applyLookColours(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  lookColours: readonly Uint8Array[],
  decode: LookColourDecode,
  mix: LookMix,
): void {
  const looks = lookColours.length;
  if (looks === 0 || looks > MAX_CITY_LOOKS) {
    throw new RangeError(
      `a look mesh needs 1 to ${MAX_CITY_LOOKS} looks, got ${looks}`,
    );
  }
  const position = geometry.getAttribute("position") as
    THREE.BufferAttribute | undefined;
  const expected = position === undefined ? undefined : position.count * 3;
  for (const [k, codes] of lookColours.entries()) {
    if (
      !(codes instanceof Uint8Array) ||
      (expected !== undefined && codes.length !== expected)
    ) {
      throw new RangeError(
        `look ${k} needs ${String(expected)} Uint8 codes, got ${String(codes.length)}`,
      );
    }
  }
  geometry.deleteAttribute("color");
  for (const [k, codes] of lookColours.entries()) {
    geometry.setAttribute(
      `lookColour${k}`,
      new THREE.BufferAttribute(codes, 3, true),
    );
  }
  const row = ROWS[decode];
  material.vertexColors = false;
  // CHAINED, like the ground tint's patch: a hook already on the material
  // runs first and keeps its key, so two patches never overwrite each other
  // or share one program.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- kept unbound on purpose and always called with `.call(material, ...)`.
  const previous = material.onBeforeCompile;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- as `previous` above.
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms["trimWeights"] = mix.trimWeights;
    shader.uniforms["lookDecode"] = { value: lookDecodeTexture() };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${vertexHead(looks, row)}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${vertexMix(looks)}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vLookColour;",
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb *= vLookColour;",
      );
  };
  // three's default key is the CURRENT hook's source, which after this
  // patch is the patch itself; the earlier hook's source keeps its place.
  const keyBefore =
    previousKey === THREE.Material.prototype.customProgramCacheKey
      ? () => previous.toString()
      : () => previousKey.call(material);
  material.customProgramCacheKey = () =>
    `${keyBefore()}|look-colours-${looks}-${row}`;
  material.needsUpdate = true;
}
