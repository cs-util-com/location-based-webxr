import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QR_LAUNCH_BASE_URL,
  MAX_HOME_PRINTABLE_SIDE_M,
  homePrintWarning,
  planPrintCode,
  printedSideCss,
} from './qr-print-plan.js';
import { resolveQrPayload } from './qr-launch-dispatch.js';
import { qrCodeId } from './qr-code-id.js';
import { qrCodeIsOurs } from './qr-code-origin.js';

/**
 * Why these tests matter: the print panel is the creator's step ZERO, and the
 * printed artifact is expensive to redo. Two silent mistakes would survive
 * into the field: a launch URL whose extra parameter sits outside the
 * measured fits-a-QR guarantee, and a printed size that does not match the
 * size the pose solve assumes.
 */

const HOSTING_URL = 'https://www.dropbox.com/scl/fi/abc/tour.zip?rlkey=k&dl=0';

describe('planPrintCode', () => {
  it('builds a measured launch URL that decodes back to the hosting URL', async () => {
    const plan = await planPrintCode(HOSTING_URL);
    expect(plan.url.startsWith(DEFAULT_QR_LAUNCH_BASE_URL)).toBe(true);

    // The builder picks the MEASURED smallest form (often the dictionary
    // codec, not raw) - what matters is that our own dispatcher decodes it
    // back to the exact hosting URL.
    const payload = new URL(plan.url).searchParams.get('qr');
    expect(payload).not.toBeNull();
    await expect(
      resolveQrPayload(payload as string, 'https://x/')
    ).resolves.toBe(HOSTING_URL);
    expect(plan.qrVersion).toBeGreaterThan(0);
    expect(plan.qrVersion).toBeLessThanOrEqual(25); // the scannable ceiling
  });

  it('prints a bare-host base so the forward keeps the densest encodings', () => {
    // The landing page owns "/" and forwards ?qr= untouched to the viewer; a
    // path in the printed base would forfeit the dense forms forever (ZD-9).
    expect(new URL(DEFAULT_QR_LAUNCH_BASE_URL).pathname).toBe('/');
  });

  it('accepts a caller-supplied base URL', async () => {
    const plan = await planPrintCode(HOSTING_URL, {
      baseUrl: 'https://example.test/',
    });
    expect(plan.url.startsWith('https://example.test/')).toBe(true);
  });

  it('omits the token for the first code and adds it for the rest', async () => {
    // Why this matters: the token exists ONLY to make several codes for ONE
    // zip distinct. Spending its bytes on the single-code tour - the common
    // case - would shrink the payload budget for nothing.
    const first = await planPrintCode(HOSTING_URL, { codeIndex: 1 });
    expect(new URL(first.url).searchParams.has('n')).toBe(false);

    const second = await planPrintCode(HOSTING_URL, { codeIndex: 2 });
    expect(new URL(second.url).searchParams.get('n')).toBe('2');
  });

  it('gives N codes for ONE zip N distinct identities', async () => {
    // Why this test matters: this IS DEC-2b. The author hangs four posters
    // that all point at one zip; if their ids collided, three of the four
    // would silently read the wrong level and be mis-placed.
    const plans = await Promise.all(
      [1, 2, 3, 4].map((codeIndex) => planPrintCode(HOSTING_URL, { codeIndex }))
    );
    const ids = await Promise.all(plans.map((p) => qrCodeId(p.url)));
    expect(new Set(ids).size).toBe(4);
  });

  it('keeps every printed code inside the scannable ceiling, token and all', async () => {
    // Why this test matters: cold-review finding 17. The token is appended
    // BEFORE size estimation, so the fits-a-QR guarantee still holds - but
    // that is a claim about the builder, and it is asserted rather than
    // assumed.
    for (const codeIndex of [1, 2, 10, 99]) {
      const plan = await planPrintCode(HOSTING_URL, { codeIndex });
      expect(plan.qrVersion, `code ${String(codeIndex)}`).toBeLessThanOrEqual(
        25
      );
    }
  });

  it('produces a URL our own safety gate recognises', async () => {
    // Why this test matters: the recorder refuses to fetch or mint anything
    // qrCodeIsOurs rejects. If the printer and the gate ever disagreed, our
    // own printed codes would be silently ignored in the field.
    const plan = await planPrintCode(HOSTING_URL, { codeIndex: 3 });
    expect(qrCodeIsOurs(plan.url, ['gps.csutil.com'])).toBe(true);
  });

  it('rejects a non-URL hosting input and a nonsensical code index', async () => {
    await expect(planPrintCode('not a url')).rejects.toThrow();
    for (const codeIndex of [0, -1, 1.5, Number.NaN]) {
      await expect(
        planPrintCode(HOSTING_URL, { codeIndex }),
        String(codeIndex)
      ).rejects.toThrow(RangeError);
    }
  });
});

describe('homePrintWarning', () => {
  it('is silent up to the page budget and warns in plain words past it', () => {
    // A clipped QR does not decode AT ALL, and the panel's own "100% scale"
    // instruction is what turns overflow into a clip.
    expect(homePrintWarning(0.16)).toBeNull();
    expect(homePrintWarning(MAX_HOME_PRINTABLE_SIDE_M)).toBeNull();
    expect(homePrintWarning(0.2)).toMatch(/cut off|will not scan/);
  });
});

describe('printedSideCss', () => {
  it('maps metres to exact CSS centimetres', () => {
    expect(printedSideCss(0.2)).toBe('20cm');
    expect(printedSideCss(0.145)).toBe('14.5cm');
  });

  it('keeps a hand-typed off-step size to 0.1 mm, as documented', () => {
    // The size input's `step` only gates the spinner - a typed 0.1234 m must
    // print as 12.34 cm, not snap to a full millimetre while the PnP solve
    // keeps the un-snapped value (a silent ~0.3% scale bias).
    expect(printedSideCss(0.1234)).toBe('12.34cm');
    expect(printedSideCss(0.12346)).toBe('12.35cm');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive/non-finite size (%s)',
    (sizeM) => {
      expect(() => printedSideCss(sizeM)).toThrow(RangeError);
    }
  );
});
