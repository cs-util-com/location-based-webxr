/**
 * Downloads and their cost for the feature matching benchmark: timed
 * fetches of model files, and the size and time of runtime code read from
 * the browser's resource timing.
 *
 * @see bench-net.ts.md
 */

/** One downloaded file or group of files. */
export interface DownloadRecord {
  readonly label: string;
  /** Bytes over the wire (compressed, with headers), or the body size of a
   *  cached file; null when the browser hides it. */
  readonly bytes: number | null;
  readonly ms: number;
  /** True when it came from the HTTP cache; null when unknown. */
  readonly cached: boolean | null;
  readonly files: number;
}

/** The fields of a `PerformanceResourceTiming` entry the page reads. */
export interface ResourceLike {
  readonly name: string;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly startTime: number;
  readonly responseEnd: number;
}

/** A thrown value as one log line. */
export function errorText(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}`;
  }
  return String(e);
}

/** Bytes for the log: "-" for unknown, else B, KB or MB (powers of 1000). */
export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) {
    return "-";
  }
  if (n < 1000) {
    return `${String(n)} B`;
  }
  if (n < 1e6) {
    return `${(n / 1e3).toFixed(1)} KB`;
  }
  return `${(n / 1e6).toFixed(2)} MB`;
}

/**
 * The files whose URL starts with `prefix`, summed: bytes (null when any
 * entry hides its size, as a cross-origin entry without Timing-Allow-Origin
 * does), the span from the first start to the last end, and whether every
 * one came from the cache. Null when no entry matches.
 */
export function summarizeResources(
  entries: readonly ResourceLike[],
  prefix: string,
  label: string,
): DownloadRecord | null {
  const mine = entries.filter((e) => e.name.startsWith(prefix));
  if (mine.length === 0) {
    return null;
  }
  const hidden = mine.some((e) => e.encodedBodySize === 0);
  const start = Math.min(...mine.map((e) => e.startTime));
  const end = Math.max(...mine.map((e) => e.responseEnd));
  return {
    label,
    bytes: hidden
      ? null
      : mine.reduce(
          (s, e) =>
            s + (e.transferSize > 0 ? e.transferSize : e.encodedBodySize),
          0,
        ),
    ms: end - start,
    cached: hidden ? null : mine.every((e) => e.transferSize === 0),
    files: mine.length,
  };
}

/**
 * Fetches a file as bytes and times it.
 *
 * @throws Error naming the label, the HTTP status and the URL when the
 *   response is not ok (a 404 becomes one log line, not a blank page).
 */
export async function fetchBytes(
  url: string,
  label: string,
  deps: {
    readonly fetch: (url: string) => Promise<Response>;
    readonly now: () => number;
    readonly lookup?: (url: string) => ResourceLike | undefined;
  },
): Promise<{ bytes: Uint8Array; record: DownloadRecord }> {
  const t0 = deps.now();
  const res = await deps.fetch(url);
  if (!res.ok) {
    throw new Error(`${label}: HTTP ${String(res.status)} for ${url}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ms = deps.now() - t0;
  const entry = deps.lookup?.(url);
  const cached =
    entry && entry.encodedBodySize > 0 ? entry.transferSize === 0 : null;
  return {
    bytes,
    record: { label, bytes: bytes.byteLength, ms, cached, files: 1 },
  };
}

/**
 * What a method needs from the browser to load its code and models, so
 * a unit test can hand it fakes instead of the network.
 */
export interface LoadDeps {
  /** A dynamic `import()` of a pinned CDN module. */
  readonly importModule: (url: string) => Promise<unknown>;
  readonly fetch: (url: string) => Promise<Response>;
  readonly now: () => number;
  /** The page's resource timing entries so far. */
  readonly resources: () => readonly ResourceLike[];
}

/** The resource timing entry of one URL, if the browser kept one. */
export function lookupIn(
  deps: LoadDeps,
): (url: string) => ResourceLike | undefined {
  return (url) => deps.resources().find((e) => e.name === url);
}
