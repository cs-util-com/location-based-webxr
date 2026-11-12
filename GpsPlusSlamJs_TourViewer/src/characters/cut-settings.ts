/**
 * Every number the character-sheet cut reads, in one settings object, so a
 * retune (or an author's "Adjust the cut" slider) never touches the
 * algorithm. `cutSettingsOf` is the boundary check: anything a page or a
 * Worker message hands in is read through it.
 *
 * @see cut-settings.ts.md
 */

export interface CutSettings {
  /** Largest channel distance from the border colour that still counts as
   *  background (flat-background pictures only). */
  readonly whiteTol: number;
  /** Also count light, colourless pixels as background (an image AI's soft
   *  ground shadow under each pose): every channel at least `shadowFloor`
   *  and the channels within `shadowSpread` of each other. */
  readonly shadowOn: boolean;
  readonly shadowFloor: number;
  readonly shadowSpread: number;
  /** A separate figure piece (8-connected) of fewer pixels than this is a
   *  speck and becomes background; 0 keeps every piece. */
  readonly islandMin: number;
  /** How far beyond half the tolerance an edge pixel's distance must be to
   *  be fully opaque (the edge ramp's width, in channel steps). */
  readonly edgeSoft: number;
  /** Alpha below this is background (pictures with real transparency). */
  readonly alphaThr: number;
  /** An empty column run narrower than this share of the width does not
   *  split two figures. */
  readonly minGapFrac: number;
  /** A column group with less than this share of the biggest group's
   *  pixels is a speck, not a pose. */
  readonly specFrac: number;
  /** One cell of the canonical sheet, in pixels. */
  readonly cellW: number;
  readonly cellH: number;
  /** Top share of the figure height taken from a talking frame by the
   *  steady body. */
  readonly headBand: number;
  /** The head band's feather, as a share of the figure height. */
  readonly featherFrac: number;
  /** A pixel differs when a channel differs by more than this. */
  readonly diffThr: number;
  /** A body difference above this share means the body moves while
   *  talking. */
  readonly jitterWarn: number;
  /** A head difference below this share means the mouth hardly moves. */
  readonly mouthMin: number;
  /** The shift search, in half-resolution pixels. */
  readonly maxShift: number;
  /** Pictures with more pixels are refused before they are decoded. */
  readonly maxPixels: number;
}

export const CUT_SETTINGS: CutSettings = {
  whiteTol: 28,
  shadowOn: true,
  shadowFloor: 170,
  shadowSpread: 20,
  islandMin: 64,
  edgeSoft: 96,
  alphaThr: 32,
  minGapFrac: 0.004,
  specFrac: 0.02,
  cellW: 512,
  cellH: 1024,
  headBand: 0.3,
  featherFrac: 0.05,
  diffThr: 48,
  // Real pictures: a flat style 1.9-3.2 %, a painted one 6.9-18 %.
  jitterWarn: 0.05,
  mouthMin: 0.0015,
  maxShift: 3,
  // The tour's own cap for a picture a phone decodes (4096 x 4096). Measured
  // on a desktop: the cut takes about 2 s and 80 MiB beside the picture
  // at 16 MP, 6.6 s and 170 MiB at 40 MP, and a phone is 4-6 times slower;
  // a 12 MP phone photo passes, a 24 MP camera photo does not.
  maxPixels: 4096 * 4096,
};

/** The range each setting is clamped to; a value outside it, or one that is
 *  no finite number, takes the default. */
type NumberKey = {
  [K in keyof CutSettings]: CutSettings[K] extends number ? K : never;
}[keyof CutSettings];

const RANGES: Readonly<Record<NumberKey, readonly [number, number]>> = {
  whiteTol: [0, 255],
  shadowFloor: [0, 255],
  shadowSpread: [0, 255],
  islandMin: [0, 1e6],
  edgeSoft: [1, 255],
  alphaThr: [1, 255],
  minGapFrac: [0, 0.2],
  specFrac: [0, 1],
  cellW: [16, 4096],
  cellH: [16, 4096],
  headBand: [0.05, 0.9],
  featherFrac: [0, 0.5],
  diffThr: [0, 255],
  jitterWarn: [0, 1],
  mouthMin: [0, 1],
  maxShift: [0, 16],
  maxPixels: [1, 1e9],
};

/** `input` read as settings: every key of `CUT_SETTINGS`, taken from
 *  `input` where it has the default's type (a number also finite and inside
 *  its range), else the default. Unknown keys are dropped. Never throws. */
export function cutSettingsOf(input: unknown): CutSettings {
  const given =
    typeof input === "object" && input !== null
      ? (input as Partial<Record<string, unknown>>)
      : {};
  const out: Record<string, number | boolean> = {};
  for (const key of Object.keys(CUT_SETTINGS) as (keyof CutSettings)[]) {
    const value = given[key];
    const fallback = CUT_SETTINGS[key];
    if (typeof fallback === "boolean") {
      out[key] = typeof value === "boolean" ? value : fallback;
      continue;
    }
    const [lo, hi] = RANGES[key as NumberKey];
    out[key] =
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= lo &&
      value <= hi
        ? value
        : fallback;
  }
  return out as unknown as CutSettings;
}
