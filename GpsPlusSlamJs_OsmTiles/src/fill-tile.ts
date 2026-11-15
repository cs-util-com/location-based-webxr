/**
 * One tile fill, as the serial queue consumer runs it: re-check the store,
 * the failure record and the daily cap; fetch the client's exact query from
 * the operators in turn, asking for gzip; keep the bytes as sent; refuse a
 * bad answer (the head of a gzip one, head and tail of an uncompressed
 * one); never replace a newer tile with an older one; store. Nothing is
 * compressed or fully decompressed here (CPU).
 *
 * @see fill-tile.ts.md
 */

import {
  buildTileQuery,
  cellToBoundingBox,
  OVERPASS_SELECT_KEYS,
} from "gps-plus-slam-osm/source/overpass-query";
import type { FillMessage, TileBucket } from "./bindings";
import {
  gzipDecodedSize,
  hasGzipMagic,
  inflateHead,
  MAX_TILE_DECODED_BYTES,
  MAX_TILE_GZIP_BYTES,
} from "./body-window";
import {
  BODY_HEAD_BYTES,
  checkOverpassBody,
  checkOverpassHead,
} from "./overpass-body-check";
import {
  clearFailure,
  clearVerified,
  readDaily,
  readFailure,
  readLastReplace,
  recordFailure,
  REPLACE_MIN_GAP_MS,
  writeDaily,
  writeFailure,
  writeLastReplace,
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

/** The replace share of a day's upstream budget unless configured: a third. */
export function defaultReplaceCap(dailyUpstreamCap: number): number {
  return Math.floor(dailyUpstreamCap / 3);
}

function replaceCapOf(deps: FillDeps): number {
  return deps.dailyReplaceCap ?? defaultReplaceCap(deps.dailyUpstreamCap);
}

/** Whether today's budget, or a replace's share of it, is spent. */
function budgetSpent(
  day: DailyState,
  deps: FillDeps,
  replace: boolean,
): boolean {
  return (
    day.upstreamRequests >= deps.dailyUpstreamCap ||
    (replace && day.replaceRequests >= replaceCapOf(deps))
  );
}

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
  /**
   * Of `dailyUpstreamCap`, the requests replaces may send in one day;
   * {@link defaultReplaceCap} when absent.
   */
  readonly dailyReplaceCap?: number;
  readonly attemptTimeoutMs?: number;
  readonly wallLimitMs?: number;
}

interface FillAttempt {
  readonly endpoint: string;
  readonly status?: number;
  readonly result:
    | "ok"
    | "status"
    | "error"
    | "encoding"
    | "not-json"
    | "no-timestamp"
    | "future-timestamp"
    | "remark"
    | "incomplete"
    | "too-large";
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
    /** A replace within {@link REPLACE_MIN_GAP_MS} of the cell's last one. */
    | "too-soon"
    | "failed"
    | "kept-newer"
    | "missing";
  readonly attempts: readonly FillAttempt[];
  readonly endpoint?: string;
  readonly osmBase?: string;
  /** Decoded size: the length of a raw answer, the gzip trailer's ISIZE. */
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

interface Fetched {
  /** The body as the operator sent it, gzip or not. */
  readonly bytes: Uint8Array;
  readonly gzip: boolean;
  readonly osmBase: string;
  readonly endpoint: string;
  /** Decoded size: the raw length, or the gzip trailer's ISIZE. */
  readonly rawBytes: number;
}

type AnswerCheck =
  | {
      readonly ok: true;
      readonly osmBase: string;
      readonly gzip: boolean;
      readonly rawBytes: number;
    }
  | { readonly ok: false; readonly reason: FillAttempt["result"] };

/** Whether the first byte that is not JSON whitespace is `{`. */
function startsWithBrace(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      continue;
    }
    return byte === 0x7b;
  }
  return false;
}

