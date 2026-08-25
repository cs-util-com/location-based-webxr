import { describe, expect, it } from 'vitest';

import {
  probeRemote,
  RemoteRangeByteSource,
} from './remote-range-byte-source.js';
import { StructuralReadError } from './structural-read-error.js';

/** A minimal Response-shaped fake for header-controlled probe tests — the real
 *  Response constructor manages `Content-Length` itself, so forcing a bogus
 *  value needs a hand-rolled shape. */
function fakeResponse(init: {
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
}): Response {
  const bytes = init.body ?? new Uint8Array(0);
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    headers: new Headers(init.headers ?? {}),
    arrayBuffer: () =>
      Promise.resolve(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)
      ),
    body: null,
  } as unknown as Response;
}

/**
 * Why this test matters: Node's global `fetch` (undici) tolerates being called
 * through an arbitrary receiver — `this.someField(...)` — so an integration
 * suite that injects the real Node `fetch` stays green even while
 * `RemoteRangeByteSource` is silently broken. A *browser* `fetch` is a WebIDL
 * "unforgeable" method: it brand-checks its receiver and throws
 * `TypeError: Illegal invocation` when invoked as `obj.method()` on anything
 * other than the global scope. This fake reproduces exactly that brand check
 * without needing a browser.
 */

/** Mimics a browser-native `fetch`: throws if invoked with a foreign receiver. */
function browserLikeFetch(): typeof fetch {
  return function fetchImpl(this: unknown): Promise<Response> {
    if (this !== undefined) {
      throw new TypeError('Illegal invocation');
    }
    return Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { 'content-range': 'bytes 0-2/3' },
      })
    );
  };
}

describe('RemoteRangeByteSource', () => {
  it('reads without rebinding `this` on the injected fetch', async () => {
    const source = new RemoteRangeByteSource(
      'https://example.com/archive.zip',
      3,
      browserLikeFetch()
    );

    await expect(source.read(0, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('passes an abort signal so a hung connection times out instead of stalling', async () => {
    let seenSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      seenSignal = init?.signal;
      return Promise.resolve(new Response(new Uint8Array(1), { status: 206 }));
    };
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await source.read(0, 1);

    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it('fails a 4xx read structurally — an expired/gone link must not be retried', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(null, { status: 403 }));
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await expect(source.read(0, 1)).rejects.toBeInstanceOf(StructuralReadError);
  });

  it('fails a 5xx read with a plain error — transient, eligible for retry', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(null, { status: 503 }));
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    const err = await source.read(0, 1).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StructuralReadError);
  });

  // Why this test matters (D1): a host (or CDN config change) that ignores
  // `Range` mid-session answers 200 with the WHOLE archive body. Returning that
  // as if it were the requested slice silently corrupts every downstream parse
  // — the worst failure mode this transport can have. It must fail loudly and
  // permanently so the caller re-probes and falls back.
  it('rejects a 200 full-body answer instead of returning the whole archive as a slice', async () => {
    const whole = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(fakeResponse({ status: 200, body: whole }));
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await expect(source.read(2, 3)).rejects.toBeInstanceOf(StructuralReadError);
  });

  // Why this test matters (D1): a 206 whose body is shorter/longer than asked
  // (truncated proxy, hostile server) would shift every later offset.
  it('rejects a 206 whose body length does not match the requested length', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        fakeResponse({ status: 206, body: new Uint8Array([1, 2]) })
      );
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await expect(source.read(2, 3)).rejects.toBeInstanceOf(StructuralReadError);
  });

  // Why this test matters (D1): a readable Content-Range that names a different
  // start means the server answered a different slice — even a correct length
  // would be the wrong bytes.
  it('rejects a 206 whose Content-Range starts at a different offset', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        fakeResponse({
          status: 206,
          headers: { 'content-range': 'bytes 0-2/10' },
          body: new Uint8Array([1, 2, 3]),
        })
      );
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await expect(source.read(2, 3)).rejects.toBeInstanceOf(StructuralReadError);
  });

  // Why this test matters (PR #357 review): a Content-Range that is PRESENT
  // but unparseable must reject — a server can pair a garbage header with an
  // exact-length body for the WRONG offset, and length alone cannot catch
  // that. Absence stays acceptable (CORS-hidden header).
  it('rejects a 206 whose exposed Content-Range is malformed', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        fakeResponse({
          status: 206,
          headers: { 'content-range': 'utter garbage' },
          body: new Uint8Array([1, 2, 3]),
        })
      );
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await expect(source.read(2, 3)).rejects.toBeInstanceOf(StructuralReadError);
  });

  // Why this test matters: `Content-Range` is NOT CORS-safelisted, and e.g.
  // raw.githubusercontent sends no Access-Control-Expose-Headers — so in a real
  // browser the header is often unreadable (null) on a perfectly good 206.
  // Requiring it (as the original review suggested) would break the primary
  // demo host; validation must be opportunistic, with the body-length check as
  // the always-on guard.
  it('accepts a 206 with an unreadable Content-Range when the body length matches', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        fakeResponse({ status: 206, body: new Uint8Array([1, 2, 3]) })
      );
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await expect(source.read(2, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  // Why this test matters (D2): `bytes=X-(X-1)` is an invalid Range header; a
  // zero-length read (zip.js probing at EOF) must resolve empty locally, not
  // reach the network at all.
  it('resolves a zero-length read empty without fetching', async () => {
    const fetchImpl: typeof fetch = () => {
      throw new Error('must not fetch for a zero-length read');
    };
    const source = new RemoteRangeByteSource('https://x/t.zip', 10, fetchImpl);

    await expect(source.read(5, 0)).resolves.toEqual(new Uint8Array(0));
  });
});

