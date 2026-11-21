/**
 * The globe's quality tiers: one table of what each name sets in the sea,
 * and the pixel ratio it caps the canvas at. Read once
 * when a view is made: the sea's wave count is compiled into its shader.
 * A page's link picks a name (`?quality=<name>`); `resolveGlobeQuality`
 * judges it and supplies the default.
 *
 * @see globe-quality.ts.md
 */

/** The sea's explicit waves: everything shorter is left to the statistics. */
interface GlobeSeaQuality {
  /** How many wave octaves the shader sums, each twice the last. */
  readonly waveOctaves: number;
  /** The shortest explicit wave (m). */
  readonly shortestWaveM: number;
}

export interface GlobeQuality {
  /** The canvas's pixel ratio is the device's, at most this. */
  readonly pixelRatioCap: number;
  readonly sea: GlobeSeaQuality;
}

export const GLOBE_QUALITIES = Object.freeze({
  low: Object.freeze({
    pixelRatioCap: 1,
    sea: Object.freeze({ waveOctaves: 6, shortestWaveM: 32 }),
  }),
  medium: Object.freeze({
    pixelRatioCap: 1.5,
    sea: Object.freeze({ waveOctaves: 7, shortestWaveM: 16 }),
  }),
  high: Object.freeze({
    pixelRatioCap: 2,
    sea: Object.freeze({ waveOctaves: 8, shortestWaveM: 8 }),
  }),
} satisfies Record<string, GlobeQuality>);

export type GlobeQualityName = keyof typeof GLOBE_QUALITIES;

/** The tiers, cheapest first. */
export const GLOBE_QUALITY_NAMES: readonly GlobeQualityName[] = Object.freeze([
  "low",
  "medium",
  "high",
]);

/** The link's parameter: `?quality=<name>`. */
export const GLOBE_QUALITY_PARAM = "quality";

const isQualityName = (name: string): name is GlobeQualityName =>
  Object.hasOwn(GLOBE_QUALITIES, name);

/**
 * The tier to use: a name in the link wins; with none, high on a device
 * with a fine pointer and medium on a coarse one (low is never a default);
 * a name not in the table is that default, with one warning.
 */
export function resolveGlobeQuality(
  name: string | null,
  coarsePointer: boolean,
  // eslint-disable-next-line no-console -- the one report of a mistyped link
  warn: (message: string) => void = console.warn,
): GlobeQualityName {
  const fallback: GlobeQualityName = coarsePointer ? "medium" : "high";
  if (name === null) return fallback;
  if (isQualityName(name)) return name;
  warn(
    `unknown globe quality "${name}", using "${fallback}" (known: ${GLOBE_QUALITY_NAMES.join(", ")})`,
  );
  return fallback;
}

/**
 * The canvas's pixel ratio on a tier: the device's, capped. A missing or
 * broken device ratio reads as 1. RangeError for a name not in the table.
 */
export function globeQualityPixelRatio(
  name: GlobeQualityName,
  devicePixelRatio: number,
): number {
  if (!isQualityName(name)) {
    throw new RangeError(`unknown globe quality: ${String(name)}`);
  }
  const device = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(device, GLOBE_QUALITIES[name].pixelRatioCap);
}
