/**
 * Terrain relief, sampled once and read synchronously thereafter.
 *
 * WHY IT IS PRE-FETCHED RATHER THAN SAMPLED LAZILY. `buildBuildings` and
 * `buildTrees` take a plain `groundHeightM(position) => number` — synchronous,
 * because they are called per volume inside a mesh build. So the network work
 * has to be finished before the build starts. That is the whole reason this is a
 * grid loaded up front rather than a provider passed straight through.
 *
 * WHY IT IS RELATIVE. The provider returns ORTHOMETRIC height — about 53 m at
 * Cologne — while the ENU frame puts the user at `y = 0`. Feeding absolute
 * metres in would lift the whole city off a camera that looks at `y = 10`. Only
 * relief matters for a standalone 3D view, so the origin's height is subtracted
 * and the datum cancels exactly. **A later AR mode will need the opposite** —
 * absolute height against an ellipsoidal GNSS altitude, which is what the
 * geoid model in `gps-plus-slam-osm` is for. Do not reuse this there.
 *
 * WHY `undefined` IS NEVER `0`. `elevationAt` returns `undefined` for "no data",
 * and the tempting `?? 0` turns a DEM outage into a sea-level hole shaped
 * exactly like the outage — which reads as terrain rather than as a failure,
 * and buries the buildings standing in it. Missing posts are filled from the
 * data that did arrive, and the count is reported so the UI can say so.
 *
 * @see heightfield.ts.md
 */

import type { ElevationProvider, EnuFrame, LatLng } from "gps-plus-slam-osm";

export interface HeightfieldOptions {
  readonly frame: EnuFrame;
  /** Half-width in metres: the field covers `[-extentM, +extentM]` on both axes. */
  readonly extentM: number;
  /** Distance between posts, metres. Match the DEM's own resolution. */
  readonly spacingM: number;
  readonly signal?: AbortSignal;
}

/**
 * A heightfield as PLAIN DATA — the form that survives a worker boundary.
 *
 * Split out from {@link Heightfield} because the sampling now happens in the
 * worker (the field is ~55 000 posts since the extent grew to the rendered
 * extent) while the ground plane and the affordance grid read it on the main
 * thread. `heightAt` is a **method**, and the structured-clone algorithm drops
 * methods *silently* — leaving an object that looks correct until the first call.
 * So the grid crosses as numbers and {@link heightfieldFrom} rebuilds the
 * sampler on the far side.
 *
 * `heights` is a `Float32Array` so it can be **transferred** rather than copied.
 */
export interface HeightfieldData {
  /** Row-major posts, `side * side` of them. Empty when `hasData` is false. */
  readonly heights: Float32Array;
  /** Posts per axis. */
  readonly side: number;
  /** Half-width of the sampled square, metres. */
  readonly extentM: number;
  /**
   * The origin's height, subtracted from every read.
   *
   * Kept rather than pre-subtracted from `heights` so the datum stays visible
   * and the arithmetic is identical on both sides of the boundary.
   */
  readonly datum: number;
  /** False when nothing usable arrived — `heightAt` is then flat zero. */
  readonly hasData: boolean;
  /** Posts the provider had no answer for. */
  readonly missing: number;
  /** Posts requested. */
  readonly total: number;
  /**
   * Peak-to-trough relief across the field, metres.
   *
   * Reported rather than derived by the caller because it is the one number
   * that tells a viewer whether the terrain is doing anything: 0.3 m of relief
   * over 600 m is a plain, and a plain rendered as a plain is indistinguishable
   * from terrain that failed to load. The status line says it out loud.
   */
  readonly reliefM: number;
}

export interface Heightfield extends HeightfieldData {
  /** Relief in metres at an ENU point, relative to the frame origin. */
  heightAt(point: { x: number; y: number }): number;
}

/** What a failed or empty load produces: flat, and honest about it. */
function flat(total: number, extentM: number): HeightfieldData {
  return {
    heights: new Float32Array(0),
    side: 0,
    extentM,
    datum: 0,
    hasData: false,
    missing: total,
    total,
    reliefM: 0,
  };
}

/**
 * Rebuilds the synchronous sampler from plain data.
 *
 * The one place `heightAt` is created, so the main thread and the worker cannot
 * disagree about what a post means. A field with `hasData: false` samples flat
 * zero — never a sea-level surface, for the reason in the module header.
 */
export function heightfieldFrom(data: HeightfieldData): Heightfield {
  if (!data.hasData || data.side === 0) {
    return { ...data, heightAt: () => 0 };
  }
  return {
    ...data,
    heightAt: (point) =>
      bilinear(data.heights, data.side, data.extentM, point.x, point.y) -
      data.datum,
  };
}

