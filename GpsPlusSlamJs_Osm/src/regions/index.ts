/**
 * Regions module — contiguous above-threshold cells with exact outlines.
 */

export { connectedComponents } from "./connected-components.js";

export type { Region } from "./region-builder.js";
export { buildRegion, buildRegions, regionId } from "./region-builder.js";
