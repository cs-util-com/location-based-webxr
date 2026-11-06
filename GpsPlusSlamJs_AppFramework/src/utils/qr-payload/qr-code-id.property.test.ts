import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { QR_CODE_ID_LENGTH, qrCodeId } from './qr-code-id.js';

/**
 * A bare `fc.string()` draws short ASCII only — 200 samples yielded zero
 * non-ASCII characters — so a property claiming to cover surrogates, control
 * characters and long payloads over it was covering none of them (M-A review
 * finding 8). Probed against fast-check 4.8: 'grapheme' and 'binary' each
 * produce non-ASCII in ~85% of samples, and 'binary' is what reaches lone
 * surrogates, which is where a hand-rolled UTF-8 encoder would diverge from
 * a standard one.
 */
const arbText = fc.oneof(
  fc.string({ maxLength: 4000 }),
  fc.string({ unit: 'grapheme', maxLength: 200 }),
  fc.string({ unit: 'binary', maxLength: 200 })
);

function oracleId(text: string): string {
  return createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, QR_CODE_ID_LENGTH);
}

describe('qrCodeId properties', () => {
  it('agrees with an independent SHA-256 for any text, as a filename-safe id of fixed length', async () => {
    // Why this test matters: the unit test pins a handful of realistic
    // strings. This one covers the input space the unit test cannot -
    // lone surrogates, control characters, very long payloads - where a
    // hand-rolled UTF-8 encoding would diverge from a standard one.
    // The id is also interpolated straight into `qr/<id>.json`: anything
    // outside lowercase hex would produce an entry the archive reader's
    // pattern rejects, and the level would go missing with no error raised
    // anywhere. Agreeing with the hex oracle implies it; the pattern keeps
    // that rule's own failure message.
    const filenameSafe = new RegExp(`^[0-9a-f]{${QR_CODE_ID_LENGTH}}$`);
    await fc.assert(
      fc.asyncProperty(arbText, async (text) => {
        const id = await qrCodeId(text);
        expect(id, 'a filename-safe id of fixed length').toMatch(filenameSafe);
        expect(id).toBe(oracleId(text));
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
      fc.asyncProperty(arbText, arbText, async (a, b) => {
        fc.pre(a !== b);
        expect(await qrCodeId(a)).not.toBe(await qrCodeId(b));
      }),
      { numRuns: 200 }
    );
  });
});
