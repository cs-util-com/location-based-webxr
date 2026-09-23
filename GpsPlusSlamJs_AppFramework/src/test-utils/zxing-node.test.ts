/**
 * Why this test matters: `zxing-wasm` fetches its `.wasm` from the jsDelivr
 * CDN by default. A unit suite that silently depends on the network is slow,
 * flaky offline and in CI, and tests a binary we never pinned. The loader must
 * instantiate from the installed package file and never call `fetch`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadZxingReaderForNode, readQrCodes } from './zxing-node';

describe('zxing-node test oracle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('instantiates the reader from the local package file without any network fetch', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access is not allowed in unit tests');
    });
    vi.stubGlobal('fetch', fetchSpy);

    await loadZxingReaderForNode();
    const blank = {
      data: new Uint8ClampedArray(64 * 48 * 4).fill(255),
      width: 64,
      height: 48,
    };
    await expect(readQrCodes(blank)).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a buffer whose length does not match width x height x 4', async () => {
    const malformed = {
      data: new Uint8ClampedArray(10),
      width: 64,
      height: 48,
    };
    await expect(readQrCodes(malformed)).rejects.toThrow(RangeError);
  });
});
