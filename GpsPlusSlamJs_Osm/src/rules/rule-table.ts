/**
 * The `RuleTable` — the policy layer the scoring engine consumes.
 *
 * The engine itself is category-agnostic: it multiplies whatever numbers this
 * table declares, under whatever category names this table declares. The game
 * vocabulary that the C# reference hard-coded (`walkable`, `battleArea`,
 * `questGiver`, …) becomes just one possible table, which is the whole point of
 * §2's "generic engine + pluggable rule table" decision.
 *
 * @see rule-table.ts.md
 */

import { parseCsvObjects } from "./csv.js";

/** A `key_value` rule id, e.g. `surface_sand`. */
export type RuleKey = string;

export interface RuleTable {
  /** Free-form version stamp, e.g. the sheet's publication date. */
  readonly version: string;
  /** Where this table came from: a URL, `"snapshot"`, or `"cache"`. */
  readonly source: string;
  readonly fetchedAt: number;
  /** Discovered from the CSV's numeric columns, never hardcoded. */
  readonly categories: readonly string[];
  /** Per-category score threshold above which a cell joins a region. */
  readonly thresholds: Readonly<Record<string, number>>;
  /** `key_value` → category → multiplier. */
  readonly rules: Readonly<Record<RuleKey, Readonly<Record<string, number>>>>;
  /**
   * Every distinct OSM key the table scores on, sorted.
   *
   * Read from the sheet's own `Key` column, **never** derived by splitting the
   * rule id — see {@link ruleTableKeys}.
   */
  readonly keys: readonly string[];
  /** Rows the parser refused, with reasons. Never silently dropped. */
  readonly skipped: readonly SkippedRule[];
}

export interface SkippedRule {
  readonly id: string;
  readonly reason: string;
}

/**
 * Columns that are never categories however numeric they look.
 *
 * `nr` is the C# reference's own blacklist. `Count` matters more in practice:
 * on the live sheet it holds values like `"6 109 792\n30.12%"` which are not
 * numeric, but a future formatting change could make them parse — and a
 * usage-count column silently becoming a scoring category would produce
 * enormous, entirely meaningless scores.
 */
const NEVER_CATEGORIES = new Set([
  "nr",
  "id",
  "seperator", // [sic] — the sheet's own spelling
  "separator",
  "Key",
  "Value",
  "Count",
  "Description",
  "w",
]);

/** Ported from `OsmRules.EnsureFieldNamesValid`. */
const MAX_FIELD_NAME_LENGTH = 40;
/** Ported from the plan's §Iteration 3 validation list. */
const MAX_CATEGORY_NAME_LENGTH = 20;

/**
 * Applied when a table declares no threshold for a category.
 *
 * `1` is deliberate and is the only defensible default: it is the
 * multiplicative identity, so "at least one rule said something positive about
 * this cell" is the bar. A higher guess would silently hide regions; a lower one
 * would make every unmapped cell a region.
 */
export const DEFAULT_THRESHOLD = 1;

/** Rows whose threshold is declared inline rather than per-column. */
const THRESHOLD_ROW_ID = "__threshold__";

/**
 * Builds a `RuleTable` from the published CSV.
 *
 * Category discovery, ported from `OsmRules`: a column is a category iff it is
 * not blacklisted **and** its value parses as a number. That is why the table
 * can grow a category without any code change — which is the live-tuning loop
 * §2.1 chose to keep.
 *
 * @throws if the CSV cannot be parsed at all, or if it yields no categories —
 *   a table with no categories scores nothing, and returning it would present
 *   as "this whole area is unmapped".
 */
export function parseRuleTable(
  csv: string,
  meta: {
    readonly source: string;
    readonly fetchedAt: number;
    readonly version?: string;
  },
): RuleTable {
  const { header, rows, malformed } = parseCsvObjects(csv);

  for (const name of header) {
    if (name.length > MAX_FIELD_NAME_LENGTH) {
      throw new Error(
        `Rule table column name exceeds ${MAX_FIELD_NAME_LENGTH} chars: ${JSON.stringify(name.slice(0, 60))}`,
      );
    }
  }

  const skipped: SkippedRule[] = malformed.map((m) => ({
    id: `line ${m.line}`,
    reason: `row has ${m.fields} fields, header has ${header.length}`,
  }));

  const categories = discoverCategories(header, rows);
  if (categories.length === 0) {
    throw new Error(
      "Rule table declares no numeric categories; a table that scores nothing would present as unmapped ground",
    );
  }

  const rules: Record<RuleKey, Record<string, number>> = {};
  const thresholds: Record<string, number> = {};
  const keys = new Set<string>();

  for (const row of rows) {
    applyRow(row, categories, rules, thresholds, keys, skipped);
  }

  for (const category of categories) {
    thresholds[category] ??= DEFAULT_THRESHOLD;
  }

  return {
    version: meta.version ?? `${new Date(meta.fetchedAt).toISOString()}`,
    source: meta.source,
    fetchedAt: meta.fetchedAt,
    categories,
    thresholds,
    rules,
    keys: [...keys].sort(),
    skipped,
  };
}

