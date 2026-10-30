/**
 * The globe's whole view for an app (the full-globe editor plan
 * 2026-10-27-1850, GV1b): the view core, its camera controls and the
 * defaults a page sets it up with. Re-exports only; each block's own
 * module and sidecar hold its rules and tests. Apart from `./editor`
 * because this one carries the whole-Earth imagery and the sky: an app
 * reaches it only through a lazy import.
 *
 * @see globe-view-entry.ts.md
 */
export {
  createGlobeView,
  type GlobeView,
  type GlobeViewPose,
  type GlobeViewSettings,
} from "./globe-view.js";
export {
  createGlobeCameraControls,
  type GlobeCameraControls,
} from "./globe-camera-controls.js";
export { GLOBE_CLOUD_DRIFT_LAW } from "./globe-cloud-drift.js";
export { GLOBE_CLOUD_DRIFT_DEG_PER_S } from "./globe-surface-material.js";
export { creditsFor } from "./globe-credits.js";
// The air (the blue sky below the hand-over, the haze, the halo): the view
// core draws only the sun disc, the stars and navy space.
export { mountGlobeViewAir, type GlobeViewAir } from "./globe-view-air.js";
