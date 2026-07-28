/**
 * Loads the rule table: live CSV → persisted cache → checked-in snapshot.
 *
 * The runtime fetch is the shipped default by owner decision (§2.1) — the
 * live-tuning loop is the point of the design. That decision is what makes the
 * drift guard below **not optional**: it is the only thing standing between a
 * bad edit to a publicly-editable Google Sheet and every downstream app's
 * behaviour, with no review, no diff and no rollback.
 *
 * @see rule-table-loader.ts.md
 */

import type { OsmBlobStore } from "../source/osm-blob-store.js";
import type { RuleTable } from "./rule-table.js";
import { parseRuleTable } from "./rule-table.js";
import {
  DEFAULT_RULE_TABLE_CSV,
  DEFAULT_RULE_TABLE_VERSION,
} from "./default-rules.js";

/** The published sheet, same URL the C# reference uses. */
export const RULE_TABLE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWD-aZgPzMYThZhVNkUomlhjq88MU9XnumlmFw4nYiiHB0VavFAtVrWKWjbB-nrjCsXo--CoWZW47k/pub?gid=0&single=true&output=csv";

/** Matches the C# reference's cache lifetime. */
export const DEFAULT_TTL_MS = 100 * 60 * 1000;

const CACHE_KEY = "rules/v1/table.csv";

/**
 * Maximum share of rules that may change in one fetch before the table is
 * rejected.
 *
 * The threshold exists because the three-tier fallback bounds only the *broken*
 * failure (a sheet that will not parse degrades to the snapshot); it does
 * nothing about a **plausible-but-wrong** edit, which is the likelier accident.
 * A third is deliberately loose: real tuning sessions do change a lot of rows,
 * and a guard that fires on legitimate work gets disabled.
 */
export const DEFAULT_MAX_RULE_DRIFT = 1 / 3;

export interface RuleTableLoaderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly store?: OsmBlobStore;
  readonly now?: () => number;
  readonly url?: string;
  readonly ttlMs?: number;
  readonly maxRuleDrift?: number;
  /** Diagnostics sink. Defaults to `console.warn`. */
  readonly onWarn?: (message: string) => void;
}

export interface LoadedRuleTable {
  readonly table: RuleTable;
  /** Which tier produced it — surfaced so an app can show provenance. */
  readonly tier: "live" | "cache" | "snapshot";
  /** Why a higher tier was not used, when one was skipped. */
  readonly degradedBecause?: string;
}

/**
 * Default diagnostics sink.
 *
 * A library should not decide how an app logs, but silence is worse: every
 * degradation this module performs is invisible in its return value alone, and
 * "why are my scores the old ones?" has to be answerable. Consumers override via
 * `onWarn`.
 */
/* eslint-disable-next-line no-console */
const defaultWarn = (message: string): void => console.warn(message);

/**
 * The checked-in snapshot, always available and never failing.
 *
 * Exists so that (a) tests are deterministic and offline, and (b) a first run
 * with no network still produces sensible results rather than an empty index
 * that looks like unmapped ground.
 */
export function snapshotRuleTable(now = 0): RuleTable {
  return parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
    source: "snapshot",
    fetchedAt: now,
    version: DEFAULT_RULE_TABLE_VERSION,
  });
}

/**
 * Loads the best available table.
 *
 * **Never throws.** A rule table that fails to load must degrade, because the
 * alternative is an app with no affordance data at all — and the snapshot is
 * always there. Every degradation is reported through `onWarn` and named in
 * `degradedBecause`, so "why are my scores the old ones?" is answerable.
 */
export async function loadRuleTable(
  options: RuleTableLoaderOptions = {},
): Promise<LoadedRuleTable> {
  const now = options.now ?? Date.now;
  const warn = options.onWarn ?? defaultWarn;
  const snapshot = snapshotRuleTable(now());

  const cached = await readCache(options, now, warn);

  // Tier 1: live fetch, but only if the cache is stale or missing. A fresh cache
  // short-circuits the network entirely — the point of the TTL.
  if (cached?.fresh === true) {
    return { table: cached.table, tier: "cache" };
  }

  const live = await fetchLive(options, now, warn);
  if (live !== undefined) {
    return acceptOrReject(live, cached?.table, snapshot, options, now, warn);
  }

  // Tier 2: a stale cache still beats the snapshot — it is at least a table
  // someone chose, and OSM tuning moves on a scale of months.
  if (cached !== undefined) {
    return {
      table: cached.table,
      tier: "cache",
      degradedBecause: "live fetch failed",
    };
  }

  return {
    table: snapshot,
    tier: "snapshot",
    degradedBecause: "live fetch failed and no cache",
  };
}

/**
 * Decides whether a freshly-fetched table may be used.
 *
 * **THE BASELINE MATTERS, and it cannot be the snapshot.** Drift is inherently
 * COMPARATIVE — it asks "did this change suspiciously fast?" — so it needs a
 * baseline of comparable age. Against the shipped snapshot it measures elapsed
 * time instead: months after a release the sheet has legitimately moved on, so a
 * first run (which by definition has no cache) would reject the live table,
 * never write a cache, and therefore reject it again on every subsequent run.
 * The app would be pinned to a snapshot nobody maintains — silently and
 * permanently, which is a worse failure than the bad edit the guard is for.
 *
 * What protects a first run is not drift but the STRUCTURAL validation in
 * `parseRuleTable`, which needs no baseline: unparseable CSV, an over-long
 * column name, or a table with no numeric categories at all are all rejected
 * outright. A first run therefore cannot accept a login page or a truncated
 * file; it can only accept a table that has genuinely moved on, which is right.
 */
