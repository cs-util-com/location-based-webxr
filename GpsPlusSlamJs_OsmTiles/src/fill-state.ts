/**
 * The fill's small bookkeeping objects in R2: the daily counter (the global
 * caps), the per-tile failure record (backoff), one pending marker per
 * queued or running fill (the fill backlog), one verifying marker per
 * queued verify (the report backlog) and the verified memo (the verdict on
 * one stored object). Only the serial queue consumer writes the counter,
 * the records and the memos, so a read-modify-write needs no lock; the
 * endpoints write only their own cell's markers.
 *
 * @see fill-state.ts.md
 */

import type { TileBucket, TileObjectHead } from "./bindings";

export interface DailyState {
  /** Requests sent to Overpass operators today, all of them together. */
  readonly upstreamRequests: number;
  readonly fills: number;
  readonly failures: number;
  /**
   * Decoded bytes, summed over today's fills: a raw answer's length, a
   * gzip answer's trailer ISIZE (no inflate needed).
   */
  readonly rawBytes: number;
  /** Bytes as stored, summed over today's fills. */
  readonly storedBytes: number;
  /** Verifies of reported tiles run today. */
  readonly verifies: number;
  /**
   * Of `upstreamRequests`, those a replace sent: a replace has its own
   * share of the day's budget, so reports cannot spend what fills need.
   */
  readonly replaceRequests: number;
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
  replaceRequests: 0,
});

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_BACKOFF_MS = 7 * DAY_MS;

const PENDING_PREFIX = "state/pending/";
const VERIFIED_PREFIX = "state/verified/";
const VERIFYING_PREFIX = "state/verifying/";
/**
 * The last replace of a cell, never swept: one empty object per cell ever
 * replaced, inert once its 24 h gap has passed (see the sidecar).
 */
const REPLACED_PREFIX = "state/replaced/";

/**
 * The least time between two replaces of one cell: a replace costs the
 * operators a request, and anyone can cause one with a report.
 */
export const REPLACE_MIN_GAP_MS = DAY_MS;

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
    replaceRequests: count(raw["replaceRequests"]),
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

/** Epoch ms of the cell's last replace, if one is on record. */
export async function readLastReplace(
  bucket: TileBucket,
  cell: string,
): Promise<number | undefined> {
  const head = await bucket.head(`${REPLACED_PREFIX}${cell}`);
  const at = Number(head?.customMetadata?.["at"]);
  return head === null || !Number.isFinite(at) ? undefined : at;
}

export async function writeLastReplace(
  bucket: TileBucket,
  cell: string,
  at: number,
): Promise<void> {
  await bucket.put(`${REPLACED_PREFIX}${cell}`, "", {
    customMetadata: { at: String(at) },
  });
}

/** How long a good verdict on one object stands before it is checked again. */
export const VERIFIED_TTL_MS = 7 * 86_400_000;

/**
 * The last verify of one object: `started` is written before the body is
 * read and `good` after it passed, so a `started` memo that stays is the
 * trace of a verify the runtime killed.
 */
export interface VerifiedMemo {
  readonly etag: string;
  readonly state: "good" | "started";
  /** Epoch ms the state was written. */
  readonly at: number;
}

/** The verify memo of `cell`, if any. */
export async function readVerified(
  bucket: TileBucket,
  cell: string,
): Promise<VerifiedMemo | undefined> {
  const memo = await bucket.head(`${VERIFIED_PREFIX}${cell}`);
  const meta = memo?.customMetadata;
  const etag = meta?.["etag"];
  if (etag === undefined) return undefined;
  // A memo written before it held a state reads as good and long expired.
  const at = Number(meta?.["at"] ?? 0);
  return {
    etag,
    state: meta?.["state"] === "started" ? "started" : "good",
    at: Number.isFinite(at) ? at : 0,
  };
}

