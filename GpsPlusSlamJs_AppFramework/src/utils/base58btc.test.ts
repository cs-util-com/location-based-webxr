/**
 * Why this test matters: a tour's author is named by a `did:key`, whose
 * key bytes are base58btc. A codec that is off by one leading zero, or
 * that accepts a look-alike character (`0`, `O`, `I`, `l` are not in the
 * alphabet), would name a different key or none - and the signature check
 * would fail for an honest author, or the "signed by" line would show a
 * key nobody holds. The vectors are the Bitcoin Core base58 test vectors,
 * cross-checked against an independent BigInt encoder before use.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { decodeBase58btc, encodeBase58btc } from './base58btc';

const VECTORS: readonly (readonly [string, string])[] = [
  ['', ''],
  ['61', '2g'],
  ['626262', 'a3gV'],
  ['636363', 'aPEr'],
  ['73696d706c792061206c6f6e6720737472696e67', '2cFupjhnEsSn59qHXstmK2ffpLv2'],
  [
    '00eb15231dfceb60925886b67d065299925915aeb172c06647',
    '1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L',
  ],
  ['516b6fcd0f', 'ABnLTmg'],
  ['bf4f89001e670274dd', '3SEo3LWLoPntC'],
  ['572e4794', '3EFU7m'],
  ['ecac89cad93923c02321', 'EJDM8drfXA6uyA'],
  ['10c8511e', 'Rt5zm'],
  ['00000000000000000000', '1111111111'],
];

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

describe('base58btc', () => {
  it.each(VECTORS)('encodes %s as %s and back', (hex, text) => {
    expect(encodeBase58btc(fromHex(hex))).toBe(text);
    expect(decodeBase58btc(text)).toEqual(fromHex(hex));
  });

  it.each(['0', 'O', 'I', 'l', '+', ' ', 'z0'])(
    'refuses %j, which is not in the alphabet',
    (text) => {
      expect(decodeBase58btc(text)).toBeNull();
    }
  );

  it('decode(encode(bytes)) is the identity, leading zeros included (property)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 4 }),
        fc.uint8Array({ maxLength: 48 }),
        (zeros, rest) => {
          const bytes = new Uint8Array([
            ...new Array<number>(zeros).fill(0),
            ...rest,
          ]);
          expect(decodeBase58btc(encodeBase58btc(bytes))).toEqual(bytes);
        }
      )
    );
  });
});
