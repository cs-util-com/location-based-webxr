/**
 * Spatial module — the H3 resolution ladder and cell-coverage indexing.
 */

export {
  EVENT_TILE_RES,
  FETCH_RES,
  SCORE_CHUNK_RES,
  AFFORDANCE_RES,
  FETCH_DISK_RADIUS,
  SCORE_DISK_MAX_RADIUS,
  SCORE_DISK_RADIUS,
  RES13_CELLS_PER_CHUNK,
  AFFORDANCE_CELL_AREA_M2,
  toEventTile,
  toFetchTile,
  toScoreChunk,
  fetchWorkingSet,
  scoreWorkingSet,
  fetchTilesForScoreWorkingSet,
} from "./resolutions.js";

export type { MergedTiles, FeatureProvenance } from "./merge-tiles.js";
export { mergeTiles } from "./merge-tiles.js";

export { cellsOfChunks } from "./chunk-cells.js";

export type { Bbox } from "./clip.js";
export {
  clipToBbox,
  boundsOf,
  positionsOf,
  padBbox,
  bboxesIntersect,
  metresToDegrees,
} from "./clip.js";

export type { CellCoverage } from "./cell-coverage.js";
export { coverCells, dilate, cellCentre } from "./cell-coverage.js";

export type {
  H3FeatureIndex,
  CellFeature,
  BuildIndexOptions,
} from "./h3-feature-index.js";
export {
  buildFeatureIndex,
  featuresAt,
  indexEntryCount,
} from "./h3-feature-index.js";
