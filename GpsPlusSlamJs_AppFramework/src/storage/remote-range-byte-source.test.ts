import { describe, expect, it } from 'vitest';

import { RemoteRangeByteSource } from './remote-range-byte-source.js';
import { StructuralReadError } from './structural-read-error.js';

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
});
