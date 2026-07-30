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
  type LatLng,
} from "gps-plus-slam-osm";
import { fetchTilesForScoreWorkingSet } from "gps-plus-slam-osm";
import { latLngToCell } from "h3-js";
import { SCORE_CHUNK_RES } from "gps-plus-slam-osm";

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
  readonly stats: {
    readonly chunksScored: number;
    readonly chunksReused: number;
    readonly geometryBuilt: number;
  };
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
  ): Promise<DemoSnapshot> {
    const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
    const missingTiles: string[] = [];

    for (const tile of fetchTilesForScoreWorkingSet(chunk)) {
      if (this.loaded.has(tile)) continue;
      // CHECKED PER TILE, which is the granularity that matters: a tile is
      // 28-68 MB, so stopping between tiles is most of the saving available from
      // abort at all. Once the worker's caller has moved on, continuing to pull
      // tiles for a position the user has left is exactly the waste the fetch
      // discipline exists to avoid.
      //
      // Deliberately NOT threaded into `fetchTile` itself — that would need an
      // `AbortSignal` through `OsmDataSource`, `CachingSource` and
      // `OverpassSource`, which is a package API change and its own piece of
      // work. Recorded as a follow-up; the in-flight request still completes.
      if (signal?.aborted === true) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        const result: OsmTileResult = await this.source.fetchTile(tile);
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

    this.index.update(position);

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

    return {
      position,
      category,
      threshold,
      cells: [...scoresByCell.values()],
      regions,
      missingTiles,
      loadedTiles: [...this.loaded],
      stats: {
        chunksScored: this.index.stats.chunksScored,
        chunksReused: this.index.stats.chunksReused,
        geometryBuilt: this.index.stats.geometryBuilt,
      },
    };
  }

  /** The features currently merged in, for the 3D view. */
  features() {
    return this.index.mergedFeatures();
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
