/**
 * `gps-plus-slam-osm` — OpenStreetMap → H3 affordance index.
 *
 * Pure data: no Three.js, no AR, no framework dependency, and the only runtime
 * dependency is `h3-js` (a peer). Persistence and workers are injected by the
 * consumer, never imported here.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-07-28-0624-osm-h3-affordance-index-plan.md
 */

export * from "./model/index.js";
export * from "./spatial/index.js";
export * from "./source/index.js";