async function acceptOrReject(
  live: { table: RuleTable; csv: string },
  cached: RuleTable | undefined,
  snapshot: RuleTable,
  options: RuleTableLoaderOptions,
  now: () => number,
  warn: (message: string) => void,
): Promise<LoadedRuleTable> {
  const drift =
    cached === undefined
      ? undefined
      : checkDrift(
          live,
          cached,
          options.maxRuleDrift ?? DEFAULT_MAX_RULE_DRIFT,
        );

  if (drift !== undefined) {
    warn(`Rule table rejected: ${drift}`);
    return { table: cached!, tier: "cache", degradedBecause: drift };
  }

  if (cached === undefined) warnIfCategoriesDiffer(live.table, snapshot, warn);
  await writeCache(options, live.csv, now, warn);
  return { table: live.table, tier: "live" };
}

/**
 * Compares a fetched table against the last known good one.
 *
 * Returns a reason string when the table should be REJECTED, `undefined` when
 * it is acceptable.
 *
 * The two checks are deliberately different in kind. A vanished **category** is
 * unambiguously wrong — some app is scoring on it and would silently start
 * getting the identity for everything. A large **rule** delta might be
 * legitimate tuning, so it is a proportion rather than a count, set loose enough
 * not to fire on real work.
 */
export function checkDrift(
  candidate: { readonly table: RuleTable },
  previous: RuleTable,
  maxDrift: number,
): string | undefined {
  // A vanished category is the unambiguous half of the guard: some app is
  // scoring on it and would silently start getting the multiplicative identity
  // for everything, which reads as "this whole area is unmapped" rather than as
  // a broken configuration.
  const missing = previous.categories.filter(
    (category) => !candidate.table.categories.includes(category),
  );
  if (missing.length > 0) {
    return `categories disappeared: ${missing.join(", ")}`;
  }

  const previousIds = Object.keys(previous.rules);
  if (previousIds.length === 0) return undefined;

  let changed = 0;
  for (const id of previousIds) {
    const before = previous.rules[id];
    const after = candidate.table.rules[id];
    if (after === undefined || !sameValues(before!, after)) changed++;
  }
  const ratio = changed / previousIds.length;
  if (ratio > maxDrift) {
    return `${changed}/${previousIds.length} rules changed (${(ratio * 100).toFixed(0)}%), above the ${(maxDrift * 100).toFixed(0)}% limit`;
  }
  return undefined;
}

function sameValues(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Reports a category difference from the shipped snapshot without rejecting.
 *
 * The first-run case. Not fatal — the snapshot ages and the sheet is allowed to
 * move on — but worth saying out loud, because a consumer that hardcoded a
 * category name is about to start getting the identity for it.
 */
function warnIfCategoriesDiffer(
  live: RuleTable,
  snapshot: RuleTable,
  warn: (message: string) => void,
): void {
  const missing = snapshot.categories.filter(
    (category) => !live.categories.includes(category),
  );
  if (missing.length > 0) {
    warn(
      `Live rule table no longer declares ${missing.join(", ")} (present in the shipped snapshot); accepted because no cached baseline exists to compare against`,
    );
  }
}

async function fetchLive(
  options: RuleTableLoaderOptions,
  now: () => number,
  warn: (message: string) => void,
): Promise<{ table: RuleTable; csv: string } | undefined> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (fetchImpl === undefined) return undefined;
  const url = options.url ?? RULE_TABLE_CSV_URL;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      warn(`Rule table fetch returned ${response.status}`);
      return undefined;
    }
    const csv = await response.text();
    const table = parseRuleTable(csv, { source: url, fetchedAt: now() });
    return { table, csv };
  } catch (error) {
    // Downgraded, never thrown: an offline first run must still produce a
    // working table.
    warn(`Rule table fetch failed: ${String(error)}`);
    return undefined;
  }
}

async function readCache(
  options: RuleTableLoaderOptions,
  now: () => number,
  warn: (message: string) => void,
): Promise<{ table: RuleTable; fresh: boolean } | undefined> {
  if (options.store === undefined) return undefined;
  try {
    const raw = await options.store.get(CACHE_KEY);
    if (raw === undefined) return undefined;
    const envelope = JSON.parse(raw) as { fetchedAt?: number; csv?: string };
    if (typeof envelope.csv !== "string") return undefined;
    const fetchedAt = envelope.fetchedAt ?? 0;
    const table = parseRuleTable(envelope.csv, {
      source: "cache",
      fetchedAt,
    });
    const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
    return { table, fresh: now() - fetchedAt < ttl };
  } catch (error) {
    // A corrupt cache entry is not fatal — it just means we go to the network.
    warn(`Rule table cache unreadable: ${String(error)}`);
    return undefined;
  }
}

async function writeCache(
  options: RuleTableLoaderOptions,
  csv: string,
  now: () => number,
  warn: (message: string) => void,
): Promise<void> {
  if (options.store === undefined) return;
  try {
    // The INJECTED clock, not Date.now(). Mixing the two puts the cache
    // timestamp on a different time base from the TTL comparison that reads it,
    // so freshness becomes meaningless — and under an injected clock a just-
    // written entry can read as fresh forever (a negative age is less than any
    // TTL), which silently disables the live fetch.
    await options.store.put(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: now(), csv }),
    );
  } catch (error) {
    // A read-only or full store must not break loading.
    warn(`Rule table cache write failed: ${String(error)}`);
  }
}
