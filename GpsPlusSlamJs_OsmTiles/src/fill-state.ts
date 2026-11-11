/**
 * The fill's small bookkeeping objects in R2: the daily counter (the global
 * cap), the per-tile failure record (backoff) and the manifest of filled
 * cells. Only the serial queue consumer writes them, so a read-modify-write
 * needs no lock; the fill endpoint only reads.
 *
 * @see fill-state.ts.md
 */

import type { TileBucket } from "./bindings";
import { TILE_PREFIX } from "./tile-cell";

export interface DailyState {
  /** Requests sent to Overpass operators today, all of them together. */
  readonly upstreamRequests: number;
  readonly fills: number;
  readonly failures: number;
  /** Bytes as Overpass sent them, summed over today's fills. */
  readonly rawBytes: number;
  /** Bytes as stored (gzip), summed over today's fills. */
  readonly storedBytes: number;
}

export interface FailureRecord {
  readonly count: number;
  /** Epoch ms before which the tile is not tried again. */
  readonly retryAt: number;
  readonly reason: string;
}

const EMPTY_DAY: DailyState = Object.freeze({
  upstreamRequests: 0,
  fills: 0,
  failures: 0,
  rawBytes: 0,
  storedBytes: 0,
});

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_BACKOFF_MS = 7 * DAY_MS;

/** The manifest of filled cells: one `cell<TAB>osmBase<TAB>storedBytes` line each. */
export const MANIFEST_KEY = `${TILE_PREFIX}manifest.tsv`;

/** `YYYY-MM-DD` of the UTC day containing `now`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function msUntilNextUtcDay(now: number): number {
  return DAY_MS - (now % DAY_MS);
}

/** One hour after the first failure, doubling, at most a week. */
export function failureBackoffMs(count: number): number {
  const exponent = Math.max(0, Math.min(count - 1, 20));
  return Math.min(HOUR_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

function dailyKey(now: number): string {
  return `state/daily/${utcDay(now)}.json`;
}

function failureKey(cell: string): string {
  return `state/failures/${cell}.json`;
}

async function readJson(
  bucket: TileBucket,
  key: string,
): Promise<Record<string, unknown> | undefined> {
  const object = await bucket.get(key);
  if (object === null) return undefined;
  try {
    const value: unknown = JSON.parse(await object.text());
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    // A damaged state object must not stop the service: read it as absent.
    return undefined;
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export async function readDaily(
  bucket: TileBucket,
  now: number,
): Promise<DailyState> {
  const raw = await readJson(bucket, dailyKey(now));
  if (raw === undefined) return EMPTY_DAY;
  return {
    upstreamRequests: count(raw["upstreamRequests"]),
    fills: count(raw["fills"]),
    failures: count(raw["failures"]),
    rawBytes: count(raw["rawBytes"]),
    storedBytes: count(raw["storedBytes"]),
  };
}

export async function writeDaily(
  bucket: TileBucket,
  now: number,
  state: DailyState,
): Promise<void> {
  await bucket.put(dailyKey(now), JSON.stringify(state), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function readFailure(
  bucket: TileBucket,
  cell: string,
): Promise<FailureRecord | undefined> {
  const raw = await readJson(bucket, failureKey(cell));
  if (raw === undefined) return undefined;
  return {
    count: count(raw["count"]),
    retryAt: count(raw["retryAt"]),
    reason: typeof raw["reason"] === "string" ? raw["reason"] : "unknown",
  };
}

export async function recordFailure(
  bucket: TileBucket,
  cell: string,
  now: number,
  reason: string,
): Promise<FailureRecord> {
  const previous = await readFailure(bucket, cell);
  const failures = (previous?.count ?? 0) + 1;
  const record: FailureRecord = {
    count: failures,
    retryAt: now + failureBackoffMs(failures),
    reason,
  };
  await bucket.put(failureKey(cell), JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
  });
  return record;
}

export async function clearFailure(
  bucket: TileBucket,
  cell: string,
): Promise<void> {
  await bucket.delete(failureKey(cell));
}

/** The manifest text with `cell`'s line replaced, or appended when new. */
export function upsertManifestLine(
  manifest: string,
  cell: string,
  osmBase: string,
  storedBytes: number,
): string {
  const line = `${cell}\t${osmBase}\t${storedBytes}`;
  const lines = manifest.split("\n").filter((l) => l !== "");
  const index = lines.findIndex((l) => l.startsWith(`${cell}\t`));
  if (index === -1) lines.push(line);
  else lines[index] = line;
  return `${lines.join("\n")}\n`;
}

export async function addToManifest(
  bucket: TileBucket,
  cell: string,
  osmBase: string,
  storedBytes: number,
): Promise<void> {
  const current = await bucket.get(MANIFEST_KEY);
  const text = current === null ? "" : await current.text();
  await bucket.put(
    MANIFEST_KEY,
    upsertManifestLine(text, cell, osmBase, storedBytes),
    {
      httpMetadata: { contentType: "text/tab-separated-values; charset=utf-8" },
    },
  );
}
