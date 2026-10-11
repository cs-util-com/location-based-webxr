/**
 * `manifest.sig.json`: an Ed25519 signature over the EXACT bytes of a
 * tour's `manifest.json`, by the key its `author` names as a `did:key`
 * (tour kit plan K1, §4.1, K-D2). Verified through WebCrypto
 * (`crypto.subtle.verify({ name: "Ed25519" })`), never a bundled library.
 *
 * WHAT IS SIGNED: the UTF-8 bytes of {@link TOUR_SIGNATURE_CONTEXT}
 * followed by the manifest file's bytes as stored. The context prefix
 * keeps a signature made for a tour from being valid for anything else
 * the same key might ever sign (domain separation); the exact bytes, not a
 * re-serialisation, mean no JSON canonicalisation scheme has to agree
 * between writer and reader.
 *
 * WHERE ED25519 IS MISSING (§8 D3 honesty rule): every target browser has
 * it as of 2026 (MDN browser-compat-data: Chrome 137, Firefox 129, Safari
 * 17, with Chrome Android, Samsung Internet and iOS mirroring their
 * engines), but an older browser rejects the key import with
 * `NotSupportedError`, and a page served without a secure context has no
 * `crypto.subtle` at all. Both read as `unsupported` - "cannot check the
 * signature on this browser" - never as valid. Any OTHER failure (a key
 * that does not import, a verify that returns false) is a bad signature.
 * Sources are in the sidecar.
 */

import { didKeyToEd25519PublicKey, isDidKeyEd25519 } from '../utils/did-key.js';
import { isRecord } from '../utils/json-guards.js';
import { decodeBase64Url } from '../utils/qr-payload/base64url.js';
import { sha256Hex } from '../utils/sha256-hex.js';
import { TourIntegrityError } from './tour-signed-manifest.js';

/** Prepended to the manifest's bytes before signing (domain separation).
 *  Changing it invalidates every signature ever made: it is a format
 *  constant, not a label. */
export const TOUR_SIGNATURE_CONTEXT = 'tour-kit manifest.json signature v1\n';

const ALG = 'Ed25519';
const SIGNATURE_BYTES = 64;
/**
 * The format of `manifest.sig.json` this module reads (K1 milestone review
 * R9). A newer number, or an algorithm this app does not know, is a file
 * made by a newer app: it reads `newer-format` ("update the app"), never
 * as tampering.
 */
const SIGNATURE_FORMAT = 1;

export interface ManifestSignature {
  readonly formatVersion: typeof SIGNATURE_FORMAT;
  readonly alg: typeof ALG;
  /** The signing key as an Ed25519 did:key. */
  readonly author: string;
  /** The 64-byte signature, unpadded base64url. */
  readonly sig: string;
}

export type SignatureVerdict =
  | { readonly kind: 'valid'; readonly author: string }
  | {
      readonly kind: 'unsupported';
      readonly author: string;
      /** Why the browser cannot check it (for logs, not for visitors). */
      readonly reason: string;
    };

function malformed(message: string): never {
  throw new TourIntegrityError(
    'malformed-signature',
    `manifest.sig.json: ${message}`
  );
}

function newerFormat(what: string): never {
  throw new TourIntegrityError(
    'newer-format',
    `manifest.sig.json ${what} was made with a newer version of the app; update the app to check this tour`
  );
}

/** The format version and algorithm, checked before anything else: a
 *  newer one is `newer-format`, a missing or malformed one
 *  `malformed-signature`. */
function checkSignatureFormat(data: Record<string, unknown>): void {
  const { formatVersion, alg } = data;
  if (
    Number.isSafeInteger(formatVersion) &&
    (formatVersion as number) > SIGNATURE_FORMAT
  ) {
    newerFormat(`format ${String(formatVersion)}`);
  }
  if (formatVersion !== SIGNATURE_FORMAT) {
    malformed(`"formatVersion" must be ${String(SIGNATURE_FORMAT)}`);
  }
  if (typeof alg !== 'string') malformed('"alg" must be an algorithm name');
  if (alg !== ALG) newerFormat(`algorithm "${alg.slice(0, 32)}"`);
}

/** Parse `manifest.sig.json`. Throws {@link TourIntegrityError}:
 *  `newer-format` for a newer format version or an algorithm this app does
 *  not know (checked first, so a newer file's other fields are never
 *  judged), else `malformed-signature`. Unknown fields are ignored. */
