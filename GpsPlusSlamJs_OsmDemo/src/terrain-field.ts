/**
 * The terrain cache: one growing lattice of height posts, sampled once each.
 *
 * WHY THIS EXISTS (DEC-R2-21, replacing the fixed square of DEC-15/W8). The
 * previous design sampled a square centred on the user and re-sampled **all of
 * it** on every position change — at the rendered extent that is ~55 000 posts
 * discarded and recomputed per step. Tolerable for clicking around a map, wrong
 * for the actual use case, which is walking. Here a post is fetched once and
 * reused for as long as it stays near the user, so movement costs only the new
 * edge.
 *
 * WHY A LATTICE RATHER THAN TILES. DEC-R2-21 asked for "tiled, cached,
 * ring-loaded" and named tile seams as the risk that design introduced. A single
 * global lattice with a sparse post map has the same three properties and **makes
 * the seam unrepresentable**: there is one grid, so there is no boundary between
 * two grids for a discontinuity to live on. Fewer moving parts, and one whole
 * failure mode removed rather than tested for.
 *
 * WHY THE LATTICE IS WEB MERCATOR PIXELS AT THE TERRARIUM ZOOM. Two reasons, and
 * both matter:
 *
 *  - **It is the DEM's own sampling grid.** Every post lands on a source pixel
 *    centre, so nothing is resampled and no detail is invented. Sampling finer
 *    than the source buys interpolated pixels and nothing else.
 *  - **It is global and does not move.** An ENU grid is anchored at the user, so
 *    it shifts with every step and no post is ever reusable — which is precisely
 *    the flaw being fixed. Pixel indices are absolute.
 *
 * WHAT STILL CROSSES THE WORKER BOUNDARY. Not the lattice — it grows without a
 * fixed size. `sampleGrid` renders a bounded, fixed-shape `HeightfieldData` over
 * the current view, exactly the type the boundary already carried, so the protocol
 * is unchanged and the incremental win is entirely worker-side.
 *
 * @see terrain-field.ts.md
 */

import {
  DEFAULT_TERRARIUM_ZOOM,
  fromWorldPixel,
  toWorldPixel,
  type ElevationProvider,
  type EnuFrame,
  type LatLng,
} from "gps-plus-slam-osm";

import { NEAR_FIELD_M, type HeightfieldData } from "./heightfield.js";

/**
 * Posts kept before the furthest are evicted.
 *
 * 250 000 is ~1 MB of `Float64` values and covers roughly a 6 × 6 km area at the
 * z13 pixel pitch — comfortably more than one session's walking, while still
 * bounded. The OSM chunk LRU makes the same trade for the same reason: walking
 * back should be free.
 */
const DEFAULT_MAX_POSTS = 250_000;

export interface TerrainFieldOptions {
  readonly provider: ElevationProvider;
  /** Mercator zoom whose pixel grid the lattice uses. Defaults to Terrarium's. */
  readonly zoom?: number;
  readonly maxPosts?: number;
}

/** Internal: the shape `sampleGrid` takes. Not part of the module surface. */
interface SampleGridOptions {
  readonly frame: EnuFrame;
  /** Half-width of the sampled square, metres. */
  readonly extentM: number;
  /** Distance between output posts, metres. */
  readonly spacingM: number;
}

export interface TerrainField {
  /**
   * Fetches whatever posts are missing within `radiusM` of `centre`.
   *
   * Never rejects: a DEM outage costs the relief, not the view. One batch per
   * call, so a provider can coalesce by source tile.
   */
  ensureAround(centre: LatLng, radiusM: number): Promise<void>;
  /** Renders a bounded grid over the current view, for crossing the boundary. */
  sampleGrid(options: SampleGridOptions): HeightfieldData;
  /** Posts currently held. Exposed so the eviction bound is testable. */
  readonly postCount: number;
}

