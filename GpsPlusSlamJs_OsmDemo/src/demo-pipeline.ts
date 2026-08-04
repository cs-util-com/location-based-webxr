/**
 * The demo's data pipeline: tiles in, scored cells and regions out.
 *
 * WHY THIS IS A SEPARATE, DOM-FREE MODULE. Iteration 8 exists to answer three
 * questions nobody can answer from a test suite — is res 13 the right grain, are
 * the unbounded thresholds practically pickable, do regions land in the right
 * places. Those need eyes on a map. But *getting* the data onto the map is
 * ordinary wiring that can be wrong in ordinary ways, and debugging it through a
 * browser is miserable. So everything up to "here are cells and regions" lives
 * here, is pure, and is tested; only the drawing needs a browser.
 *
 * It is also the first real consumer of `AffordanceIndex`, which is the point of
 * building the lifecycle layer before this iteration rather than during it.
 *
 * @see demo-pipeline.ts.md
 */

import {
  AffordanceIndex,
  buildRegions,
  cellsAboveThreshold,
  connectedComponents,
  thresholdFor,
  type CellScore,
  type OsmDataSource,
  type OsmTileResult,
  type Region,
  type RuleTable,
  type CellState,
  type GeoEvent,
  type LatLng,
} from "gps-plus-slam-osm";
import {
  AFFORDANCE_RES,
  EVENT_TILE_RES,
  eventCandidates,
  fetchTilesForScoreWorkingSet,
  fetchWorkingSet,
  newGeoEventFor,
  nextEventTime,
  toFetchTile,
} from "gps-plus-slam-osm";
import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { heatScale } from "./heat-colours.js";

/**
 * The seed every device shares (DEC-R9-7).
 *
 * ONE FIXED CONSTANT IN SOURCE, not build-injected and not configurable. Two
 * devices on different app versions must still agree, and a release must not
 * silently relocate every event in the world. Changing it is a deliberate,
 * breaking act.
 */
const GEO_EVENT_SEED = 20260804;

/** Candidates evaluated per batch, matching the C#s COUNT. */
const GEO_EVENT_BATCH = 10;

/**
 * Climb steps, matching the C#s five unrolled moves.
 *
 * At res 13 a step is sqrt(3) x 4.09 = 7.09 m, so five moves reach ~35 m --
 * against the C#s ~24 m over geohash-9. The reach is a re-expression rather than
 * a port; see resolutions.ts.
 */
const CLIMB_STEPS = 5;

/** A cells bounding box as [south, west, north, east]. */
function boundsOfCell(cell: string): [number, number, number, number] {
  const ring = cellToBoundary(cell);
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lng] of ring) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return [south, west, north, east];
}
import { SCORE_CHUNK_RES, SCORE_DISK_RADIUS } from "gps-plus-slam-osm";

export interface DemoPipelineOptions {
  readonly source: OsmDataSource;
  readonly table: RuleTable;
  /** Categories to score. Defaults to every category the table declares. */
  readonly categories?: readonly string[];
}

