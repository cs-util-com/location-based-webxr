/**
 * `/api/status` reading for the comparison benchmark; see the sidecar.
 *
 * A faithful plain-Node mirror of `src/source/overpass-status.ts`, which the
 * benchmark scripts cannot import because they run under bare `node`, not
 * vitest. `benchmark-status.test.mjs` parses every captured fixture with BOTH
 * implementations and asserts field-by-field agreement, so this copy cannot
 * drift without a red gate.
 */

import { BENCHMARK_USER_AGENT } from "./benchmark-request.mjs";

const CLIENT_RE = /^Connected as:\s*(\S+)\s*$/m;
const TIME_RE = /^Current time:\s*(\S+)\s*$/m;
const ENDPOINT_RE = /^Announced endpoint:\s*(\S+)\s*$/m;
const RATE_LIMIT_RE = /^Rate limit:\s*(\d+)\s*$/m;
const AVAILABLE_NOW_RE = /^(\d+)\s+slots? available now\.\s*$/m;
const SLOT_AFTER_RE =
  /^Slot available after:\s*(\S+?),\s*in\s*(-?\d+)\s*seconds?\.\s*$/gm;
const RUNNING_HEADER_RE = /^Currently running queries\b.*$/m;

/** Thrown rather than guessed at: see the TypeScript original's rationale. */
export class BenchmarkStatusParseError extends Error {
  constructor(message, body) {
    super(`${message} (body: ${JSON.stringify(String(body).slice(0, 200))})`);
    this.name = "BenchmarkStatusParseError";
  }
}

/**
 * Pure string -> snapshot. Mirrors `parseOverpassStatus`.
 *
 * Decomposed the same way as the TypeScript original, one reader per field, so
 * the two can be compared side by side when the unversioned upstream format
 * next changes.
 */
export function parseStatus(body) {
  if (typeof body !== "string" || body.trim() === "") {
    throw new BenchmarkStatusParseError("Empty /api/status body", body ?? "");
  }
  const text = body.replace(/\r\n?/g, "\n");

  const rateLimit = readRateLimit(text, body);
  const unlimited = rateLimit === 0;
  const serverTimeMs = readServerTime(text, body);
  const slotsAvailableAtMs = readPendingSlots(text, serverTimeMs);
  const announcedEndpoint = ENDPOINT_RE.exec(text)?.[1];

  return {
    clientId: CLIENT_RE.exec(text)?.[1] ?? "unknown",
    serverTimeMs,
    ...(announcedEndpoint === undefined ? {} : { announcedEndpoint }),
    rateLimit,
    unlimited,
    slotsAvailable: readSlotsAvailable(text, unlimited),
    slotsAvailableAtMs,
    runningQueries: countRunningQueries(text),
    ...(slotsAvailableAtMs.length === 0 || unlimited
      ? {}
      : { nextSlotAtMs: slotsAvailableAtMs[0] }),
  };
}

/** A body with no rate limit is not a status response. */
function readRateLimit(text, body) {
  const match = RATE_LIMIT_RE.exec(text);
  if (!match?.[1]) {
    throw new BenchmarkStatusParseError(
      "No 'Rate limit:' line in /api/status body",
      body,
    );
  }
  return Number.parseInt(match[1], 10);
}

/** Every recovery time is derived from this, so an unreadable one is fatal. */
function readServerTime(text, body) {
  const match = TIME_RE.exec(text);
  const parsed = match?.[1] ? Date.parse(match[1]) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new BenchmarkStatusParseError(
      "Missing or unparseable 'Current time:' in /api/status body",
      body,
    );
  }
  return parsed;
}

/** Absence of the count line IS zero: Overpass omits it rather than print one. */
function readSlotsAvailable(text, unlimited) {
  if (unlimited) return Number.POSITIVE_INFINITY;
  const match = AVAILABLE_NOW_RE.exec(text);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Absolute recovery times, earliest first.
 *
 * The absolute timestamp is preferred over the `in N seconds` figure, which is
 * only accurate at the instant the response was generated. Falling back to the
 * relative figure rather than dropping a slot is deliberate: losing a pending
 * slot makes the budget look healthier than it is, which is the direction that
 * burns quota.
 */
function readPendingSlots(text, serverTimeMs) {
  const times = [];
  // A fresh lastIndex per call: the regex is module-scoped and /g is stateful.
  SLOT_AFTER_RE.lastIndex = 0;
  for (const match of text.matchAll(SLOT_AFTER_RE)) {
    const absolute = Date.parse(match[1] ?? "");
    if (Number.isFinite(absolute)) {
      times.push(absolute);
      continue;
    }
    const seconds = Number.parseInt(match[2] ?? "", 10);
    if (Number.isFinite(seconds)) times.push(serverTimeMs + seconds * 1000);
  }
  return times.sort((a, b) => a - b);
}

/** The header is always present and last, so anything after it is a row. */
function countRunningQueries(text) {
  const header = RUNNING_HEADER_RE.exec(text);
  if (!header) return 0;
  return text
    .slice(header.index + header[0].length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "").length;
}

/** Milliseconds until a slot is expected free. Mirrors `msUntilNextSlot`. */
export function msUntilSlot(status) {
  if (status.slotsAvailable > 0) return 0;
  if (status.nextSlotAtMs === undefined) return 0;
  return Math.max(0, status.nextSlotAtMs - status.serverTimeMs);
}

/**
 * `.../api/interpreter` -> `.../api/status`.
 *
 * Derived rather than configured, so the status host can never disagree with
 * the endpoint actually being measured.
 */
export function statusUrlFor(interpreterUrl) {
  if (!interpreterUrl.endsWith("/api/interpreter")) {
    throw new Error(
      `Expected an Overpass interpreter URL, got ${JSON.stringify(interpreterUrl)}`,
    );
  }
  return `${interpreterUrl.slice(0, -"/interpreter".length)}/status`;
}

/**
 * Reads `/api/status` for one endpoint.
 *
 * **Never throws and never blocks the run.** Status reading is an optimisation;
 * when it fails the caller proceeds on the blind cooldown as before. It is
 * equally important that a failed read is not reported as a free slot, because
 * the free-slot count at a refusal is what distinguishes a genuinely busy
 * server from a query killed on arrival — the distinction the 2026-09-19 run
 * could not make about its own three 504s.
 */
export async function fetchStatus({
  url,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The User-Agent is required, not decorative: overpass-api.de answers 406
    // without one. No Accept header — the endpoint serves plain text and 406s
    // on a request it cannot satisfy, so asking for anything is a way to fail.
    const response = await fetchImpl(statusUrlFor(url), {
      signal: controller.signal,
      headers: { "User-Agent": BENCHMARK_USER_AGENT },
    });
    if (!response.ok) {
      return { ok: false, waitMs: 0, error: `HTTP ${response.status}` };
    }
    const status = parseStatus(await response.text());
    return { ok: true, waitMs: msUntilSlot(status), ...status };
  } catch (error) {
    return { ok: false, waitMs: 0, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}
