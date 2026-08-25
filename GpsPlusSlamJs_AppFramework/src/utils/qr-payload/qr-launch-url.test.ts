import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { buildQrLaunchUrl } from './qr-launch-url';
import { estimateQrSize } from './qr-size-estimator';
import { decodeDictionaryPayload } from './codec-dictionary';

/**
 * `buildQrLaunchUrl` — demo + verification (QR payload benchmark
 * follow-up, 2026-07-05).
 *
 * THE DEVELOPER STORY this file doubles as documentation for:
 * you have the app's base URL and an asset URL ("map to load"); you want
 * the printed QR code with the FEWEST modules (coarsest squares = greatest
 * scan distance at a fixed print size). The helper generates every launch
 * form the 2026-07-05 benchmark validated — raw URL, versioned-dictionary
 * blob, raw-GitHub template, bare name under a configured prefix, and the
 * opt-in all-caps `/S/<BASE32>` path form — measures each with the
 * oracle-locked QR size estimator, and returns the sparsest. Rendering
 * the result is one `qrcode` call (see the "printable QR" test below).
 */

const BASE = 'https://gps.csutil.com';
const MAP_URL =
  'https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/MyMap123.zip';

describe('buildQrLaunchUrl — developer walkthrough', () => {
  it('picks the raw-GitHub template form for a main-branch asset URL', async () => {
    const plan = await buildQrLaunchUrl(BASE, MAP_URL);
    // Human-readable, hand-typeable, and QR v5 at EC Q — the raw URL
    // (also generated, see `plan.candidates`) needs v9.
    expect(plan.url).toBe(
      'https://gps.csutil.com/?qr=cs-util-com/GeoTales/MyMap123.zip'
    );
    expect(plan.strategy).toBe('template');
    expect(plan.estimate.version).toBe(5);
    const raw = plan.candidates.find((c) => c.strategy === 'raw');
    expect(raw?.estimate.version).toBe(9);
  });

  it('renders a printable QR — and the real encoder agrees with the estimate', async () => {
    const plan = await buildQrLaunchUrl(BASE, MAP_URL);
    // This is the complete "generate the perfect QR code" recipe:
    const svg = await QRCode.toString(plan.url, {
      type: 'svg',
      errorCorrectionLevel: 'Q', // print-robust level, decision D2
    });
    expect(svg).toContain('<svg');
    // (For a PNG data-URL instead: QRCode.toDataURL(plan.url, { errorCorrectionLevel: 'Q' }))
    // Why this test matters: the plan's version must be REAL — the qrcode
    // package, choosing freely, must land on exactly the predicted version.
    const produced = QRCode.create(plan.url, { errorCorrectionLevel: 'Q' });
    expect(produced.version).toBe(plan.estimate.version);
  });

  it('shrinks to a bare map name when the app declares a default asset prefix', async () => {
    // If the app hard-codes where its maps live, the QR only needs the
    // one thing that varies: the file name. v4 at EC Q.
    const plan = await buildQrLaunchUrl(BASE, MAP_URL, {
      defaultAssetPrefix:
        'https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/',
    });
    expect(plan.url).toBe('https://gps.csutil.com/?qr=MyMap123.zip');
    expect(plan.strategy).toBe('name');
    expect(plan.estimate.version).toBeLessThanOrEqual(4);
  });

  it('beats the raw URL with the dictionary blob on a non-GitHub host', async () => {
    // No template match here — the measured contest is raw vs dictionary.
    const plan = await buildQrLaunchUrl(
      BASE,
      'https://cdn.example.com/tours/downtown-42.zip'
    );
    expect(['raw', 'dictionary']).toContain(plan.strategy);
    const raw = plan.candidates.find((c) => c.strategy === 'raw');
    expect(plan.estimate.bits).toBeLessThanOrEqual(raw?.estimate.bits ?? 0);
  });

  it('offers the all-caps /S/<BASE32> path form only when opted in', async () => {
    // The path form needs a Cloudflare rewrite rule that does not exist
    // yet (follow-ups doc #2), so it is opt-in.
    const withoutOptIn = await buildQrLaunchUrl(BASE, MAP_URL);
    expect(
      withoutOptIn.candidates.some((c) => c.strategy === 'path-base32')
    ).toBe(false);
    const withOptIn = await buildQrLaunchUrl(BASE, MAP_URL, {
      allowPathForm: true,
    });
    const pathForm = withOptIn.candidates.find(
      (c) => c.strategy === 'path-base32'
    );
    expect(pathForm).toBeDefined();
    // Everything after /S/ must survive scanners and stay in the cheap
    // QR alphanumeric mode: strictly uppercase base32.
    expect(pathForm?.url).toMatch(/^HTTPS:\/\/GPS\.CSUTIL\.COM\/S\/[A-Z2-7]+$/);
  });

  it('prefixes dictionary blobs with "~" so a launch handler can dispatch unambiguously', async () => {
    // Dispatch contract: http… → raw URL; "~…" → dictionary blob;
    // contains "/" → template; otherwise → bare name. Without the marker
    // a bare name could collide with a valid base64url blob.
    const plan = await buildQrLaunchUrl(BASE, MAP_URL);
    const dict = plan.candidates.find((c) => c.strategy === 'dictionary');
    const blob = dict?.url.replace(`${BASE}/?qr=~`, '');
    expect(dict?.url.startsWith(`${BASE}/?qr=~`)).toBe(true);
    expect(await decodeDictionaryPayload(blob ?? '')).toBe(MAP_URL);
  });

  it('tolerates a scheme-less base URL and a trailing slash', async () => {
    const plan = await buildQrLaunchUrl('gps.csutil.com/', MAP_URL);
    expect(plan.url.startsWith('https://gps.csutil.com/?qr=')).toBe(true);
  });

  it('rejects invalid inputs with TypeError', async () => {
    await expect(buildQrLaunchUrl('ftp://x.y', MAP_URL)).rejects.toThrow(
      TypeError
    );
    await expect(buildQrLaunchUrl(BASE, 'not a url')).rejects.toThrow(
      TypeError
    );
    await expect(
      buildQrLaunchUrl(BASE, `https://example.com/${'x'.repeat(2000)}`)
    ).rejects.toThrow(TypeError); // beyond QR v25 — not printable
  });
});

