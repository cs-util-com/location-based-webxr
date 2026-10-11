/**
 * Stable identity for a printed QR code: the SHA-256 of its decoded text,
 * truncated to a short lowercase-hex string.
 *
 * WHY THIS EXISTS. A tour zip can serve several printed codes at once, so
 * each code needs a name for its own level file (`qr/<id>.json`). The
 * identity is derived from the code itself rather than from a number an
 * author has to keep track of — print the code, and its file name follows.
 *
 * WHAT IS HASHED. The decoded text **exactly as printed**, never a browser's
 * idea of the current URL: a trailing slash, a re-encoded parameter or a
 * redirect would all change the digest and orphan an already-published level
 * file. Callers that only have a page URL must reconstruct the printed string
 * rather than pass `location.href`.
 *
 * SEE `GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
 * §3 M-A (DEC-2 / DEC-2b) for the decision and the collision argument.
 */

import { sha256Hex } from '../sha256-hex.js';
import { utf8Encode } from './utf8.js';

/**
 * Hex characters kept from the digest.
 *
 * 12 hex characters is 48 bits. A collision needs two DISTINCT printed URLs,
 * and an author prints a handful per tour; at 1 000 codes the birthday
 * probability is below 2e-9. The truncation is a deliberate trade for a
 * file name a human can read in a zip listing, not an oversight — and the
 * whole digest stays available by raising this constant, at the cost of
 * renaming every future level file.
 */
export const QR_CODE_ID_LENGTH = 12;

/**
 * Derive the level-file identity for a decoded QR text.
 *
 * @param text the decoded QR payload, exactly as printed
 * @returns lowercase hex, {@link QR_CODE_ID_LENGTH} characters — always safe
 *   inside `qr/<id>.json`
 * @throws TypeError when `text` is not a string
 * @throws Error when Web Crypto is unavailable (a page served over plain
 *   `http:` to a non-localhost host has no `crypto.subtle`)
 */
export async function qrCodeId(text: string): Promise<string> {
  if (typeof text !== 'string') {
    throw new TypeError(
      `qrCodeId: expected the decoded QR text as a string, got ${typeof text}`
    );
  }
  // The package's one SHA-256 (DEC-H3, K1 milestone review R14): it copies
  // the bytes into a plain ArrayBuffer for WebCrypto and rejects where
  // `crypto.subtle` is missing (an insecure context).
  return (await sha256Hex(utf8Encode(text))).slice(0, QR_CODE_ID_LENGTH);
}
