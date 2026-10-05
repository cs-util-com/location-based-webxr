/**
 * Why this test matters: a tour's manifest records each file as SHA-256
 * hex, and the check compares strings. Upper case, a missing leading zero
 * per byte, or a hash of the wrong bytes (a view's whole buffer instead of
 * the view) would make every honest tour read as modified. The vectors are
 * the FIPS 180-2 examples.
 */

import { describe, expect, it } from 'vitest';

import { bytesToHex, sha256Hex } from './sha256-hex';

describe('sha256Hex', () => {
  it('hashes the FIPS 180-2 examples', async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    await expect(sha256Hex(new TextEncoder().encode('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('hashes only the bytes a view covers, not its whole buffer', async () => {
    const buffer = new TextEncoder().encode('xxabcxx');
    await expect(sha256Hex(buffer.subarray(2, 5))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('accepts an ArrayBuffer', async () => {
    await expect(
      sha256Hex(new TextEncoder().encode('abc').buffer)
    ).resolves.toMatch(/^ba7816bf/);
  });
});

describe('bytesToHex', () => {
  it('pads every byte to two lowercase digits', () => {
    expect(bytesToHex(Uint8Array.from([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});
