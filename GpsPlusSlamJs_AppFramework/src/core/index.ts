/**
 * Curated re-export surface of `gps-plus-slam-js` (the closed-source core
 * library) for app consumers of `gps-plus-slam-app-framework`.
 *
 * Apps should import core symbols from here rather than from `gps-plus-slam-js`
 * directly so that:
 *   - Apps need only one direct npm dependency (the framework). The core is
 *     declared as a regular `dependency` of the framework, so every package
 *     manager installs it automatically — see
 *     2026-05-01-app-single-package-dep-analysis.md (Option C).
 *   - The framework can curate which core symbols are part of the public app
 *     surface, providing a real architectural boundary.
 *   - Coordinated releases only need to update the framework's dependency range,
 *     not pin sites scattered across every app `package.json`.
 *
 * Library-only consumers (no framework) can still depend on `gps-plus-slam-js`
 * directly; this barrel does not replace it.
 *
 * NOTE on `RootState`: the library exports a type named `RootState` that
 * refers to the *core* store's state shape. The framework also exports a
 * `RootState` that refers to the *framework* (recorder) store's state shape.
 * To avoid a name collision we re-export the library's type as both
 * `RootState` (here, in this dedicated namespace) and as `LibraryRootState`
 * (a convenience alias for tests that want to disambiguate at the import
 * site). Import as:
 *
 *   import { type LibraryRootState } from 'gps-plus-slam-app-framework/core';
 */

export {
  // Coordinate transforms
  webxrToNUE,
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  isIdentityMatrix4,

  // AbsoluteOrientationSensor heading kernels (Phase 1). magneticHeadingFromEnuQuat
  // returns the same magnetic heading the v3 absolute-compass demo shows — used
  // for the recorder's live AbsCompass HUD read-out.
  magneticHeadingFromEnuQuat,
  arNorthBearingDeg,
  bearingDeltaDeg,

  // Actions
  odometryTrackingRestarted,

  // Live loop-closure handler factory (2026-07-06 recorder wiring): feed raw
  // WebXR poses per frame; dispatches arLoopClosureDetected on a >1 m jump so
  // recordings finally capture loop closures. Gated by the operator's
  // `loopClosureDebug.detectorEnabled` recording option (default OFF).
  createLoopClosureHandler,

  // Store factory (test/integration use)
  createGpsSlamStore,

  // License activation (used by app tests that exercise licensed math)
  validateLicenseKey,
} from 'gps-plus-slam-js';

export type {
  // Geometry tuples
  Vector3,
  Quaternion,
  Matrix4,

  // GPS types
  LatLong,
  LatLongAlt,
  GpsPoint,

  // Frame-tile payload (used by the recorder's frame-tile visualizer
  // subscriber; see 2026-05-27 collapse-refpoint-and-frame-slices plan).
  ArImageCapture,

  // Live loop-closure handler contract (see createLoopClosureHandler above)
  LoopClosureHandler,
  LoopClosureHandlerConfig,

  // Library root state (renamed to avoid collision with framework RootState)
  RootState as LibraryRootState,
} from 'gps-plus-slam-js';

// Also re-export the library RootState under its original name for callers
// that import from this dedicated subpath and don't need disambiguation.
export type { RootState } from 'gps-plus-slam-js';
