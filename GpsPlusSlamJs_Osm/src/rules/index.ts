/**
 * Rules module — the policy layer. Loads and validates the affordance rule
 * table; contains no scoring logic itself.
 */

export type { RuleTable, RuleKey, SkippedRule } from "./rule-table.js";
export {
  parseRuleTable,
  ruleValue,
  thresholdFor,
  ruleTableKeys,
  DEFAULT_THRESHOLD,
} from "./rule-table.js";

export type {
  RuleTableLoaderOptions,
  LoadedRuleTable,
} from "./rule-table-loader.js";
export {
  loadRuleTable,
  snapshotRuleTable,
  checkDrift,
  RULE_TABLE_CSV_URL,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_RULE_DRIFT,
} from "./rule-table-loader.js";

export {
  IGNORED_TAG_PREFIXES,
  isIgnoredTagKey,
  interestingUnmappedTags,
} from "./ignored-tags.js";

export { parseCsv, parseCsvObjects, CsvParseError } from "./csv.js";
