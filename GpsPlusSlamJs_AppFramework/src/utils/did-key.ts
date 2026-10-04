/**
 * `did:key` identifiers for Ed25519 public keys (W3C CCG did:key spec,
 * v0.9: https://w3c-ccg.github.io/did-key-spec/): the string
 * `did:key:` + multibase `z` (base58btc) + base58btc of the multicodec
 * varint for `ed25519-pub` (code 0xed, varint bytes `0xed 0x01`;
 * https://github.com/multiformats/multicodec table.csv) followed by the
 * 32 raw key bytes. Every Ed25519 did:key therefore starts `did:key:z6Mk`.
 * A tour's author is named this way (tour kit plan K1, K-D2): a standard,
 * self-contained string for a key, with no registry behind it. Pure.
 */

import { decodeBase58btc, encodeBase58btc } from './base58btc.js';

const PREFIX = 'did:key:z';
/** The multicodec varint of `ed25519-pub` (0xed). */
const ED25519_MULTICODEC = [0xed, 0x01] as const;
const KEY_BYTES = 32;

/** The did:key for a raw 32-byte Ed25519 public key.
 *  @throws TypeError for a key of any other length. */
export function ed25519PublicKeyToDidKey(publicKey: Uint8Array): string {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== KEY_BYTES) {
    throw new TypeError('ed25519PublicKeyToDidKey: the key must be 32 bytes');
  }
  return `${PREFIX}${encodeBase58btc(
    Uint8Array.from([...ED25519_MULTICODEC, ...publicKey])
  )}`;
}

/** The raw 32-byte key an Ed25519 did:key names, or null for anything
 *  else (another method, another key type, a wrong length, a character
 *  outside the alphabet). Total: never throws. */
export function didKeyToEd25519PublicKey(did: unknown): Uint8Array | null {
  if (typeof did !== 'string' || !did.startsWith(PREFIX)) return null;
  const bytes = decodeBase58btc(did.slice(PREFIX.length));
  if (
    bytes === null ||
    bytes.length !== ED25519_MULTICODEC.length + KEY_BYTES ||
    bytes[0] !== ED25519_MULTICODEC[0] ||
    bytes[1] !== ED25519_MULTICODEC[1]
  ) {
    return null;
  }
  return bytes.slice(ED25519_MULTICODEC.length);
}

/** True for a well-formed Ed25519 did:key. */
export function isDidKeyEd25519(value: unknown): value is string {
  return didKeyToEd25519PublicKey(value) !== null;
}