// Why these tests matter (QR-pose plan 2026-08-25, delta review #3): the
// per-code discriminator `&c=<n>` must live INSIDE the size optimization —
// a suffix appended after the winner is picked voids both the returned
// estimate and the fits-a-QR guarantee, and the all-caps /S/ form cannot
// carry '&'/'='/lowercase at all, so that candidate must simply not compete.
describe('buildQrLaunchUrl — extraQuery', () => {
  const DATA_URL =
    'https://raw.githubusercontent.com/user/repo/main/recording.zip';

  it('appends the extra params to every candidate, inside the estimate', async () => {
    const plan = await buildQrLaunchUrl('https://gps.csutil.com', DATA_URL, {
      extraQuery: { c: '2' },
    });

    for (const candidate of plan.candidates) {
      expect(candidate.url).toContain('&c=2');
      // The estimate was computed on the FULL printed string.
      expect(candidate.estimate.bits).toBe(
        estimateQrSize(candidate.url, 'Q')?.bits
      );
    }
    expect(plan.url).toContain('&c=2');
  });

  it('percent-encodes extra keys and values', async () => {
    const plan = await buildQrLaunchUrl('https://gps.csutil.com', DATA_URL, {
      extraQuery: { c: 'a b' },
    });
    expect(plan.url).toContain('&c=a%20b');
  });

  it('drops the /S/ path form when extraQuery is present, even if allowed', async () => {
    const plan = await buildQrLaunchUrl('https://gps.csutil.com', DATA_URL, {
      allowPathForm: true,
      extraQuery: { c: '1' },
    });
    expect(
      plan.candidates.every((cand) => cand.strategy !== 'path-base32')
    ).toBe(true);
  });

  it('changes nothing when extraQuery is absent', async () => {
    const withEmpty = await buildQrLaunchUrl(
      'https://gps.csutil.com',
      DATA_URL,
      {
        extraQuery: {},
      }
    );
    const without = await buildQrLaunchUrl('https://gps.csutil.com', DATA_URL);
    expect(withEmpty.url).toBe(without.url);
  });
});