export interface DemoSnapshot {
  readonly position: LatLng;
  readonly category: string;
  readonly threshold: number;
  /** Every scored cell currently held, for the heat grid. */
  readonly cells: readonly CellScore[];
  readonly regions: readonly Region[];
  /** Fetch tiles that were requested but refused or failed. */
  readonly missingTiles: readonly string[];
  /**
   * Res-7 fetch tiles whose data is currently held.
   *
   * Surfaced so the map can DRAW the downloaded extent. "One res-7 tile" is an
   * abstraction until you see it over a city — and the query covers the tile's
   * bounding box, not the hexagon, which is a difference worth seeing rather
   * than being told.
   */
  readonly loadedTiles: readonly string[];
  /**
   * How many cells are scored, whether or not `cells` carries them.
   *
   * Separate from `cells.length` because that array is now OMITTABLE (see
   * `update`'s `includeCells`), and the status line reports this number in
   * every configuration.
   */
  readonly cellCount: number;
  /**
   * The top of the heat ramp for `category` — `heatScale(...).max`.
   *
   * COMPUTED HERE BECAUSE IT IS WHY THE CELLS TRAVELLED (round 10, stage B).
   * The page derived this by mapping every cell's score for the current
   * category and taking the maximum — which meant ~24 000 cells crossed the
   * worker boundary, at a measured 27–35 ms each of three passes per move, to
   * produce ONE NUMBER. The regions were already computed here; this was the
   * only other thing the default configuration used the array for.
   */
  readonly heatMax: number;
  readonly stats: {
    readonly chunksScored: number;
    readonly chunksReused: number;
    readonly geometryBuilt: number;
  };
  /**
   * How many rings of chunks this snapshot covers — which ring of the widening
   * it is (F42).
   *
   * WHY THE SNAPSHOT CARRIES IT. Scoring is progressive: `refresh-cycle.ts`
   * scores `PROGRESSIVE_RADII` = 2, 3, 4 and publishes after each, and
   * `snapshotReady` sets `loading: idle` every time. So the app announced a
   * final-looking answer THREE times and nothing downstream could tell an
   * intermediate ring from the last one. A user watched a cell count, a region
   * count and a triangle count settle and then silently change twice, and the
   * e2e helper had to infer the end of widening from 500 ms of status
   * quiescence — which contention defeats, so one run read 845 cells where
   * another read 1692 from the same fixture.
   *
   * Compared against `SCORE_DISK_MAX_RADIUS` rather than carrying an `isFinal`
   * flag: a snapshot describing a disc of radius N should say N, and a boolean
   * would have to be recomputed by whoever changes the ring list. The radius was
   * already a parameter of `update` — it simply never came back out.
   */
  readonly radius: number;
}

/**
 * Owns an `AffordanceIndex` and the fetches that feed it.
 *
 * STILL NOT A STORE, AND STILL NOT AN EVENT EMITTER — but the reason has
 * narrowed. This file originally argued that no shared-state layer belonged in
 * the demo at all, because with two write-only views and one input a second
 * abstraction between the index and the map would only obscure which of the two
 * produced a wrong answer. That was right for what the demo was.
 *
 * Re-opened 2026-07-29 (round-1 feedback, DEC-4): the demo grew a legend, a
 * details panel and a selected cell that three views must agree on, and wiring
 * four views to each other is six edges. There is now a Redux store in
 * `osm-store.ts` — but it sits ABOVE this file, not inside it. This class stays
 * a pure data producer: position and category in, a `DemoSnapshot` out, no
 * subscriptions, no dispatch, no knowledge that a store exists. The original
 * argument survives where it was actually load-bearing — "is the data wrong or
 * the drawing wrong?" is still answerable by testing this in isolation.
 */
export class DemoPipeline {
  private readonly source: OsmDataSource;
  private readonly index: AffordanceIndex;
  private readonly table: RuleTable;

  /** Tiles already handed to the index, so a redraw does not refetch. */
  private readonly loaded = new Set<string>();

  constructor(options: DemoPipelineOptions) {
    this.source = options.source;
    this.table = options.table;
    this.index = new AffordanceIndex(
      options.categories === undefined
        ? { table: options.table }
        : { table: options.table, categories: options.categories },
    );
    // A late tile invalidates chunks; the demo simply redraws from the next
    // snapshot, so nothing needs to listen. Registering a no-op listener would
    // imply a reactivity this app does not have.
  }

