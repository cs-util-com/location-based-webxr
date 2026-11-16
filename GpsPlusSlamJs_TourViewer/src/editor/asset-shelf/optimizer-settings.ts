/**
 * What "smaller files" means for the asset shelf, in one place, so the
 * values can be retuned after a listening and viewing check without
 * touching an optimizer. Each optimizer reads its own part
 * (`asset-optimizers.ts`); nothing else hard-codes a size or a bitrate.
 *
 * @see optimizer-settings.ts.md
 */

interface PictureSettings {
  /** The longest side after resizing; a smaller picture is never enlarged. */
  readonly maxSidePx: number;
  readonly type: "image/webp";
  /** The encoder's quality, 0..1. */
  readonly quality: number;
}

interface SoundSettings {
  readonly codec: "opus";
  readonly bitsPerSecond: number;
  readonly channels: 1 | 2;
}

/** A 3D model's: its textures made smaller, its triangles thinned to a
 *  level of detail, its geometry stored in fewer bytes (`model-step.ts`). */
export interface ModelSettings {
  /** A texture's longest side after resizing; never enlarged. */
  readonly textureMaxSidePx: number;
  /** JPEG quality of a colour texture (base colour, emission). */
  readonly colourQuality: number;
  /** JPEG quality of a data texture (normal, roughness and metalness,
   *  occlusion), which shows losses sooner. */
  readonly dataQuality: number;
  /** The lossy format a texture is written in: JPEG (the default, read by
   *  every glTF viewer) or WebP (through the EXT_texture_webp extension; at
   *  the same quality numbers 14 to 28 % fewer texture bytes on the check
   *  page's samples at 1024 px, and about 40 % fewer at the same PSNR). Alpha and lossless maps stay PNG either way. */
  readonly textureType?: "image/jpeg" | "image/webp";
  /** Bits of a quantized position, normal (and tangent), texture
   *  coordinate (`model-quantize.ts`). */
  readonly positionBits: 8 | 16;
  readonly normalBits: 8 | 16;
  readonly texcoordBits: 8 | 16;
  /** The largest position error allowed, as a share of a mesh's box
   *  diagonal; more keeps its positions as they were. */
  readonly maxPositionError: number;
  /** The default level of detail's largest deviation, as a share of a
   *  primitive's box diagonal (`model-lod.ts`): the fewest triangles
   *  within it are kept. */
  readonly lodBudget: number;
  /** A primitive with fewer triangles keeps them all. */
  readonly lodMinTriangles: number;
  /** The author's share of triangles kept, from the shelf's slider,
   *  overriding the budget; left out by default. */
  readonly detailShare?: number;
}

export interface OptimizerSettings {
  readonly picture: PictureSettings;
  /** A narration or a voice memo. */
  readonly speech: SoundSettings;
  /** Music and ambience. */
  readonly music: SoundSettings;
  readonly model: ModelSettings;
  /** A result at most this share of the original's bytes replaces it;
   *  a larger one keeps the original (not worth a re-encoding). */
  readonly keepAbove: number;
}

/** A photo's setting, judged by eye on one sample street photo (the check
 *  page, `asset-optimizer-check.html`): at 1600 px and quality 0.6 (about
 *  18 % of the original) small text stayed readable zoomed in, at the
 *  next smaller step (about 16 %) it did not. One photo was judged; see
 *  the sidecar. */
export const PHOTO_PICTURE: PictureSettings = {
  maxSidePx: 1600,
  type: "image/webp",
  quality: 0.6,
};

export const OPTIMIZER_SETTINGS: OptimizerSettings = {
  picture: PHOTO_PICTURE,
  speech: { codec: "opus", bitsPerSecond: 24_000, channels: 1 },
  music: { codec: "opus", bitsPerSecond: 64_000, channels: 2 },
  model: {
    textureMaxSidePx: 1024,
    colourQuality: 0.85,
    dataQuality: 0.92,
    positionBits: 16,
    normalBits: 8,
    texcoordBits: 16,
    maxPositionError: 0.0001,
    lodBudget: 0.0025,
    lodMinTriangles: 2000,
  },
  keepAbove: 0.9,
};

/** Jobs run at once: one keeps a phone responsive (and cool); a desktop
 *  takes two. Provisional until the phone measurement. */
export const OPTIMIZER_SLOTS = { phone: 1, desktop: 2 } as const;
