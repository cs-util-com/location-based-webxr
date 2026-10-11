/**
 * Base58 with the Bitcoin alphabet ("base58btc"), the encoding a `did:key`
 * identifier uses after its multibase prefix `z` (W3C CCG did:key spec;
 * multibase table). Pure: no I/O.
 *
 * Big-number arithmetic on bytes, the textbook way: leading zero bytes
 * become leading `1`s and back, everything else is a base conversion. The
 * inputs here are a few dozen bytes (a 34-byte multicodec key), so the
 * quadratic loop costs microseconds - and only because the caller bounds
 * the length first (`did-key.ts`): untrusted text of any length would hang.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const INDEX: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((c, i) => [c, i])
);

/** Encode bytes as base58btc (no multibase prefix). */
export function encodeBase58btc(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Little-endian base-58 digits of the number the bytes spell.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let d = 0; d < digits.length; d++) {
      carry += digits[d]! * 256;
      digits[d] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '1'.repeat(zeros);
  for (let d = digits.length - 1; d >= 0; d--) out += ALPHABET[digits[d]!];
  return out;
}

/** Decode base58btc, or `null` for a character outside the alphabet.
 *  Total: never throws. */
export function decodeBase58btc(text: string): Uint8Array | null {
  if (typeof text !== 'string') return null;
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;
  // Little-endian base-256 bytes of the number the digits spell.
  const bytes: number[] = [];
  for (let i = zeros; i < text.length; i++) {
    const value = INDEX.get(text[i]!);
    if (value === undefined) return null;
    let carry = value;
    for (let b = 0; b < bytes.length; b++) {
      carry += bytes[b]! * 58;
      bytes[b] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let b = 0; b < bytes.length; b++) {
    out[out.length - 1 - b] = bytes[b]!;
  }
  return out;
}
