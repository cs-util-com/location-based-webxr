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
  type OsmFeature,
} from "gps-plus-slam-osm";
import {
  AFFORDANCE_RES,
  CANDIDATES_PER_BATCH,
  EVENT_TILE_RES,
  eventCandidates,
  fetchTilesForScoreWorkingSet,
  fetchWorkingSet,
  newGeoEventFor,
  nextEventTime,
  toFetchTile,
} from "gps-plus-slam-osm";
import {
  cellToBoundary,
  cellToChildren,
  cellToLatLng,
  gridDisk,
  latLngToCell,
} from "h3-js";
import type { GeoEventStats } from "./geo-event-stats.js";
import { heatScale } from "./heat-colours.js";
import { nowMs } from "./monotonic-clock.js";

// `nowMs` moved to `monotonic-clock.ts` when the worker handler and the page
// needed the same clock for the click-path breakdown. Three copies of the
// `typeof performance` guard is three places for the fallback to drift.

/**
 * The seed every device shares (DEC-R9-7).
 *
 * ONE FIXED CONSTANT IN SOURCE, not build-injected and not configurable. Two
 * devices on different app versions must still agree, and a release must not
 * silently relocate every event in the world. Changing it is a deliberate,
 * breaking act.
 */
const GEO_EVENT_SEED = 20260804;

/**
 * Candidates evaluated per batch — IMPORTED, no longer a second copy.
 *
 * It was `const GEO_EVENT_BATCH = 10` here while `geo-event.ts` held its own
 * `CANDIDATES_PER_BATCH = 10` in another package, module-private. Step 1 below
 * seeds a batch of this size to derive which cells the climb could reach, and
 * `bestPickForTile` then evaluates a batch of ITS size — so the two agreeing
 * was the precondition for the ensure set covering the batch that actually
 * runs. Nothing tested the relationship and nothing could: one of the two was
 * not exported. Changing either would have left every event computed over
 * partly unscored ground, with no failure anywhere.
 */
const GEO_EVENT_BATCH = CANDIDATES_PER_BATCH;

/**
 * Climb steps, matching the C#s five unrolled moves.
 *
 * At res 13 a step is sqrt(3) x 4.09 = 7.09 m, so five moves reach ~35 m --
 * against the C#s ~24 m over geohash-9. The reach is a re-expression rather than
 * a port; see resolutions.ts.
 */
const CLIMB_STEPS = 5;

