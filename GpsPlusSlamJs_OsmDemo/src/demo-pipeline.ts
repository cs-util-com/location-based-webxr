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
} from 'gps-plus-slam-osm';
import { fetchTilesForScoreWorkingSet, toScoreChunk } from 'gps-plus-slam-osm';
import { latLngToCell } from 'h3-js';
import { SCORE_CHUNK_RES } from 'gps-plus-slam-osm';

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
  readonly stats: {
    readonly chunksScored: number;
    readonly chunksReused: number;
    readonly geometryBuilt: number;
  };
}

/**
 * Owns an `AffordanceIndex` and the fetches that feed it.
 *
 * Deliberately NOT a store or an event emitter: the demo redraws on demand, and
 * a second abstraction between the index and the map would only obscure which
 * of the two produced a wrong answer.
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
        : { table: options.table, categories: options.categories }
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
  async update(position: LatLng, category: string): Promise<DemoSnapshot> {
    const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
    const missingTiles: string[] = [];

    for (const tile of fetchTilesForScoreWorkingSet(chunk)) {
      if (this.loaded.has(tile)) continue;
      try {
        const result: OsmTileResult = await this.source.fetchTile(tile);
        this.loaded.add(tile);
        this.index.acceptTile(result);
      } catch {
        missingTiles.push(tile);
      }
    }

    this.index.update(position);

    const threshold = thresholdFor(this.table, category);
    const scoresByCell = this.index.scoresByCell();
    const above = cellsAboveThreshold(
      { cells: [...scoresByCell.values()], unmappedTagCounts: {}, lookups: 0 },
      category,
      threshold
    );
    const regions = buildRegions(
      connectedComponents(above),
      category,
      scoresByCell
    );

    return {
      position,
      category,
      threshold,
      cells: [...scoresByCell.values()],
      regions,
      missingTiles,
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

  /** The res-11 chunk a position falls in — shown so the grid is legible. */
  static chunkFor(position: LatLng): string {
    return toScoreChunk(latLngToCell(position.lat, position.lng, 13));
  }
}
