/**
 * Which POI kinds are worth their own 3D model, ranked by how common they are
 * (W15, DEC-R4-7).
 *
 * THE PROBLEM THIS SOLVES. The feedback asks for the tags in the weighting sheet
 * to get "ihr eigenes kleines prozedurales Low-Polygon 3D-Modell" — and the
 * sheet has roughly 700 rows across 57 keys. That is not a work item, it is a
 * project, so the owner chose the top fifty by global occurrence
 * (DEC-R4-7, held through two rounds of pushback).
 *
 * WHY THE SHEET CAN ANSWER THIS ITSELF. The CSV carries a `Count` column — the
 * worldwide usage count for each tag value — which is exactly the note's own
 * criterion: _"die am häufigsten auch auf der Welt vorkommen"_. So the triage
 * rule is data rather than taste, and this file is the derivation.
 *
 * WHY ONLY NINE KEYS ARE ELIGIBLE. A model is placed by `poi.ts`, which marks
 * NODES carrying one of nine keys. `landuse`, `building`, `highway`, `barrier`
 * and `surface` rows are ways and areas owned by `plates.ts`, `roads.ts` and
 * `buildings.ts` — giving them a marker would put a pin in the middle of every
 * car park in the tile, which is the mistake `poi.ts`'s header already records.
 *
 * WHY THE RESULT IS COMMITTED RATHER THAN COMPUTED AT RUNTIME. The `Count`
 * column is a snapshot of global OSM usage, and the sheet is publicly editable.
 * Deriving the list at runtime would make *the set of models that exist* depend
 * on a data file that can change underneath the code — a sheet edit could
 * silently orphan a model or reference one that was never written. So the
 * ranking is computed here, the answer is checked in as
 * {@link TOP_POI_KINDS}, and a test asserts the two still agree.
 *
 * @see poi-ranking.ts.md
 */

import { parseCsvObjects } from "../rules/csv.js";
import { POI_KEYS } from "./poi.js";

/** One ranked tag value. */
export interface RankedPoiKind {
  /** `key=value`, the same form `poiKind` returns. */
  readonly kind: string;
  readonly key: string;
  readonly value: string;
  /** Worldwide occurrences, from the sheet's `Count` column. */
  readonly count: number;
}

/**
 * Reads the leading integer out of a `Count` cell.
 *
 * The live sheet writes counts like `"6 109 792\n30.12%"` — a
 * space-grouped number, a newline, and a percentage. Parsing this with `Number`
 * gives `NaN` and would silently rank everything equally; the percentage half
 * must not be read as digits either, or `30.12%` on a rare tag would outrank a
 * genuinely common one.
 */
export function parseUsageCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  // Only the FIRST line: everything after the newline is the percentage.
  const firstLine = raw.split("\n")[0] ?? "";
  // Space-grouped digits, with non-breaking and thin spaces as well as plain
  // ones — all three appear in spreadsheet exports.
  const digits = firstLine.replace(/[\s\u00a0\u2009\u202f]/g, "");
  if (!/^\d+$/.test(digits)) return undefined;
  return Number(digits);
}

/**
 * The most common POI values in the sheet, most common first.
 *
 * Ties break on `kind` so the ranking is total and therefore reproducible: two
 * tags with the same count would otherwise swap places between runs and make
 * the committed list look like it had drifted.
 */
/**
 * One row as a ranked kind, or `undefined` when it is not a POI value at all.
 *
 * Split out of `rankPoiKinds` so the loop stays a loop: the row-level rejections
 * are five independent reasons a row does not qualify, and reading them as one
 * chain is easier than reading them interleaved with the ranking.
 */
function rankedKindFor(
  row: Record<string, string>,
  eligible: ReadonlySet<string>,
): RankedPoiKind | undefined {
  const key = row["Key"]?.trim();
  const value = row["Value"]?.trim();
  if (key === undefined || value === undefined) return undefined;
  // `no` is the tag's own negation and never marks a place.
  if (value === "" || value === "no") return undefined;
  if (!eligible.has(key)) return undefined;
  const count = parseUsageCount(row["Count"]);
  if (count === undefined || count <= 0) return undefined;
  return { kind: `${key}=${value}`, key, value, count };
}

export function rankPoiKinds(csv: string, limit: number): RankedPoiKind[] {
  const eligible = new Set<string>(POI_KEYS);
  const ranked: RankedPoiKind[] = [];
  const seen = new Set<string>();

  for (const row of parseCsvObjects(csv).rows) {
    const entry = rankedKindFor(row, eligible);
    // The sheet has duplicate rows in places; the first wins, so re-running the
    // derivation is stable.
    if (entry === undefined || seen.has(entry.kind)) continue;
    seen.add(entry.kind);
    ranked.push(entry);
  }

  ranked.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return ranked.slice(0, limit);
}

/** How many kinds get their own model (DEC-R4-7). */
export const POI_MODEL_LIMIT = 50;