/**
 * SCAN the event tile rather than climbing within it (DEC-A5).
 *
 * The reported bug is that an event never lands on the obviously best ground:
 * measured on a field with one clear peak, **0 hits in 24 searches**. Climbing
 * samples — it walks each seeded candidate ~1.5 of its 5 allowed steps before
 * sticking on the nearest bump — so it finds a peak only when a candidate lands
 * on one.
 *
 * Scanning is affordable for a reason that is the opposite of intuitive: a res-8
 * tile holds only **343 res-11 chunks** to score, FEWER than a climb with useful
 * reach needs.
 *
 * ⚠️ **THE "404 OF 488" THIS USED TO CLAIM IS SINGLE-TILE ARITHMETIC, and the
 * search is not single-tile.** The reach accumulates over the centre tile AND
 * every admitted neighbour — measured at **2 401 cells, i.e. 343 x 7** — so the
 * pinned set can reach ~2 401 against a 488 cap. Pins beat the cap, so nothing
 * evicts mid-search and this is a memory spike rather than a correctness break;
 * but the comfortable-sounding 404 described one tile of seven.
 *
 * **The climb is kept, not deleted.** The 364 ms scan measurement is a LOWER
 * bound — no fixture holds a full tile — so this constant is the way back, and
 * the climb path keeps its own tests running rather than becoming a fallback
 * nobody exercises.
 *
 * ⚠️ **OFF: it runs, and it still does not find the peak. Cause NOT established.**
 *
 * What is established, by measurement:
 *
 * - the exhaustive branch really is taken — `evaluated` carries the shortlist
 *   size rather than the climb's ten seeded candidates;
 * - the reach is the whole tile — `reachCells` reads 2 401, i.e. 343 x 7 tiles;
 * - the target peak IS scored, at 80;
 * - and it still loses, 0 hits in 24, even after the draw was weighted by heat.
 *
 * **An earlier comment here blamed unscored neighbours (peak 80 + 0 against a
 * bump at 84). That diagnosis is NOT proven and a review argues it is wrong**:
 * the peak sits 17 rings inside the tile, the ensure set covers the enumerated
 * field exactly, and `cellState` answers `empty` (heat 1) rather than
 * `unknown` for any cell in a scored chunk — which would floor the peak at
 * 80 + 6 = 86 and win. Observation and that argument disagree, and **resolving
 * that contradiction is the next step**, not another fix.
 *
 * Two candidate explanations: the peak's neighbourhood may genuinely span chunks
 * the ensure set missed, or `picks[0]` may be a nearer tile's pick rather than
 * this tile's (`newGeoEventFor` sorts by distance to the user, and 5 tiles
 * produced picks).
 *
 * **THE SECOND ONE IS NOW THE FAVOURITE, on geometry rather than on a run**
 * (2026-08-11). In the graded fixture the peak is **395 m** from the user and in
 * the user's OWN res-8 tile, while the user stands **~30 m from that tile's
 * western edge** with the fixture's background covering ~350 m beyond it. A
 * neighbour tile therefore yields a pick nearer than 395 m on essentially every
 * roll, so the peak's tile's pick is never the one the test asserts on — and
 * "0 of 24" would read 0 for a perfect search. **Print every pick with its tile
 * before changing anything here**; the same instrument produced the climb path's
 * 0 of 24, so both figures are in doubt together.
 *
 * Left wired and inert rather than reverted: the path, the weighted draw and the
 * enumeration are all correct as far as they go, and a review confirmed the
 * enumeration is exactly complete. Only the outcome is missing.
 */
const EXHAUSTIVE_GEO_EVENT = false;

/**
 * A feature's outlines, for drawing it without knowing what kind it is.
 *
 * ONE OUTLINE PER RELATION MEMBER rather than a merged ring: a multipolygon's
 * members are separate boundaries, and concatenating them draws a line between
 * two unrelated rings. A node becomes a single point, which Leaflet and the
 * mesh both handle as a degenerate polyline.
 */
function outlinesOf(feature: OsmFeature): (readonly LatLng[])[] {
  if (feature.type === "node") return [[feature.position]];
  if (feature.type === "way") return [feature.geometry];
  return feature.members
    .map((member) => member.geometry)
    .filter(
      (geometry): geometry is readonly LatLng[] => geometry !== undefined,
    );
}

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
  /**
   * Monotonic clock for `DemoStageTimings`. Injected so ATTRIBUTION is testable.
   *
   * **This seam was missing and its absence was a real gap**, not a
   * convenience. `OverpassSource` and `CachingSource` both take one precisely
   * so a test can make exactly one stage expensive and assert the others are
   * zero; without it here, `scoreMs` and `deriveMs` could be swapped and every
   * test stayed green. The plan mandates that test (§5) and it could not be
   * written against a hard-wired clock.
   */
  readonly monotonicNow?: () => number;
}

/**
 * Where the wall clock went in stages 1–5 of one refresh pass.
 *
 * **Stages 1–5 and no more, because this method owns no more.** Fetch, parse,
 * merge, score and derive all happen inside `DemoPipeline.update`; the terrain
 * join, the mesh build, the structured clone and the draw happen outside it and
 * are added by the worker handler and the page. Pretending otherwise here would
 * produce a "complete" breakdown that is quietly missing four stages — which is
 * the failure the whole plan exists to correct, one level down.
 *
 * **REQUIRED, not optional.** `update` is the only producer of a
 * `DemoSnapshot` and it always measures, so an optional field could only ever
 * mean "a future path dropped it silently" — and silence reading as measured is
 * precisely what let a six-week performance loop miss this path entirely.
 *
 * @see demo-pipeline.ts.md
 */
