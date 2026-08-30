/**
 * The stateful owner of everything derived: geometry, per-chunk scores, and the
 * invalidation that keeps them honest when a tile arrives late.
 *
 * WHY THIS EXISTS. Every module below this one is a pure function, which was
 * the right thing to build first and is the wrong thing to run continuously.
 * A walking user crosses a res-11 chunk every ~50 m; the new working set
 * overlaps the previous one by 12 of its 19 chunks; and rebuilding all of it
 * costs ~165 ms of measured main-thread work per step. The C# reference does
 * not do that — it converts each element's geometry **once per session**, scores
 * each tile **once and never again** (`OsmHeatMapsManager.loadedAreas`), and
 * makes the whole pipeline a no-op unless the user crosses a tile boundary
 * (`oldUserTile`). This class is that lifecycle, on the H3 ladder.
 *
 * What it owns, and why each one is here rather than recomputed:
 *
 * - **Merged features**, from `mergeTiles`. Tiles arrive over time and overlap;
 *   the merge is the only place that decides which copy of an element wins.
 * - **Geometry and its bbox, per feature, computed once ever.** Geometry
 *   conversion is the expensive half of indexing and its result never changes,
 *   so it survives every move. This is `OsmGeoSpatialIndexer`'s
 *   `geometryLookup`/`envelopeLookup` pair, which is the reference's single
 *   best performance idea.
 * - **Scored chunks**, keyed by res-11 cell. The plan already names the res-11
 *   chunk as "the unit of scoring, of caching of computed scores, and of cache
 *   eviction" (§4.4) and nothing had ever written one.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN. Fetching. `acceptTile` is push-only: the
 * caller decides when to hit the network, and this class only reacts. That
 * keeps the network policy (slot budget, backoff, queueing) in `source/` where
 * it is tested against an injected `fetch`, and keeps this class synchronous
 * and worker-safe.
 *
 * @see affordance-index.ts.md
 */

import {
  cellToBoundary,
  cellToChildren,
  cellToParent,
  gridDistance,
  latLngToCell,
} from "h3-js";

import type {
  LatLng,
  OsmFeature,
  OsmFeatureKey,
} from "../model/osm-feature.js";
import { isBelowSurface } from "../model/below-surface.js";
import { toGeometry } from "../model/osm-geometry.js";
import type { OsmGeometry } from "../model/osm-geometry.js";
import type { OsmTileResult } from "../source/osm-data-source.js";
import { coverCells } from "../spatial/cell-coverage.js";
import type { CellFeature } from "../spatial/h3-feature-index.js";
import {
  boundsOf,
  bboxesIntersect,
  clipToBbox,
  padBbox,
  positionsOf,
} from "../spatial/clip.js";
import type { Bbox } from "../spatial/clip.js";
import { mergeTiles } from "../spatial/merge-tiles.js";
import type { FeatureProvenance } from "../spatial/merge-tiles.js";
import { featureKey } from "../model/osm-feature.js";
import {
  AFFORDANCE_RES,
  SCORE_CHUNK_RES,
  SCORE_DISK_MAX_RADIUS,
  SCORE_DISK_RADIUS,
  scoreWorkingSet,
  toFetchTile,
} from "../spatial/resolutions.js";
import type { RuleTable } from "../rules/rule-table.js";
import { scoreCells } from "./affordance-scorer.js";
import type { CellScore } from "./affordance-scorer.js";

/**
 * Margin added to a chunk's bbox before selecting features, in degrees.
 *
 * ~55 m — comfortably more than one res-11 chunk's 28.7 m edge, and the same
 * constant `h3-feature-index.ts` uses for the same reason. H3's hierarchy is
 * not geometric, so a chunk's res-13 children can sit slightly outside the
 * chunk's own boundary; the margin absorbs that rather than dropping coverage
 * at the seam. Over-selecting costs a bbox test, under-selecting loses cells.
 *
 * **This number is a conservative guess, not a computed bound.** Nobody has
 * derived the actual maximum offset between a res-11 parent's boundary and its
 * res-13 children, and ~55 m of slack around a ~4 m cell is very likely an
 * order of magnitude more than needed. It is left alone deliberately: since
 * `scoreChunks` pads the union once per batch rather than once per chunk, the
 * cost is amortised, and the failure mode of shrinking it — silently dropped
 * coverage at chunk seams — is one no current test would catch. Deriving the
 * real bound and pinning it in a test is the prerequisite for touching it.
 * See `GpsPlusSlamJs_Docs/docs/2026-07-29-0127-osm-perf-round-followups.md`.
 */
const CHUNK_MARGIN_DEG = 0.0005;

/**
 * How many chunks one working set is, at the widest radius anything scores.
 *
 * A `gridDisk` of radius r holds `3r² + 3r + 1` cells — 127 at r = 6. DERIVED
 * rather than written down, because the two numbers must not be able to drift:
 * the whole defect W7 fixes is a cap that was chosen against a 19-chunk working
 * set and left alone when DEC-R2-20 tripled it.
 */
const CHUNKS_PER_WORKING_SET =
  3 * SCORE_DISK_MAX_RADIUS * SCORE_DISK_MAX_RADIUS +
  3 * SCORE_DISK_MAX_RADIUS +
  1;

/**
 * How many working sets the default cache holds.
 *
 * Eight, so a short walk — or the click-around-the-map exploration this demo
 * exists for — stops re-scoring ground it scored moments ago. Consecutive
 * positions overlap heavily, so eight DISJOINT working sets is a generous
 * reading of "eight moves"; the number is about the worst case, where the user
 * jumps.
 */
const WORKING_SETS_RETAINED = 8;

/**
 * Default cap on retained scored chunks (W7, finding R3-3).
 *
 * RAISED FROM A HARD-CODED 256 AND MADE DERIVED. 256 was chosen when a working
 * set was 19 chunks — "~13 working sets" — and DEC-R2-20 then widened the scored
 * disk to 61 chunks without revisiting it, leaving barely four moves of headroom.
 * Past that the LRU evicts chunks the next click needs, which shows up as a click
 * that re-scores ground it just scored: part of what the round-3 notes described
 * as the behaviour feeling "undeterministisch".
 *
 * The relationship is now in the code rather than in a comment, so widening the
 * disk again cannot silently reintroduce the thrashing.
 *
 * ⚠️ **AND WIDENING THE DISK RAISES THIS CAP, WHICH IS A SEPARATE DECISION.**
 * DEC-K1 took `SCORE_DISK_MAX_RADIUS` from 4 to 6 on a field request, and this
 * derivation carried the cache along with it:
 *
 * - retained chunks **488 → 1 016**;
 * - the `scoresByCell` ceiling **23 912 → 49 784** cells;
 * - at the corpus-measured 808 bytes/cell, **~19.3 MB → ~40 MB serialised**,
 *   and `chunk-cap.corpus.test.ts` records that real heap is several times
 *   these figures.
 *
 * That test answered F54 — "can the cap go to 2 000?" — with **no**, on the
 * grounds that "this demo is meant to run on a phone". This change does not
 * reach 2 000, and the owner accepted the growth knowingly on the argument that
 * retention should scale with reach. **But no gate asserts the TOTAL**: the
 * corpus test bounds per-chunk cost only, so an eviction problem on a real
 * phone would arrive as a field report rather than as a red test. Anyone
 * raising the radius again should price this line before the CPU.
 */
