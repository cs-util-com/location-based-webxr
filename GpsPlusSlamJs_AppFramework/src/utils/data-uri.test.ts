/**
 * Why these tests matter: glTF carries buffers and pictures as base64
 * `data:` URIs, and the text is untrusted (a creator's `.gltf`, a tour's
 * `.glb`). The decoder must refuse a URI whose decoded size passes the cap
 * BEFORE it allocates (a short header can announce a huge payload only
 * through its length, which is checked first), must report that size so
 * a refusal can say how large the data really is, and must never accept
 * anything but strict base64, so a garbled file is a refusal in words,
 * not a half-decoded buffer.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { decodeDataUri, decodedLengthOf, isDataUri } from './data-uri.js';

const encode = (bytes: Uint8Array, mime = 'application/octet-stream') =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

describe('decodeDataUri', () => {
  it('decodes a base64 URI and reads its MIME type', () => {
    const result = decodeDataUri(
      encode(Uint8Array.of(1, 2, 3), 'image/png'),
      10
    );
    expect(result).toEqual({
      ok: true,
      bytes: Uint8Array.of(1, 2, 3),
      mime: 'image/png',
    });
  });

  it('takes parameters before ;base64 and an empty MIME type', () => {
    const withParam = decodeDataUri(
      'data:text/plain;charset=utf-8;base64,AAE=',
      9
    );
    expect(withParam).toEqual({
      ok: true,
      bytes: Uint8Array.of(0, 1),
      mime: 'text/plain',
    });
    const bare = decodeDataUri('data:;base64,AAE=', 9);
    expect(bare).toEqual({ ok: true, bytes: Uint8Array.of(0, 1), mime: '' });
  });

  it('refuses a URI that is not strict base64, or not a data URI', () => {
    for (const uri of [
      'data:,hello',
      'data:text/plain,%41',
      'data:;base64,AA E=',
      'data:;base64,A',
      'data:;base64,AAE=AAE=',
      'data:;base64,AA*=',
      'data;base64,AAE=',
      'https://example.invalid/x.bin',
      '',
    ]) {
      expect(decodeDataUri(uri, 100), uri).toEqual({
        ok: false,
        why: 'malformed',
      });
    }
  });

  it('refuses an over-cap URI from its length alone, before decoding, and says how large it is', () => {
    // A payload of 4 MiB of "A" decodes to 3 MiB; at a 1 MiB cap the
    // refusal must come without the decode (a malformed tail proves it:
    // decoding first would report "malformed").
    const uri = 'data:;base64,' + 'A'.repeat(4 * 1024 * 1024 - 4) + 'A*==';
    expect(decodeDataUri(uri, 1024 * 1024)).toEqual({
      ok: false,
      why: 'too-large',
      size: 3 * 1024 * 1024 - 2,
    });
  });

  // three.js reads a URI as data by /^data:.*,.*$/i and hands it to fetch,
  // where the scheme and the ";base64" token are matched in any letter
  // case. A case-sensitive decoder refused such a URI as "broken" while
  // three would have loaded it: a false refusal of a readable model.
  it('decodes the scheme and the base64 token in any letter case', () => {
    for (const uri of ['DATA:;base64,AAE=', 'Data:x/y;BASE64,AAE=']) {
      expect(decodeDataUri(uri, 9), uri).toEqual({
        ok: true,
        bytes: Uint8Array.of(0, 1),
        mime: expect.any(String),
      });
    }
  });

  it('accepts a URI of exactly the cap', () => {
    const result = decodeDataUri(encode(new Uint8Array(30)), 30);
    expect(result.ok).toBe(true);
  });
});

describe('decodeDataUri, properties', () => {
  it('round-trips any bytes and any cap at least their length', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 300 }),
        fc.nat(50),
        (bytes, slack) => {
          const result = decodeDataUri(encode(bytes), bytes.length + slack);
          expect(result).toEqual({
            ok: true,
            bytes,
            mime: 'application/octet-stream',
          });
        }
      )
    );
  });

  it('refuses every URI whose bytes exceed the cap with their exact size', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 300 }),
        fc.nat(300),
        (bytes, under) => {
          const payload = Buffer.from(bytes).toString('base64');
          expect(decodedLengthOf(payload)).toBe(bytes.length);
          const cap = Math.max(0, bytes.length - 1 - under);
          expect(decodeDataUri(encode(bytes), cap)).toEqual({
            ok: false,
            why: 'too-large',
            size: bytes.length,
          });
        }
      )
    );
  });

  it('never throws on any string', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(1000), (text, cap) => {
        expect(() => decodeDataUri(text, cap)).not.toThrow();
        expect(() => decodeDataUri('data:;base64,' + text, cap)).not.toThrow();
      })
    );
  });
});

/**
 * Why these tests matter: `isDataUri` is the one place every reader of a
 * model's URIs asks whether a URI is embedded data or something three.js
 * would resolve and fetch. It must answer exactly as three's own test
 * (`LoaderUtils.resolveURL`, /^data:.*,.*$/i): a stricter answer refuses
 * models three reads, a looser one lets through a URI three fetches.
 */
describe('isDataUri', () => {
  it('answers as three.js reads a URI: a comma, no line break, any case', () => {
    for (const uri of ['data:,', 'data:;base64,AAE=', 'DATA:x,y', 'dAtA:,']) {
      expect(isDataUri(uri), uri).toBe(true);
    }
    for (const uri of [
      'data:x',
      'data:\n,AAAA',
      'data:,A\nA',
      ' data:,',
      'x.bin',
      7,
      null,
    ]) {
      expect(isDataUri(uri), JSON.stringify(uri)).toBe(false);
    }
  });

  it('agrees with three.js on any string', () => {
    const three = /^data:.*,.*$/i;
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc
            .tuple(fc.constantFrom('data:', 'DATA:', 'DaTa:'), fc.string())
            .map(([a, b]) => a + b)
        ),
        (uri) => {
          expect(isDataUri(uri)).toBe(three.test(uri));
        }
      )
    );
  });
});
