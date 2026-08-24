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
import { parseContentRangeTotal, type ProbeResult } from './range-probe.js';
import { StructuralReadError } from './structural-read-error.js';

export type FetchImpl = typeof fetch;

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

/** HEAD for size + `bytes=0-0` GET for range support. Throws if `fetch` rejects. */
export async function probeRemote(
  url: string,
  fetchImpl: FetchImpl
): Promise<ProbeResult> {
  let size: number | null = null;
  try {
    const head = await fetchImpl(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    const len = head.headers.get('content-length');
    if (len !== null && len !== '') size = Number(len);
  } catch {
    // Some hosts reject HEAD; fall through and let the range GET decide. A hard
    // network/CORS failure will re-throw from the GET below.
  }

  const probe = await fetchImpl(url, {
    headers: { Range: 'bytes=0-0' },
    signal: AbortSignal.timeout(PROBE_GET_TIMEOUT_MS),
  });

  if (probe.status === 200) {
    const body = new Uint8Array(await probe.arrayBuffer());
    return { status: 200, size: size ?? body.length, body };
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
  return { status: probe.status, size };
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
    const end = offset + length - 1;
    // The timeout turns a *hanging* connection into a rejection, so a
    // transient-retry policy above this module actually gets to run (a stall
    // would otherwise never fail and strand the caller forever).
    const res = await this.#fetch(this.#url, {
      headers: { Range: `bytes=${offset}-${end}` },
      signal: AbortSignal.timeout(RANGE_READ_TIMEOUT_MS),
    });
    if (!res.ok) {
      const message = `range read failed (${res.status}) at ${offset}-${end}`;
      // 4xx is permanent for this URL (expired signed link, file gone, bad
      // range) — retrying with backoff cannot fix it, so fail structurally.
      if (res.status >= 400 && res.status < 500) {
        throw new StructuralReadError(message);
      }
      throw new Error(message);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
