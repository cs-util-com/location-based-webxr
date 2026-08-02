/**
 * Places module — the corpus of sites the demo is tested and demonstrated at.
 */

export type { CorpusSite, CorpusTrait } from "./sites.js";
export { CORPUS_SITES, siteById } from "./sites.js";

// §6: the pure half of the GeoEvent port. See geo-event.ts.md.
export type { ClimbResult, GeoBounds } from "./geo-event.js";
export {
  QUARTER_HOUR_MS,
  climbToLocalMaximum,
  eventCandidates,
  nextEventTime,
} from "./geo-event.js";