export function parseManifestSignature(text: string): ManifestSignature {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    malformed('not readable JSON');
  }
  if (!isRecord(data) || Array.isArray(data))
    malformed('must be a JSON object');
  checkSignatureFormat(data);
  if (!isDidKeyEd25519(data.author)) {
    malformed('"author" must be an Ed25519 did:key');
  }
  const sig = typeof data.sig === 'string' ? decodeBase64Url(data.sig) : null;
  if (sig?.length !== SIGNATURE_BYTES) {
    malformed('"sig" must be a 64-byte signature in base64url');
  }
  return {
    formatVersion: SIGNATURE_FORMAT,
    alg: ALG,
    author: data.author,
    sig: data.sig as string,
  };
}

/** The bytes a signature covers: the context, then the manifest. */
export function signedMessage(
  manifestBytes: Uint8Array
): Uint8Array<ArrayBuffer> {
  const context = new TextEncoder().encode(TOUR_SIGNATURE_CONTEXT);
  const message = new Uint8Array(context.length + manifestBytes.length);
  message.set(context);
  message.set(manifestBytes, context.length);
  return message;
}

function isNotSupported(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotSupportedError';
}

function badSignature(author: string): never {
  throw new TourIntegrityError(
    'bad-signature',
    `the signature does not match the manifest for the key ${author}`
  );
}

/**
 * Check `manifest.sig.json` against the manifest's exact bytes.
 *
 * @param subtle injected for tests; defaults to `globalThis.crypto.subtle`
 *   (null or missing: an insecure origin, read as `unsupported`).
 * @returns `valid`, or `unsupported` where the browser cannot check
 *   Ed25519 at all.
 * @throws TourIntegrityError `malformed-signature` or `bad-signature`.
 */
export async function verifyManifestSignature(
  manifestBytes: Uint8Array,
  signatureText: string,
  subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle
): Promise<SignatureVerdict> {
  const signature = parseManifestSignature(signatureText);
  const { author } = signature;
  if (subtle === null || subtle === undefined) {
    return {
      kind: 'unsupported',
      author,
      reason: 'no WebCrypto (insecure context)',
    };
  }
  // Both were validated by the parser; the non-null assertions restate it.
  const publicKey = didKeyToEd25519PublicKey(author)!;
  const sig = decodeBase64Url(signature.sig)!;
  let ok: boolean;
  try {
    const key = await subtle.importKey(
      'raw',
      Uint8Array.from(publicKey),
      { name: ALG },
      false,
      ['verify']
    );
    ok = await subtle.verify(
      { name: ALG },
      key,
      Uint8Array.from(sig),
      signedMessage(manifestBytes)
    );
  } catch (err) {
    // Only "this browser has no Ed25519" is unsupported; any other failure
    // (a key that does not import) is a bad signature, never a pass.
    if (isNotSupported(err)) {
      return { kind: 'unsupported', author, reason: String(err) };
    }
    return badSignature(author);
  }
  if (!ok) badSignature(author);
  return { kind: 'valid', author };
}

/**
 * Hex digits of a key's fingerprint: 20, which is 80 bits (K1 milestone
 * review R11). A fingerprint is compared by eye, so a look-alike key only
 * has to match what is SHOWN: 48 bits is about 2^48 hashes, within reach of
 * one GPU in days; 80 bits is about 2^80, out of reach. Reverses towards
 * 128 bits if a well-funded attacker is in scope, and loses its point if
 * visitors read only the first group or two (K2's nickname helps there).
 */
const FINGERPRINT_HEX_DIGITS = 20;

/**
 * A short fingerprint of an author key for people to compare: the first
 * 80 bits of the SHA-256 of the raw public key, as five groups of four
 * hex digits (`3f2a 91c0 77de 5b10 e4a9`). K2 pairs it with a nickname
 * the player gives the key. Rejects for a string that is not an Ed25519
 * did:key.
 */
export async function keyFingerprint(author: string): Promise<string> {
  const publicKey = didKeyToEd25519PublicKey(author);
  if (publicKey === null) {
    throw new TypeError('keyFingerprint: not an Ed25519 did:key');
  }
  const hex = await sha256Hex(publicKey);
  return (hex.slice(0, FINGERPRINT_HEX_DIGITS).match(/.{4}/g) ?? []).join(' ');
}
