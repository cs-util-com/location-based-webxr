/**
 * Source module — data acquisition. The only place that touches the network.
 */

export type { OsmDataSource, OsmTileResult } from "./osm-data-source.js";
export { OSM_ATTRIBUTION } from "./osm-data-source.js";

export type { OsmBlobStore } from "./osm-blob-store.js";
export { MemoryBlobStore } from "./memory-blob-store.js";

export type { BoundingBox } from "./overpass-query.js";
export {
  buildTileQuery,
  cellToBoundingBox,
  AntimeridianCellError,
  OVERPASS_SCHEMA_VERSION,
} from "./overpass-query.js";

export type { BackoffOptions } from "./backoff.js";
export {
  RETRYABLE_STATUSES,
  backoffDelayMs,
  parseRetryAfterMs,
  nextDelayMs,
  sleep,
} from "./backoff.js";

export type { OverpassStatus } from "./overpass-status.js";
export {
  parseOverpassStatus,
  msUntilNextSlot,
  OverpassStatusParseError,
} from "./overpass-status.js";

export type { SlotBudgetOptions } from "./slot-budget.js";
export { OverpassSlotBudget } from "./slot-budget.js";

export type { OverpassSourceOptions } from "./overpass-source.js";
export {
  OverpassSource,
  PermanentOverpassError,
  DEFAULT_OVERPASS_ENDPOINTS,
} from "./overpass-source.js";

export type { CachingSourceOptions, EnsureOptions } from "./caching-source.js";
export { CachingSource } from "./caching-source.js";

export type { OsmFixture, FixtureSourceOptions } from "./fixture-source.js";
export { FixtureSource } from "./fixture-source.js";