export async function writeVerified(
  bucket: TileBucket,
  cell: string,
  etag: string,
  at: number,
  state: VerifiedMemo["state"] = "good",
): Promise<void> {
  await bucket.put(`${VERIFIED_PREFIX}${cell}`, "", {
    customMetadata: { etag, state, at: String(at) },
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

interface Marker {
  readonly cell: string;
  readonly queuedAt: number;
  readonly running: boolean;
  readonly etag?: string;
}

function markerOf(object: TileObjectHead, prefix: string): Marker {
  const meta = object.customMetadata ?? {};
  const queuedAt = Number(meta["queuedAt"]);
  const etag = meta["etag"];
  return {
    cell: object.key.slice(prefix.length),
    queuedAt: Number.isFinite(queuedAt) ? queuedAt : object.uploaded.getTime(),
    running: meta["running"] === "1",
    ...(etag === undefined ? {} : { etag }),
  };
}

/**
 * Every marker under `prefix`, stale ones included; one page holds them
 * (both backlogs are bounded, and stale markers are swept).
 */
async function allMarkers(
  bucket: TileBucket,
  prefix: string,
): Promise<Marker[]> {
  const listing = await bucket.list({ prefix, include: ["customMetadata"] });
  return listing.objects.map((object) => markerOf(object, prefix));
}

async function allPending(bucket: TileBucket): Promise<PendingFill[]> {
  return (await allMarkers(bucket, PENDING_PREFIX)).map(
    ({ cell, queuedAt, running }) => ({ cell, queuedAt, running }),
  );
}

function isFresh(pending: { readonly queuedAt: number }, now: number): boolean {
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

/** An open verify of a reported object, as the report endpoint left it. */
export interface VerifyingMarker {
  readonly cell: string;
  /** The ETag of the reported object. */
  readonly etag: string;
  /** Epoch ms the verify was queued. */
  readonly queuedAt: number;
}

function verifyingOf(marker: Marker): VerifyingMarker | undefined {
  return marker.etag === undefined
    ? undefined
    : { cell: marker.cell, etag: marker.etag, queuedAt: marker.queuedAt };
}

/**
 * Marks a verify of `cell`'s object `etag` as queued. The report endpoint
 * writes it before it sends the message and the consumer clears it when the
 * verify ends, so a cell has at most one verify message open at a time.
 */
export async function markVerifying(
  bucket: TileBucket,
  cell: string,
  etag: string,
  now: number,
): Promise<void> {
  await bucket.put(`${VERIFYING_PREFIX}${cell}`, "", {
    customMetadata: { etag, queuedAt: String(now) },
  });
}

/** The cell's open verify, unless absent or older than the stale age. */
export async function readVerifying(
  bucket: TileBucket,
  cell: string,
  now: number,
): Promise<VerifyingMarker | undefined> {
  const head = await bucket.head(`${VERIFYING_PREFIX}${cell}`);
  if (head === null) return undefined;
  const marker = verifyingOf(markerOf(head, VERIFYING_PREFIX));
  return marker !== undefined && isFresh(marker, now) ? marker : undefined;
}

export async function clearVerifying(
  bucket: TileBucket,
  cell: string,
): Promise<void> {
  await bucket.delete(`${VERIFYING_PREFIX}${cell}`);
}

/**
 * Clears the cell's verifying marker only when it names the object `etag`.
 * A verify of an object already replaced can end after a report of the new
 * object wrote its own marker; that marker must stay, or each further
 * report of the new object would queue another verify.
 */
export async function clearVerifyingIf(
  bucket: TileBucket,
  cell: string,
  etag: string,
): Promise<void> {
  const head = await bucket.head(`${VERIFYING_PREFIX}${cell}`);
  if (head === null) return;
  if (markerOf(head, VERIFYING_PREFIX).etag === etag) {
    await clearVerifying(bucket, cell);
  }
}

/** The open verifies younger than the stale age: the report backlog. */
export async function listVerifying(
  bucket: TileBucket,
  now: number,
): Promise<VerifyingMarker[]> {
  const markers = await allMarkers(bucket, VERIFYING_PREFIX);
  return markers
    .filter((m) => isFresh(m, now))
    .flatMap((m) => verifyingOf(m) ?? []);
}

/**
 * Removes the verifying markers older than the stale age: a verify the
 * runtime killed, or a message that was lost, leaves its marker behind.
 */
export async function sweepVerifying(
  bucket: TileBucket,
  now: number,
): Promise<void> {
  for (const marker of await allMarkers(bucket, VERIFYING_PREFIX)) {
    if (!isFresh(marker, now)) await clearVerifying(bucket, marker.cell);
  }
}
