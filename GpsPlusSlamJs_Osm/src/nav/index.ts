/**
 * Navigation module — the state model an agent moves through.
 */

export type { Column } from "./column.js";
export { columnsAdjacent, STEP_THRESHOLD_M } from "./column.js";

export type { StateSpace, SearchOptions } from "./search.js";
export {
  findStatePath,
  reachableStates,
  DEFAULT_MAX_EXPANSIONS,
} from "./search.js";

export type { ColumnSpaceOptions } from "./column-space.js";
export { columnSpace, columnKey } from "./column-space.js";

export type { PathOptions } from "./path.js";
export { findPath, reachableFrom } from "./path.js";