  /**
   * Loads whatever the working set needs, then scores it.
   *
   * Fetch failures are COLLECTED, not thrown. A demo that dies because one of
   * three tiles was rate-limited would hide the two that arrived — and "some of
   * the map is missing" is exactly the state the fetch policy is designed to
   * degrade into gracefully.
   */
  async update(
    position: LatLng,
    category: string,
    signal?: AbortSignal,
    /**
     * How many `gridDisk` rings of chunks to score (W16, DEC-R2-30).
     *
     * Omitted means the first pass's radius — the narrow, fast answer the user
     * is actually waiting for. The demo calls this again with wider radii once
     * that has been drawn, and each call scores only the rings the previous one
     * did not, so the reach is progressive rather than paid for up front.
     */
    radius?: number,
    /**
     * Whether the cell array travels back (round 10, stage B).
     *
     * DEFAULTS TO TRUE so every existing caller is unchanged. Pass `false` when
     * nothing on the page draws cells — which is the DEFAULT configuration of
     * the demo, since the `cells` layer is off (DEC-R7b-5/R7b-6: the map would
     * draw one Leaflet polygon per cell).
     *
     * The regions, the threshold, `heatMax` and `cellCount` are all still
     * reported, so the visible surface is identical either way. What is skipped
     * is only the raw material the page had no use for.
     *
     * **This does not withhold cells from anything that needs them.** Cell-level
     * algorithms run HERE, against the index, exactly as the geo-event's hill
     * climb does — its thousands of `cellState` reads are synchronous callbacks
     * that cannot cross a structured clone, so it returns a finished event
     * rather than the field it walked. NPC navigation is designed the same way.
     */
    options?: { readonly includeCells?: boolean },
  ): Promise<DemoSnapshot> {
    const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
    const missingTiles: string[] = [];

    // FETCHED FOR THE RING THIS PASS WILL SCORE, not for the widest one (W4,
    // finding N1). Two failure modes are being avoided at once, in opposite
    // directions:
    //
    //  - Deriving from `SCORE_DISK_RADIUS` while scoring reaches
    //    `SCORE_DISK_MAX_RADIUS` — which is what shipped — scores rings 3 and 4
    //    against tiles nobody fetched. An unfetched cell comes out as the
    //    identity, indistinguishable from "no rule has ever mentioned this
    //    ground": a plausible wrong answer within ~250 m of any res-7 boundary.
    //  - Deriving from the MAXIMUM on every pass blocks the FIRST answer on a
    //    tile only the outer rings need. The fetch loop below runs before any
    //    scoring, so near a boundary that is 18–110 s added to the one thing the
    //    user is actually waiting for — undoing W16, whose whole point is that
    //    the extra reach costs nothing at the moment of waiting.
    //
    // `radius` is the pass's own ring, and `undefined` means the first pass, so
    // the fallback has to be the SCORING default rather than this function's.
    //
    // NORMALISED ONCE, here, because the snapshot reports it too (see
    // `DemoSnapshot.radius`). Two `?? SCORE_DISK_RADIUS` expressions could drift
    // into a snapshot claiming a ring the fetch never covered.
    const scoredRadius = radius ?? SCORE_DISK_RADIUS;
    for (const tile of fetchTilesForScoreWorkingSet(chunk, scoredRadius)) {
      if (this.loaded.has(tile)) continue;
      // CHECKED PER TILE, which is the granularity that matters: a tile is
      // 28-68 MB, so stopping between tiles is most of the saving available from
      // abort at all. Once the worker's caller has moved on, continuing to pull
      // tiles for a position the user has left is exactly the waste the fetch
      // discipline exists to avoid.
      if (signal?.aborted === true) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        // AND THREADED INTO THE REQUEST ITSELF, so a superseded run stops the
        // transfer rather than merely stopping before the next one. An earlier
        // comment here said this "would need an `AbortSignal` through
        // `OsmDataSource`, `CachingSource` and `OverpassSource`, which is a
        // package API change" — that API change has since landed, and
        // `fetchTile(tile, signal)` is honoured all the way down to `fetch`. The
        // comment outlived the constraint it described.
        const result: OsmTileResult = await this.source.fetchTile(tile, signal);
        this.loaded.add(tile);
        this.index.acceptTile(result);
      } catch {
        missingTiles.push(tile);
      }
    }

    // CHECKED AGAIN AFTER THE FETCH LOOP, and this is not redundant. The
    // per-tile check only fires when there is a NEXT tile, and at an interior
    // position the working set needs exactly one — so a run superseded during
    // its single fetch would otherwise go on to score 19 chunks and 931 cells
    // for a position the user has already left. Scoring is the other expensive
    // half of this method, so skipping it is worth as much as skipping a tile.
    if (signal?.aborted === true) {
      throw new DOMException("Aborted", "AbortError");
    }

    this.index.update(position, radius);

    const threshold = thresholdFor(this.table, category);
    const scoresByCell = this.index.scoresByCell();
    const above = cellsAboveThreshold(
      { cells: [...scoresByCell.values()], unmappedTagCounts: {}, lookups: 0 },
      category,
      threshold,
    );
    const regions = buildRegions(
      connectedComponents(above),
      category,
      scoresByCell,
    );

    const cells = [...scoresByCell.values()];
    // OVER THE SAME VALUES THE PAGE USED, including the `?? 1` identity for a
    // cell with no entry for this category — the ramp must not shift because
    // the computation moved.
    const { max: heatMax } = heatScale(
      cells.map((cell) => cell.scores[category] ?? 1),
      threshold,
    );

