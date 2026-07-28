/**
 * Spatial module — the H3 resolution ladder and cell-coverage indexing.
 */

export {
  FETCH_RES,
  SCORE_CHUNK_RES,
  AFFORDANCE_RES,
  FETCH_DISK_RADIUS,
  SCORE_DISK_RADIUS,
  RES13_CELLS_PER_CHUNK,
  AFFORDANCE_CELL_AREA_M2,
  toFetchTile,
  toScoreChunk,
  fetchWorkingSet,
  scoreWorkingSet,
} from "./resolutions.js";