/** The full head and tail check of an answer held uncompressed. */
function checkRaw(bytes: Uint8Array, now: number): AnswerCheck {
  if (bytes.length > MAX_TILE_DECODED_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  const check = checkOverpassBody(bytes, now);
  return check.ok ? { ...check, gzip: false, rawBytes: bytes.length } : check;
}

/**
 * An uncompressed answer gets the full head and tail check; a gzip one
 * only its inflated head (a bounded cost), as its tail is reached only by
 * inflating the whole tile, plus the size bounds its length and trailer
 * give for free. A body labelled gzip that is plain JSON (a hop decoded it
 * and kept the header) is checked and stored as raw. Any other encoding
 * was never asked for.
 */
async function checkAnswer(
  bytes: Uint8Array,
  contentEncoding: string | null,
  now: number,
): Promise<AnswerCheck> {
  const encoding = (contentEncoding ?? "").trim().toLowerCase();
  if (encoding === "" || encoding === "identity") return checkRaw(bytes, now);
  if (encoding !== "gzip") return { ok: false, reason: "encoding" };
  if (!hasGzipMagic(bytes)) {
    return startsWithBrace(bytes)
      ? checkRaw(bytes, now)
      : { ok: false, reason: "encoding" };
  }
  const rawBytes = gzipDecodedSize(bytes);
  if (rawBytes === undefined) return { ok: false, reason: "encoding" };
  if (bytes.length > MAX_TILE_GZIP_BYTES || rawBytes > MAX_TILE_DECODED_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  let head: Uint8Array;
  try {
    head = await inflateHead(bytes, BODY_HEAD_BYTES);
  } catch {
    return { ok: false, reason: "encoding" };
  }
  const check = checkOverpassHead(new TextDecoder().decode(head), now);
  return check.ok ? { ...check, gzip: true, rawBytes } : check;
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
  // A replace refetches a stored tile whatever its age; with none stored
  // there is nothing to replace (an ordinary fill brings it).
  if (message.kind === "replace" && existing === null) {
    return { outcome: "missing" };
  }
  if (
    message.kind !== "replace" &&
    existing !== null &&
    existingBase !== undefined
  ) {
    const age = now - Date.parse(existingBase);
    if (age < REFRESH_AGE_MS) return { outcome: "fresh" };
  }
  const failure = await readFailure(deps.bucket, message.cell);
  if (failure !== undefined && failure.retryAt > now) {
    return { outcome: "backoff" };
  }
  if (message.kind === "replace") {
    const last = await readLastReplace(deps.bucket, message.cell);
    if (last !== undefined && now - last < REPLACE_MIN_GAP_MS) {
      return { outcome: "too-soon" };
    }
  }
  const daily = await readDaily(deps.bucket, now);
  if (budgetSpent(daily, deps, message.kind === "replace")) {
    return { outcome: "cap" };
  }
  return existingBase === undefined ? {} : { existingBase };
}

async function attemptOnce(
  endpoint: string,
  query: string,
  deps: FillDeps,
): Promise<{ attempt: FillAttempt; fetched?: Fetched }> {
  const started = deps.now();
  const elapsed = (): number => Math.max(0, deps.now() - started);
  // `encodeResponseBody: "manual"` (workerd; Node ignores it) hands over
  // the body as the operator encoded it, so a gzip answer is stored as is.
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "User-Agent": deps.userAgent,
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(
      deps.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
    ),
    encodeResponseBody: "manual",
  } as RequestInit;
  try {
    const response = await deps.fetchImpl(endpoint, init);
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return {
        attempt: {
          endpoint,
          status: response.status,
          result: "status",
          ms: elapsed(),
        },
      };
    }
    // The bytes as sent: no JSON.parse (CPU), only the bounded checks.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const check = await checkAnswer(
      bytes,
      response.headers.get("content-encoding"),
      deps.now(),
    );
    const base = { endpoint, status: 200, ms: elapsed(), bytes: bytes.length };
    if (!check.ok) return { attempt: { ...base, result: check.reason } };
    return {
      attempt: { ...base, result: "ok" },
      fetched: {
        bytes,
        gzip: check.gzip,
        osmBase: check.osmBase,
        endpoint,
        rawBytes: check.rawBytes,
      },
    };
  } catch {
    return { attempt: { endpoint, result: "error", ms: elapsed() } };
  }
}

/**
 * The operators in turn, never in parallel. Each request is counted in the
 * daily state BEFORE it is sent, so a fill the runtime kills mid-way still
 * counts against the cap; a replace's request counts in its share too.
 */
async function fetchFromOperators(
  cell: string,
  deps: FillDeps,
  started: number,
  replace: boolean,
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
    if (budgetSpent(daily, deps, replace)) break;
    await writeDaily(deps.bucket, now, {
      ...daily,
      upstreamRequests: daily.upstreamRequests + 1,
      replaceRequests: daily.replaceRequests + (replace ? 1 : 0),
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
): Promise<void> {
  const { gzip, bytes } = fetched;
  await deps.bucket.put(tileObjectKey(cell), bytes, {
    httpMetadata: {
      contentType: "application/json",
      ...(gzip ? { contentEncoding: "gzip" } : {}),
      cacheControl: TILE_CACHE_CONTROL,
    },
    customMetadata: {
      osmBase: fetched.osmBase,
      filledAt: new Date(deps.now()).toISOString(),
      endpoint: new URL(fetched.endpoint).hostname,
      // `checked: head` - the tail of a gzip answer is the reader's check
      // (a viewer's report and the verify job), see fill-tile.ts.md.
      storedAs: gzip ? "upstream-gzip" : "raw",
      checked: gzip ? "head" : "full",
      rawBytes: String(fetched.rawBytes),
    },
  });
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
  // A replace is bounded by its own gap and budget share, not by the bad
  // count: a report is no evidence the tile is bad, so it must not lengthen
  // the backoff a genuine bad tile of the cell earns later. The gap is
  // written up front, so a replace the runtime kills still counts.
  const replace = message.kind === "replace";
  if (replace) await writeLastReplace(deps.bucket, message.cell, started);
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
    replace,
  );
  if (fetched === undefined) {
    const reason = attempts.at(-1)?.result ?? "cap";
    await writeFailure(deps.bucket, message.cell, { ...pending, reason });
    await bumpDaily(deps, (d) => ({ ...d, failures: d.failures + 1 }));
    return done("failed", { attempts });
  }
  const { rawBytes } = fetched;
  const facts = {
    attempts,
    endpoint: new URL(fetched.endpoint).hostname,
    osmBase: fetched.osmBase,
    rawBytes,
  };
  // ISO-8601 UTC strings of one format compare correctly as text. A
  // replace stores the answer even when it is not newer: the stored tile
  // is the one a viewer could not use.
  if (
    !replace &&
    pre.existingBase !== undefined &&
    fetched.osmBase <= pre.existingBase
  ) {
    await clearFailure(deps.bucket, message.cell);
    return done("kept-newer", facts);
  }
  await store(message.cell, fetched, deps);
  const storedBytes = fetched.bytes.length;
  await clearFailure(deps.bucket, message.cell);
  if (replace) await clearVerified(deps.bucket, message.cell);
  await bumpDaily(deps, (d) => ({
    ...d,
    fills: d.fills + 1,
    rawBytes: d.rawBytes + rawBytes,
    storedBytes: d.storedBytes + storedBytes,
  }));
  return done("filled", { ...facts, storedBytes });
}
