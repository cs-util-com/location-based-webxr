/**
 * HTTP Range reads straight against a hosted archive, plus the opening probe.
 *
 * The probe issues a HEAD (total size from the CORS-safelisted
 * `Content-Length`, which every provider exposes — unlike `Content-Range`)
 * and a `Range: bytes=0-0` GET (support detection). A `fetch` rejection here
 * — a CORS block or a dropped connection — propagates so the caller can map
 * it to a fatal error: a CORS-blocked link is unrecoverable, since it defeats
 * both the range path and the full-body fallback.
 */

import type { ByteSource } from './byte-source.js';
import {
  parseContentRangeTotal,
  type ArchiveValidators,
  type ProbeResult,
} from './range-probe.js';
import { StructuralReadError } from './structural-read-error.js';

export type FetchImpl = typeof fetch;

/** A header value as archive size: finite safe non-negative integer, or null. */
function parseArchiveSize(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Why a range-read response is unusable, or null when it is good. A 200 means
 * the host ignored `Range` and streamed the full file — returning that body as
 * the slice would silently corrupt every downstream parse, so it is permanent
 * for this URL (the caller must re-probe and fall back). 4xx (expired signed
 * link, file gone, bad range) is likewise permanent; anything else non-206 is
 * transient. A readable `Content-Range` naming different offsets means the
 * server answered a different slice — but the header is not CORS-safelisted
 * (e.g. raw.githubusercontent exposes no headers), so null is normal and the
 * caller's body-length check stays the always-on guard.
 */
function classifyRangeResponse(
  status: number,
  contentRange: string | null,
  offset: number,
  end: number
): Error | null {
  if (status === 200) {
    return new StructuralReadError(
      `host ignored Range (200) at ${offset}-${end} — fall back to a full download`
    );
  }
  if (status !== 206) {
    const message = `range read failed (${status}) at ${offset}-${end}`;
    return status >= 400 && status < 500
      ? new StructuralReadError(message)
      : new Error(message);
  }
  if (contentRange !== null) {
    const m = /^bytes\s+(\d+)-(\d+)\//.exec(contentRange.trim());
    if (m && (Number(m[1]) !== offset || Number(m[2]) !== end)) {
      return new StructuralReadError(
        `server answered range ${contentRange} instead of ${offset}-${end}`
      );
    }
  }
  return null;
}

/** A HEAD is headers-only — anything slower than this is a hung connection. */
const HEAD_TIMEOUT_MS = 15_000;
/** The probe GET may legitimately stream the whole archive (a 200 from a
 *  range-refusing host becomes the eager-local body), so its budget must cover
 *  a full download on a slow cellular link, not just headers. */
const PROBE_GET_TIMEOUT_MS = 300_000;
/** A range read returns a small slice; a stalled one must fail fast so a
 *  transient-retry policy above this module gets a chance instead of hanging
 *  forever on a dead connection. */
const RANGE_READ_TIMEOUT_MS = 20_000;

/** Freshness validators readable off a response, where CORS lets us. */
function readValidators(headers: Headers): ArchiveValidators | undefined {
  const etag = headers.get('etag');
  const lastModified = headers.get('last-modified');
  if (etag === null && lastModified === null) return undefined;
  return {
    ...(etag !== null ? { etag } : {}),
    ...(lastModified !== null ? { lastModified } : {}),
  };
}

/**
 * Size + freshness validators via a single HEAD, or null when the HEAD fails
 * or is refused — the lightweight check a cache-revalidating caller runs
 * before deciding whether a full probe is needed at all.
 */
export async function fetchRemoteValidators(
  url: string,
  fetchImpl: FetchImpl
): Promise<{ size: number | null; validators?: ArchiveValidators } | null> {
  try {
    const head = await fetchImpl(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    // Only a SUCCESSFUL HEAD may size the archive: a 404/403 also carries a
    // Content-Length — of the error page. And only a finite safe non-negative
    // integer may pass: `Number('abc')` is NaN, and `NaN ?? fallback` never
    // falls back, so an unvalidated value would propagate into ProbeResult.
    if (!head.ok) return null;
    const validators = readValidators(head.headers);
    return {
      size: parseArchiveSize(head.headers.get('content-length')),
      ...(validators !== undefined ? { validators } : {}),
    };
  } catch {
    // Some hosts reject HEAD; the caller falls through to the range GET. A
    // hard network/CORS failure will re-throw from that GET.
    return null;
  }
}

/** HEAD for size + `bytes=0-0` GET for range support. Throws if `fetch` rejects. */
export async function probeRemote(
  url: string,
  fetchImpl: FetchImpl
): Promise<ProbeResult> {
  const headInfo = await fetchRemoteValidators(url, fetchImpl);
  let size: number | null = headInfo?.size ?? null;

  const probe = await fetchImpl(url, {
    headers: { Range: 'bytes=0-0' },
    signal: AbortSignal.timeout(PROBE_GET_TIMEOUT_MS),
  });
  // Prefer HEAD validators; when HEAD failed, the probe GET's own headers
  // still carry them on many hosts.
  const validators = headInfo?.validators ?? readValidators(probe.headers);
  const validatorsField =
    validators !== undefined ? { validators } : ({} as const);

  if (probe.status === 200) {
    const body = new Uint8Array(await probe.arrayBuffer());
    return { status: 200, size: size ?? body.length, body, ...validatorsField };
  }

  // On a 206, if HEAD gave no size, recover it from Content-Range — this is
  // what makes the loader work behind a CORS proxy (or any host that answers
  // a ranged GET but no HEAD Content-Length). The proxy must expose
  // Content-Range.
  if (probe.status === 206 && size === null) {
    size = parseContentRangeTotal(probe.headers.get('content-range'));
  }

  // Drain the small range body so the connection can be reused/closed.
  await probe.arrayBuffer().catch(() => undefined);
  return { status: probe.status, size, ...validatorsField };
}

export class RemoteRangeByteSource implements ByteSource {
  readonly size: number;
  readonly #url: string;
  readonly #fetch: FetchImpl;

  constructor(url: string, size: number, fetchImpl: FetchImpl) {
    this.#url = url;
    this.size = size;
    // Wrapped, not stored directly: `this.#fetch(...)` below is a method-style
    // call, so a bare `fetchImpl` reference would run with `this` rebound to
    // this instance. A real browser `fetch` brand-checks its receiver and
    // throws `TypeError: Illegal invocation` for any receiver but the global
    // scope (Node's `fetch` does not enforce this, which is why an
    // integration suite that injects Node's `fetch` never catches it). The
    // wrapper re-invokes `fetchImpl` as a free call, so its own receiver is
    // `undefined`, which every `fetch` implementation accepts.
    this.#fetch = (input, init) => fetchImpl(input, init);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    // `bytes=X-(X-1)` is an invalid Range header — a zero-length read (zip.js
    // probing at EOF) resolves locally, never on the network.
    if (length <= 0) return new Uint8Array(0);
    const end = offset + length - 1;
    // The timeout turns a *hanging* connection into a rejection, so a
    // transient-retry policy above this module actually gets to run (a stall
    // would otherwise never fail and strand the caller forever).
    const res = await this.#fetch(this.#url, {
      headers: { Range: `bytes=${offset}-${end}` },
      signal: AbortSignal.timeout(RANGE_READ_TIMEOUT_MS),
    });
    const failure = classifyRangeResponse(
      res.status,
      res.headers.get('content-range'),
      offset,
      end
    );
    if (failure !== null) {
      // Cancel the body before failing — on a 200 it is the WHOLE archive.
      await res.body?.cancel().catch(() => undefined);
      throw failure;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== length) {
      throw new StructuralReadError(
        `range read at ${offset}-${end} returned ${bytes.length} bytes, expected ${length}`
      );
    }
    return bytes;
  }
}
