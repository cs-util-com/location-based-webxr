/**
 * Elevation module — the provider seam, Terrarium rasters, a point fallback,
 * and the geoid conversion.
 */

export type {
  ElevationProvider,
  FallbackElevationProvider,
  FallbackProviderStats,
} from "./elevation-provider.js";
export {
  NullElevationProvider,
  consensusProvider,
  fallbackProvider,
} from "./elevation-provider.js";
// Re-exported from this barrel because that is where consumers have always
// found it; the implementation moved to the package's `utils/` when the
// second copy in `regions/` was folded in.
export { median } from "../utils/median.js";

export type {
  Heights,
  RacingElevationProvider,
  RacingProviderOptions,
  RacingProviderStats,
} from "./racing-provider.js";
export { racingProvider } from "./racing-provider.js";

export type {
  WorldPixel,
  DecodedImage,
  ElevationTile,
  PngDecoder,
  TerrariumProviderOptions,
  TilePixel,
} from "./terrarium.js";
export {
  fromWorldPixel,
  toWorldPixel,
  DEFAULT_TERRARIUM_ZOOM,
  MAPTERHORN_ATTRIBUTION,
  MAPTERHORN_URL_TEMPLATE,
  TERRARIUM_ATTRIBUTION,
  TERRARIUM_URL_TEMPLATE,
  TerrariumProvider,
  browserPngDecoder,
  decodeTerrarium,
  sampleTile,
  toElevationTile,
  toTilePixel,
} from "./terrarium.js";

export type {
  CachingTileFetch,
  CachingTileFetchOptions,
  CachingTileFetchStats,
} from "./caching-tile-fetch.js";
export { createCachingTileFetch } from "./caching-tile-fetch.js";

export type { OpenTopoDataOptions } from "./opentopodata-provider.js";
export {
  OPENTOPODATA_ATTRIBUTION,
  OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST,
  OPENTOPODATA_MIN_REQUEST_INTERVAL_MS,
  OpenTopoDataProvider,
  TooManyElevationPointsError,
} from "./opentopodata-provider.js";

export type { GeoidModel, UndulationGrid } from "./geoid.js";
export {
  ZERO_GEOID,
  constantGeoid,
  describeGeoid,
  gridGeoid,
  toEllipsoidal,
  toOrthometric,
} from "./geoid.js";

// The terrain height field (moved from OsmDemo with the globe city's library
// validation, globe city plan 2026-10-05-0040 §14 L1): a window of posts
// sampled from a provider around a frame, read in ENU metres.
export type {
  Heightfield,
  HeightfieldData,
  HeightfieldOptions,
} from "./heightfield.js";
export {
  NEAR_FIELD_M,
  TERRAIN_EXTENT_M,
  TERRAIN_SPACING_M,
  buildHeightfield,
  buildHeightfieldData,
  createHeightfieldCache,
  heightfieldFrom,
  peakToTrough,
} from "./heightfield.js";
export type { TerrainField, TerrainFieldOptions } from "./terrain-field.js";
export {
  absoluteDatumFor,
  createTerrainField,
  latticeWindow,
} from "./terrain-field.js";
export type { TerrainWindow, TerrainWindowOptions } from "./terrain-window.js";
export { FETCH_SLACK, terrainWindowFor } from "./terrain-window.js";
