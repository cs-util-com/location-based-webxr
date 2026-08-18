/**
 * The range-vs-fallback policy for opening a hosted archive over HTTP, as one
 * pure function.
 *
 * A transport probes a hosted URL with a HEAD (total size from the
 * CORS-safelisted `Content-Length`) plus a `Range: bytes=0-0` GET (support
 * detection), then asks `decideFallback` what to do. Keeping it pure means
 * every branch — including the ones that are a pain to trigger against a real
 * cloud provider — is unit-testable with no network.
 */

/** Total from a `Content-Range: bytes <range>/<total>` header, or null if
 *  unknown/absent/malformed. A `206` always carries this header (or the
 *  unsatisfied-range form with an asterisk in place of the range), so when a
 *  host — or a proxy under the caller's control — exposes it, the archive can
 *  be sized even when HEAD gives no `Content-Length`. `TOTAL` may itself be an
 *  asterisk (unknown), in which case there is nothing usable. */
export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = /^bytes\s+(?:\d+-\d+|\*)\/(\d+)$/.exec(header.trim());
  return m ? Number(m[1]) : null;
}

/** Raw result of the opening probe. */
export interface ProbeResult {
  /** HTTP status of the `Range: bytes=0-0` GET. */
  readonly status: number;
  /** Total archive size from HEAD `Content-Length`, or null if unreadable. */
  readonly size: number | null;
  /** Full body — present only when the host ignored Range and answered 200. */
  readonly body?: Uint8Array;
}

/** Why the probe could not be turned into a usable open — the four causes a
 *  probe itself can produce. A consumer with app-specific fatal causes of its
 *  own (e.g. "the file parsed but its contents were invalid") is expected to
 *  extend this union locally. */
export type RangeProbeRejectCause =
  | 'unusable-link' // no size / opaque response — cannot range or read a body
  | 'cors' // cross-origin read blocked by the browser
  | 'corrupt' // truncated / garbage bytes / 416 on a non-empty archive
  | 'missing'; // 404

/** What the transport should do next. */
export type FallbackDecision =
  | { readonly mode: 'ranges'; readonly size: number }
  | { readonly mode: 'eager-local'; readonly body: Uint8Array }
  | { readonly mode: 'full-download' }
  | { readonly mode: 'reject'; readonly cause: RangeProbeRejectCause };

export function decideFallback(probe: ProbeResult): FallbackDecision {
  if (probe.status === 206) {
    if (probe.size !== null) return { mode: 'ranges', size: probe.size };
    // Ranges work but neither HEAD nor Content-Range yielded a total, and a
    // range-reading zip/archive parser needs the size to anchor its central
    // directory. A plain full download still works — degrade to it instead of
    // rejecting the link.
    return { mode: 'full-download' };
  }
  if (probe.status === 200 && probe.body !== undefined) {
    return { mode: 'eager-local', body: probe.body };
  }
  if (probe.status === 404) {
    return { mode: 'reject', cause: 'missing' };
  }
  if (probe.status === 416) {
    // A 416 on `bytes=0-0` means the archive is empty/unsatisfiable — treat as
    // a broken file, not a usable archive.
    return { mode: 'reject', cause: 'corrupt' };
  }
  return { mode: 'reject', cause: 'unusable-link' };
}