const DEFAULT_MAX_CHUNKS = CHUNKS_PER_WORKING_SET * WORKING_SETS_RETAINED;

export interface AffordanceIndexOptions {
  readonly table: RuleTable;
  /** Defaults to every category the table declares. */
  readonly categories?: readonly string[];
  /**
   * Chunks retained before the furthest-from-the-user are dropped.
   *
   * Defaults to {@link WORKING_SETS_RETAINED} working sets at the widest scored
   * radius, so a short walk is recomputed rather than re-scored. Bounded because
   * an unbounded cache on a user who walks all day is a leak with a slow fuse.
   */
  readonly maxChunks?: number;
}

/** One res-11 chunk's scores, and what they were computed from. */
export interface ScoredChunk {
  readonly chunk: string;
  readonly cells: readonly CellScore[];
  /** Fetch tiles whose data contributed. Invalidation is keyed on these. */
  readonly tiles: readonly string[];
  /** Features considered. Exposed because "0 features" and "no data" differ. */
  readonly featureCount: number;
}

/**
 * What is known about one cell (round 9 §3, DEC-R7b-10).
 *
 * THREE STATES BECAUSE TWO WERE A BUG. Every other read on this class answers an
 * unscored cell with the multiplicative identity — the same answer a genuinely
 * empty cell gives — so "nothing is mapped here" and "nobody has looked here
 * yet" were indistinguishable to every caller. That is tolerable while scoring
 * only ever happens in a disc around the user, and load-bearing the moment an
 * algorithm may read outside it.
 *
 * `unknown` is a fact about the field, not a request: reading it never triggers
 * scoring or fetching.
 */
export type CellState =
  | {
      readonly state: "scored";
      readonly score: Readonly<Record<string, number>>;
    }
  | { readonly state: "empty" }
  | { readonly state: "unknown" };

export interface UpdateResult {
  /** The 19 chunks now covering the user. */
  readonly workingSet: readonly string[];
  /** Chunks scored during this call — empty when the user has not moved far. */
  readonly scored: readonly string[];
  /** Chunks served from cache. */
  readonly reused: readonly string[];
}

/** Fired when previously-published scores stopped being true. */
export type ChangeListener = (changedChunks: readonly string[]) => void;

interface FeatureGeometry {
  readonly geometry: OsmGeometry;
  readonly bbox: Bbox;
}

export class AffordanceIndex {
  private readonly table: RuleTable;
  private readonly categories: readonly string[];
  private readonly maxChunks: number;

  /** Every tile ever accepted, newest-wins per tile id. See `mergeTiles`. */
  private readonly tiles = new Map<string, OsmTileResult>();
  private features = new Map<OsmFeatureKey, OsmFeature>();

  /**
   * The tile each surviving feature came from, straight from `mergeTiles`.
   *
   * Needed because `ScoredChunk.tiles` must name the tiles that CONTRIBUTED,
   * not the tiles the index happens to hold — invalidation keys on it, and the
   * two differ the moment a held tile is refetched.
   */
  private featureTile: ReadonlyMap<OsmFeatureKey, FeatureProvenance> =
    new Map();

  /**
   * Geometry per feature, computed once and kept. Cleared only for features the
   * merge actually replaced — see `acceptTile`.
   */
  private readonly geometry = new Map<OsmFeatureKey, FeatureGeometry | null>();

  /**
   * Rough bbox per feature, from raw positions. The cheap half of the funnel:
   * computed for every feature, where geometry is converted only for the few
   * that survive it.
   */
  private readonly bounds = new Map<OsmFeatureKey, Bbox | null>();

  private readonly chunks = new Map<string, ScoredChunk>();

  /**
   * Chunks an in-flight algorithm has asked not to be evicted (round 9 §4).
   *
   * Held rather than counted, because eviction needs to test membership. Always
   * emptied by the `finally` in {@link withPinned}, so a thrown algorithm cannot
   * leave the cap permanently unenforceable.
   */
  private readonly pinned = new Set<string>();
  private readonly listeners = new Set<ChangeListener>();

  /**
   * Bumped by every path that adds, replaces or drops a scored chunk (W9).
   *
   * A COUNTER RATHER THAN A DIRTY FLAG, so a cache can record which version it
   * was built from and a future second cache cannot be reset by the first one
   * clearing the flag. The three writers are `scoreChunks`, `acceptTile`'s
   * invalidation, `evictBeyond` and `ensureScored` — note it is `update` rather
   * than `scoreChunks` that bumps it on the scoring path; missing one would
   * produce a stale read that
   * looks like the map has stopped updating.
   */
  private chunkVersion = 0;

  /** The last `scoresByCell` result, and the version it was built from. */
  private scoresByCellCache: Map<string, CellScore> | undefined;

  /** The user's last res-11 cell. The `oldUserTile` short-circuit. */
  private lastChunk: string | undefined;
  /**
   * The widest radius scored for `lastChunk`.
   *
   * Reset with the chunk, because a move invalidates how far the PREVIOUS place
   * had been scored — carrying it over would let a new position's first pass be
   * mistaken for an already-completed wider one.
   */
  private lastRadius = -1;

  readonly stats = {
    chunksScored: 0,
    chunksReused: 0,
    chunksEvicted: 0,
    geometryBuilt: 0,
    geometryReused: 0,
    /** Times `update` returned without scoring because the chunk was the same. */
    movesIgnored: 0,
    /** Chunks currently pinned against eviction. Zero unless a climb is running. */
    chunksPinned: 0,
    /**
     * The HIGH-WATER mark of {@link chunksPinned}, which is the useful one.
     *
     * `chunksPinned` is live: `withPinned` sets it on entry and resets it in a
     * `finally`, so by the time a caller can read it the answer is always the
     * number pinned right now — zero, for anyone asking after the fact. That
     * makes "how much did that search hold?" unanswerable, which is precisely
     * the question W7 exists to answer. Kept as a peak and never reset, since
     * the interesting value is the worst case across a session rather than the
     * last one.
     */
    chunksPinnedPeak: 0,
    /**
     * How far the pinned set has pushed the cache past its cap (DEC-R9-11).
     *
     * Non-zero means something is holding several batches at once without
     * releasing — a bug rather than normal use, since one batch is ~190 chunks
     * against a 488 cap. Counted rather than thrown so a leak is visible in the
     * status line instead of crashing the demo.
     */
    pinnedOverCap: 0,
    /**
     * Times the cell map was built from scratch (round 10, stage A).
     *
     * THE METRIC THE STAGE IS FOR, not a diagnostic. Before stage A this was
     * effectively one per scoring pass — three per move, each walking every
     * retained chunk — and the whole change is that it should now be **at most
     * one for the lifetime of the index**. A test asserts that across the three
     * progressive rings; without a counter the improvement would be asserted by
     * comment rather than measured.
     */
    scoresByCellBuilds: 0,
    /**
     * Cells `coverCells` produced, BEFORE the per-chunk filter throws most away.
     *
     * **THE INPUT SIDE OF THE FUNNEL, and nothing could see it** (r514 review).
     * Every other number here counts what was KEPT, and kept cells are capped
     * at `chunks x 49` by construction — `distribute` files a cell only if
     * `cellToChunk` has it. So the cost of covering a feature against the
     * batch's whole bounding box was invisible: delete the `clipToBbox` in
     * `scoreChunks` and every existing assertion still passes, with the suite
     * grinding as the only signal.
     *
     * That made the one claim `oversize-feature-guard.test.ts` exists for — the
     * clip is what keeps a continental feature affordable — the one thing it
     * could not pin. With this it is a direct assertion instead of a
     * replicated-geometry argument.
     *
     * Cumulative over the index's life, like its neighbours here.
     */
    cellsCovered: 0,
  };

