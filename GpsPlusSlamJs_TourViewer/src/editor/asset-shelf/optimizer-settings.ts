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

/** A 3D model's: its textures made smaller, its geometry stored in fewer
 *  bytes (`model-step.ts`). */
export interface ModelSettings {
  /** A texture's longest side after resizing; never enlarged. */
  readonly textureMaxSidePx: number;
  /** JPEG quality of a colour texture (base colour, emission). */
  readonly colourQuality: number;
  /** JPEG quality of a data texture (normal, roughness and metalness,
   *  occlusion), which shows losses sooner. */
  readonly dataQuality: number;
  /** Bits of a quantized position, normal (and tangent), texture
   *  coordinate (`model-quantize.ts`). */
  readonly positionBits: 8 | 16;
  readonly normalBits: 8 | 16;
  readonly texcoordBits: 8 | 16;
  /** The largest position error allowed, as a share of a mesh's box
   *  diagonal; more keeps its positions as they were. */
  readonly maxPositionError: number;
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

export const OPTIMIZER_SETTINGS: OptimizerSettings = {
  picture: { maxSidePx: 1600, type: "image/webp", quality: 0.75 },
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
  },
  keepAbove: 0.9,
};

/** Jobs run at once: one keeps a phone responsive (and cool); a desktop
 *  takes two. Provisional until the phone measurement. */
export const OPTIMIZER_SLOTS = { phone: 1, desktop: 2 } as const;