export interface DemoStageTimings {
  /**
   * Stage 1–2, SUMMED over the tiles this pass fetched, from
   * `OsmTileResult.timings`.
   *
   * Summed rather than sampled: a working set is 1–3 tiles depending on how
   * near a res-7 boundary the click landed, so sampling would divide the fetch
   * stage by three exactly where the click is slowest and read correctly
   * everywhere else.
   */
  readonly transportMs: number;
  readonly decodeMs: number;
  readonly parseMs: number;
  /** The awaited cache write, and the cache read that did not serve. */
  readonly storeMs: number;
  readonly probeMs: number;
  /** Queued behind the source's concurrency cap, and waiting on a dedup peer. */
  readonly slotWaitMs: number;
  readonly joinedMs: number;
  /**
   * Wall clock around the ENTIRE fetch loop, merge included.
   *
   * The anchor that makes the parts falsifiable. Any set of plausible per-stage
   * numbers adds up to something; only a separately measured whole can say the
   * parts are wrong, and `fetchMs` minus the parts is the first place an
   * unattributed cost inside fetching shows up.
   */
  readonly fetchMs: number;
  /**
   * Stage 3 — `acceptTile`, i.e. `mergeTiles` over every tile held this session.
   *
   * Measured apart from `fetchMs` even though it runs inside the same loop,
   * because this is the stage the plan predicts GROWS across a session:
   * `this.tiles` is never evicted, so the cost of clicking around is quadratic
   * in tiles visited. Folded into fetching, that growth would be invisible.
   */
  readonly mergeMs: number;
  /** Stage 4 — `AffordanceIndex.update`: sweep, clip, cover, score. */
  readonly scoreMs: number;
  /** Stage 5 — thresholding, components, regions, heat scale, outlines. */
  readonly deriveMs: number;
  /** Wall clock of the whole method — the second reconciliation anchor. */
  readonly pipelineMs: number;
  /** Tiles this pass actually fetched (0 on a fully warm pass). */
  readonly tilesFetched: number;
  /** Tiles held by the index — the denominator merge cost grows against. */
  readonly tilesHeld: number;
  readonly tilesFromNetwork: number;
  readonly tilesFromCache: number;
  /**
   * Tiles whose source reported nothing.
   *
   * A COUNT rather than an absence, because a fixture-backed run would
   * otherwise read as a click whose network cost nothing — true of the fixture
   * and false of the app. A breakdown has to be able to say how much of itself
   * is unmeasured.
   */
  readonly tilesUnmeasured: number;
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
   * How many features `isBelowSurface` excluded from scoring and from the mesh.
   *
   * ALWAYS REPORTED, even when the outlines are not. The exclusion is invisible
   * by construction — 13.3 % of corpus features on the shipped table — and the
   * mirror bug is the one that does not announce itself: too eager a predicate
   * deletes real walkable ground and nothing looks broken, there is simply less
   * map. A number on the status line makes an absurd count noticeable without
   * anyone switching the layer on.
   */
  readonly undergroundCount: number;
  /**
   * The excluded features' outlines, for the `underground` layer.
   *
   * Omitted unless that layer is on, for the same reason `cells` is (round 10,
   * stage B): it is a diagnostic that is off by default, and the array would
   * otherwise be copied across the worker boundary to be drawn by nobody.
   *
   * IT HAS THE SAME SEAM AS `cells`, and this comment used to claim it did not.
   * The FEATURES are held by the index, which is what made "no refetch needed"
   * sound right — but the OUTLINES are only built when this flag is set, so a
   * held snapshot has an empty array and switching the layer on has nothing to
   * draw until a new one arrives. Gating the payload is what creates the seam,
   * regardless of where the source data lives. See `DATA_GATED_LAYERS`.
   */
  readonly undergroundOutlines: readonly (readonly LatLng[])[];
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
  /** Stages 1–5 of this pass. See {@link DemoStageTimings}. */
  readonly timings: DemoStageTimings;
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
  /** Monotonic clock for the stage timings — injectable so attribution is testable. */
  private readonly clock: () => number;

  /** Tiles already handed to the index, so a redraw does not refetch. */
  private readonly loaded = new Set<string>();