  constructor(options: AffordanceIndexOptions) {
    this.table = options.table;
    this.categories = options.categories ?? options.table.categories;
    this.maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  }

  /**
   * The cap actually in force, so a test can assert the RELATIONSHIP to the
   * working set rather than a number (W7).
   *
   * Exposed rather than exporting the constant: the constant is a default, and
   * what matters is what this instance will do — a consumer that passes
   * `maxChunks` should be checkable the same way.
   */
  get maxRetainedChunks(): number {
    return this.maxChunks;
  }

  /**
   * Adds or replaces a fetch tile, dropping any scores it invalidates.
   *
   * Returns the chunks whose scores were discarded, and notifies listeners with
   * the same list. **This is the consumer the "serve cache now, queue the
   * fetch" design always implied and never had**: a tile can land minutes after
   * `ensureAreaLoaded` resolved, and without this the index would keep serving
   * scores computed from data it now knows to be incomplete.
   *
   * Invalidation is by tile id, not by geometry: a chunk records which tiles it
   * was computed from, and any chunk that used this tile — or that was computed
   * with this tile ABSENT, i.e. before it arrived — must be re-scored.
   */
  acceptTile(tile: OsmTileResult): readonly string[] {
    // A REFETCH of a tile we already hold is the only case that can REMOVE a
    // feature, because absence within the bbox of one tile means deletion
    // (see mergeTiles). Adding a tile we have never seen can only add or
    // outrank, never remove - which is what makes the incremental path sound,
    // and why the two cases are separated rather than unified.
    const isRefetch = this.tiles.has(tile.tile);
    this.tiles.set(tile.tile, tile);

    if (isRefetch) {
      this.remergeAllTiles();
    } else {
      this.overlayNewTile(tile);
    }

    // Every chunk that overlaps the tile is suspect, whether or not it names
    // the tile: a chunk scored before this tile arrived recorded its absence.
    const bbox = tileBbox(tile.tile);
    const invalidated: string[] = [];
    for (const [chunk, scored] of this.chunks) {
      const overlaps = bboxesIntersect(bbox, chunkBbox(chunk));
      if (!overlaps && !scored.tiles.includes(tile.tile)) continue;
      this.dropChunk(chunk);
      invalidated.push(chunk);
    }

    // Force the next `update` to do work even if the user has not moved: the
    // short-circuit is about the USER's position, and the world just changed.
    if (invalidated.length > 0) {
      this.lastChunk = undefined;
      this.lastRadius = -1;
    }

    if (invalidated.length > 0) this.notify(invalidated);
    return invalidated;
  }

  /**
   * The full merge - correct for every case, and O(all features) per call.
   *
   * Kept for the refetch case, where the new version of a tile may have
   * DROPPED features whose next-best owner could be any other tile. Working
   * that out incrementally means re-deriving the winner for each dropped key
   * from the tiles that remain, which is the merge again with more
   * bookkeeping.
   */
  private remergeAllTiles(): void {
    const merged = mergeTiles([...this.tiles.values()]);
    const previous = this.features;
    this.features = new Map(merged.features);
    // Which tile each SURVIVING record came from, so a scored chunk can name
    // the tiles that actually fed it. `mergeTiles` already resolves this while
    // picking the winner across tiles — recomputing it here would just be a
    // second, divergable copy of the same rule.
    this.featureTile = merged.provenance;

    // Drop cached geometry only where the winning record actually changed.
    // Re-converting geometry that no tile touched is the cost this class exists
    // to avoid, and a refetch of one tile must not throw away the whole map.
    for (const [key, feature] of this.features) {
      if (previous.get(key) === feature) continue;
      this.geometry.delete(key);
      this.bounds.delete(key);
    }
    for (const key of previous.keys()) {
      if (this.features.has(key)) continue;
      this.geometry.delete(key);
      this.bounds.delete(key);
    }
  }

