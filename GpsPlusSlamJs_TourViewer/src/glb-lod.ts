/**
 * The renderer's side of a model's saved levels of detail: what the asset
 * shelf wrote into `primitive.extras.lod` (`editor/asset-shelf/model-lod.ts`),
 * read back defensively, and the level a frame draws, chosen by the error
 * it would show on screen. Pure numbers, no three.js import: `glb-model.ts`
 * wires it into the loaded scene.
 *
 * @see glb-lod.ts.md
 */

/** One saved level: its draw range in the chain's index list and its
 *  largest deviation, as a share of the primitive's box diagonal. */
export interface LodLevel {
  readonly start: number;
  readonly count: number;
  readonly error: number;
}

/** A primitive's saved levels, finest first. */
export interface SavedLod {
  /** The glTF accessor that holds every level's indices, end to end. */
  readonly indices: number;
  readonly levels: readonly LodLevel[];
}

/** The screen error a coarser level may show, in pixels of the drawing
 *  buffer (swept over 0.5 to 4: `glb-lod.ts.md`). */
export const LOD_PIXEL_BUDGET = 1;

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/** The levels in a geometry's `userData.lod`, or null when there are none
 *  or they are not well formed (the file then draws as it is). */
export function lodOf(value: unknown): SavedLod | null {
  if (typeof value !== "object" || value === null) return null;
  const { indices, levels } = value as Record<string, unknown>;
  if (!isCount(indices) || !Array.isArray(levels) || levels.length === 0) {
    return null;
  }
  const out: LodLevel[] = [];
  for (const level of levels as unknown[]) {
    if (typeof level !== "object" || level === null) return null;
    const { start, count, error } = level as Record<string, unknown>;
    if (!isCount(start) || !isCount(count) || count === 0 || count % 3 !== 0)
      return null;
    if (typeof error !== "number" || !Number.isFinite(error) || error < 0)
      return null;
    out.push({ start, count, error });
  }
  return { indices, levels: out };
}

/** Whether every level lies inside an index list of `indexCount`. */
export function levelsFit(
  levels: readonly LodLevel[],
  indexCount: number,
): boolean {
  return levels.every((l) => l.start + l.count <= indexCount);
}

/**
 * Pixels one model unit covers at `depth` in front of the camera, from
 * the camera's projection matrix (column-major, as three.js keeps it) and
 * the drawing buffer's height. An orthographic projection ignores depth.
 * Infinity when `depth` is not in front of the camera, so the finest level
 * is drawn.
 */
export function pixelsPerUnit(
  projection: ArrayLike<number>,
  viewportHeight: number,
  depth: number,
): number {
  const scale = Math.abs(projection[5] ?? 0) * (viewportHeight / 2);
  const perspective = projection[11] === -1;
  if (!perspective) return Number.isFinite(scale) ? scale : Infinity;
  return depth > 0 ? scale / depth : Infinity;
}

/**
 * The coarsest level whose deviation, at `pixelsPerDiagonal` pixels for
 * the primitive's box diagonal, stays within `pixelBudget`; the finest
 * (0) when none does or the input is not a finite positive number.
 */
export function pickLevel(
  levels: readonly LodLevel[],
  pixelsPerDiagonal: number,
  pixelBudget: number = LOD_PIXEL_BUDGET,
): number {
  if (!(pixelsPerDiagonal > 0) || !Number.isFinite(pixelsPerDiagonal)) {
    return 0;
  }
  let chosen = 0;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]!.error * pixelsPerDiagonal <= pixelBudget) chosen = i;
  }
  return chosen;
}
