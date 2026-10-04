/**
 * Lowercase hex, and the SHA-256 of bytes as lowercase hex, through
 * WebCrypto. One copy per package (DEC-H3): the printed code's identity
 * (`qr-payload/qr-code-id.ts`), a tour archive's file hashes and a signing
 * key's fingerprint (tour kit plan K1) all need the same two lines.
 */

/** Lowercase hex for a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * The SHA-256 of `data` as 64 lowercase hex digits.
 *
 * @throws Error when WebCrypto is unavailable (a page served over plain
 *   `http:` to a non-localhost host has no `crypto.subtle`).
 */
export async function sha256Hex(
  data: Uint8Array | ArrayBuffer
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error(
      'sha256Hex: Web Crypto is unavailable - hashing needs a secure context (https, or localhost)'
    );
  }
  // A copy into a plain ArrayBuffer: a Uint8Array's buffer may be typed as
  // shared, which WebCrypto refuses.
  const bytes =
    data instanceof ArrayBuffer ? data : Uint8Array.from(data).buffer;
  return bytesToHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
}
