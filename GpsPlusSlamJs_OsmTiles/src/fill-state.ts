/**
 * The fill's small bookkeeping objects in R2: the daily counter (the global
 * caps), the per-tile failure record (backoff), one pending marker per
 * queued or running fill (the backlog) and the verified memo (the ETag a
 * verify found good). Only the serial queue consumer writes the counter,
 * the records and the memos, so a read-modify-write needs no lock; the fill
 * endpoint writes only its own cell's marker.
 *
 * @see fill-state.ts.md
 */

import type { TileBucket } from "./bindings";

export interface DailyState {
  /** Requests sent to Overpass operators today, all of them together. */
  readonly upstreamRequests: number;
  readonly fills: number;
  readonly failures: number;
  /**
   * Decoded bytes, summed over today's fills whose size is known: a gzip
   * answer is stored without inflating, so it adds nothing here.
   */
  readonly rawBytes: number;
  /** Bytes as stored, summed over today's fills. */
  readonly storedBytes: number;
  /** Verifies of reported tiles run today. */
  readonly verifies: number;
}

export interface FailureRecord {
  readonly count: number;
  /** Epoch ms before which the tile is not tried again. */
  readonly retryAt: number;
  readonly reason: string;
  /**
   * Stored tiles of this cell a verify found bad, ever; present only when
   * above 0. It survives a successful fill, so the backoff after the next
   * bad tile is longer (no fill, report, delete loop once an hour).
   */
  readonly badCount?: number;
}

const EMPTY_DAY: DailyState = Object.freeze({
  upstreamRequests: 0,
  fills: 0,
  failures: 0,
  rawBytes: 0,
  storedBytes: 0,
  verifies: 0,
});

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_BACKOFF_MS = 7 * DAY_MS;

const PENDING_PREFIX = "state/pending/";
const VERIFIED_PREFIX = "state/verified/";

/**
 * A marker older than this no longer counts: a consumer invocation has 15
 * minutes of wall time, so a fill still marked after that was killed.
 */
export const PENDING_STALE_MS = 15 * 60_000;

/** One queued or running fill, as the backlog lists it. */
export interface PendingFill {
  readonly cell: string;
  /** Epoch ms the fill was queued, or the consumer started it. */
  readonly queuedAt: number;
  /** The consumer has started it (not merely queued). */
  readonly running: boolean;
}

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
    verifies: count(raw["verifies"]),
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
  const badCount = count(raw["badCount"]);
  return {
    count: count(raw["count"]),
    retryAt: count(raw["retryAt"]),
    reason: typeof raw["reason"] === "string" ? raw["reason"] : "unknown",
    ...(badCount > 0 ? { badCount } : {}),
  };
}

/** Stores `record` as is: the fill names a failure's reason this way. */
export async function writeFailure(
  bucket: TileBucket,
  cell: string,
  record: FailureRecord,
): Promise<void> {
  await bucket.put(failureKey(cell), JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** One more failure: count + 1 and the next allowed time from the backoff. */
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
    ...(previous?.badCount === undefined
      ? {}
      : { badCount: previous.badCount }),
  };
  await writeFailure(bucket, cell, record);
  return record;
}

/**
 * A stored tile of `cell` was found bad and deleted: one more bad tile, and
 * the backoff of that count (an hour, doubling, at most a week), so the
 * cell is not filled again at once with what is likely the same answer.
 */
export async function recordBadTile(
  bucket: TileBucket,
  cell: string,
  now: number,
  reason: string,
): Promise<FailureRecord> {
  const previous = await readFailure(bucket, cell);
  const badCount = (previous?.badCount ?? 0) + 1;
  const record: FailureRecord = {
    count: previous?.count ?? 0,
    retryAt: now + failureBackoffMs(badCount),
    reason: `bad-tile:${reason}`,
    badCount,
  };
  await writeFailure(bucket, cell, record);
  return record;
}

/**
 * A successful fill: the record goes, except a cell's bad-tile count, which
 * stays (with no backoff now) so the next bad tile backs off longer.
 */
export async function clearFailure(
  bucket: TileBucket,
  cell: string,
): Promise<void> {
  const previous = await readFailure(bucket, cell);
  if (previous?.badCount === undefined) {
    await bucket.delete(failureKey(cell));
    return;
  }
  await writeFailure(bucket, cell, {
    count: 0,
    retryAt: 0,
    reason: previous.reason,
    badCount: previous.badCount,
  });
}

/** The ETag of the object of `cell` last verified good, if any. */
export async function readVerifiedEtag(
  bucket: TileBucket,
  cell: string,
): Promise<string | undefined> {
  const memo = await bucket.head(`${VERIFIED_PREFIX}${cell}`);
  return memo?.customMetadata?.["etag"];
}

export async function writeVerified(
  bucket: TileBucket,
  cell: string,
  etag: string,
): Promise<void> {
  await bucket.put(`${VERIFIED_PREFIX}${cell}`, "", {
    customMetadata: { etag },
  });
}

export async function clearVerified(
  bucket: TileBucket,
  cell: string,
): Promise<void> {
  await bucket.delete(`${VERIFIED_PREFIX}${cell}`);
}

/** Marks `cell` queued (the endpoint) or running (the consumer). */
export async function markPending(
  bucket: TileBucket,
  cell: string,
  now: number,
  running = false,
): Promise<void> {
  await bucket.put(`${PENDING_PREFIX}${cell}`, "", {
    customMetadata: {
      queuedAt: String(now),
      ...(running ? { running: "1" } : {}),
    },
  });
}

export async function clearPending(
  bucket: TileBucket,
  cell: string,
): Promise<void> {
  await bucket.delete(`${PENDING_PREFIX}${cell}`);
}

/** Every marker, stale ones included; one page holds them (the backlog is bounded). */
async function allPending(bucket: TileBucket): Promise<PendingFill[]> {
  const listing = await bucket.list({
    prefix: PENDING_PREFIX,
    include: ["customMetadata"],
  });
  return listing.objects.map((object) => {
    const meta = object.customMetadata ?? {};
    const queuedAt = Number(meta["queuedAt"]);
    return {
      cell: object.key.slice(PENDING_PREFIX.length),
      queuedAt: Number.isFinite(queuedAt)
        ? queuedAt
        : object.uploaded.getTime(),
      running: meta["running"] === "1",
    };
  });
}

function isFresh(pending: PendingFill, now: number): boolean {
  return now - pending.queuedAt < PENDING_STALE_MS;
}

/** The fresh markers, oldest first: the backlog the fill endpoint reads. */
export async function listPending(
  bucket: TileBucket,
  now: number,
): Promise<PendingFill[]> {
  const pending = await allPending(bucket);
  return pending
    .filter((p) => isFresh(p, now))
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

/**
 * Removes stale markers and every marker still flagged running. The consumer
 * calls it as each message starts: it is serial, so a running marker at that
 * moment belongs to a run the runtime killed.
 */
export async function sweepPending(
  bucket: TileBucket,
  now: number,
): Promise<void> {
  for (const pending of await allPending(bucket)) {
    if (pending.running || !isFresh(pending, now)) {
      await clearPending(bucket, pending.cell);
    }
  }
}