describe('probeRemote', () => {
  // Why this test matters (D3): a failed HEAD (404/403 error page) still
  // carries a Content-Length — of the ERROR PAGE. Adopting it as the archive
  // size anchors every zip offset to garbage.
  it('ignores Content-Length from a failed HEAD', async () => {
    let call = 0;
    const fetchImpl: typeof fetch = () => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          fakeResponse({ status: 404, headers: { 'content-length': '1234' } })
        );
      }
      return Promise.resolve(
        fakeResponse({ status: 206, body: new Uint8Array(1) })
      );
    };

    const probe = await probeRemote('https://x/t.zip', fetchImpl);

    expect(probe.status).toBe(206);
    expect(probe.size).toBeNull(); // never 1234
  });

  // Why this test matters (cache revalidation): the orchestrator compares a
  // cached copy against the live file using validators captured here.
  // Last-Modified is CORS-safelisted; ETag often is not — both must surface
  // when readable, from the HEAD or (when HEAD fails) from the probe GET.
  it('captures ETag and Last-Modified validators from the responses', async () => {
    let call = 0;
    const fetchImpl: typeof fetch = () => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          fakeResponse({
            status: 200,
            headers: {
              'content-length': '10',
              etag: '"v1"',
              'last-modified': 'Mon, 24 Aug 2026 00:00:00 GMT',
            },
          })
        );
      }
      return Promise.resolve(
        fakeResponse({ status: 206, body: new Uint8Array(1) })
      );
    };

    const probe = await probeRemote('https://x/t.zip', fetchImpl);

    expect(probe.size).toBe(10);
    expect(probe.validators).toEqual({
      etag: '"v1"',
      lastModified: 'Mon, 24 Aug 2026 00:00:00 GMT',
    });
  });

  // Why this test matters (PR #357 review): a HEAD Content-Length and a 206
  // Content-Range total that DISAGREE mean the host is confused about the
  // archive's size — anchoring zip offsets to either guess risks corrupt
  // reads. The size degrades to unknown (→ full-download) instead.
  it('drops the size when HEAD and Content-Range disagree about it', async () => {
    let call = 0;
    const fetchImpl: typeof fetch = () => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          fakeResponse({ status: 200, headers: { 'content-length': '10' } })
        );
      }
      return Promise.resolve(
        fakeResponse({
          status: 206,
          headers: { 'content-range': 'bytes 0-0/999' },
          body: new Uint8Array(1),
        })
      );
    };

    const probe = await probeRemote('https://x/t.zip', fetchImpl);

    expect(probe.size).toBeNull();
  });

  it('falls back to the probe GET headers for validators when HEAD fails', async () => {
    let call = 0;
    const fetchImpl: typeof fetch = () => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(fakeResponse({ status: 405 }));
      }
      return Promise.resolve(
        fakeResponse({
          status: 206,
          headers: { etag: '"v2"' },
          body: new Uint8Array(1),
        })
      );
    };

    const probe = await probeRemote('https://x/t.zip', fetchImpl);

    expect(probe.validators).toEqual({ etag: '"v2"' });
  });

  // Why this test matters (D3): `Number('abc')` is NaN and `NaN ?? fallback`
  // never falls back — an unvalidated Content-Length propagates NaN into
  // ProbeResult.size. Only finite safe non-negative integers may pass.
  it.each(['abc', '-5', '9007199254740993', 'Infinity'])(
    'rejects unusable Content-Length %s instead of adopting it',
    async (badLength) => {
      let call = 0;
      const fetchImpl: typeof fetch = () => {
        call += 1;
        if (call === 1) {
          return Promise.resolve(
            fakeResponse({
              status: 200,
              headers: { 'content-length': badLength },
            })
          );
        }
        return Promise.resolve(
          fakeResponse({ status: 206, body: new Uint8Array(1) })
        );
      };

      const probe = await probeRemote('https://x/t.zip', fetchImpl);

      expect(probe.size).toBeNull();
    }
  );
});
