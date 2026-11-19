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

import { MAX_CITY_LOOKS } from "../mesh/colour-scheme.js";
import type { GroundTint } from "../mesh/ground-tint.js";

/** O2's fade to the plain ground at the window's edge, metres. */
export const GROUND_TINT_FADE_M = 40;

/** What `applyGroundTint` returns: the switch and the cleanup. */
export interface AppliedGroundTint {
  /** Turns the tint on or off without recompiling (a uniform). */
  setEnabled(on: boolean): void;
  /**
   * The mix of a tint built with looks: one weight per look, each finite and
   * >= 0 (they are not normalised: the caller passes weights summing to 1).
   * RangeError for a wrong count or value, and on a tint without looks.
   */
  setLookWeights(weights: readonly number[]): void;
  /**
   * The neutral the tint fades to at the window edge (and, without looks,
   * the one it is off at), sRGB 0xRRGGBB. RangeError for anything else.
   */
  setNeutral(rgb: number): void;
  /** Frees the textures and gives the material back its own shader and colour. */
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

/**
 * The class raster of a tint built with looks: one byte per texel, the class
 * index into a palette row. Sampled nearest and never mipmapped, since
 * filtering would blend class INDICES, not colours.
 */
export function groundClassTexture(tint: GroundTint): THREE.DataTexture {
  const { width, height, classes } = tint;
  if (classes.length !== width * height) {
    throw new RangeError("ground tint classes do not match its size");
  }
  const texture = new THREE.DataTexture(
    classes,
    width,
    height,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  nearestData(texture);
  // A row of an odd width is not 4-byte aligned.
  texture.unpackAlignment = 1;
  return texture;
}

/**
 * The palettes of a tint built with looks: row k is `lookPalettes[k]`, one
 * sRGB texel per palette entry, `MAX_CITY_LOOKS` rows (rows past the last
 * look repeat row 0; their weight is 0). RangeError without look palettes,
 * with more than `MAX_CITY_LOOKS`, or with rows of different lengths.
 */
export function groundPaletteTexture(tint: GroundTint): THREE.DataTexture {
  const palettes = checkedLookPalettes(tint);
  const first = palettes[0] ?? [];
  const width = first.length;
  const rgba = new Uint8Array(width * MAX_CITY_LOOKS * 4);
  for (let k = 0; k < MAX_CITY_LOOKS; k++) {
    const row = palettes[k] ?? first;
    for (let i = 0; i < width; i++) {
      const rgb = row[i] ?? 0;
      const at = (k * width + i) * 4;
      rgba[at] = (rgb >> 16) & 0xff;
      rgba[at + 1] = (rgb >> 8) & 0xff;
      rgba[at + 2] = rgb & 0xff;
      rgba[at + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(rgba, width, MAX_CITY_LOOKS);
  texture.colorSpace = THREE.SRGBColorSpace;
  nearestData(texture);
  return texture;
}

/** `tint.lookPalettes` when 1..MAX_CITY_LOOKS rows of one length. */
function checkedLookPalettes(tint: GroundTint): readonly (readonly number[])[] {
  const palettes = tint.lookPalettes;
  if (palettes === undefined || palettes.length === 0) {
    throw new RangeError("the ground tint has no look palettes");
  }
  if (palettes.length > MAX_CITY_LOOKS) {
    throw new RangeError(
      `the ground tint has ${palettes.length} look palettes, at most ${MAX_CITY_LOOKS}`,
    );
  }
  const width = palettes[0]?.length ?? 0;
  if (width === 0 || palettes.some((row) => row.length !== width)) {
    throw new RangeError(
      "the look palettes of the ground tint differ in length",
    );
  }
  return palettes;
}

/**
 * The textures `applyGroundTint` draws from: the RGBA tint without looks,
 * the class and palette textures with them.
 */
function tintTextures(
  tint: GroundTint,
  looks: number,
  anisotropy: number | undefined,
): {
  readonly tint?: THREE.DataTexture;
  readonly classes?: THREE.DataTexture;
  readonly palette?: THREE.DataTexture;
} {
  return looks === 0
    ? { tint: groundTintTexture(tint, anisotropy) }
    : {
        classes: groundClassTexture(tint),
        palette: groundPaletteTexture(tint),
      };
}

function nearestData(texture: THREE.DataTexture): void {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

/**
 * The looks mode's paint: the texel's class (nearest; an index past the
 * palette reads as the neutral 0), its colour in each look's palette row
 * (decoded from sRGB by the texture format), mixed by the weights in linear
 * light.
 */
const LOOKS_PAINT = [
  "ivec2 groundCells = textureSize(groundClasses, 0);",
  "ivec2 groundTexel = clamp(ivec2(floor(groundUv * vec2(groundCells))), ivec2(0), groundCells - 1);",
  "int groundClass = int(texelFetch(groundClasses, groundTexel, 0).r * 255.0 + 0.5);",
  "if (groundClass >= textureSize(groundPalette, 0).x) groundClass = 0;",
  "vec3 groundPaint = groundWeights.x * texelFetch(groundPalette, ivec2(groundClass, 0), 0).rgb",
  "  + groundWeights.y * texelFetch(groundPalette, ivec2(groundClass, 1), 0).rgb",
  "  + groundWeights.z * texelFetch(groundPalette, ivec2(groundClass, 2), 0).rgb",
  "  + groundWeights.w * texelFetch(groundPalette, ivec2(groundClass, 3), 0).rgb;",
];

/**
 * `weights` when it holds one finite weight >= 0 per look; RangeError
 * otherwise, and for a tint without looks (`looks` 0).
 */
function checkedLookWeights(weights: unknown, looks: number): number[] {
  if (looks === 0) {
    throw new RangeError("the ground tint was built without looks");
  }
  if (!Array.isArray(weights) || weights.length !== looks) {
    throw new RangeError(`setLookWeights needs ${looks} weights`);
  }
  return weights.map((w: unknown) => {
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
      throw new RangeError(
        `look weights must be finite and >= 0, got ${String(w)}`,
      );
    }
    return w;
  });
}

/** The tint uniforms of one material (see `tintUniformsOf`). */
interface TintUniforms {
  readonly groundTint: { value: THREE.Texture | null };
  readonly groundClasses: { value: THREE.Texture | null };
  readonly groundPalette: { value: THREE.Texture | null };
  readonly groundWeights: { value: THREE.Vector4 };
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
      groundClasses: { value: null },
      groundPalette: { value: null },
      groundWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
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
 *
 * A tint built with looks (`lookPalettes`) is drawn from the class and
 * palette textures instead, mixed per fragment by `setLookWeights` (look 0
 * alone until then), so the land use cross-fades without a new texture.
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
  const looks = tint.lookPalettes === undefined ? 0 : tint.lookPalettes.length;
  const textures = tintTextures(tint, looks, options.anisotropy);
  const neutral = new THREE.Color(tint.palette[0] ?? 0);
  const previousColour = material.color.clone();
  const uniforms = uniformsFor(material);
  const handle = {};
  uniforms.owner = handle;
  uniforms.groundTint.value = textures.tint ?? null;
  uniforms.groundClasses.value = textures.classes ?? null;
  uniforms.groundPalette.value = textures.palette ?? null;
  uniforms.groundWeights.value.set(1, 0, 0, 0);
  uniforms.groundOrigin.value.set(tint.originX, tint.originY);
  uniforms.groundSize.value.set(
    tint.width * tint.texelM,
    tint.height * tint.texelM,
  );
  uniforms.groundNeutral.value.set(neutral.r, neutral.g, neutral.b);
  uniforms.groundFade.value = Math.max(0.01, fadeM);
  const live = (): boolean => uniforms.owner === handle;
  // THE ORIGINALS ARE KEPT, called with the material as `this`, so dispose
  // restores exactly them: a bound copy would leave one more wrapper behind
  // on every rebuild.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- kept unbound on purpose and always called with `.call(material, ...)`.
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      groundTint: uniforms.groundTint,
      groundClasses: uniforms.groundClasses,
      groundPalette: uniforms.groundPalette,
      groundWeights: uniforms.groundWeights,
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
          ...(looks === 0
            ? ["uniform sampler2D groundTint;"]
            : [
                "uniform sampler2D groundClasses;",
                "uniform sampler2D groundPalette;",
                "uniform vec4 groundWeights;",
              ]),
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
          ...(looks === 0
            ? ["vec3 groundPaint = texture2D(groundTint, groundUv).rgb;"]
            : LOOKS_PAINT),
          "vec2 groundEdge = min(groundEnu - groundOrigin, groundOrigin + groundSize - groundEnu);",
          "float groundInside = smoothstep(0.0, groundFade, min(groundEdge.x, groundEdge.y)) * groundOn;",
          "diffuseColor.rgb *= mix(groundNeutral, groundPaint, groundInside);",
        ].join("\n"),
      );
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method -- as `previous` above.
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `${previousKey.call(material)}|${looks === 0 ? "ground-tint" : "ground-tint-looks"}`;
  // Off (groundOn 0) the patch multiplies by the neutral everywhere, which
  // is exactly the plain ground, so the material stays white in both states.
  const setEnabled = (on: boolean): void => {
    if (live()) uniforms.groundOn.value = on ? 1 : 0;
  };
  setEnabled(options.enabled !== false);
  const setLookWeights = (weights: readonly number[]): void => {
    const [x = 0, y = 0, z = 0, w = 0] = checkedLookWeights(weights, looks);
    if (live()) uniforms.groundWeights.value.set(x, y, z, w);
  };
  const setNeutral = (rgb: number): void => {
    if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff) {
      throw new RangeError(`the neutral must be an sRGB 0xRRGGBB, got ${rgb}`);
    }
    if (live()) {
      const c = new THREE.Color(rgb);
      uniforms.groundNeutral.value.set(c.r, c.g, c.b);
    }
  };
  material.color.set(0xffffff);
  material.needsUpdate = true;
  return {
    setEnabled,
    setLookWeights,
    setNeutral,
    dispose() {
      textures.tint?.dispose();
      textures.classes?.dispose();
      textures.palette?.dispose();
      if (!live()) return;
      uniforms.owner = undefined;
      uniforms.groundTint.value = null;
      uniforms.groundClasses.value = null;
      uniforms.groundPalette.value = null;
      material.onBeforeCompile = previous;
      material.customProgramCacheKey = previousKey;
      material.color.copy(previousColour);
      material.needsUpdate = true;
    },
  };
}
