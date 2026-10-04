/**
 * Why this test matters: `manifest.sig.json` is the only thing that ties a
 * tour to its author's key (tour kit plan K1, K-D2). Three outcomes must
 * stay apart, and confusing any two is a security bug or an honest author
 * wrongly accused: a valid signature by the named key; a signature that
 * does not verify (another key, other bytes, a forged author line) - a hard
 * failure; and a browser that cannot check Ed25519 at all, which must read
 * "cannot check", never "valid". Signatures here are made with Node's own
 * WebCrypto Ed25519, the same API a browser exposes.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { encodeBase64Url } from '../utils/qr-payload/base64url';
import { ed25519PublicKeyToDidKey } from '../utils/did-key';
import {
  keyFingerprint,
  parseManifestSignature,
  TOUR_SIGNATURE_CONTEXT,
  verifyManifestSignature,
} from './tour-signature';
import { TourIntegrityError } from './tour-signed-manifest';

const subtle = globalThis.crypto.subtle;

async function keyPair(): Promise<{ privateKey: CryptoKey; did: string }> {
  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, did: ed25519PublicKeyToDidKey(raw) };
}

/** Sign exactly as the format says: the context prefix, then the bytes. */
async function sign(privateKey: CryptoKey, bytes: Uint8Array): Promise<string> {
  const context = new TextEncoder().encode(TOUR_SIGNATURE_CONTEXT);
  const message = new Uint8Array(context.length + bytes.length);
  message.set(context);
  message.set(bytes, context.length);
  const sig = await subtle.sign({ name: 'Ed25519' }, privateKey, message);
  return encodeBase64Url(new Uint8Array(sig));
}

const MANIFEST = new TextEncoder().encode('{"formatVersion":1}');

async function signatureFile(
  bytes = MANIFEST
): Promise<{ text: string; did: string; privateKey: CryptoKey }> {
  const { privateKey, did } = await keyPair();
  const text = JSON.stringify({
    alg: 'Ed25519',
    author: did,
    sig: await sign(privateKey, bytes),
  });
  return { text, did, privateKey };
}

async function kindOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof TourIntegrityError ? err.kind : 'other';
  }
}