  constructor(options: DemoPipelineOptions) {
    this.source = options.source;
    this.table = options.table;
    this.clock = options.monotonicNow ?? nowMs;
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
    options?: {
      readonly includeCells?: boolean;
      /** Whether the underground outlines travel. Defaults to false. */
      readonly includeUnderground?: boolean;
    },
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
    //    scoring, so near a boundary that is ~15–90 s added to the one thing the
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
    const pipelineStart = this.clock();
    // ACCUMULATED ACROSS THE TILES, because a working set is 1–3 of them. The
    // per-tile records are summed rather than sampled; see `DemoStageTimings`.
    const totals = {
      transportMs: 0,
      decodeMs: 0,
      parseMs: 0,
      storeMs: 0,
      probeMs: 0,
      slotWaitMs: 0,
      joinedMs: 0,
      tilesFetched: 0,
      tilesFromNetwork: 0,
      tilesFromCache: 0,
      tilesUnmeasured: 0,
    };
    let mergeMs = 0;
    const fetchStart = this.clock();
    for (const tile of fetchTilesForScoreWorkingSet(chunk, scoredRadius)) {
      if (this.loaded.has(tile)) continue;
      // CHECKED PER TILE, which is the granularity that matters: a tile is
      // ~21 MB, so stopping between tiles is most of the saving available from
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
        totals.tilesFetched++;
        // ABSENT IS COUNTED, NEVER ZEROED. A source that does not instrument
        // itself must show up as `tilesUnmeasured`, or a fixture-backed run
        // reads as a click whose network cost nothing.
        const t = result.timings;
        if (t === undefined) {
          totals.tilesUnmeasured++;
        } else {
          totals.transportMs += t.transportMs;
          totals.decodeMs += t.decodeMs;
          totals.parseMs += t.parseMs;
          totals.storeMs += t.storeMs ?? 0;
          totals.probeMs += t.probeMs ?? 0;
          totals.slotWaitMs += t.slotWaitMs;
          totals.joinedMs += t.joinedMs ?? 0;
          if (t.servedBy === "network") totals.tilesFromNetwork++;
          else if (t.servedBy === "cache") totals.tilesFromCache++;
        }
        // STAGE 3, CLOCKED SEPARATELY THOUGH IT SITS INSIDE THIS LOOP. It is
        // the term the plan predicts grows across a session, and it is the term
        // nothing has ever measured; inside the fetch stage that growth would
        // be invisible.
        const mergeStart = this.clock();
        this.index.acceptTile(result);
        mergeMs += Math.max(0, this.clock() - mergeStart);
      } catch {
        missingTiles.push(tile);
      }
    }
    const fetchMs = Math.max(0, this.clock() - fetchStart);

    // CHECKED AGAIN AFTER THE FETCH LOOP, and this is not redundant. The
    // per-tile check only fires when there is a NEXT tile, and at an interior
    // position the working set needs exactly one — so a run superseded during
    // its single fetch would otherwise go on to score 19 chunks and 931 cells
    // for a position the user has already left. Scoring is the other expensive
    // half of this method, so skipping it is worth as much as skipping a tile.
    if (signal?.aborted === true) {
      throw new DOMException("Aborted", "AbortError");
    }

    const scoreStart = this.clock();
    this.index.update(position, radius);
    const scoreMs = Math.max(0, this.clock() - scoreStart);