  /**
   * The incremental path for a tile we have never held: overlay it onto the
   * current merge instead of rebuilding that merge from every tile.
   *
   * WHY THIS IS EQUIVALENT. mergeTiles sorts by compareTiles - a TOTAL order
   * on (fetchedAt, tile id) - and lets the last write win, so the owner of a
   * key after a full merge is the GREATEST tile containing it. Adding a tile
   * does not change the relative order of the tiles already held, so the new
   * greatest is just max(current owner, incoming tile). Comparing against the
   * recorded owner therefore reproduces the answer of the full merge for
   * every key, without visiting the keys that no tile touched.
   *
   * THE MAP IS STILL REPLACED, NOT MUTATED. mergedFeatures documents its
   * result as a snapshot whose identity changes, precisely so a caller
   * holding one keeps a coherent world rather than watching it shift under
   * them. Mutating in place would save the copy and hand that caller a TORN
   * view instead - a worse failure than the stale one the contract names.
   *
   * Measured 2026-08-30 on devbox-win11: the 24th accept of a 2 259-feature
   * tile falls 62.1 -> 14.6 ms (-76 %), and a 24-tile session 881 -> 210 ms.
   * The old cost grew with the whole working set on every tile, so a walk
   * paid quadratically for tiles it had already merged.
   */
  private overlayNewTile(tile: OsmTileResult): void {
    const features = new Map(this.features);
    const provenance = new Map(this.featureTile);
    const provenanceEntry: FeatureProvenance = {
      tile: tile.tile,
      fetchedAt: tile.fetchedAt,
      sourceId: tile.sourceId,
    };

    for (const feature of tile.features) {
      const key = featureKey(feature);
      const owner = provenance.get(key);
      if (owner !== undefined && !outranks(tile, owner)) continue;
      // Only a CHANGED record invalidates cached geometry - the same rule the
      // full path applies, and the reason this class exists at all.
      if (features.get(key) !== feature) {
        this.geometry.delete(key);
        this.bounds.delete(key);
      }
      features.set(key, feature);
      provenance.set(key, provenanceEntry);
    }

    this.features = features;
    this.featureTile = provenance;
  }
  /** Subscribes to invalidations. Returns an unsubscribe function. */
  onChanged(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Brings the working set around `position` up to date.
   *
   * Cheap by design in the common case: if the user is still in the same res-11
   * chunk and nothing was invalidated, this does nothing at all. That is the
   * reference's `oldUserTile` short-circuit, and it is what makes calling this
   * on every GPS fix acceptable.
   */
  update(
    position: LatLng,
    /**
     * How many rings to score (W16). Defaults to the first pass's radius.
     *
     * Calling this repeatedly with a growing radius is the progressive path: each
     * call scores only the chunks the previous one did not, because the ones it
     * did are already in `this.chunks` and come back as `reused`.
     */
    radius: number = SCORE_DISK_RADIUS,
  ): UpdateResult {
    const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
    const workingSet = scoreWorkingSet(chunk, radius);

    // The short-circuit now has to consider the RADIUS as well as the chunk.
    // Keyed on the chunk alone, the second call of a progressive run — same
    // chunk, wider ring — would return early with nothing scored, and the outer
    // rings would silently never arrive. The symptom would be a working set that
    // stops growing, which looks exactly like a working set that finished.
    if (chunk === this.lastChunk && radius <= this.lastRadius) {
      this.stats.movesIgnored++;
      return { workingSet, scored: [], reused: workingSet };
    }
    this.lastChunk = chunk;
    this.lastRadius = radius;

    // NEAREST FIRST, as the reference sorts its sub-tiles by real distance to
    // the user. It changes no result, and it means a run that is interrupted —
    // by a frame budget, by an abort — has done the most useful work first.
    const ordered = [...workingSet].sort(
      (a, b) => ringDistance(chunk, a) - ringDistance(chunk, b),
    );

    const scored: string[] = [];
    const reused: string[] = [];
    for (const target of ordered) {
      if (this.chunks.has(target)) {
        reused.push(target);
        this.stats.chunksReused++;
      } else {
        scored.push(target);
        this.stats.chunksScored++;
      }
    }

    // ONE pass over the features for the whole batch — see `scoreChunks`.
    // `scored` keeps the nearest-first order of `ordered`, so a consumer still
    // learns which chunks were computed in the order they matter.
    for (const [target, result] of this.scoreChunks(scored)) {
      this.retainChunk(target, result);
    }

    this.evictBeyond(workingSet);
    return { workingSet, scored, reused };
  }

  /**
   * Scores the chunks these cells fall in, and nothing else (round 9 §4).
   *
   * WHY A SECOND WRITE PATH EXISTS. `update` is "move the user here and score a
   * whole disc", and it also evicts. An algorithm that reads around a point 600 m
   * from the user — a geo-event candidate — cannot express that as a user
   * position without moving the user, and would have its chunks evicted by the
   * next refresh regardless. This scores exactly what was asked for.
   *
   * **It does not evict**, deliberately: eviction is `update`'s, because only
   * `update` knows where the user is and therefore what "far away" means.
   *
   * **It does not touch `lastChunk` / `lastRadius`.** Those mean "how far the
   * USER's position has been scored"; writing them here would make the next
   * `update` short-circuit past real work.
   *
   * **It returns the fetch tiles it could not cover rather than fetching them**
   * (DEC-R9-10). This class is push-only and synchronous by design — that is
   * what keeps it worker-safe and testable with no network — so the caller
   * fetches and calls again. Reporting what was actually missing also cannot
   * drift from what was actually needed, which deriving the tiles separately
   * can: `demo-pipeline.ts` measures that drift at four of sixty sweep points.
   */
  ensureScored(cells: Iterable<string>): { missingTiles: string[] } {
    const wanted = new Set<string>();
    for (const cell of cells) wanted.add(cellToParent(cell, SCORE_CHUNK_RES));

    const missing = new Set<string>();
    const targets: string[] = [];
    for (const chunk of wanted) {
      if (this.chunks.has(chunk)) continue;
      // A chunk whose fetch tile never arrived cannot be scored, and scoring it
      // anyway would publish an empty chunk — indistinguishable from genuinely
      // empty ground, which is the ambiguity `cellState` exists to remove.
      const tile = toFetchTile(chunk);
      if (!this.tiles.has(tile)) {
        missing.add(tile);
        continue;
      }
      targets.push(chunk);
    }

    for (const [target, result] of this.scoreChunks(targets)) {
      // THROUGH `retainChunk`, which is what keeps `scoresByCell` in step. The
      // previous version set the chunk here and bumped the version by hand, and
      // the comment warned that forgetting the bump made every cell scored here
      // invisible. Routing every writer through one method removes the class of
      // mistake rather than warning about it.
      this.retainChunk(target, result);
      this.stats.chunksScored++;
    }

    return { missingTiles: [...missing] };
  }

  /**
   * Runs `body` with the chunks containing `cells` exempt from eviction.
   *
   * WHY PINNING IS NOT AN OPTIMISATION HERE. `update` calls `evictBeyond`
   * unconditionally and the demo issues three `update`s per user action
   * (`refresh-cycle.ts`, radii 2 → 3 → 4). A chunk scored for a candidate far
   * from the user sits in the first-to-go bucket, so without a pin it would be
   * scored, evicted and re-scored on every ring.
   *
   * **Scoped rather than a pin/unpin pair** so ordinary code cannot forget —
   * including on a throw. An abandoned algorithm that kept its pins would make
   * the cache cap permanently unenforceable, which is the leak the cap exists to
   * prevent, reintroduced through its own exemption.
   *
   * **Pins WIN over the cap, and the overrun is counted** (DEC-R9-11). Having an
   * algorithm's data evicted mid-run is the thing this prevents, so the pin must
   * take precedence; exceeding the cap then requires holding several batches at
   * once without releasing, which is a bug rather than normal use. Throwing was
   * rejected — it turns memory pressure into a crash in front of whoever runs
   * the demo rather than whoever wrote the leak — and silently growing the cap
   * was rejected because it makes a leak invisible.
   */
  withPinned<T>(cells: Iterable<string>, body: () => T): T {
    const pinned: string[] = [];
    for (const cell of cells) {
      const chunk = cellToParent(cell, SCORE_CHUNK_RES);
      if (this.pinned.has(chunk)) continue;
      this.pinned.add(chunk);
      pinned.push(chunk);
    }
    this.stats.chunksPinned = this.pinned.size;
    // BEFORE the body, not after: the `finally` below puts `chunksPinned` back
    // to whatever is still held, so a peak taken there would always read the
    // released value. This is the only moment the size is the size of THIS
    // search's pinned set.
    this.stats.chunksPinnedPeak = Math.max(
      this.stats.chunksPinnedPeak,
      this.pinned.size,
    );
    try {
      return body();
    } finally {
      for (const chunk of pinned) this.pinned.delete(chunk);
      this.stats.chunksPinned = this.pinned.size;
    }
  }

  /** A scored chunk, if it is currently held. */
  chunk(chunk: string): ScoredChunk | undefined {
    return this.chunks.get(chunk);
  }

  /** Every currently-held scored chunk. */
  scoredChunks(): readonly ScoredChunk[] {
    return [...this.chunks.values()];
  }

  /**
   * What is known about one cell — scored, empty, or not looked at yet.
   *
   * WHY THIS EXISTS, and it is the difference between a correct algorithm and a
   * confidently wrong one. Every other read here answers an unscored cell with
   * the multiplicative identity, which is the same answer a genuinely empty cell
   * gives. `resolutions.ts` already names the cost: _"an unfetched cell scores
   * as the identity, which reads as 'nothing is mapped here'"_. A hill-climb
   * that believes it walks to the edge of the scored field and stops, every
   * time, and nothing reports it.
   *
   * **The distinction is not invented here, only surfaced.** `chunk()` already
   * separates the two — `undefined` for unscored against a `ScoredChunk` whose
   * `featureCount` may be 0 — and that field's doc says why it is exposed.
   * What was missing is a path from a CELL to that fact.
   *
   * **`empty` cannot come from the score map**, which is why this is a
   * membership check rather than a lookup with a default. `distribute` only
   * creates an entry for a cell some feature actually covered, so a scored chunk
   * with nothing in it publishes no cell records at all. Materialising them
   * would mean ~2 989 records of pure absence per working set, inflating every
   * snapshot that crosses the worker boundary to say nothing.
   *
   * **Coarsening a cell to its chunk is safe here**, unlike deriving a chunk
   * from a POSITION: `distribute` attributes cells through this same index
   * partition, so a cell's res-11 parent is by construction the chunk that would
   * have scored it. (`demo-pipeline.ts` records the position-derived version
   * disagreeing at four of sixty sweep points.)
   *
   * Reads only. It never scores, never fetches and never awaits — `unknown` is a
   * fact about the field, not a request to change it.
   */
  cellState(cell: string): CellState {
    // STRAIGHT TO THE CHUNK, never through `scoresByCell()`. The first version
    // of this method did go through it, and that was a real defect rather than
    // an inefficiency: `scoresByCell` rebuilds over EVERY retained chunk
    // (~24 000 cells) whenever `chunkVersion` moves, and the geo-event climb
    // interleaves single-cell reads with `ensureScored` calls that bump it. Each
    // read after each ensure would have rebuilt the whole map — O(everything
    // retained) per step of an algorithm whose whole point is to touch a bounded
    // neighbourhood.
    //
    // The spatial structure needed to avoid it was already here: chunks are
    // keyed by their res-11 cell, so a cell's parent names its chunk directly.
    // This is O(49) over one chunk's cells, allocates nothing, and cannot be
    // invalidated.
    const chunk = this.chunks.get(cellToParent(cell, SCORE_CHUNK_RES));
    if (chunk === undefined) return { state: "unknown" };
    const scored = chunk.cells.find((entry) => entry.cell === cell);
    return scored === undefined
      ? { state: "empty" }
      : { state: "scored", score: scored.scores };
  }

  /** Every held cell whose score in `category` is strictly above `threshold`. */
  cellsAbove(category: string, threshold: number): string[] {
    const out: string[] = [];
    for (const scored of this.chunks.values()) {
      for (const cell of scored.cells) {
        if ((cell.scores[category] ?? 1) > threshold) out.push(cell.cell);
      }
    }
    return out;
  }

  /**
   * Cell id → its score record, across every held chunk.
   *
   * CACHED AGAINST A MUTATION COUNTER (W9). This walks every retained chunk —
   * up to eight working sets of 49 cells each — and the demo asks for it once
   * per scoring pass (three times per click) and again for every `explain`. At
   * that size the rebuild is the single most expensive read on this class, and
   * nothing about it changes between two calls with no mutation in between.
   *
   * **MAINTAINED, NOT REBUILT (round 10, stage A).** It was previously derived
   * on demand and invalidated by a version counter, which meant a move — three
   * progressive rings, each scoring new chunks — rebuilt the whole map three
   * times to deliver one ring of new cells. At the 488-chunk cap that is
   * ~24 000 cells walked per ring, and DEC-R9-14 named it as the reason the cap
   * could not simply be raised.
   *
   * Now every path that adds, replaces or drops a chunk goes through
   * {@link retainChunk} / {@link dropChunk}, which update this map by the cells
   * that actually changed. The build below runs at most once per index.
   *
   * **THE RETURNED MAP IS LIVE.** It used to be replaced wholesale on
   * invalidation, so a caller could hold one across a mutation and keep a
   * consistent old snapshot; now it is the map itself and later mutations are
   * visible through it. Every caller in this repo reads it immediately
   * (`update` spreads it into an array in the same statement), so this costs
   * nothing today — but a caller that retains it across a scoring pass would
   * now see the new state, and that is a real behavioural change rather than a
   * refactor.
   */
  scoresByCell(): Map<string, CellScore> {
    if (this.scoresByCellCache === undefined) {
      const byCell = new Map<string, CellScore>();
      for (const scored of this.chunks.values()) {
        for (const cell of scored.cells) byCell.set(cell.cell, cell);
      }
      this.scoresByCellCache = byCell;
      this.stats.scoresByCellBuilds++;
    }
    return this.scoresByCellCache;
  }

  /**
   * Adds or replaces a chunk, keeping {@link scoresByCell} in step.
   *
   * THE ONLY WAY A CHUNK MAY ENTER `this.chunks`. Routing every writer through
   * here is what makes the incremental map safe: a path that set the chunk
   * directly would leave the map missing those cells, and the symptom would be
   * ground that is scored but draws unscored — invisible until someone compared
   * the two.
   *
   * A REPLACEMENT DROPS THE OLD CELLS FIRST. Chunks partition cells by
   * `cellToParent`, so a rescore should produce the same cell set and the
   * delete should be redundant — but "should be" is not a guarantee this map
   * can afford, and a stale cell here outlives every later pass because nothing
   * rescores a chunk that already exists.
   */
  private retainChunk(chunk: string, result: ScoredChunk): void {
    const cache = this.scoresByCellCache;
    if (cache !== undefined) {
      const previous = this.chunks.get(chunk);
      if (previous !== undefined) {
        for (const cell of previous.cells) cache.delete(cell.cell);
      }
      for (const cell of result.cells) cache.set(cell.cell, cell);
    }
    this.chunks.set(chunk, result);
    this.chunkVersion += 1;
  }

  /**
   * Removes a chunk and its cells. The counterpart to {@link retainChunk}.
   *
   * Returns whether anything was removed, so callers can keep their own counters
   * honest rather than assuming the chunk was there.
   */
  private dropChunk(chunk: string): boolean {
    const previous = this.chunks.get(chunk);
    if (previous === undefined) return false;
    const cache = this.scoresByCellCache;
    if (cache !== undefined) {
      for (const cell of previous.cells) cache.delete(cell.cell);
    }
    this.chunks.delete(chunk);
    this.chunkVersion += 1;
    return true;
  }

  /**
   * Features currently merged in, for callers that need the raw data.
   *
   * **This is what decision 12.4 asks for, and it already existed.** The spatial
   * index needs exactly the set this class maintains: tiles overlap,
   * `mergeTiles` resolves them, and at 14–55 MB resident a second merged copy is
   * not affordable on a phone. Reading this one also inherits `acceptTile`'s
   * merge and invalidation, so the two consumers cannot drift apart about what
   * is loaded.
   *
   * **NOT A LIVE VIEW — a snapshot whose identity changes.** `acceptTile`
   * replaces the whole map rather than mutating it, so a caller that holds the
   * returned reference keeps the world as of its call and then serves stale data
   * silently, with no error to notice. Re-read after every `acceptTile`; the
   * chunk list that call returns is the signal something changed.
   *
   * **Returned uncopied and must be treated as read-only.** `ReadonlyMap` says
   * so in the type; copying instead would reintroduce the second copy this
   * accessor exists to avoid.
   */
  mergedFeatures(): ReadonlyMap<OsmFeatureKey, OsmFeature> {
    return this.features;
  }

  /**
   * The features excluded from scoring because they are under the surface.
   *
   * WHY THIS IS A SELECTOR RATHER THAN SOMETHING THE SCORER RECORDS. Skipping
   * these is invisible by construction -- 13.3 %% of corpus features, silently
   * absent from both the scores and the mesh -- and the mirror bug is the one
   * that does not announce itself: a predicate that is too eager deletes real
   * walkable ground, and nothing looks broken, there is simply less map.
   *
   * Recomputing `isBelowSurface` over the merged features CANNOT DISAGREE with
   * the scorer, because it is the same function over the same input. Having the
   * scorer record what it skipped would be truthful by construction too, but it
   * puts a diagnostic collection in the hot loop and grows `ScoreResult` with a
   * field every consumer must ignore. The predicate is pure and cheap, and this
   * feeds a layer that is off by default.
   *
   * **Call this only when the layer is ON.** For the count alone — which the
   * status line reports unconditionally — use {@link belowSurfaceCount}: it
   * runs the same predicate over the same features without materialising an
   * array of ~13 % of the corpus on every `update`. The "off by default"
   * justification above stopped covering the count the moment it became
   * unconditional, which is what review on #256 caught.
   */
  belowSurfaceFeatures(): OsmFeature[] {
    const excluded: OsmFeature[] = [];
    for (const feature of this.features.values()) {
      if (isBelowSurface(feature)) excluded.push(feature);
    }
    return excluded;
  }

  /**
   * How many features are excluded as below-surface.
   *
   * The same loop as {@link belowSurfaceFeatures} without the allocation, for
   * the status line, which reports the number whether or not the layer is
   * drawn. Kept as a separate method rather than `belowSurfaceFeatures().length`
   * precisely because that spelling is what put an array of ~13 % of the corpus
   * on a hot path.
   */
  belowSurfaceCount(): number {
    let count = 0;
    for (const feature of this.features.values()) {
      if (isBelowSurface(feature)) count++;
    }
    return count;
  }

  private notify(chunks: readonly string[]): void {
    for (const listener of this.listeners) listener(chunks);
  }

  /**
   * Scores a BATCH of chunks in one pass over the features.
   *
   * WHY A BATCH AND NOT ONE CHUNK AT A TIME. Measured 2026-07-29 (perf loop),
   * **84 % of `update`'s time was `polygonToCellsExperimental`** — the h3 call
   * behind `coverCells`. Not the bbox funnel, not clipping, not scoring. The
   * reason it dominated was repetition: a cold working set is 19 chunks, and a
   * feature touching several of them was clipped and covered once per chunk.
   *
   * The waste compounds with `CHUNK_MARGIN_DEG`. That margin is ~55 m against a
   * res-11 chunk's ~29 m edge, so each per-chunk selection box was ~135 m
   * across — nearly the size of the whole 19-chunk working set. Nineteen
   * overlapping ~135 m covers were being computed to fill a ~150 m area, and
   * all but the 49 cells belonging to the chunk being scored were discarded.
   * Covering the union once and bucketing the results by chunk does the same
   * work once, and the margin is now paid once rather than nineteen times.
   *
   * SOUNDNESS. A chunk's result must be a function of the chunk alone, or
   * scores would depend on the route the user walked. Two things secure that:
   * each chunk gets its own `byCell`/`kept`, and a coverage cell is attributed
   * via `cellToChunk`, which is a partition — `childCells` of distinct res-11
   * chunks are disjoint, so no cell can land in two buckets. Clipping to the
   * union rather than to one chunk cannot change a cell's coverage either:
   * clipping is an intersection, so for any cell inside the clip rectangle the
   * covered area is identical, and the union rectangle contains every
   * per-chunk one. `affordance-index.test.ts` pins this by scoring the same
   * chunks in differently-composed batches and comparing.
   *
   * The TWO-STAGE FUNNEL is unchanged: a cheap bbox test over EVERY feature,
   * then the expensive work only for survivors. The bbox comes from the raw
   * inline positions, so a feature the user will never walk near is never
   * ring-stitched, never classified area-vs-line and never converted at all.
   * That matters at res 7: a fetch tile is estimated at **~40,000–116,000
   * features** and a working set needs a handful.
   *
   * ⚠️ **THIS IS A LINEAR SWEEP, AND THIS COMMENT USED TO SAY IT WAS "exactly
   * as the reference queries its quadtree".** It is not: a quadtree does not
   * visit every feature, and there is no tree here — every merged feature of
   * every held tile is bbox-tested on every scoring pass, and tiles are never
   * evicted, so the sweep grows for the whole session. The claim was the
   * sentence most likely to convince a reader that an index already exists.
   *
   * The sweep is defensible on cost — measured at ~1.1 ms across a res-7 tile's
   * features, so a tree "saves ~1 ms per move"
   * (`GpsPlusSlamJs_Docs/docs/2026-07-31-1005-osm-spatial-index-design.md` §1) —
   * and NOT defensible on capability: the same doc reframes the index as a
   * requirement for AR frame-loop queries, which this shape cannot answer at
   * all. That index was planned to ship (`…2026-08-10-0634-osm-spatial-index-build-plan.md`
   * §1: "`flatbush` ships, as a real `dependencies` entry"); the supporting
   * modules landed and the index did not, so `package.json` still has no
   * `dependencies` block. See
   * `GpsPlusSlamJs_Docs/docs/2026-08-13-2305-osm-spatial-structure-review-findings.md`.
   *
   * The ~21,800 this used to quote is RETRACTED (2026-08-09) — see
   * `resolutions.ts` FETCH_RES, which withdraws the 21,847-element figure, and
   * `GpsPlusSlamJs_Docs/docs/2026-08-09-1728-osm-spatial-index-build-cost-plan.md`
   * §14.4 for the three methods that bracket the replacement. The bracket is an
   * ESTIMATE: no fixture contains a full res-7 tile.
   */
  private scoreChunks(
    targets: readonly string[],
  ): Map<string, Readonly<ScoredChunk>> {
    const out = new Map<string, Readonly<ScoredChunk>>();
    if (targets.length === 0) return out;

    const { cellToChunk, buckets, selection } = planBatch(targets);

    for (const [key, feature] of this.features) {
      const rough = this.featureBounds(key, feature);
      if (rough === null) continue;
      if (!bboxesIntersect(rough, selection)) continue;

      const cached = this.featureGeometry(key, feature);
      if (cached === null) continue;

      // Coverage is computed against the CLIPPED geometry, so a continental
      // feature costs the working set rather than the planet. Same rule as
      // `buildFeatureIndex`, applied here because this path does not use it.
      const clipped = clipToBbox(cached.geometry, selection);
      if (clipped === undefined) continue;

      this.stats.cellsCovered += distribute(
        clipped,
        key,
        feature,
        cellToChunk,
        buckets,
      );
    }

    for (const target of targets) {
      const bucket = buckets.get(target);
      if (bucket === undefined) continue;
      out.set(target, this.publish(target, bucket.byCell, bucket.kept));
    }
    return out;
  }

  /** Scores one chunk's collected coverage and freezes the result. */
  private publish(
    chunk: string,
    byCell: Map<string, CellFeature[]>,
    kept: Map<OsmFeatureKey, OsmFeature>,
  ): Readonly<ScoredChunk> {
    const result = scoreCells(
      {
        byCell,
        byFeature: new Map(),
        features: kept,
        failed: [],
        resolution: AFFORDANCE_RES,
      },
      this.table,
      { categories: this.categories },
    );

    // FROZEN ON PUBLICATION, as the reference freezes a heat tile before
    // dispatching it into its immutable store (`MakeAllTilesImmutable`). A late
    // tile re-scores chunks while a consumer may still hold the previous
    // result; an in-place update would present as a stale UI rather than an
    // error, which is exactly what the reference's write barrier catches.
    return Object.freeze({
      chunk,
      cells: Object.freeze(result.cells),
      // THE TILES THAT CONTRIBUTED, derived from `kept` — not every tile held.
      // `acceptTile` invalidates a chunk when it overlaps the tile OR when the
      // chunk names it, so listing every held tile made the second branch fire
      // for every chunk on any refetch of a known tile, dropping the entire
      // cache regardless of geography. A `maxAgeMs` refresh is exactly that
      // refetch, so the bound this class advertises was lost on the normal path.
      tiles: Object.freeze([
        ...new Set(
          [...kept.keys()]
            .map((key) => this.featureTile.get(key)?.tile)
            .filter((t): t is string => t !== undefined),
        ),
      ]),
      featureCount: kept.size,
    });
  }

  /**
   * A feature's bounding box from its RAW inline positions.
   *
   * Deliberately not derived from the converted geometry: the whole point is to
   * answer "could this feature possibly touch that chunk?" without paying for
   * ring stitching, area-vs-line classification or hole assignment. `out geom`
   * inlines every coordinate, so the raw positions are already in hand.
   *
   * `null` means the feature carries no usable position at all — cached as such
   * so a malformed element is examined once rather than once per chunk.
   */
  private featureBounds(key: OsmFeatureKey, feature: OsmFeature): Bbox | null {
    const cached = this.bounds.get(key);
    if (cached !== undefined) return cached;

    const bbox = boundsOf(rawPositions(feature)) ?? null;
    this.bounds.set(key, bbox);
    return bbox;
  }

  /** Cached geometry for a feature, converting on first use. `null` = unusable. */
  private featureGeometry(
    key: OsmFeatureKey,
    feature: OsmFeature,
  ): FeatureGeometry | null {
    const cached = this.geometry.get(key);
    if (cached !== undefined) {
      this.stats.geometryReused++;
      return cached;
    }

    const converted = toGeometry(feature);
    if (!converted.ok) {
      // Remembered as a failure so a broken relation is not re-converted once
      // per chunk forever. The C# reference logs and moves on; caching the
      // negative is the same decision made once instead of every time.
      this.geometry.set(key, null);
      return null;
    }

    const bbox = boundsOf(positionsOf(converted.geometry));
    if (bbox === undefined) {
      this.geometry.set(key, null);
      return null;
    }

    const entry: FeatureGeometry = { geometry: converted.geometry, bbox };
    this.geometry.set(key, entry);
    this.stats.geometryBuilt++;
    return entry;
  }

  /**
   * Drops the chunks furthest from the current working set.
   *
   * Furthest-first rather than least-recently-used: the access pattern is
   * spatial, not temporal, and a chunk 500 m behind the user is dead weight
   * however recently it was read.
   */
  private evictBeyond(workingSet: readonly string[]): void {
    if (this.chunks.size <= this.maxChunks) return;
    const keep = new Set(workingSet);
    const centre = this.lastChunk;
    if (centre === undefined) return;

    const candidates = [...this.chunks.keys()]
      // PINNED CHUNKS ARE NOT CANDIDATES (round 9 §4, DEC-R9-11). An algorithm
      // reading around a point far from the user holds exactly the chunks this
      // sort puts first, and the demo calls `update` three times per action — so
      // without the exemption they would be scored, evicted and re-scored on
      // every ring.
      .filter((chunk) => !keep.has(chunk) && !this.pinned.has(chunk))
      .sort((a, b) => ringDistance(centre, b) - ringDistance(centre, a));

    for (const chunk of candidates) {
      if (this.chunks.size <= this.maxChunks) break;
      this.dropChunk(chunk);
      this.stats.chunksEvicted++;
    }

    // THE EXEMPTION HAS TO BE REPORTED, or it becomes the leak the cap exists to
    // prevent. Reaching here still over the cap means the un-evictable set —
    // pins plus the current working set — is larger than the cap allows. For one
    // candidate batch (~190 against 488) that cannot happen; several batches
    // held at once without releasing is a bug, and this is what makes it visible
    // rather than silent memory growth.
    if (this.chunks.size > this.maxChunks) {
      this.stats.pinnedOverCap = this.chunks.size - this.maxChunks;
    }
  }
}

/**
 * Files one feature's coverage into whichever chunk owns each covered cell.
 *
 * Cells outside the batch are dropped here: covering the union produces the
 * whole rectangle, and only the cells belonging to a chunk being scored are
 * wanted. A feature lands in `kept` for a chunk only if it actually reached one
 * of that chunk's cells, which is what keeps `ScoredChunk.tiles` per-chunk.
 *
 * **Returns how many cells the cover produced**, i.e. the count BEFORE that
 * drop. See `stats.cellsCovered`: the gap between this and what survives is the
 * price of clipping to a bounding box, and it was previously unobservable.
 */
function distribute(
  geometry: OsmGeometry,
  key: OsmFeatureKey,
  feature: OsmFeature,
  cellToChunk: ReadonlyMap<string, string>,
  buckets: ReadonlyMap<string, ChunkBucket>,
): number {
  let covered = 0;
  for (const coverage of coverCells(geometry, AFFORDANCE_RES)) {
    covered += 1;
    const owner = cellToChunk.get(coverage.cell);
    if (owner === undefined) continue;
    const bucket = buckets.get(owner);
    if (bucket === undefined) continue;

    const entry: CellFeature = { feature: key, fraction: coverage.fraction };
    const cell = bucket.byCell.get(coverage.cell);
    if (cell === undefined) bucket.byCell.set(coverage.cell, [entry]);
    else cell.push(entry);
    bucket.kept.set(key, feature);
  }
  return covered;
}

/** One chunk's collected coverage, before it is scored. */
interface ChunkBucket {
  byCell: Map<string, CellFeature[]>;
  kept: Map<OsmFeatureKey, OsmFeature>;
}

/**
 * The per-batch lookup tables `scoreChunks` needs, built in one walk.
 *
 * Split out of `scoreChunks` to keep it under the complexity ratchet, and it
 * reads better besides: this is the "what are we scoring" half, and what
 * remains there is the "walk the features" half.
 *
 * `cellToChunk` is a PARTITION — `childCells` of distinct res-11 chunks are
 * disjoint — which is what lets a single coverage pass be bucketed per chunk
 * without any cell being double-counted. `selection` is the union of the
 * per-chunk padded boxes, so clipping against it can only ever be looser than
 * clipping per chunk, and clipping looser cannot change the covered area of a
 * cell that lies inside both.
 */
function planBatch(targets: readonly string[]): {
  cellToChunk: Map<string, string>;
  buckets: Map<string, ChunkBucket>;
  selection: Bbox;
} {
  const cellToChunk = new Map<string, string>();
  const buckets = new Map<string, ChunkBucket>();

  for (const target of targets) {
    for (const cell of childCells(target)) cellToChunk.set(cell, target);
    buckets.set(target, { byCell: new Map(), kept: new Map() });
  }

  return { cellToChunk, buckets, selection: selectionBoxFor(targets) };
}

/**
 * The box a batch of chunks is clipped and selected against.
 *
 * **EXPORTED SO A TEST CAN ASK THE REAL QUESTION** (r514 review).
 * `oversize-feature-guard.test.ts` asserts that this box stays ~1.8x the area
 * of the chunks inside it — the claim that the union-padding is amortised, and
 * the reason a feature larger than the batch stays affordable. It had a private
 * COPY of this loop and of {@link CHUNK_MARGIN_DEG}, so the one production knob
 * the assertion exists to guard was the one it could not see: raising the margin
 * would grow the real box while the test kept measuring 0.0005 and passing.
 *
 * **The margin itself stays module-private.** Exporting it was the cheaper half
 * of the same fix and is redundant once this function exists — the test needs
 * the box, not the constant — and `check:deadcode` refuses the unused export,
 * which is the right answer.
 *
 * The union is a BOUNDING BOX, not a union of shapes, which is why the cost of
 * a batch grows with its SPREAD rather than with its chunk count. That is
 * harmless for the compact disc `update` passes and is an open question for the
 * scattered set `ensureScored` can receive — see the test's header.
 */
export function selectionBoxFor(chunks: readonly string[]): Bbox {
  let bounds: Bbox | undefined;
  for (const chunk of chunks) {
    const padded = padBbox(chunkBbox(chunk), CHUNK_MARGIN_DEG);
    bounds =
      bounds === undefined
        ? padded
        : {
            south: Math.min(bounds.south, padded.south),
            west: Math.min(bounds.west, padded.west),
            north: Math.max(bounds.north, padded.north),
            east: Math.max(bounds.east, padded.east),
          };
  }

  if (bounds === undefined) {
    throw new Error("selectionBoxFor needs at least one chunk");
  }
  return bounds;
}

/**
 * Every res-13 child of a res-11 chunk.
 *
 * DELIBERATELY NOT MEMOISED. It was, in a module-level `Map` with no eviction —
 * which contradicted this class's own stated bound ("an unbounded cache on a
 * user who walks all day is a leak with a slow fuse"), outlived the instance,
 * and was shared between instances and across a whole test run. At 49 res-13
 * ids per chunk, a day's walk through 20k chunks interns ~1M strings that
 * `evictBeyond` could never reach, because it drops the chunk and not the data
 * derived from it.
 *
 * The memoisation bought nothing worth that: measured at **9.1 µs per call**,
 * against a `scoreChunk` that bbox-tests every one of a tile's features in the
 * same pass — an estimated ~40,000–116,000 of them, the ~21,800 once quoted
 * here being retracted (see `scoreChunks`). The comparison is unaffected: the
 * bbox sweep is the larger term at either count.
 * The result is also used only as a membership `Set` inside a
 * single `scoreChunk` call, so it has no reason to outlive it.
 *
 * Note `cellToChildren` is an INDEX partition, not a geometric one — a child can
 * lie slightly outside its parent — which is why `scoreChunk` also pads the bbox
 * it selects features with.
 */
function childCells(chunk: string): string[] {
  return cellToChildren(chunk, AFFORDANCE_RES);
}

/**
 * Every position a feature carries, straight off the wire.
 *
 * The cheap counterpart to `positionsOf`, which needs a converted geometry.
 * `out geom` inlines member coordinates on ways and relations, so a bbox is
 * available without deciding whether the feature is an area, without stitching
 * rings and without assigning holes — which is the entire cost this avoids.
 */
function* rawPositions(feature: OsmFeature): Generator<LatLng> {
  switch (feature.type) {
    case "node":
      yield feature.position;
      return;
    case "way":
      yield* feature.geometry;
      return;
    case "relation":
      for (const member of feature.members) {
        if (member.position !== undefined) yield member.position;
        if (member.geometry !== undefined) yield* member.geometry;
      }
  }
}

/**
 * How many grid steps apart two cells of the same resolution are.
 *
 * **CORRECTED FROM a `gridDisk` ring scan that SATURATED** (2026-08-10). It
 * looped `ring <= SCORE_DISK_RADIUS + 1` and returned a constant for anything
 * further, so every chunk past ring 3 compared EQUAL. `evictBeyond` sorts by
 * this; ties are stable and its candidate array is `Map` insertion order, so
 * "furthest-first" silently degraded to **oldest-first past ~198 m** — the
 * opposite of what its docstring promises, and worst exactly where the promise
 * matters. Reported from London as heat-map cells clearing right after a short
 * jump: the ground just walked away from is the oldest, so it went first while
 * chunks five to twenty times further away stayed.
 *
 * `gridDistance` is exact and has no cap. It **throws** for cells whose
 * relationship H3 cannot express in its local IJ coordinates — across a
 * pentagon, or very far apart — and the honest answer there is "further than
 * anything measurable", so a failure sorts to the front of the eviction queue
 * rather than being silently treated as adjacent. `cell-coverage.ts` catches
 * around `gridPathCells` for the same reason.
 */
function ringDistance(from: string, to: string): number {
  if (from === to) return 0;
  try {
    return gridDistance(from, to);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function cellBbox(cell: string): Bbox {
  const boundary = cellToBoundary(cell).map(([lat, lng]) => ({ lat, lng }));
  const bbox = boundsOf(boundary);
  if (bbox === undefined) {
    throw new Error(`Cell ${cell} has no boundary — is it a valid H3 index?`);
  }
  return bbox;
}

/**
 * A chunk's bbox. Uncached, for the same reason as `childCells` above.
 *
 * The cache this replaces was module-level and unbounded, growing per chunk
 * while `evictBeyond` dropped the chunks themselves. Measured cost of the call
 * it avoided: **2.55 µs**. Its hottest caller is `acceptTile`, which runs it
 * once per held chunk — bounded by {@link DEFAULT_MAX_CHUNKS} — behind a
 * network fetch measured in tens of seconds.
 *
 * The bound is named rather than written out because it is DERIVED. This
 * comment said "at most 256" until 2026-08-11, which was the hard-coded cap W7
 * replaced precisely because a widened scored disk left it thrashing.
 */
function chunkBbox(chunk: string): Bbox {
  return cellBbox(chunk);
}

function tileBbox(tile: string): Bbox {
  return cellBbox(tile);
}

/**
 * Does tile beat the tile that currently owns a key?
 *
 * The same total order compareTiles sorts by in mergeTiles - ascending
 * fetchedAt, tie-broken by tile id - read as "sorts later, so its write lands
 * last". Written here rather than imported because the merge compares whole
 * tiles while this compares a tile against a recorded PROVENANCE entry;
 * affordance-index.test.ts pins that the two agree.
 */
function outranks(
  tile: { readonly fetchedAt: number; readonly tile: string },
  owner: FeatureProvenance,
): boolean {
  if (tile.fetchedAt !== owner.fetchedAt) {
    return tile.fetchedAt > owner.fetchedAt;
  }
  return tile.tile > owner.tile;
}
