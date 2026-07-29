/**
 * Score module — the multiplicative affordance kernel and its provenance.
 */

export type {
  CellScore,
  ScoreOptions,
  ScoreResult,
} from "./affordance-scorer.js";
export {
  scoreFeature,
  scoreCells,
  cellsAboveThreshold,
  debugUrlForKey,
} from "./affordance-scorer.js";
export type {
  CellExplanation,
  FeatureExplanation,
  TagContribution,
} from "./explain-cell.js";
export { explainCell } from "./explain-cell.js";
export type {
  AffordanceIndexOptions,
  ChangeListener,
  ScoredChunk,
  UpdateResult,
} from "./affordance-index.js";
export { AffordanceIndex } from "./affordance-index.js";
