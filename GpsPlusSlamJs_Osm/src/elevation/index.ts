/**
 * Elevation module — the provider seam, Terrarium rasters, a point fallback,
 * and the geoid conversion.
 */

export type { ElevationProvider } from "./elevation-provider.js";
export {
  NullElevationProvider,
  consensusProvider,
  median,
} from "./elevation-provider.js";

export type {
  DecodedImage,
  ElevationTile,
  PngDecoder,
  TerrariumProviderOptions,
  TilePixel,
} from "./terrarium.js";
export {
  DEFAULT_TERRARIUM_ZOOM,
  TERRARIUM_ATTRIBUTION,
  TERRARIUM_URL_TEMPLATE,
  TerrariumProvider,
  browserPngDecoder,
  decodeTerrarium,
  sampleTile,
  toElevationTile,
  toTilePixel,
} from "./terrarium.js";

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