/** Peak-to-trough of a non-empty list, without spreading it into Math.max. */
function spread(values: readonly number[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

/** Metres per Mercator pixel at a latitude — how wide one lattice step is. */
function metresPerPixel(lat: number, zoom: number, tileSize = 256): number {
  const equator = 40_075_016.686;
  return (equator * Math.cos((lat * Math.PI) / 180)) / (2 ** zoom * tileSize);
}

export function createTerrainField(options: TerrainFieldOptions): TerrainField {
  const { provider } = options;
  const zoom = options.zoom ?? DEFAULT_TERRARIUM_ZOOM;
  const maxPosts = options.maxPosts ?? DEFAULT_MAX_POSTS;

  /**
   * Post height by integer pixel index, `"x/y"`.
   *
   * A `Map` keyed by a string rather than a nested array because the covered area
   * is an arbitrary union of walks, not a rectangle — a dense array would have to
   * be reallocated and recentred on every step, which is the cost being removed.
   */
  const posts = new Map<string, number>();
  /** Whether ANY post has ever arrived. Distinguishes "flat" from "no DEM". */
  let anyData = false;

  const key = (x: number, y: number): string => `${x}/${y}`;

  /** The integer pixel a position falls nearest to. */
  const pixelOf = (position: LatLng): { x: number; y: number } => {
    const raw = toWorldPixel(position, zoom);
    return { x: Math.round(raw.x), y: Math.round(raw.y) };
  };

  async function ensureAround(centre: LatLng, radiusM: number): Promise<void> {
    const perPixel = metresPerPixel(centre.lat, zoom);
    // `+1` so the requested radius is fully covered rather than truncated.
    const reach = Math.ceil(radiusM / perPixel) + 1;
    const origin = pixelOf(centre);

    const missing: { x: number; y: number }[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = origin.x + dx;
        const y = origin.y + dy;
        // Already held — the whole point. Standing still costs nothing.
        if (posts.has(key(x, y))) continue;
        missing.push({ x, y });
      }
    }
    if (missing.length === 0) {
      evictBeyond(origin);
      return;
    }

    let heights: readonly (number | undefined)[];
    try {
      heights = await provider.elevationAt(
        missing.map((pixel) => fromWorldPixel(pixel, zoom)),
      );
    } catch {
      // Degrade to whatever is already held. A DEM outage must cost the relief,
      // never the 3D view — a thrown error here would take the pane down with it.
      return;
    }

    const known: number[] = [];
    for (const height of heights) {
      if (height !== undefined && Number.isFinite(height)) known.push(height);
    }
    if (known.length === 0) return;
    anyData = true;
    // Missing posts take the mean of what arrived — NOT zero. See the module
    // header of `heightfield.ts`: zero is sea level, and a sea-level hole reads
    // as terrain rather than as absent data.
    const mean = known.reduce((sum, v) => sum + v, 0) / known.length;

    missing.forEach((pixel, index) => {
      const height = heights[index];
      posts.set(
        key(pixel.x, pixel.y),
        height === undefined || !Number.isFinite(height) ? mean : height,
      );
    });

    evictBeyond(origin);
  }

  /**
   * Drops the posts furthest from the current centre, once over the cap.
   *
   * By distance rather than by insertion order: a user who walks out and back
   * should not lose the posts they are standing on just because they are old,
   * which is the same reasoning the OSM chunk LRU records.
   */
  function evictBeyond(origin: { x: number; y: number }): void {
    if (posts.size <= maxPosts) return;
    const ranked = [...posts.keys()]
      .map((k) => {
        const [x = 0, y = 0] = k.split("/").map(Number);
        const dx = x - origin.x;
        const dy = y - origin.y;
        return { k, distance: dx * dx + dy * dy };
      })
      .sort((a, b) => b.distance - a.distance);
    for (const entry of ranked) {
      if (posts.size <= maxPosts) break;
      posts.delete(entry.k);
    }
  }

  /** Bilinear read of the lattice, in lat/lng. Falls back to the nearest post. */
  function heightAtPosition(position: LatLng): number | undefined {
    const raw = toWorldPixel(position, zoom);
    const x0 = Math.floor(raw.x);
    const y0 = Math.floor(raw.y);
    const fx = raw.x - x0;
    const fy = raw.y - y0;

    const at = (x: number, y: number): number | undefined =>
      posts.get(key(x, y));
    const corners = [
      at(x0, y0),
      at(x0 + 1, y0),
      at(x0, y0 + 1),
      at(x0 + 1, y0 + 1),
    ];
    if (corners.some((corner) => corner === undefined)) {
      // Outside the covered area. The NEAREST held post is the honest answer —
      // "this is the last thing we know" — and returning `undefined` here would
      // drop a vertex, which silently deletes a triangle rather than reporting.
      return at(Math.round(raw.x), Math.round(raw.y));
    }
    const [tl = 0, tr = 0, bl = 0, br = 0] = corners;
    const top = tl + (tr - tl) * fx;
    const bottom = bl + (br - bl) * fx;
    return top + (bottom - top) * fy;
  }

  function sampleGrid(gridOptions: SampleGridOptions): HeightfieldData {
    const { frame, extentM, spacingM } = gridOptions;
    // `+1` because the posts include both edges: a 600 m span at 50 m spacing is
    // 13 posts, not 12. Off by one here tilts the whole surface.
    const side = Math.max(2, Math.round((extentM * 2) / spacingM) + 1);
    const total = side * side;
    const heights = new Float32Array(total);

    const values: number[] = [];
    /** The same, restricted to the near field — see `nearReliefM`. */
    const near: number[] = [];
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const enu = {
          x: -extentM + (col / (side - 1)) * extentM * 2,
          y: -extentM + (row / (side - 1)) * extentM * 2,
        };
        const height = heightAtPosition(frame.toLatLng(enu));
        if (height !== undefined) {
          values.push(height);
          if (
            Math.abs(enu.x) <= NEAR_FIELD_M &&
            Math.abs(enu.y) <= NEAR_FIELD_M
          ) {
            near.push(height);
          }
        }
        heights[row * side + col] = height ?? 0;
      }
    }

    if (!anyData || values.length === 0) {
      return {
        heights: new Float32Array(0),
        side: 0,
        extentM,
        datum: 0,
        hasData: false,
        missing: total,
        total,
        reliefM: 0,
        nearReliefM: 0,
      };
    }

    // Gaps inside the grid take the mean of what was found, for the same reason
    // the fetch path does: not zero.
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    for (let i = 0; i < total; i++) {
      if (!Number.isFinite(heights[i] ?? NaN)) heights[i] = mean;
    }
    return {
      heights,
      side,
      extentM,
      // The origin's height, subtracted on every read so the surface is relief
      // rather than altitude — the datum then cancels exactly.
      datum: heightAtPosition(frame.toLatLng({ x: 0, y: 0 })) ?? mean,
      hasData: true,
      missing: total - values.length,
      total,
      // A fold, never a spread into `Math.max` — a spread passes one argument per
      // element and throws above ~100 000, which this grid comfortably exceeds at
      // the 2.8 km extent.
      reliefM: spread(values),
      // DEC-R2-22: the near field reported separately, because over 2.8 km the
      // whole-field number can be tens of metres while the ground under the user
      // is flat. Empty only if the extent is smaller than the near field.
      nearReliefM: near.length === 0 ? spread(values) : spread(near),
    };
  }

  return {
    ensureAround,
    sampleGrid,
    get postCount() {
      return posts.size;
    },
  };
}