describe('verifyManifestSignature', () => {
  it('a signature by the named key over the exact bytes is valid', async () => {
    const { text, did } = await signatureFile();
    await expect(
      verifyManifestSignature(MANIFEST, text)
    ).resolves.toMatchObject({
      kind: 'valid',
      author: did,
    });
  });

  it('a signature over other bytes is a bad signature', async () => {
    const { text } = await signatureFile();
    const other = new TextEncoder().encode('{"formatVersion":1} ');
    expect(await kindOf(() => verifyManifestSignature(other, text))).toBe(
      'bad-signature'
    );
  });

  it('a valid signature with ANOTHER author named is a bad signature (a forged author line)', async () => {
    const { text } = await signatureFile();
    const { did: other } = await keyPair();
    const forged = JSON.stringify({ ...JSON.parse(text), author: other });
    expect(await kindOf(() => verifyManifestSignature(MANIFEST, forged))).toBe(
      'bad-signature'
    );
  });

  it('a signature made WITHOUT the context prefix does not verify (no cross-protocol reuse)', async () => {
    const { privateKey, did } = await keyPair();
    const bare = await subtle.sign({ name: 'Ed25519' }, privateKey, MANIFEST);
    const text = JSON.stringify({
      alg: 'Ed25519',
      author: did,
      sig: encodeBase64Url(new Uint8Array(bare)),
    });
    expect(await kindOf(() => verifyManifestSignature(MANIFEST, text))).toBe(
      'bad-signature'
    );
  });

  it('any single flipped byte of the manifest fails (property)', async () => {
    const { text } = await signatureFile();
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: MANIFEST.length - 1 }),
        fc.integer({ min: 1, max: 255 }),
        async (at, xor) => {
          const flipped = MANIFEST.slice();
          flipped[at] = flipped[at]! ^ xor;
          expect(
            await kindOf(() => verifyManifestSignature(flipped, text))
          ).toBe('bad-signature');
        }
      ),
      { numRuns: 40 }
    );
  });

  it('any single flipped byte of the signature fails (property)', async () => {
    const { text } = await signatureFile();
    const parsed = JSON.parse(text) as { sig: string };
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 63 }),
        fc.integer({ min: 1, max: 255 }),
        async (at, xor) => {
          const sig = Uint8Array.from(
            atob(parsed.sig.replace(/-/g, '+').replace(/_/g, '/')),
            (c) => c.charCodeAt(0)
          );
          sig[at] = sig[at]! ^ xor;
          const tampered = JSON.stringify({
            ...JSON.parse(text),
            sig: encodeBase64Url(sig),
          });
          expect(
            await kindOf(() => verifyManifestSignature(MANIFEST, tampered))
          ).toBe('bad-signature');
        }
      ),
      { numRuns: 40 }
    );
  });

  it('a browser without Ed25519 reads "unsupported", never valid', async () => {
    const { text, did } = await signatureFile();
    const noEd25519 = {
      importKey: () =>
        Promise.reject(
          new DOMException('Algorithm: Unrecognized name', 'NotSupportedError')
        ),
      verify: () => Promise.reject(new Error('unreachable')),
    } as unknown as SubtleCrypto;
    await expect(
      verifyManifestSignature(MANIFEST, text, noEd25519)
    ).resolves.toMatchObject({
      kind: 'unsupported',
      author: did,
    });
  });

  it('a page without WebCrypto (an insecure origin) reads "unsupported" too', async () => {
    const { text } = await signatureFile();
    await expect(
      verifyManifestSignature(MANIFEST, text, null)
    ).resolves.toMatchObject({
      kind: 'unsupported',
    });
  });

  it('a verify that throws something other than NotSupportedError is a bad signature, not "unsupported"', async () => {
    const { text } = await signatureFile();
    const broken = {
      importKey: () =>
        Promise.reject(new DOMException('bad key data', 'DataError')),
    } as unknown as SubtleCrypto;
    expect(
      await kindOf(() => verifyManifestSignature(MANIFEST, text, broken))
    ).toBe('bad-signature');
  });
});

describe('parseManifestSignature', () => {
  const author = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
  const sig = encodeBase64Url(new Uint8Array(64).fill(7));

  it('reads alg, author and the 64-byte signature', () => {
    expect(
      parseManifestSignature(JSON.stringify({ alg: 'Ed25519', author, sig }))
    ).toEqual({
      alg: 'Ed25519',
      author,
      sig,
    });
  });

  it.each([
    ['not JSON', '{'],
    ['another algorithm', JSON.stringify({ alg: 'ES256', author, sig })],
    [
      'an author that is not an Ed25519 did:key',
      JSON.stringify({ alg: 'Ed25519', author: 'me', sig }),
    ],
    [
      'a signature of the wrong length',
      JSON.stringify({ alg: 'Ed25519', author, sig: 'AAAA' }),
    ],
    [
      'a signature that is not base64url',
      JSON.stringify({ alg: 'Ed25519', author, sig: '+/==' }),
    ],
  ])('refuses %s as malformed', (_label, text) => {
    expect(() => parseManifestSignature(text)).toThrow(TourIntegrityError);
    expect(() => parseManifestSignature(text)).toThrow(
      expect.objectContaining({ kind: 'malformed-signature' })
    );
  });
});

describe('keyFingerprint', () => {
  it('is three groups of four hex digits, the same for the same key and different for another', async () => {
    const a = await keyFingerprint(
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
    );
    const b = await keyFingerprint(
      'did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP'
    );
    expect(a).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    expect(
      await keyFingerprint(
        'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
      )
    ).toBe(a);
    expect(b).not.toBe(a);
  });
});
