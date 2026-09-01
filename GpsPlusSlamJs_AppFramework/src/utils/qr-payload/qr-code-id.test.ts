import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { QR_CODE_ID_LENGTH, qrCodeId } from './qr-code-id.js';

/**
 * Independent oracle. `lessons-learned.md` is explicit that a spec constant
 * must never be hand-written from memory — it is derived from a second
 * implementation and cross-checked. Node's own SHA-256 is that second
 * implementation, so a change to our digest, encoding or truncation fails
 * here rather than silently renaming every level file in every zip.
 */
function oracleId(text: string): string {
  return createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, QR_CODE_ID_LENGTH);
}

describe('qrCodeId', () => {
  it('matches an independent SHA-256 implementation', async () => {
    // Why this test matters: the id names a file inside a published zip. If
    // our digest ever disagrees with a standard one, previously authored
    // levels become unreachable with no error anywhere.
    for (const text of [
      'https://gps.csutil.com/?qr=demo',
      'https://gps.csutil.com/?qr=demo&n=2',
      'a',
      '',
    ]) {
      expect(await qrCodeId(text)).toBe(oracleId(text));
    }
  });

  it('hashes the UTF-8 bytes, not the UTF-16 code units', async () => {
    // Why this test matters: a QR can carry any text. Hashing code units
    // would give a different id on a different platform for the same code.
    for (const text of ['grüße', '日本語', '👋🏽 emoji']) {
      expect(await qrCodeId(text)).toBe(oracleId(text));
    }
  });

  it('is deterministic and stable across calls', async () => {
    const text = 'https://gps.csutil.com/?qr=~AbCd&n=7';
    expect(await qrCodeId(text)).toBe(await qrCodeId(text));
  });

  it('distinguishes URLs that differ only by the per-code token', async () => {
    // Why this test matters: this is the whole point of DEC-2b. Four printed
    // codes for ONE zip differ only in that token; if the ids collided they
    // would all resolve to the same level file and three posters would be
    // silently mis-placed.
    const base = 'https://gps.csutil.com/?qr=tour';
    const ids = await Promise.all([
      qrCodeId(base),
      qrCodeId(`${base}&n=2`),
      qrCodeId(`${base}&n=3`),
      qrCodeId(`${base}&n=4`),
    ]);
    expect(new Set(ids).size).toBe(4);
  });

  it('produces a filename-safe id of the documented length', async () => {
    // Why this test matters: the id is interpolated into `qr/<id>.json` and
    // must satisfy the archive entry pattern. Lowercase hex always does; a
    // future switch to base64url would not, and would break reading silently.
    const id = await qrCodeId('https://gps.csutil.com/?qr=demo');
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id).toHaveLength(QR_CODE_ID_LENGTH);
  });

  it('rejects a non-string input rather than hashing "undefined"', async () => {
    // Why this test matters: defensive boundary. A decoder that yields no
    // text must not silently produce the id of the literal string.
    await expect(
      qrCodeId(undefined as unknown as string)
    ).rejects.toBeInstanceOf(TypeError);
  });
});
