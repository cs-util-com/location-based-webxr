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
  globeViewFitM,
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
// The whole-Earth imagery, for a relief that draws the globe's own ground
// under the camera (one overlay per carrier: each keeps its own textures).
export { createGlobeImagery } from "./globe-surface.js";
export { GIBS_ACKNOWLEDGEMENT } from "./globe-sources.js";
// The air (the blue sky below the hand-over, the haze, the halo): the view
// core draws only the sun disc, the stars and navy space.
export { mountGlobeViewAir, type GlobeViewAir } from "./globe-view-air.js";
// The relief under the globe's surface: the band between the two carriers.
export { mountGlobeRelief } from "./globe-relief-mount.js";
export { GLOBE_VIEW_CLOUDS, globeViewClouds } from "./globe-view-clouds.js";
// The city (OSM's buildings, trees and roads) in the globe's scene, built
// in an app's worker (`./city-worker`), and its per-frame step.
export {
  createGlobeCity,
  type GlobeCity,
  type GlobeCityState,
} from "./globe-city.js";
export { createGlobeCityStep, type GlobeCityStep } from "./globe-city-step.js";
// The approach: the globe's own pin flight (a meteor from far out down to a
// place) and the frame loop's drive, for a page that lands on a place.
export { createGlobeApproach } from "./globe-approach.js";
export { createGlobeLandingFlight } from "./globe-landing-flight.js";
export {
  createApproachDrive,
  createFovReturn,
} from "./globe-approach-camera.js";
export { METEOR_PACE, PIN_FLIGHT, pinEnd } from "./pin-flight.js";
// The zoom-out limit the controls hold and the intro's farthest distance:
// a page starts its approach there, as the lab's intro does.
export { globeZoomOutLimitM } from "./globe-zoom-limit.js";
export { GLOBE_INTRO } from "./globe-intro.js";
// The speed dust: streaks pouring past the camera at speed, the lab's look.
export {
  SPEED_DUST_LOOK,
  createSpeedDustPass,
  type SpeedDustPass,
} from "./globe-speed-dust-pass.js";