/**
 * Loads a heightfield over a square centred on the frame's origin.
 *
 * Never rejects. A DEM outage should cost the relief, not the 3D view — the
 * buildings and the affordance grid are still worth looking at, and a thrown
 * error here would take the whole pane down with it.
 */
export async function buildHeightfieldData(
  provider: ElevationProvider,
  options: HeightfieldOptions,
): Promise<HeightfieldData> {
  const { frame, extentM, spacingM } = options;
  // `+1` because the posts include both edges: a 600 m span at 50 m spacing is
  // 13 posts, not 12. Off by one here tilts the whole surface.
  const side = Math.max(2, Math.round((extentM * 2) / spacingM) + 1);
  const total = side * side;

  const positions: LatLng[] = [];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      positions.push(
        frame.toLatLng({
          x: -extentM + (col / (side - 1)) * extentM * 2,
          y: -extentM + (row / (side - 1)) * extentM * 2,
        }),
      );
    }
  }

  let raw: readonly (number | undefined)[];
  try {
    // ONE call for every post. `elevationAt` is batch-in/batch-out precisely so
    // the provider can coalesce by DEM tile; per-post calls would be thousands
    // of requests for one view.
    raw = await provider.elevationAt(positions, options.signal);
  } catch {
    return flat(total, extentM);
  }

  const known = raw.filter(
    (v): v is number => v !== undefined && Number.isFinite(v),
  );
  if (known.length === 0) return flat(total, extentM);

  // Missing posts take the mean of what did arrive. Not zero — see the module
  // header — and not a neighbour scan either: at this grid size the mean keeps
  // the surface continuous without inventing a slope the data never showed.
  const mean = known.reduce((sum, v) => sum + v, 0) / known.length;
  const heights = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const value = raw[i];
    heights[i] = value === undefined || !Number.isFinite(value) ? mean : value;
  }

  return {
    heights,
    side,
    extentM,
    // The origin's height, subtracted from every read so the surface is relief
    // rather than altitude. Sampled through the same bilinear path as everything
    // else, so it is exactly what an undatumed `heightAt({x: 0, y: 0})` returns.
    datum: bilinear(heights, side, extentM, 0, 0),
    hasData: true,
    missing: total - known.length,
    total,
    // NOT `Math.max(...known)`. A spread passes one argument per element, and
    // measured in this Node the limit is between 100 000 and 125 000 before
    // `RangeError: Maximum call stack size exceeded`. At the rendered extent
    // (~2.8 km at 12 m) the field is ~55 000 posts, so the spread was **not**
    // yet broken — but it is within about 2x of the limit, and the limit is
    // reached by an ordinary change: the same extent at 8 m spacing is ~123 000.
    // A fold has no limit and is not measurably slower, so this removes a
    // fragility rather than fixing a live bug. See `worker-round-trip.test.ts`.
    reliefM: extremesOf(known),
  };
}

/** Peak-to-trough of a non-empty list, without spreading it into `Math.max`. */
function extremesOf(values: readonly number[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

/**
 * Loads a heightfield and returns it ready to sample.
 *
 * The main-thread convenience form: exactly
 * `heightfieldFrom(await buildHeightfieldData(...))`. The worker uses the data
 * form directly, because that is what crosses the boundary.
 */
export async function buildHeightfield(
  provider: ElevationProvider,
  options: HeightfieldOptions,
): Promise<Heightfield> {
  return heightfieldFrom(await buildHeightfieldData(provider, options));
}

/**
 * Bilinear read, clamped to the grid.
 *
 * Clamping rather than returning `NaN` outside the extent: the ground plane and
 * the affordance grid both sample this, and a `NaN` vertex silently drops a
 * triangle instead of reporting anything. The edge value is the honest answer —
 * "this is the last thing we know" — and the caller sizes the plane to the
 * extent anyway.
 */
function bilinear(
  heights: Float32Array,
  side: number,
  extentM: number,
  x: number,
  y: number,
): number {
  const last = side - 1;
  const toGrid = (v: number): number =>
    Math.min(last, Math.max(0, ((v + extentM) / (extentM * 2)) * last));
  const gx = toGrid(x);
  const gy = toGrid(y);

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(last, x0 + 1);
  const y1 = Math.min(last, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;

  const at = (col: number, row: number): number =>
    heights[row * side + col] ?? 0;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return top + (bottom - top) * fy;
}