/** One CSV row -> either a rule, a threshold declaration, or a skip record. */
function applyRow(
  row: Record<string, string>,
  categories: readonly string[],
  rules: Record<RuleKey, Record<string, number>>,
  thresholds: Record<string, number>,
  keys: Set<string>,
  skipped: SkippedRule[],
): void {
  const id = (row["id"] ?? "").trim();
  if (id === "") {
    // 8 such rows exist on the live sheet — spacers and notes. Counted so the
    // number is visible rather than mysterious, but not an error.
    skipped.push({ id: "(empty)", reason: "row has no id" });
    return;
  }
  if (id === THRESHOLD_ROW_ID) {
    for (const category of categories) {
      const value = toNumber(row[category]);
      if (value !== undefined) thresholds[category] = value;
    }
    return;
  }

  const values = readValues(row, categories);
  if (Object.keys(values).length === 0) {
    // 254 such rows exist on the live sheet: they carry a Key, a Value and a
    // Description but no scores. They are DOCUMENTATION, not rules — the
    // "721 rules" figure quoted throughout this project's docs is really
    // 467 scoring rules plus 254 documented-but-unscored tags. Counted here so
    // the discrepancy is visible instead of looking like a parser bug.
    skipped.push({ id, reason: "documented but scores nothing" });
    return;
  }
  rules[id] = values;

  // From the sheet's OWN `Key` column. Never by splitting the id: an OSM key
  // can itself contain underscores (`man_made`, `public_transport`,
  // `leaf_type`, `drinking_water`), so a first-underscore split yields "man",
  // "public", "leaf", "drinking" — keys that match nothing, silently.
  const key = (row["Key"] ?? "").trim();
  if (key !== "") keys.add(key);
}

/**
 * A row's numeric values, per category.
 *
 * **Absent is NOT zero.** Zero is a hard veto that short-circuits scoring, so
 * treating a blank cell as zero would silently veto on every unfilled cell in a
 * deliberately sparse sheet — the single most destructive misreading available
 * here.
 */
function readValues(
  row: Record<string, string>,
  categories: readonly string[],
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const category of categories) {
    const value = toNumber(row[category]);
    if (value !== undefined) values[category] = value;
  }
  return values;
}

/**
 * A column is a category iff it is not blacklisted and at least one row gives it
 * a numeric value.
 *
 * "At least one row" rather than "every row" because the sheet is sparse: most
 * rules score only some categories.
 */
function discoverCategories(
  header: readonly string[],
  rows: readonly Record<string, string>[],
): string[] {
  const categories: string[] = [];
  for (const name of header) {
    if (NEVER_CATEGORIES.has(name)) continue;
    if (name.trim() === "") continue;
    if (name.length > MAX_CATEGORY_NAME_LENGTH) continue;
    if (rows.some((row) => toNumber(row[name]) !== undefined)) {
      categories.push(name);
    }
  }
  return categories;
}

/**
 * Strict numeric coercion.
 *
 * Deliberately not `Number(x)`: that maps `""` to `0` and `" "` to `0`, which
 * would turn every blank cell into a hard veto.
 */
function toNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (text === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Looks up one rule's multiplier for one category.
 *
 * Returns `1` — the multiplicative identity — for an unknown key or an
 * unscored category, so an unmapped tag contributes nothing rather than
 * vetoing.
 */
export function ruleValue(
  table: RuleTable,
  key: RuleKey,
  category: string,
): number {
  return table.rules[key]?.[category] ?? 1;
}

/** Threshold for a category, falling back to {@link DEFAULT_THRESHOLD}. */
export function thresholdFor(table: RuleTable, category: string): number {
  return table.thresholds[category] ?? DEFAULT_THRESHOLD;
}

/**
 * Every distinct OSM key the table scores on — the candidate Overpass filter.
 *
 * **Read from the sheet's `Key` column, not derived from the rule id.** The
 * plan originally specified "split the id on the first underscore", reasoning
 * that an OSM *value* may contain underscores (`surface_fine_gravel`). True, but
 * incomplete: an OSM *key* may too (`man_made`, `public_transport`, `leaf_type`,
 * `drinking_water`, `recycling_type`, `artwork_type`), and a first-underscore
 * split turns those into `man`, `public`, `leaf`, `drinking` — keys that match
 * nothing in Overpass and drop their elements silently. There is no split that
 * gets both cases right, which is why the explicit column wins.
 */
export function ruleTableKeys(table: RuleTable): readonly string[] {
  return table.keys;
}
