/**
 * Tag → rule-key conversion.
 *
 * This is a one-function module because the exact key format is load-bearing:
 * the rule table is a published Google Sheet whose `id` column is built as
 * `Key + seperator + Value` with the separator column holding `_`. Get this
 * wrong and every lookup misses silently, producing a uniform score of 1
 * (the multiplicative identity) that looks like "no rules matched" rather than
 * like a bug.
 *
 * **The plan's prose says `key=value`; the real sheet and the C# reference both
 * use `key_value`.** The sheet wins — it is the actual data. Verified against
 * the live sheet on 2026-07-28: 721 of 729 rows carry separator `_`.
 *
 * @see osm-tags.ts.md
 */

import type { OsmTags } from "./osm-feature.js";

/**
 * The separator between key and value in a rule-table id.
 *
 * Matches `OsmHeatMapsManager.CalcHeatFor`'s `tag.Key + "_" + tag.Value`.
 */
export const RULE_KEY_SEPARATOR = "_";

/**
 * Builds the rule-table lookup key for one tag.
 *
 * No normalisation of any kind — no lowercasing, no trimming, no unit parsing.
 * The rule table is keyed on raw OSM values and the long tail is the point;
 * "helpfully" normalising here would break exact matches such as
 * `surface=sand`.
 */
export function toRuleKey(key: string, value: string): string {
  return `${key}${RULE_KEY_SEPARATOR}${value}`;
}

/** Every rule key a feature's tags produce, in insertion order. */
export function toRuleKeys(tags: OsmTags): string[] {
  return Object.entries(tags).map(([key, value]) => toRuleKey(key, value));
}

/**
 * Splits a rule key back into its key and value.
 *
 * **Ambiguous by construction and that is not fixable here:** OSM keys and
 * values both contain underscores (`building_levels_3`, `public_transport_stop`),
 * so `key_value` cannot be uniquely inverted. This helper splits at the FIRST
 * separator, which is right for `surface_sand` and wrong for
 * `public_transport_platform`. Use it only for diagnostics — never to
 * round-trip a key back into a tag.
 */
export function splitRuleKeyForDiagnostics(
  ruleKey: string,
): { key: string; value: string } | undefined {
  const i = ruleKey.indexOf(RULE_KEY_SEPARATOR);
  if (i <= 0 || i === ruleKey.length - 1) {
    return undefined;
  }
  return {
    key: ruleKey.slice(0, i),
    value: ruleKey.slice(i + RULE_KEY_SEPARATOR.length),
  };
}
