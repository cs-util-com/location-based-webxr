/**
 * One tile fill, as the serial queue consumer runs it: re-check the store,
 * the failure record and the daily cap; fetch the client's exact query from
 * the operators in turn; keep the bytes as sent; refuse a partial answer;
 * never replace a newer tile with an older one; gzip; store.
 *
 * @see fill-tile.ts.md
 */

import {
  buildTileQuery,
  cellToBoundingBox,
  OVERPASS_SELECT_KEYS,
} from "gps-plus-slam-osm/source/overpass-query";
import type { FillMessage, TileBucket } from "./bindings";
import { checkOverpassBody } from "./overpass-body-check";
import {
  clearFailure,
  readDaily,
  readFailure,
  recordFailure,
  writeDaily,
  writeFailure,
  type DailyState,
} from "./fill-state";
import { tileObjectKey } from "./tile-cell";

/** The client's own `[timeout:]`, so the stored bytes are its answer. */
const QUERY_TIMEOUT_SECONDS = 180;

/** Per-attempt transport deadline: the query's own limit plus the transfer. */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 200_000;

/**
 * No attempt may run past this much wall time from the fill's start: an
 * attempt is started only when its whole timeout still fits. A consumer
 * invocation has 15 minutes; one minute is left for storing the tile.
 */
const DEFAULT_WALL_LIMIT_MS = 14 * 60_000;

/** A stored tile older than this (by its data age) is refreshed on request. */
export const REFRESH_AGE_MS = 30 * 86_400_000;

/** How long an edge or browser may keep a tile before asking again. */
const TILE_CACHE_CONTROL = "public, max-age=86400";

export interface FillDeps {
  readonly bucket: TileBucket;
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly userAgent: string;
  readonly endpoints: readonly string[];
  readonly dailyUpstreamCap: number;
  readonly attemptTimeoutMs?: number;
  readonly wallLimitMs?: number;
  /** Store gzip (default) or the bytes as sent. */
  readonly gzip?: boolean;
}

interface FillAttempt {
  readonly endpoint: string;
  readonly status?: number;
  readonly result:
    | "ok"
    | "status"
    | "error"
    | "not-json"
    | "no-timestamp"
    | "future-timestamp"
    | "remark"
    | "incomplete";
  readonly ms: number;
  readonly bytes?: number;
}

export interface FillOutcome {
  readonly cell: string;
  readonly kind: FillMessage["kind"];
  readonly outcome:
    | "filled"
    | "present"
    | "fresh"
    | "backoff"
    | "cap"
    | "failed"
    | "kept-newer";
  readonly attempts: readonly FillAttempt[];
  readonly endpoint?: string;
  readonly osmBase?: string;
  readonly rawBytes?: number;
  readonly storedBytes?: number;
  readonly wallMs: number;
}

/**
 * The operator an endpoint belongs to: its registrable domain. The FOSSGIS
 * entries (`lz4.`, `z.` and bare `overpass-api.de`) are one operator with
 * one quota, so a 429 from one of them skips the others.
 */
function operatorOf(endpoint: string): string {
  return new URL(endpoint).hostname.split(".").slice(-2).join(".");
}

async function compressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Fetched {
  readonly bytes: Uint8Array;
  readonly osmBase: string;
  readonly endpoint: string;
}

/** What the store says about the tile before any request is sent. */
async function precheck(
  message: FillMessage,
  deps: FillDeps,
  now: number,
): Promise<{ outcome?: FillOutcome["outcome"]; existingBase?: string }> {
  const existing = await deps.bucket.head(tileObjectKey(message.cell));
  const existingBase = existing?.customMetadata?.["osmBase"];
  if (existing !== null && message.kind === "fill")
    return { outcome: "present" };
  if (existing !== null && existingBase !== undefined) {
    const age = now - Date.parse(existingBase);
    if (age < REFRESH_AGE_MS) return { outcome: "fresh" };
  }
  const failure = await readFailure(deps.bucket, message.cell);
  if (failure !== undefined && failure.retryAt > now) {
    return { outcome: "backoff" };
  }
  const daily = await readDaily(deps.bucket, now);
  if (daily.upstreamRequests >= deps.dailyUpstreamCap)
    return { outcome: "cap" };
  return existingBase === undefined ? {} : { existingBase };
}

async function attemptOnce(
  endpoint: string,
  query: string,
  deps: FillDeps,
): Promise<{ attempt: FillAttempt; fetched?: Fetched }> {
  const started = deps.now();
  const elapsed = (): number => Math.max(0, deps.now() - started);
  try {
    const response = await deps.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": deps.userAgent,
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(
        deps.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
      ),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return {
        attempt: {
          endpoint,
          status: response.status,
          result: "status",
          ms: elapsed(),
        },
      };
    }
    // The bytes as sent: no JSON.parse (CPU), only the head and tail check.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const check = checkOverpassBody(bytes, deps.now());
    const base = { endpoint, status: 200, ms: elapsed(), bytes: bytes.length };
    if (!check.ok) return { attempt: { ...base, result: check.reason } };
    return {
      attempt: { ...base, result: "ok" },
      fetched: { bytes, osmBase: check.osmBase, endpoint },
    };
  } catch {
    return { attempt: { endpoint, result: "error", ms: elapsed() } };
  }
}

