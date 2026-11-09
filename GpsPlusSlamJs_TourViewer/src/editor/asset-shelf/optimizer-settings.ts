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

export interface OptimizerSettings {
  readonly picture: PictureSettings;
  /** A narration or a voice memo. */
  readonly speech: SoundSettings;
  /** Music and ambience. */
  readonly music: SoundSettings;
  /** A 3D model's textures: their longest side at most. */
  readonly modelTextureMaxSidePx: number;
  /** A result at most this share of the original's bytes replaces it;
   *  a larger one keeps the original (not worth a re-encoding). */
  readonly keepAbove: number;
}

export const OPTIMIZER_SETTINGS: OptimizerSettings = {
  picture: { maxSidePx: 1600, type: "image/webp", quality: 0.75 },
  speech: { codec: "opus", bitsPerSecond: 24_000, channels: 1 },
  music: { codec: "opus", bitsPerSecond: 64_000, channels: 2 },
  modelTextureMaxSidePx: 1024,
  keepAbove: 0.9,
};

/** Jobs run at once: one keeps a phone responsive (and cool); a desktop
 *  takes two. Provisional until the phone measurement. */
export const OPTIMIZER_SLOTS = { phone: 1, desktop: 2 } as const;
