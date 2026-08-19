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

import {
  NEAR_FIELD_M,
  peakToTrough,
  type EnuPoint,
  type HeightfieldData,
} from "./heightfield.js";
// The sign of the absolute datum, owned and tested in one place. Importing it
// here rather than writing `-x` inline is the whole reason it exists.
import { absoluteDatumFor } from "./ar-origin.js";

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
  /**
   * Where that square sits in the frame. Defaults to the frame origin.
   *
   * The window follows the USER while the frame stands still — see
   * `terrain-window.ts`. Before the scene had a fixed anchor the two were the
   * same point, which is why this could not exist and did not need to.
   */
  readonly centreEnu?: EnuPoint;
  /**
   * Reference heights to the ELLIPSOID instead of to the window centre.
   *
   * **AR mode's datum, and the reason it cannot reuse the default** (plan
   * §2.5). The default subtracts the height under the user so the surface is
   * relief — correct for a desktop view, and impossible for AR, because the
   * window follows the user and the datum would move mid-session, shifting the
   * whole scene's Y baseline every time the terrain recentres.
   *
   * The framework's GPS-world Y is the raw GNSS altitude: every producer calls
   * `calcRelativeCoordsInMeters` with `originAltitude = 0`, so scene `y = 0` is
   * the WGS84 ellipsoid. `heightAt` returns `surfaceHeight − datum`, so the
   * datum that yields an ellipsoidal height from an orthometric DEM is
   * **`−N`** — the geoid undulation, negated. There is no origin term; draft 3
   * of the plan had one and was wrong by ~98 m at Cologne.
   *
   * Takes the undulation rather than a `GeoidModel` so this module needs no
   * dependency on the geoid package: `N` varies about 1 m per 100 km, so one
   * value is uniform to ~5 cm across a 4.8 km city and the caller samples it
   * once at the frame origin.
   */
  readonly absoluteDatum?: { readonly undulationMetres: number };
}

