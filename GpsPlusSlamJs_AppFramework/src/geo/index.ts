/**
 * Geo module — H3-based proximity matching for geo-anchored points.
 */

export {
  H3_RESOLUTION,
  type KnownGeoAnchor,
  approxDistanceMetres,
  gpsToH3,
  gpsPathToCoverageCells,
  clusterCellsByZoom,
  findNearbyGeoAnchor,
  h3CellsMatch,
  isH3Index,
} from './h3-proximity.js';

export {
  calculateSunPosition,
  sunCalcAnglesToNue,
  type NueDirection,
  type SunPositionResult,
} from './sun-position.js';

export {
  sunAltitudeToLighting,
  type SunLightingResult,
  type LightColor,
} from './sun-altitude-lighting.js';

export {
  createRealSunDataAdapter,
  type RealSunDataAdapter,
  type RealSunDataAdapterOptions,
  type RealSunDataState,
  type RealSunSample,
  type SunInputSelection,
  type SunLocationSource,
  type SunTimeSource,
} from './real-sun-data-adapter.js';
