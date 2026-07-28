/**
 * Parses Overpass's `/api/status` response.
 *
 * Pure string → object. No I/O, so it is trivially testable against
 * byte-for-byte captures of real responses, which is the only way to be sure a
 * parser for an unversioned third-party plain-text format actually works.
 *
 * @see overpass-status.ts.md
 */

/**
 * Rejects a response this module will not guess at.
 *
 * Deliberately loud: a partial parse that defaulted to "plenty of slots" would
 * turn an upstream format change into a quota-burning loop, and one that
 * defaulted to "no slots" would make the client look permanently offline.
 * Neither is a better guess than refusing.
 */
export class OverpassStatusParseError extends Error {
  constructor(
    message: string,
    readonly body: string,
  ) {
    super(`${message} (body: ${JSON.stringify(body.slice(0, 200))})`);
    this.name = "OverpassStatusParseError";
  }
}

/** A parsed `/api/status` snapshot. All times are epoch milliseconds. */
export interface OverpassStatus {
  /** `Connected as:` — the server's identity for this client. */
  readonly clientId: string;
  /**
   * `Current time:` on the SERVER.
   *
   * Recovery waits are computed against this rather than `Date.now()`, so a
   * device with a skewed clock still derives a correct wait from a correct
   * server timestamp.
   */
  readonly serverTimeMs: number;
  /** `Announced endpoint:` — the backend behind the hostname, if reported. */
  readonly announcedEndpoint?: string;
  /** `Rate limit:` verbatim. **`0` means unlimited** — see {@link unlimited}. */
  readonly rateLimit: number;
  /** True when `rateLimit === 0`, i.e. the instance imposes no slot limit. */
  readonly unlimited: boolean;
  /**
   * Slots free at `serverTimeMs`, or `Infinity` when {@link unlimited}.
   *
   * Zero is inferred from the ABSENCE of the `N slots available now.` line,
   * because Overpass omits it entirely rather than printing a zero.
   */
  readonly slotsAvailable: number;
  /** Absolute times at which currently-taken slots free up, in file order. */
  readonly slotsAvailableAtMs: readonly number[];
  /** Rows listed under the running-queries header. */
  readonly runningQueries: number;
  /** Earliest entry of {@link slotsAvailableAtMs}; undefined if none. */
  readonly nextSlotAtMs?: number;
}

const CLIENT_RE = /^Connected as:\s*(\S+)\s*$/m;
const TIME_RE = /^Current time:\s*(\S+)\s*$/m;
const ENDPOINT_RE = /^Announced endpoint:\s*(\S+)\s*$/m;
const RATE_LIMIT_RE = /^Rate limit:\s*(\d+)\s*$/m;
const AVAILABLE_NOW_RE = /^(\d+)\s+slots? available now\.\s*$/m;
const SLOT_AFTER_RE =
  /^Slot available after:\s*(\S+?),\s*in\s*(-?\d+)\s*seconds?\.\s*$/gm;
const RUNNING_HEADER_RE = /^Currently running queries\b.*$/m;

/**
 * @throws {OverpassStatusParseError} when a required field is missing or
 *   unparseable. Unrecognised extra lines are ignored, because the format is
 *   not versioned and a new informational line must not break the client.
 */
export function parseOverpassStatus(body: string): OverpassStatus {
  if (typeof body !== "string" || body.trim() === "") {
    throw new OverpassStatusParseError("Empty /api/status body", body ?? "");
  }

  // Normalise line endings once: CRLF survives proxies and editors, and a
  // stray \r makes an anchored regex miss while leaving parseInt happy.
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

/** @throws {OverpassStatusParseError} — a body with no rate limit is not a status response. */
function readRateLimit(text: string, body: string): number {
  const match = RATE_LIMIT_RE.exec(text);
  if (!match?.[1]) {
    throw new OverpassStatusParseError(
      "No 'Rate limit:' line in /api/status body",
      body,
    );
  }
  return Number.parseInt(match[1], 10);
}

/** @throws {OverpassStatusParseError} — every recovery time is derived from this. */
function readServerTime(text: string, body: string): number {
  const match = TIME_RE.exec(text);
  const parsed = match?.[1] ? Date.parse(match[1]) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new OverpassStatusParseError(
      "Missing or unparseable 'Current time:' in /api/status body",
      body,
    );
  }
  return parsed;
}

/**
 * Absolute recovery times, earliest first.
 *
 * Prefers the absolute timestamp over the `in N seconds` figure, because the
 * relative one is only accurate at the instant the response was generated and
 * we may read it later. Falls back to the relative figure rather than dropping
 * a slot: losing a pending slot makes the budget look healthier than it is,
 * which is the direction that burns quota.
 */
function readPendingSlots(text: string, serverTimeMs: number): number[] {
  const times: number[] = [];
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

/**
 * Free slots. **Absence of the count line IS zero** — Overpass omits it
 * entirely rather than printing a zero.
 */
function readSlotsAvailable(text: string, unlimited: boolean): number {
  if (unlimited) return Number.POSITIVE_INFINITY;
  const match = AVAILABLE_NOW_RE.exec(text);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Rows under the running-queries header.
 *
 * The header is always present and always last, so anything after it is a row.
 * Counted rather than parsed: the client never needs a query's pid or space
 * limit, only how many are in flight.
 */
function countRunningQueries(text: string): number {
  const header = RUNNING_HEADER_RE.exec(text);
  if (!header) return 0;
  return text
    .slice(header.index + header[0].length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "").length;
}

/**
 * Milliseconds to wait before a slot is expected to be free, per this snapshot.
 *
 * `0` when a slot is already free. Computed against the SERVER clock in
 * `status`, then applied to the local one — so a device with a skewed clock
 * still waits the right duration.
 */
export function msUntilNextSlot(status: OverpassStatus): number {
  if (status.slotsAvailable > 0) return 0;
  if (status.nextSlotAtMs === undefined) return 0;
  return Math.max(0, status.nextSlotAtMs - status.serverTimeMs);
}