    const deriveStart = this.clock();
    const threshold = thresholdFor(this.table, category);
    const scoresByCell = this.index.scoresByCell();
    // MATERIALISED ONCE. This used to be spread here AND again below for the
    // heat scale -- two full copies of ~24 000 cells, in the round whose whole
    // subject is not copying them. Small beside the structured clone stage B
    // removes, and on the same hot path. Raised in review on #254.
    const cells = [...scoresByCell.values()];
    // THE COUNT IS ALWAYS WANTED; THE FEATURES ALMOST NEVER ARE. The status
    // line reports how many features were excluded whether or not the layer is
    // drawn, so calling `belowSurfaceFeatures()` here put an array of ~13 % of
    // the corpus on this path on every update, three lines under the comment
    // about not copying things on it. Raised in review on #256.
    //
    // WHEN THE LAYER IS ON, THE ARRAY IS ALREADY IN HAND, so the count comes
    // off its length rather than walking the feature map a second time — the
    // first fix for this traded one wasted walk for another on the drawn path
    // (#257).
    const undergroundFeatures =
      options?.includeUnderground === true
        ? this.index.belowSurfaceFeatures()
        : undefined;
    const undergroundOutlines =
      undergroundFeatures?.flatMap((feature) => outlinesOf(feature)) ?? [];
    const undergroundCount =
      undergroundFeatures?.length ?? this.index.belowSurfaceCount();
    const above = cellsAboveThreshold(
      { cells, unmappedTagCounts: {}, lookups: 0 },
      category,
      threshold,
    );
    const regions = buildRegions(
      connectedComponents(above),
      category,
      scoresByCell,
    );

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
      undergroundCount,
      undergroundOutlines,
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
      timings: {
        ...totals,
        fetchMs,
        mergeMs,
        scoreMs,
        // CLOSED HERE, on the last line before the snapshot leaves, so stage 5
        // covers everything after scoring including building this object.
        deriveMs: Math.max(0, this.clock() - deriveStart),
        pipelineMs: Math.max(0, this.clock() - pipelineStart),
        tilesHeld: this.loaded.size,
      },
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
   * merged features across the boundary — ~21 MB of them — to explain one cell.
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
    options?: { readonly overlapMinutes?: number },
  ): Promise<{ event: GeoEvent; stats: GeoEventStats }> {
    // THE OVERLAP IS THE CALLER'S, and only because a user can pick a time now
    // (W6). It shifts the instant forward BEFORE the rounding, so the default
    // five minutes turn a request for 18:00 into 18:15 — right for "find me one
    // now", wrong for "show me 18:00". `nextEventTime`'s own docstring records
    // the trap; the picker passes zero.
    const eventTime =
      options?.overlapMinutes === undefined
        ? nextEventTime(now)
        : nextEventTime(now, { overlapMinutes: options.overlapMinutes });
    const tile = latLngToCell(position.lat, position.lng, EVENT_TILE_RES);

    // W7's counters. Wrapped around the two callbacks the algorithm actually
    // spends its time in, rather than inferred: `toCell` runs once per candidate
    // (so it counts climbs STARTED, including the batches a failing tile
    // retries), and `heatAt` runs once per cell read (so it counts the WORK,
    // which is two orders of magnitude larger for a climb that has somewhere to
    // go than for one that starts on unscored ground).
    let climbsStarted = 0;
    let heatLookups = 0;

    const toCell = (at: LatLng): string =>
      latLngToCell(at.lat, at.lng, AFFORDANCE_RES);
    /**
     * `toCell`, counted — handed ONLY to the algorithm.
     *
     * Step 1 below calls `toCell` too, once per derived candidate, and counting
     * there would report the ensure set's arithmetic as climbing work. The two
     * uses are the same function and different questions, so they get different
     * wrappers rather than one counter and a subtraction.
     */
    const countedToCell = (at: LatLng): string => {
      climbsStarted += 1;
      return toCell(at);
    };
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
    // whose data is missing costs a ~15–90 s download, and the C#'s four-tile
    // answer could mean several of them.
    //
    // The app downloads in RES-7 UNITS, each covering seven event tiles, so
    // several neighbours are usually already in memory. Those are free; the
    // rest are skipped.
    //
    // "FREE" MEANS THE WHOLE SEARCH AREA, not the tile's centre — and that
    // distinction was wrong here for several rounds. See the gate below.
    //
    // **THIS DOES NOT WEAKEN DEC-R9-4, and the distinction is the whole
    // justification.** Every tile's event stays a pure function of (tile, time)
    // — identical on every device, forever. What varies with what you have
    // downloaded is only WHICH of them you can currently see. Two people who
    // walk to the same place find the same event; a device that has loaded more
    // discovers more of them, and they converge. The divergence is "you have not
    // loaded that area yet", not "we disagree about where the event is".
    // **THE GATE IS THE NEIGHBOUR'S REACH, NOT ITS CENTRE**, and the difference
    // is the whole point of the paragraph above. It used to ask whether
    // `toFetchTile(neighbour)` was loaded — the tile the neighbour's CENTRE
    // falls in. But the ensure set built for that neighbour below extends
    // `CLIMB_STEPS + 1` cells past each of its candidates, and its candidates
    // are seeded across its whole bounding box: ~550 m past the centre, into
    // fetch tiles nothing had checked. So the download this gate exists to skip
    // happened anyway — measured at the demo's own default position as three
    // tiles, with six of seven neighbours admitted (`geo-event-reach.test.ts`).
    //
    // Asking about the reach costs one set lookup per candidate and is the
    // question the paragraph above was always describing. The centre tile is
    // still exempt: the user is standing in it, so it is searched whatever it
    // costs — and it too can overhang, which is a separate open question.
    //
    // STEP 1 rides along, because the reach has to be derived to be asked
    // about. `gridDisk(steps + 1)` because the climb may move `steps` cells and
    // then needs its destination's own neighbourhood to decide it is a peak;
    // without the extra ring the last comparison reads `unknown` and the climb
    // reports `left` at the edge of the ensured set rather than of the map.
    const deriveStart = nowMs();

    /**
     * The cells a tile's own batch-0 candidates could climb over.
     *
     * `requireLoaded` ABANDONS on the first cell whose fetch tile is missing
     * and returns `undefined`. Building the whole array and then testing it
     * would be correct and wasteful in exactly the common case: after this
     * gate, most neighbours are rejected, and a reach that leaves its fetch
     * tile usually does so on an early cell. That waste would land inside
     * `deriveMs`, which is the number W7's benchmark is read off — so the
     * measurement would be reporting work the search did not need.
     */
    /**
     * EXHAUSTIVE REACH: one res-13 seed per res-11 chunk of the tile.
     *
     * 343 seeds rather than the ~1 270 cells ten candidate discs cover, because
     * `ensureScored` maps each seed to its res-11 parent and scores the whole
     * chunk. Scanning the tile is CHEAPER than climbing far within it — a 5-step
     * res-11 climb needs ~684 chunks against a 488 cap, while the whole tile is
     * 343 per tile. (Across the admitted neighbours the reach is ~2 401 — see
     * the flag's own note; the 404 figure was one tile of seven.)
     */
    const exhaustiveReachOf = (
      each: string,
      requireLoaded = false,
    ): string[] | undefined => {
      const cells: string[] = [];
      for (const chunk of cellToChildren(each, SCORE_CHUNK_RES)) {
        const seed = cellToChildren(chunk, AFFORDANCE_RES)[0];
        if (seed === undefined) continue;
        if (requireLoaded && !this.loaded.has(toFetchTile(seed))) {
          return undefined;
        }
        cells.push(seed);
      }
      return cells;
    };

    const climbReachOf = (
      each: string,
      requireLoaded = false,
    ): string[] | undefined => {
      const [s, w, n, e] = boundsOfCell(each);
      const cells: string[] = [];
      for (const candidate of eventCandidates({
        bbox: { south: s, west: w, north: n, east: e },
        globalSeed: GEO_EVENT_SEED,
        eventTime,
        count: GEO_EVENT_BATCH,
      })) {
        for (const cell of gridDisk(toCell(candidate), CLIMB_STEPS + 1)) {
          if (requireLoaded && !this.loaded.has(toFetchTile(cell))) {
            return undefined;
          }
          cells.push(cell);
        }
      }
      return cells;
    };

    const reachOf = EXHAUSTIVE_GEO_EVENT ? exhaustiveReachOf : climbReachOf;

    const tiles = [tile];
    // The centre is searched unconditionally — the user is standing in it — so
    // it is derived without the `requireLoaded` abort and can never be
    // `undefined`.
    const reach = new Set<string>(reachOf(tile) ?? []);
    for (const neighbour of gridDisk(tile, 1)) {
      if (neighbour === tile) continue;
      const cells = reachOf(neighbour, true);
      if (cells === undefined) continue;
      tiles.push(neighbour);
      for (const cell of cells) reach.add(cell);
    }
    // The bbox objects are freshly built here, so identity is a safe key back to
    // the tile CELL — which `EventTile` does not carry and the exhaustive scan
    // needs in order to enumerate the tile's cells.
    const cellOfBox = new Map<object, string>();
    const boxes = tiles.map((each) => {
      const [s, w, n, e] = boundsOfCell(each);
      const box = { south: s, west: w, north: n, east: e };
      cellOfBox.set(box, each);
      return box;
    });
    const deriveMs = nowMs() - deriveStart;

    // STEP 2 — ensure, fetching what is missing. Only this first batch may
    // fetch (DEC-R9-12): ten sequential fetch rounds would be minutes.
    const ensureStart = nowMs();
    let tilesFetched = 0;
    const { missingTiles } = this.index.ensureScored(reach);
    for (const missing of missingTiles) {
      if (signal?.aborted === true) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        this.index.acceptTile(await this.source.fetchTile(missing, signal));
        this.loaded.add(missing);
        // COUNTED ON SUCCESS ONLY. `missingTiles.length` would report tiles
        // that failed to download as work done, and a failed tile is the case
        // where the climbs afterwards are cheapest — the opposite reading.
        tilesFetched += 1;
      } catch {
        // A tile that will not load leaves its candidates unscored, and the
        // climb reports `left` for them rather than guessing. Silence here is
        // deliberate: one unreachable tile must not fail the whole event.
      }
    }
    this.index.ensureScored(reach);
    const ensureMs = nowMs() - ensureStart;

    // STEP 3 — pin, then climb. Nothing awaits inside this callback.
    const climbStart = nowMs();
    /**
     * THIS SEARCH'S pinned count, read while the pins are still held.
     *
     * `stats.chunksPinnedPeak` cannot answer this: it is a session-lifetime
     * maximum that is deliberately never reset, so after two searches it
     * reports the larger of them for both. Inside this callback the live
     * `chunksPinned` is exactly what this search is holding, which is the
     * number the benchmark claims to print.
     */
    let chunksPinnedPeak = 0;
    const event = this.index.withPinned(reach, () => {
      chunksPinnedPeak = this.index.stats.chunksPinned;
      return newGeoEventFor({
        user: position,
        tiles: boxes.map((bbox) => ({ bbox })),
        globalSeed: GEO_EVENT_SEED,
        eventTime,
        toCell: countedToCell,
        toLatLng,
        heatAt: (cell) => {
          heatLookups += 1;
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
        // THE SAME CONSTANT THE MAP DRAWS WITH. `thresholdFor` is what decides
        // whether a cell counts as usable ground and becomes part of a region,
        // so an event should not be placed where the map itself says it is not.
        // Both were the identity by default, so they agreed by coincidence; now
        // they agree by construction, and a `__threshold__` row in the rule
        // table moves both together.
        threshold: thresholdFor(this.table, category),
        ...(EXHAUSTIVE_GEO_EVENT
          ? {
              cellsOfTile: (each: { bbox: object }) => {
                const cell = cellOfBox.get(each.bbox);
                return cell === undefined
                  ? []
                  : cellToChildren(cell, AFFORDANCE_RES);
              },
            }
          : {}),
      });
    });
    const climbMs = nowMs() - climbStart;

    return {
      event,
      stats: {
        reachCells: reach.size,
        tilesFetched,
        climbsStarted,
        heatLookups,
        chunksPinnedPeak,
        /**
         * COMPUTED HERE, NOT READ FROM `stats.pinnedOverCap` — and the reason
         * is that the index's counter can never answer this question.
         *
         * `evictBeyond` is called from `update()` and from nowhere else, so the
         * cap is never tested while a search's pins are held: by the time the
         * next eviction runs — the very refresh this search triggers (W1) — the
         * pins are released and the reading belongs to something else. Reading
         * the index's field reported a value the search could not have caused,
         * and it is sticky, so a second cheaper search inherited it.
         *
         * That matters because W7's stated prediction is about exactly this
         * number. Comparing THIS search's pinned set against the cap in force
         * is the measurement the prediction was always describing.
         */
        pinnedOverCap: Math.max(
          0,
          chunksPinnedPeak - this.index.maxRetainedChunks,
        ),
        deriveMs,
        ensureMs,
        climbMs,
      },
    };
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