    return {
      position,
      category,
      threshold,
      cells: options?.includeCells === false ? [] : cells,
      cellCount: cells.length,
      heatMax,
      regions,
      missingTiles,
      loadedTiles: [...this.loaded],
      stats: {
        chunksScored: this.index.stats.chunksScored,
        chunksReused: this.index.stats.chunksReused,
        geometryBuilt: this.index.stats.geometryBuilt,
      },
      radius: scoredRadius,
    };
  }

  /** The features currently merged in, for the 3D view. */
  features() {
    return this.index.mergedFeatures();
  }

  /**
   * How many fetch tiles are currently merged in.
   *
   * A faithful signature of the FEATURE SET, and that is why it is a count: tiles
   * are only ever added, never removed or replaced, so "the same count" and "the
   * same features" are the same statement. W6 uses it to decide whether a pass
   * has to rebuild the geometry or may re-send only the region slabs.
   */
  loadedTileCount(): number {
    return this.loaded.size;
  }

  /** Whether a tile is already merged in — what the prefetch queue skips on. */
  hasTile(tile: string): boolean {
    return this.loaded.has(tile);
  }

  /**
   * The res-7 tiles worth having in the background for a user at `position`.
   *
   * The ring around the tile the user is standing in (DEC-R2-6: the full ring of
   * six, throttled and queued), minus what is already held. Derived here rather
   * than in the worker because the tile arithmetic and the "already loaded" set
   * both live in this class, and splitting them would be a second place that
   * decides what is worth fetching.
   */
  neighbourTilesFor(position: LatLng): string[] {
    const here = toFetchTile(
      latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES),
    );
    return fetchWorkingSet(here).filter((tile) => !this.loaded.has(tile));
  }

  /**
   * The score record for one cell, or `undefined` if it is not currently held.
   *
   * Exists so `explainCell` can be answered inside the worker. Before the worker
   * split, the caller found this by scanning `snapshot.cells` on the main thread;
   * that no longer works, because answering it there would mean shipping the
   * merged features across the boundary — 28–68 MB of them — to explain one cell.
   * Asking the side that already holds them is the whole point.
   */
  scoreFor(cell: string): CellScore | undefined {
    return this.index.scoresByCell().get(cell);
  }

  /** What is known about one cell — see `AffordanceIndex.cellState`. */
  cellState(cell: string): CellState {
    return this.index.cellState(cell);
  }

  /** The index's counters, for the status line and for leak assertions. */
  stats(): AffordanceIndex["stats"] {
    return this.index.stats;
  }

  /**
   * The geo-event for a moment and a place (round 9 §6a).
   *
   * THIS METHOD IS THE ORDERING, and the ordering is the round's central
   * constraint. DEC-R9-4 requires every device to compute the same event
   * whatever it happens to have scored, which forbids climbing over "whatever is
   * in the cache". So:
   *
   * 1. **Derive** the cells the climb could possibly reach — from the step
   *    count, not by walking. A derived set is the same on every device; a
   *    discovered one is not.
   * 2. **Ensure** them, fetching whatever tiles that needs.
   * 3. **Pin** them, and only then climb — with NO I/O once the climb starts,
   *    because `acceptTile` deletes chunks regardless of pins, so a tile landing
   *    mid-climb would drop the very ground being walked.
   *
   * `geo-event.ts` is pure and cannot enforce any of this; it is enforced here
   * and asserted by "gives the same answer whatever was scored beforehand".
   *
   * **ONE TILE, NOT THE C#'s FOUR.** The C# takes the centre tile plus its three
   * nearest neighbours; under fetch-on-demand that is up to four Overpass
   * fetches and minutes of waiting. The centre tile's data is already loaded by
   * definition — the user is standing in it — so this is the zero-fetch case.
   * `newGeoEventFor` takes the tile list, so widening later changes only this
   * call (DEC-R9-12 records the retry asymmetry that goes with it).
   */
  async geoEvent(
    position: LatLng,
    category: string,
    now: number,
    signal?: AbortSignal,
  ): Promise<GeoEvent> {
    const eventTime = nextEventTime(now);
    const tile = latLngToCell(position.lat, position.lng, EVENT_TILE_RES);

    const toCell = (at: LatLng): string =>
      latLngToCell(at.lat, at.lng, AFFORDANCE_RES);
    // The exact inverse, so a pick can report WHERE THE EVENT IS rather than
    // the seed the climb started from. The map marker and the button label are
    // both built from it; deriving it twice is how they drifted apart.
    const toLatLng = (cell: string): LatLng => {
      const [lat, lng] = cellToLatLng(cell);
      return { lat, lng };
    };

    // STEP 0 — which tiles (DEC-R9-15). Standing near a tile edge, your own
    // tile's event can be 500 m away while a neighbour's sits 50 m across the
    // boundary, invisible — so one tile is a real quality loss. But a neighbour
    // whose data is missing costs an 18–110 s download, and the C#'s four-tile
    // answer could mean several of them.
    //
    // The app downloads in RES-7 UNITS, each covering seven event tiles, so
    // several neighbours are usually already in memory. Those are free; the
    // rest are skipped.
    //
    // **THIS DOES NOT WEAKEN DEC-R9-4, and the distinction is the whole
    // justification.** Every tile's event stays a pure function of (tile, time)
    // — identical on every device, forever. What varies with what you have
    // downloaded is only WHICH of them you can currently see. Two people who
    // walk to the same place find the same event; a device that has loaded more
    // discovers more of them, and they converge. The divergence is "you have not
    // loaded that area yet", not "we disagree about where the event is".
    const tiles = [tile];
    for (const neighbour of gridDisk(tile, 1)) {
      if (neighbour === tile) continue;
      if (this.loaded.has(toFetchTile(neighbour))) tiles.push(neighbour);
    }
    const boxes = tiles.map((each) => {
      const [s, w, n, e] = boundsOfCell(each);
      return { south: s, west: w, north: n, east: e };
    });

    // STEP 1 — derive, over EVERY tile. `gridDisk(steps + 1)` because the climb
    // may move `steps` cells and then needs its destination's own neighbourhood
    // to decide it is a peak; without the extra ring the last comparison reads
    // `unknown` and the climb reports `left` at the edge of the ensured set
    // rather than of the map.
    const reach = new Set<string>();
    for (const bbox of boxes) {
      for (const candidate of eventCandidates({
        bbox,
        globalSeed: GEO_EVENT_SEED,
        eventTime,
        count: GEO_EVENT_BATCH,
      })) {
        for (const cell of gridDisk(toCell(candidate), CLIMB_STEPS + 1)) {
          reach.add(cell);
        }
      }
    }

    // STEP 2 — ensure, fetching what is missing. Only this first batch may
    // fetch (DEC-R9-12): ten sequential fetch rounds would be minutes.
    const { missingTiles } = this.index.ensureScored(reach);
    for (const missing of missingTiles) {
      if (signal?.aborted === true) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        this.index.acceptTile(await this.source.fetchTile(missing, signal));
        this.loaded.add(missing);
      } catch {
        // A tile that will not load leaves its candidates unscored, and the
        // climb reports `left` for them rather than guessing. Silence here is
        // deliberate: one unreachable tile must not fail the whole event.
      }
    }
    this.index.ensureScored(reach);

    // STEP 3 — pin, then climb. Nothing awaits inside this callback.
    return this.index.withPinned(reach, () =>
      newGeoEventFor({
        user: position,
        tiles: boxes.map((bbox) => ({ bbox })),
        globalSeed: GEO_EVENT_SEED,
        eventTime,
        toCell,
        toLatLng,
        heatAt: (cell) => {
          const state = this.index.cellState(cell);
          // `unknown` becomes `undefined`, which is what tells the climb it has
          // run out of map. An `empty` cell is genuinely known and its heat is
          // the multiplicative identity — collapsing the two is the ambiguity
          // this whole round removed.
          if (state.state === "unknown") return undefined;
          return state.state === "empty" ? 1 : (state.score[category] ?? 1);
        },
        neighbours: (cell) => gridDisk(cell, 1),
        steps: CLIMB_STEPS,
      }),
    );
  }

  /**
   * The res-11 chunk a position falls in — shown so the grid is legible.
   *
   * Exactly what `update()` scores, computed the same way. NOT
   * `toScoreChunk(latLngToCell(…, AFFORDANCE_RES))`: `toScoreChunk` walks the
   * H3 INDEX hierarchy, whose children are not geometrically contained by their
   * parents (`resolutions.ts` says so in as many words), so near a res-11
   * boundary that names a different chunk than the one that was scored. On a
   * 60-point sweep over Cologne, four disagreed.
   */
  static chunkFor(position: LatLng): string {
    return latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
  }
}