export interface TerrainField {
  /**
   * Fetches whatever posts are missing within `radiusM` of `centre`.
   *
   * Never rejects: a DEM outage costs the relief, not the view. One batch per
   * call, so a provider can coalesce by source tile.
   *
   * **Pass `signal` for a load that can be superseded**, which is every load
   * driven by a position change. Without it the caller is registered as `pinned`
   * by `InFlightRequests` — declaring the request uncancellable and pinning it
   * for every other joiner as well — so a superseded load pulls its whole batch
   * to completion before anything can discard it. See the tests.
   */
  ensureAround(
    centre: LatLng,
    radiusM: number,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Renders a bounded grid over the current view, for crossing the boundary. */
  sampleGrid(options: SampleGridOptions): HeightfieldData;
  /** Posts currently held. Exposed so the eviction bound is testable. */
  readonly postCount: number;
  /**
   * Overwrites held posts with better heights, all of the current window or
   * none of it.
   *
   * THE WRITE-ONCE GUARD IS WHY THIS EXISTS. `ensureAround` skips any post the
   * lattice already holds, so without an explicit replace path a DEM upgrade is
   * not a wrong height — it is no change at all, silently, while the map still
   * shows terrain.
   *
   * Returns whether anything was written. `false` means the batch was refused:
   * either it carried no usable heights, or applying it would have left the
   * current window standing on two sources at once. AWS SRTM and national LiDAR
   * differ by metres, so a half-replaced window is a visible step in otherwise
   * flat ground.
   */
  replacePosts(
    positions: readonly LatLng[],
    heights: readonly (number | undefined)[],
  ): boolean;
  /** The positions of every post currently held, for an upgrade batch. */
  heldPositions(): readonly LatLng[];
  /**
   * Posts currently holding an INVENTED height — the mean of whatever answered
   * in their batch — rather than a measured one.
   *
   * Surfaced because nothing else distinguishes the two, in the data or in any
   * readout, which is how the hazard sat unnoticed. It is carried across the
   * worker boundary on `TerrainResult.meanFilledPosts`; **no UI shows it yet**,
   * and that is a filed decision rather than an omission — the twelfth testing
   * session asked for less diagnostic text, not more.
   */
  readonly meanFilledCount: number;
}

/**
 * Whether a post counts as "around the user" for `nearReliefM`.
 *
 * AROUND THE WINDOW'S CENTRE (DEC-R11-10), which is where the user is. Measured
 * around the frame origin instead, the status line's "relief around you" would
 * describe somewhere they walked away from — and the number's whole job is to
 * distinguish "this place is hilly" from "somewhere in view is".
 */
function isNearField(enu: EnuPoint, centreEnu: EnuPoint): boolean {
  return (
    Math.abs(enu.x - centreEnu.x) <= NEAR_FIELD_M &&
    Math.abs(enu.y - centreEnu.y) <= NEAR_FIELD_M
  );
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
  /**
   * Posts holding the MEAN of their batch rather than a measured height.
   *
   * Tracked so `ensureAround` can ask for them again. Before this existed they
   * were written with the same `posts.set` as a real height and then skipped by
   * the write-once guard forever, so a tile that failed while its neighbours
   * succeeded left thousands of posts holding a plausible, confident, permanent
   * wrong height. That is the failure `terrarium.ts` argues against one layer
   * down — "a provider that returns a plausible number on failure produces a
   * confident wrong answer instead of an absence the caller can branch on" —
   * reintroduced above the seam that was careful about it.
   */
  const meanFilled = new Set<string>();
  /**
   * Posts holding heights from the upgrade path rather than the first answer.
   *
   * Read only by `replacePosts`, to decide whether a later edge can be
   * upgraded without leaving the window on two sources.
   */
  const upgraded = new Set<string>();
  /** The window the last `ensureAround` covered, for the all-or-nothing rule. */
  let lastWindow:
    | { origin: { x: number; y: number }; reach: number }
    | undefined;
  /** Whether ANY post has ever arrived. Distinguishes "flat" from "no DEM". */
  let anyData = false;

  const key = (x: number, y: number): string => `${x}/${y}`;

  /** The integer pixel a position falls nearest to. */
  const pixelOf = (position: LatLng): { x: number; y: number } => {
    const raw = toWorldPixel(position, zoom);
    return { x: Math.round(raw.x), y: Math.round(raw.y) };
  };

  async function ensureAround(
    centre: LatLng,
    radiusM: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const perPixel = metresPerPixel(centre.lat, zoom);
    // `+1` so the requested radius is fully covered rather than truncated.
    const reach = Math.ceil(radiusM / perPixel) + 1;
    const origin = pixelOf(centre);

    const viewPosts = (2 * reach + 1) ** 2;
    const missing: { x: number; y: number }[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = origin.x + dx;
        const y = origin.y + dy;
        // Already held — the whole point. Standing still costs nothing.
        //
        // EXCEPT a post we INVENTED. A mean-filled post is not an answer, it is
        // a placeholder that happens to be stored the same way, and skipping it
        // here is what made the wrong height permanent.
        if (posts.has(key(x, y)) && !meanFilled.has(key(x, y))) continue;
        missing.push({ x, y });
      }
    }
    lastWindow = { origin, reach };
    if (missing.length === 0) {
      evictBeyond(origin, viewPosts);
      return;
    }

    let heights: readonly (number | undefined)[];
    try {
      heights = await provider.elevationAt(
        missing.map((pixel) => fromWorldPixel(pixel, zoom)),
        signal,
      );
    } catch {
      // Degrade to whatever is already held. A DEM outage must cost the relief,
      // never the 3D view — a thrown error here would take the pane down with it.
      //
      // AN ABORT LANDS HERE TOO, and that is the right outcome rather than an
      // oversight: a superseded load has nothing to contribute, and the caller
      // re-checks `signal.aborted` afterwards anyway. Swallowing it here keeps
      // "cancelled" and "the DEM is down" on the same path — degrade to what is
      // held — instead of making cancellation a rejection every caller must
      // learn to expect.
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
      const postKey = key(pixel.x, pixel.y);
      const measured = height !== undefined && Number.isFinite(height);
      posts.set(postKey, measured ? height : mean);
      // Provenance recorded at the ONE place a post is written, so the two sets
      // cannot drift from the map they describe. A post that was invented and
      // is now measured must leave the set, or it would be re-requested on
      // every load forever.
      if (measured) {
        meanFilled.delete(postKey);
        // AND FROM `upgraded`. A post that was upgraded, evicted, and then
        // re-fetched holds the FAST source's data again — leaving it marked
        // upgraded would let `replacePosts` treat it as already-good and accept
        // a batch that leaves the window standing on two DEMs, which is the
        // step the all-or-nothing rule exists to prevent.
        upgraded.delete(postKey);
      } else {
        meanFilled.add(postKey);
        upgraded.delete(postKey);
      }
    });

