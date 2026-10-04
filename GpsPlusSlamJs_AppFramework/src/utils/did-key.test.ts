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
import { describe, expect, it } from 'vitest';

import {
  didKeyToEd25519PublicKey,
  ed25519PublicKeyToDidKey,
  isDidKeyEd25519,
} from './did-key';

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
        expect(didKeyToEd25519PublicKey(did)).toEqual(key);
      })
    );
  });
});
