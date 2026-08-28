import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { QR_CODE_ID_LENGTH, qrCodeId } from './qr-code-id.js';

function oracleId(text: string): string {
  return createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, QR_CODE_ID_LENGTH);
}

describe('qrCodeId properties', () => {
  it('agrees with an independent SHA-256 for any text', async () => {
    // Why this test matters: the unit test pins a handful of realistic
    // strings. This one covers the input space the unit test cannot -
    // lone surrogates, control characters, very long payloads - where a
    // hand-rolled UTF-8 encoding would diverge from a standard one.
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        expect(await qrCodeId(text)).toBe(oracleId(text));
      }),
      { numRuns: 200 }
    );
  });

  it('always yields a filename-safe id of fixed length', async () => {
    // Why this test matters: the id is interpolated straight into
    // `qr/<id>.json`. Anything outside lowercase hex would produce an entry
    // the archive reader's pattern rejects, and the level would go missing
    // with no error raised anywhere.
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        expect(await qrCodeId(text)).toMatch(
          new RegExp(`^[0-9a-f]{${QR_CODE_ID_LENGTH}}$`)
        );
      }),
      { numRuns: 200 }
    );
  });

  it('gives distinct ids to distinct texts', async () => {
    // Why this test matters: DEC-2b rests on it. Two printed codes differing
    // by one character must not share a level file. At 48 bits a genuine
    // collision here is a ~1e-14 event, so a failure means the truncation or
    // the digest changed, not bad luck.
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (a, b) => {
        fc.pre(a !== b);
        expect(await qrCodeId(a)).not.toBe(await qrCodeId(b));
      }),
      { numRuns: 200 }
    );
  });
});