    evictBeyond(origin, viewPosts);
  }

  /**
   * Drops the posts furthest from the current centre, once over the cap.
   *
   * By distance rather than by insertion order: a user who walks out and back
   * should not lose the posts they are standing on just because they are old,
   * which is the same reasoning the OSM chunk LRU records.
   *
   * THE CAP IS A FLOOR OF "ONE VIEW", NOT A FLAT CONSTANT, and that is a
   * correctness property rather than a tuning one. A cap below the lattice
   * `ensureAround` just built evicts posts the CURRENT view needs, so the next
   * load re-fetches them and the cache stops being a cache — standing still
   * starts costing what moving costs. That is not hypothetical: raising
   * `TERRAIN_EXTENT_M` to 2400 m put one view at 321 489 posts against a 250 000
   * constant, and every load paid a full re-fetch plus a 320 k-entry sort
   * (~180 ms) for it.
   *
   * `keep` is therefore whichever is larger. The constant still bounds the
   * WALKING history, which is what it was for; the view can never be sacrificed
   * to it.
   */
  function evictBeyond(origin: { x: number; y: number }, viewPosts = 0): void {
    const keep = Math.max(maxPosts, viewPosts);
    if (posts.size <= keep) return;
    const ranked = [...posts.keys()]
      .map((k) => {
        const [x = 0, y = 0] = k.split("/").map(Number);
        const dx = x - origin.x;
        const dy = y - origin.y;
        // CHEBYSHEV (max-norm), NOT EUCLIDEAN, and the floor above depends on
        // it. `ensureAround` builds a SQUARE lattice, so the current view is
        // exactly the max-norm ball of radius `reach`. Ranking by Euclidean
        // distance keeps a DISC instead, and a disc of the same area is narrower
        // than the square at its corners — measured at the demo's real numbers,
        // 1 200 posts of the view being fetched sit outside the kept disc and
        // were evicted in favour of nearer HISTORICAL posts. `keep >= viewPosts`
        // then guaranteed a count without guaranteeing the view survived, which
        // is a treadmill in miniature: the four corner regions re-fetched and
        // re-dropped on every load.
        //
        // With the max-norm the metric matches the shape the lattice is built
        // in, so keeping the nearest `keep` really does keep the whole view.
        return { k, distance: Math.max(Math.abs(dx), Math.abs(dy)) };
      })
      .sort((a, b) => b.distance - a.distance);
    for (const entry of ranked) {
      if (posts.size <= keep) break;
      posts.delete(entry.k);
      // THE PROVENANCE SETS GO WITH THE POST. They used to outlive it, which
      // cost two things: `meanFilledCount` counted posts that no longer exist,
      // so the number was not a property of the window it claimed to describe;
      // and an evicted-then-refetched post stayed marked `upgraded` while
      // holding the fast source's data, which let `replacePosts` accept a
      // window standing on two DEMs.
      meanFilled.delete(entry.k);
      upgraded.delete(entry.k);
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
    const centreEnu = gridOptions.centreEnu ?? { x: 0, y: 0 };
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
          x: centreEnu.x - extentM + (col / (side - 1)) * extentM * 2,
          y: centreEnu.y - extentM + (row / (side - 1)) * extentM * 2,
        };
        const height = heightAtPosition(frame.toLatLng(enu));
        if (height !== undefined) {
          values.push(height);
          if (isNearField(enu, centreEnu)) near.push(height);
        }
        // NaN, NOT 0, and the difference is the whole gap-fill below. Zero is
        // finite, so `?? 0` sailed straight through the `!Number.isFinite`
        // repair and every uncovered post stayed at sea level — a ~53 m pit at
        // Cologne after the datum subtraction, shaped exactly like whatever
        // outage produced it, published as real terrain with the buildings sunk
        // into it. Raised in review on PR #231.
        heights[row * side + col] = height ?? Number.NaN;
      }
    }

    if (!anyData || values.length === 0) {
      return {
        heights: new Float32Array(0),
        side: 0,
        extentM,
        centreEnu,
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
      centreEnu,
      // The height at the WINDOW'S CENTRE, subtracted on every read so the
      // surface is relief rather than altitude — the datum then cancels exactly
      // under the user. Taken at the frame origin instead, a user who has walked
      // 40 m uphill stands 40 m above the scene's zero plane with the camera
      // still framed at y ~ 10.
      //
      // UNLESS AR ASKED FOR ABSOLUTE HEIGHTS, in which case the datum is `−N`
      // and does not depend on the window at all — see `absoluteDatum`. That
      // independence is the whole point: a datum computed from the window moves
      // when the window does.
      // THE SIGN IS `absoluteDatumFor`'S TO OWN, not this line's (r511 review).
      // It was written inline here as a bare `-` while the tested function that
      // exists for exactly this sat with no production caller at all — so the
      // one decision the function was created to hold was being made somewhere
      // else, untested, in a single character.
      datum:
        gridOptions.absoluteDatum === undefined
          ? (heightAtPosition(frame.toLatLng(centreEnu)) ?? mean)
          : absoluteDatumFor(gridOptions.absoluteDatum.undulationMetres),
      hasData: true,
      missing: total - values.length,
      total,
      // A fold, never a spread into `Math.max` — a spread passes one argument per
      // element and throws above ~100 000, which this grid comfortably exceeds at
      // the 2.8 km extent.
      reliefM: peakToTrough(values),
      // DEC-R2-22: the near field reported separately, because over 2.8 km the
      // whole-field number can be tens of metres while the ground under the user
      // is flat. Empty only if the extent is smaller than the near field.
      nearReliefM:
        near.length === 0 ? peakToTrough(values) : peakToTrough(near),
    };
  }

  /** Every held post as a position, in map order. */
  function heldPositions(): readonly LatLng[] {
    return [...posts.keys()].map((postKey) => {
      const [x, y] = postKey.split("/").map(Number);
      return fromWorldPixel({ x: x as number, y: y as number }, zoom);
    });
  }

  /**
   * All of the current window, or none of it.
   *
   * THE RULE IS ABOUT THE WINDOW, NOT THE BATCH, and that distinction is the
   * whole correctness argument. `ensureAround` only ever asks the provider for
   * the posts it is MISSING, so on a second load near the first the batch is
   * just the new rim. Replacing per batch would leave the interior on one
   * source and the rim on another — a visible step in the ground, produced by
   * the very rule written to prevent one. So a batch is applied only when,
   * after applying it, every post in the current window would come from the
   * upgraded source: either it is in this batch, or it was upgraded earlier.
   *
   * The common cases both work out. A cold start's batch IS the whole window,
   * so it applies. A walk whose interior was already upgraded applies too,
   * because the rim completes the set. A walk into fresh ground before the
   * interior upgraded is refused, and the next upgrade covering both takes it.
   */
  function replacePosts(
    positions: readonly LatLng[],
    heights: readonly (number | undefined)[],
  ): boolean {
    if (lastWindow === undefined) return false;

    const incoming = new Map<string, number>();
    positions.forEach((position, index) => {
      const height = heights[index];
      if (height === undefined || !Number.isFinite(height)) return;
      const pixel = pixelOf(position);
      incoming.set(key(pixel.x, pixel.y), height);
    });
    // "It answered" is not "it has data". A batch of holes would turn a working
    // window into a flat one.
    if (incoming.size === 0) return false;

    const { origin, reach } = lastWindow;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const postKey = key(origin.x + dx, origin.y + dy);
        // A post the lattice does not hold is not part of the window it is
        // standing on — it was evicted, or never arrived — so it cannot make
        // the window mixed.
        if (!posts.has(postKey)) continue;
        if (incoming.has(postKey) || upgraded.has(postKey)) continue;
        return false;
      }
    }

    for (const [postKey, height] of incoming) {
      // ONLY POSTS THE LATTICE ALREADY HOLDS. An upgrade batch is built from
      // the positions the provider was asked for, and eviction may have dropped
      // some of them since — writing those back would resurrect posts outside
      // the current window and grow the lattice past its cap through a path the
      // eviction pass never sees.
      if (!posts.has(postKey)) continue;
      posts.set(postKey, height);
      upgraded.add(postKey);
      meanFilled.delete(postKey);
    }
    anyData = true;
    return true;
  }

  return {
    ensureAround,
    sampleGrid,
    replacePosts,
    heldPositions,
    get postCount() {
      return posts.size;
    },
    get meanFilledCount() {
      return meanFilled.size;
    },
  };
}
