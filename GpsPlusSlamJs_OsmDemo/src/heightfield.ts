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

export interface Heightfield {
  /** Relief in metres at an ENU point, relative to the frame origin. */
  heightAt(point: { x: number; y: number }): number;
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

/** What a failed or empty load produces: flat, and honest about it. */
function flat(total: number): Heightfield {
  return {
    heightAt: () => 0,
    hasData: false,
    missing: total,
    total,
    reliefM: 0,
  };
}

/**
 * Loads a heightfield over a square centred on the frame's origin.
 *
 * Never rejects. A DEM outage should cost the relief, not the 3D view — the
 * buildings and the affordance grid are still worth looking at, and a thrown
 * error here would take the whole pane down with it.
 */
export async function buildHeightfield(
  provider: ElevationProvider,
  options: HeightfieldOptions,
): Promise<Heightfield> {
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
    return flat(total);
  }

  const known = raw.filter(
    (v): v is number => v !== undefined && Number.isFinite(v),
  );
  if (known.length === 0) return flat(total);

  // Missing posts take the mean of what did arrive. Not zero — see the module
  // header — and not a neighbour scan either: at this grid size the mean keeps
  // the surface continuous without inventing a slope the data never showed.
  const mean = known.reduce((sum, v) => sum + v, 0) / known.length;
  const heights = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const value = raw[i];
    heights[i] = value === undefined || !Number.isFinite(value) ? mean : value;
  }

  // The origin's height, subtracted from every read so the surface is relief
  // rather than altitude. Sampled through the same bilinear path as everything
  // else, so it is exactly what `heightAt({x: 0, y: 0})` would otherwise return.
  const sample = (x: number, y: number): number =>
    bilinear(heights, side, extentM, x, y);
  const datum = sample(0, 0);

  return {
    heightAt: (point) => sample(point.x, point.y) - datum,
    hasData: true,
    missing: total - known.length,
    total,
    reliefM: Math.max(...known) - Math.min(...known),
  };
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
