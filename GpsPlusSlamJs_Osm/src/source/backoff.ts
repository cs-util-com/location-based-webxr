/**
 * Retry policy for Overpass requests.
 *
 * Pure functions plus an injected clock, so the whole policy is testable
 * without a single real timer or a single real second of waiting.
 *
 * @see backoff.ts.md
 */

/** HTTP statuses worth retrying. Anything else is a permanent failure. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  429, // Too Many Requests — the quota signal we must respect
  502,
  503,
  504, // Gateway/timeout — routinely returned by loaded public instances
]);

export interface BackoffOptions {
  /** Delay before the first retry, in ms. */
  readonly baseDelayMs?: number;
  /** Upper bound on any single delay, in ms. */
  readonly maxDelayMs?: number;
  /** `random()` in [0, 1). Injected so tests are deterministic. */
  readonly random?: () => number;
}

const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Exponential backoff with full jitter.
 *
 * **Full jitter, not fixed exponential.** Every client of a public Overpass
 * instance that backs off on the same schedule retries in the same instant,
 * which turns one overload into a self-sustaining thundering herd. Randomising
 * the whole interval spreads the retries out, and is the standard AWS
 * "full jitter" formula.
 *
 * @param attempt - 0 for the first retry, 1 for the second, ...
 */
export function backoffDelayMs(
  attempt: number,
  options: BackoffOptions = {},
): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;

  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}

/**
 * Parses a `Retry-After` header into milliseconds.
 *
 * Supports both documented forms: delta-seconds (`"120"`) and an HTTP-date
 * (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Returns `undefined` for anything
 * unparseable rather than guessing — a wrong guess here either hammers a server
 * that asked for room, or stalls for hours.
 *
 * @param now - epoch ms, injected for testability.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now: number,
): number | undefined {
  if (header == null) {
    return undefined;
  }
  const trimmed = header.trim();
  if (trimmed === "") {
    return undefined;
  }

  // delta-seconds. Deliberately digits-only: a negative value is not a valid
  // Retry-After, and must NOT fall through to the date branch.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date. All three RFC 9110 formats (IMF-fixdate, RFC 850, asctime)
  // begin with a day name, so requiring one is a cheap, exact-enough gate.
  //
  // The gate is NOT optional: `Date.parse` is extremely lenient and happily
  // accepts things that are obviously not dates — `Date.parse('-5')` succeeds,
  // which turned a malformed header into a confident "retry now". Guessing is
  // precisely what this function must not do.
  if (!/^[A-Za-z]{3,9},?\s/.test(trimmed)) {
    return undefined;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    return undefined;
  }
  // A date in the past means "retry now", not "retry in the negative past".
  return Math.max(0, at - now);
}

/**
 * The delay to actually wait: the server's `Retry-After` when it gave one,
 * otherwise our own backoff.
 *
 * The server's instruction always wins — it knows its own load, and ignoring it
 * is how a client gets blocked.
 */
export function nextDelayMs(
  attempt: number,
  retryAfterHeader: string | null | undefined,
  now: number,
  options: BackoffOptions = {},
): number {
  const requested = parseRetryAfterMs(retryAfterHeader, now);
  if (requested !== undefined) {
    return Math.min(requested, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  }
  return backoffDelayMs(attempt, options);
}

/** `setTimeout` as a promise, abortable. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** A DOMException-shaped abort error, matching what `fetch` itself throws. */
export function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