/**
 * The operators in turn, never in parallel. Each request is counted in the
 * daily state BEFORE it is sent, so a fill the runtime kills mid-way still
 * counts against the cap.
 */
async function fetchFromOperators(
  cell: string,
  deps: FillDeps,
  started: number,
): Promise<{ attempts: FillAttempt[]; fetched?: Fetched }> {
  const query = buildTileQuery(
    cellToBoundingBox(cell),
    QUERY_TIMEOUT_SECONDS,
    OVERPASS_SELECT_KEYS,
  );
  const attempts: FillAttempt[] = [];
  const refused = new Set<string>();
  const limit = deps.wallLimitMs ?? DEFAULT_WALL_LIMIT_MS;
  const attemptMs = deps.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  for (const endpoint of deps.endpoints) {
    if (refused.has(operatorOf(endpoint))) continue;
    const now = deps.now();
    if (now - started + attemptMs > limit) break;
    const daily = await readDaily(deps.bucket, now);
    if (daily.upstreamRequests >= deps.dailyUpstreamCap) break;
    await writeDaily(deps.bucket, now, {
      ...daily,
      upstreamRequests: daily.upstreamRequests + 1,
    });
    const { attempt, fetched } = await attemptOnce(endpoint, query, deps);
    attempts.push(attempt);
    if (fetched !== undefined) return { attempts, fetched };
    if (attempt.status === 429) refused.add(operatorOf(endpoint));
  }
  return { attempts };
}

async function bumpDaily(
  deps: FillDeps,
  change: (day: DailyState) => DailyState,
): Promise<void> {
  const now = deps.now();
  await writeDaily(deps.bucket, now, change(await readDaily(deps.bucket, now)));
}

async function store(
  cell: string,
  fetched: Fetched,
  deps: FillDeps,
): Promise<number> {
  const gzip = deps.gzip !== false;
  const stored = gzip ? await compressGzip(fetched.bytes) : fetched.bytes;
  await deps.bucket.put(tileObjectKey(cell), stored, {
    httpMetadata: {
      contentType: "application/json",
      ...(gzip ? { contentEncoding: "gzip" } : {}),
      cacheControl: TILE_CACHE_CONTROL,
    },
    customMetadata: {
      osmBase: fetched.osmBase,
      filledAt: new Date(deps.now()).toISOString(),
      endpoint: new URL(fetched.endpoint).hostname,
      rawBytes: String(fetched.bytes.length),
    },
  });
  return stored.length;
}

export async function fillTile(
  message: FillMessage,
  deps: FillDeps,
): Promise<FillOutcome> {
  const started = deps.now();
  const done = (
    outcome: FillOutcome["outcome"],
    extra: Partial<FillOutcome> = {},
  ): FillOutcome => ({
    cell: message.cell,
    kind: message.kind,
    outcome,
    attempts: [],
    wallMs: Math.max(0, deps.now() - started),
    ...extra,
  });

  const pre = await precheck(message, deps, started);
  if (pre.outcome !== undefined) return done(pre.outcome);

  // The failure is recorded BEFORE the first attempt and cleared on success:
  // the runtime can kill a fill mid-way (CPU or wall limit), the queue does
  // not retry it, and only a record written up front turns that kill into
  // backoff instead of a fresh download on the next request.
  const pending = await recordFailure(
    deps.bucket,
    message.cell,
    started,
    "unfinished",
  );
  const { attempts, fetched } = await fetchFromOperators(
    message.cell,
    deps,
    started,
  );
  if (fetched === undefined) {
    const reason = attempts.at(-1)?.result ?? "cap";
    await writeFailure(deps.bucket, message.cell, { ...pending, reason });
    await bumpDaily(deps, (d) => ({ ...d, failures: d.failures + 1 }));
    return done("failed", { attempts });
  }
  const facts = {
    attempts,
    endpoint: new URL(fetched.endpoint).hostname,
    osmBase: fetched.osmBase,
    rawBytes: fetched.bytes.length,
  };
  // ISO-8601 UTC strings of one format compare correctly as text.
  if (pre.existingBase !== undefined && fetched.osmBase <= pre.existingBase) {
    await clearFailure(deps.bucket, message.cell);
    return done("kept-newer", facts);
  }
  const storedBytes = await store(message.cell, fetched, deps);
  await clearFailure(deps.bucket, message.cell);
  await bumpDaily(deps, (d) => ({
    ...d,
    fills: d.fills + 1,
    rawBytes: d.rawBytes + fetched.bytes.length,
    storedBytes: d.storedBytes + storedBytes,
  }));
  return done("filled", { ...facts, storedBytes });
}
