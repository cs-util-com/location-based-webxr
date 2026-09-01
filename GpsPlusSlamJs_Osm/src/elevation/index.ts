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
