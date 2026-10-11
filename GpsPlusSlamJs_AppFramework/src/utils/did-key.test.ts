/**
 * Why this test matters: the author of a signed tour is named by a
 * `did:key` (tour kit plan K1, K-D2), and the signature check imports the
 * key those characters encode. The vectors are the W3C CCG did:key spec's
 * own Ed25519 examples, whose decoded bytes (multicodec 0xed 0x01, then 32
 * key bytes) were taken with an independent BigInt base58 decoder - so a
 * wrong prefix, a wrong multibase letter or a truncated key fails here,
 * not as "bad signature" for an honest author.
 */

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { decodeBase58btc } from './base58btc';
import type * as Base58 from './base58btc';
import {
  didKeyToEd25519PublicKey,
  ed25519PublicKeyToDidKey,
  isDidKeyEd25519,
} from './did-key';

// The decoder, spied on (it still decodes): the length check must refuse
// a wrong-sized did:key BEFORE the quadratic decode runs.
vi.mock('./base58btc', async (importOriginal) => {
  const original = await importOriginal<typeof Base58>();
  return { ...original, decodeBase58btc: vi.fn(original.decodeBase58btc) };
});

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

const SPEC_VECTORS = [
  [
    'did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP',
    '095f9a1a595dde755d82786864ad03dfa5a4fbd68832566364e2b65e13cc9e44',
  ],
  [
    'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    '2e6fcce36701dc791488e0d0b1745cc1e33a4c1c9fcc41c63bd343dbbe0970e6',
  ],
] as const;

describe('did:key (Ed25519)', () => {
  it.each(SPEC_VECTORS)('%s carries the key %s', (did, keyHex) => {
    const key = didKeyToEd25519PublicKey(did);
    expect(key === null ? null : hex(key)).toBe(keyHex);
    expect(ed25519PublicKeyToDidKey(fromHex(keyHex))).toBe(did);
    expect(isDidKeyEd25519(did)).toBe(true);
  });

  it.each([
    ['another DID method', 'did:web:example.com'],
    ['a non-base58btc multibase', 'did:key:m7QFr'],
    [
      'a key of another type (secp256k1, 0xe7)',
      'did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme',
    ],
    [
      'a truncated Ed25519 key',
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2do',
    ],
    [
      'a look-alike character',
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doO',
    ],
    ['not a string', 42],
  ])('refuses %s', (_label, value) => {
    expect(isDidKeyEd25519(value)).toBe(false);
    expect(didKeyToEd25519PublicKey(value)).toBeNull();
  });

  it('names every Ed25519 key with a 47-character body (both spec vectors, and the property below)', () => {
    // The 34 bytes start 0xed 0x01, so the number they spell lies between
    // 0xed01 * 2^256 and 0xed02 * 2^256 - 1, and both ends are 47 base58
    // digits (measured with a BigInt encoder). The length is exact, so the
    // decoder can refuse any other length before doing any work.
    for (const [did] of SPEC_VECTORS) {
      expect(did.length - 'did:key:z'.length).toBe(47);
    }
  });

  it('refuses a did:key of any other length without decoding it', () => {
    // Why: an author string comes from any opened tour. base58 decoding is
    // quadratic in the length: 60,000 characters took 2.8 s (measured
    // before the length check) and a longer one hangs the tab. So the
    // decoder must never see one - asserted on the call, not on a clock.
    const decode = vi.mocked(decodeBase58btc);
    decode.mockClear();
    const [valid] = SPEC_VECTORS[0];
    for (const did of [
      `did:key:z6Mk${'z'.repeat(60_000)}`,
      `${valid}z`,
      valid.slice(0, -1),
    ]) {
      expect(isDidKeyEd25519(did)).toBe(false);
    }
    expect(decode).not.toHaveBeenCalled();
    expect(isDidKeyEd25519(valid)).toBe(true);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('refuses to encode a key that is not 32 bytes', () => {
    expect(() => ed25519PublicKeyToDidKey(new Uint8Array(31))).toThrow(
      TypeError
    );
  });

  it('decode(encode(key)) is the identity for every 32-byte key (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (key) => {
        const did = ed25519PublicKeyToDidKey(key);
        expect(did.startsWith('did:key:z6Mk')).toBe(true);
        expect(did.length).toBe('did:key:z'.length + 47);
        expect(didKeyToEd25519PublicKey(did)).toEqual(key);
      })
    );
  });
});
