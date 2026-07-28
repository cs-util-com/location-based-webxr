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

import { cellToBoundary, cellToChildren, gridDisk, latLngToCell } from "h3-js";

import type {
  LatLng,
  OsmFeature,
  OsmFeatureKey,
} from "../model/osm-feature.js";
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
import {
  AFFORDANCE_RES,
  SCORE_CHUNK_RES,
  SCORE_DISK_RADIUS,
  scoreWorkingSet,
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
 */
const CHUNK_MARGIN_DEG = 0.0005;

/** Default cap on retained scored chunks. */
const DEFAULT_MAX_CHUNKS = 256;

export interface AffordanceIndexOptions {
  readonly table: RuleTable;
  /** Defaults to every category the table declares. */
  readonly categories?: readonly string[];
  /**
   * Chunks retained before the furthest-from-the-user are dropped.
   *
   * 256 res-11 chunks is ~13 working sets, i.e. a few hundred metres of walking
   * before anything is recomputed. Bounded because an unbounded cache on a
   * user who walks all day is a leak with a slow fuse.
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
  private readonly listeners = new Set<ChangeListener>();

  /** The user's last res-11 cell. The `oldUserTile` short-circuit. */
  private lastChunk: string | undefined;

  readonly stats = {
    chunksScored: 0,
    chunksReused: 0,
    chunksEvicted: 0,
    geometryBuilt: 0,
    geometryReused: 0,
    /** Times `update` returned without scoring because the chunk was the same. */
    movesIgnored: 0,
  };

  constructor(options: AffordanceIndexOptions) {
    this.table = options.table;
    this.categories = options.categories ?? options.table.categories;
    this.maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
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
    this.tiles.set(tile.tile, tile);

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

    // Every chunk that overlaps the tile is suspect, whether or not it names
    // the tile: a chunk scored before this tile arrived recorded its absence.
    const bbox = tileBbox(tile.tile);
    const invalidated: string[] = [];
    for (const [chunk, scored] of this.chunks) {
      const overlaps = bboxesIntersect(bbox, chunkBbox(chunk));
      if (!overlaps && !scored.tiles.includes(tile.tile)) continue;
      this.chunks.delete(chunk);
      invalidated.push(chunk);
    }

    // Force the next `update` to do work even if the user has not moved: the
    // short-circuit is about the USER's position, and the world just changed.
    if (invalidated.length > 0) this.lastChunk = undefined;

    if (invalidated.length > 0) this.notify(invalidated);
    return invalidated;
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
  update(position: LatLng): UpdateResult {
    const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
    const workingSet = scoreWorkingSet(chunk);

    if (chunk === this.lastChunk) {
      this.stats.movesIgnored++;
      return { workingSet, scored: [], reused: workingSet };
    }
    this.lastChunk = chunk;

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
        continue;
      }
      this.chunks.set(target, this.scoreChunk(target));
      scored.push(target);
      this.stats.chunksScored++;
    }

    this.evictBeyond(workingSet);
    return { workingSet, scored, reused };
  }

  /** A scored chunk, if it is currently held. */
  chunk(chunk: string): ScoredChunk | undefined {
    return this.chunks.get(chunk);
  }

  /** Every currently-held scored chunk. */
  scoredChunks(): readonly ScoredChunk[] {
    return [...this.chunks.values()];
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

  /** Cell id → its score record, across every held chunk. */
  scoresByCell(): Map<string, CellScore> {
    const byCell = new Map<string, CellScore>();
    for (const scored of this.chunks.values()) {
      for (const cell of scored.cells) byCell.set(cell.cell, cell);
    }
    return byCell;
  }

  /** Features currently merged in, for callers that need the raw data. */
  mergedFeatures(): ReadonlyMap<OsmFeatureKey, OsmFeature> {
    return this.features;
  }

  private notify(chunks: readonly string[]): void {
    for (const listener of this.listeners) listener(chunks);
  }

  /**
   * Scores one chunk from the features whose bbox reaches it.
   *
   * The bbox pre-selection is what keeps this proportional to the chunk rather
   * than to the loaded world: a res-7 tile holds ~21,800 features and a chunk
   * needs a handful of them. Comparing four numbers per feature is far cheaper
   * than converting geometry, which is why geometry is cached and the bbox test
   * is not.
   */
  private scoreChunk(chunk: string): ScoredChunk {
    const bounds = padBbox(chunkBbox(chunk), CHUNK_MARGIN_DEG);
    const cells = new Set(gridDisk(chunk, 0).flatMap((c) => childCells(c)));

    // TWO-STAGE FUNNEL, exactly as the reference queries its quadtree: a cheap
    // bbox test over EVERY feature, then the expensive work only for survivors.
    // The bbox comes from the raw inline positions, so a feature the user will
    // never walk near is never ring-stitched, never classified area-vs-line and
    // never converted at all. That matters at res 7: a fetch tile holds ~21,800
    // features and a chunk needs a handful.
    const byCell = new Map<string, CellFeature[]>();
    const kept = new Map<OsmFeatureKey, OsmFeature>();

    for (const [key, feature] of this.features) {
      const rough = this.featureBounds(key, feature);
      if (rough === null) continue;
      if (!bboxesIntersect(rough, bounds)) continue;

      const cached = this.featureGeometry(key, feature);
      if (cached === null) continue;

      // Coverage is computed against the CLIPPED geometry, so a continental
      // feature costs the chunk rather than the planet. Same rule as
      // `buildFeatureIndex`, applied here because this path does not use it.
      const clipped = clipToBbox(cached.geometry, bounds);
      if (clipped === undefined) continue;

      let landed = false;
      for (const coverage of coverCells(clipped, AFFORDANCE_RES)) {
        if (!cells.has(coverage.cell)) continue;
        const entry: CellFeature = {
          feature: key,
          fraction: coverage.fraction,
        };
        const bucket = byCell.get(coverage.cell);
        if (bucket === undefined) byCell.set(coverage.cell, [entry]);
        else bucket.push(entry);
        landed = true;
      }
      if (landed) kept.set(key, feature);
    }

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
      .filter((chunk) => !keep.has(chunk))
      .sort((a, b) => ringDistance(centre, b) - ringDistance(centre, a));

    for (const chunk of candidates) {
      if (this.chunks.size <= this.maxChunks) break;
      this.chunks.delete(chunk);
      this.stats.chunksEvicted++;
    }
  }
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
 * against a `scoreChunk` that bbox-tests every one of a tile's ~21,800 features
 * in the same pass. The result is also used only as a membership `Set` inside a
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

/** How many grid steps apart two cells of the same resolution are, capped. */
function ringDistance(from: string, to: string): number {
  if (from === to) return 0;
  for (let ring = 1; ring <= SCORE_DISK_RADIUS + 1; ring++) {
    if (gridDisk(from, ring).includes(to)) return ring;
  }
  return SCORE_DISK_RADIUS + 2;
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
 * once per held chunk — at most 256 — behind a network fetch measured at 18 s.
 */
function chunkBbox(chunk: string): Bbox {
  return cellBbox(chunk);
}

function tileBbox(tile: string): Bbox {
  return cellBbox(tile);
}
