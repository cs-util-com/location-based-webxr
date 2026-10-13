import { describe, expect, it } from 'vitest';

import { buildQrLaunchUrl } from './qr-launch-url.js';
import { resolveQrPayload } from './qr-launch-dispatch.js';

/**
 * Why these tests matter: the encoder (`buildQrLaunchUrl`) picks whichever
 * payload form yields the sparsest printable QR, so a viewer that decodes
 * only some forms silently breaks a SUBSET of printed codes — the worst kind
 * of breakage, discovered only in the field. The round-trip test below runs
 * the real encoder and requires every candidate it can emit for `?qr=` to
 * resolve back to the exact input URL.
 */

const PREFIX =
  'https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/';

describe('resolveQrPayload — the four documented forms', () => {
  it('passes a raw http(s) payload through', async () => {
    await expect(
      resolveQrPayload('https://example.com/recording.zip', PREFIX)
    ).resolves.toBe('https://example.com/recording.zip');
  });

  it('expands the GitHub template user/repo/path', async () => {
    await expect(
      resolveQrPayload('user/repo/maps/city.zip', PREFIX)
    ).resolves.toBe(
      'https://raw.githubusercontent.com/user/repo/refs/heads/main/maps/city.zip'
    );
  });

  it('resolves a bare name under the default asset prefix', async () => {
    await expect(resolveQrPayload('MyMap123.zip', PREFIX)).resolves.toBe(
      `${PREFIX}MyMap123.zip`
    );
  });

  it('returns null for an empty or undecodable payload', async () => {
    await expect(resolveQrPayload('', PREFIX)).resolves.toBeNull();
    await expect(
      resolveQrPayload('~!!!not-base64url', PREFIX)
    ).resolves.toBeNull();
    await expect(
      resolveQrPayload('name with spaces', PREFIX)
    ).resolves.toBeNull();
  });
});

describe('resolveQrPayload — round-trips the real encoder', () => {
  /** The GitHub template collapses `/refs/heads/main/` and `/main/` into one
   *  payload, so equality is checked modulo that (both URL forms serve the
   *  same bytes on raw.githubusercontent). */
  function canonical(url: string): string {
    return url.replace('/refs/heads/main/', '/main/');
  }

  // Every ?qr= candidate the encoder can emit must decode to the input URL.
  it.each([
    'https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/MyMap123.zip',
    'https://raw.githubusercontent.com/user/repo/main/a/recording.zip',
    'https://example.com/tours/city.zip?sig=abc123',
  ])('decodes every emitted ?qr= form for %s', async (dataUrl) => {
    const plan = await buildQrLaunchUrl('https://gps.csutil.com', dataUrl, {
      defaultAssetPrefix: PREFIX,
    });
    for (const candidate of plan.candidates) {
      const payload = new URL(candidate.url).searchParams.get('qr');
      expect(payload).not.toBeNull();
      const resolved = await resolveQrPayload(payload!, PREFIX);
      expect(resolved).not.toBeNull();
      expect(canonical(resolved!)).toBe(canonical(dataUrl));
    }
  });
});

describe('resolveQrPayload — the Drive short form (Tour Viewer r820 feedback R5)', () => {
  // Why: `?qr=D/<id>` prints a Drive tour one QR version smaller than the
  // full link (v6 against v7-8 at EC Q, measured 2026-10-12). Printed codes
  // open gps.csutil.com, i.e. `main`, so the READER ships before any code
  // carries the form - a code the live page cannot read is a dead poster.
  const ID = '1A4mU8eV16aaIvy6Msd76RC3_cbbftRkX';

  it("resolves D/<id> to the Drive file's address", async () => {
    await expect(resolveQrPayload(`D/${ID}`, PREFIX)).resolves.toBe(
      `https://drive.google.com/file/d/${ID}`
    );
  });

  it('leaves other two-part payloads undecodable, as before', async () => {
    await expect(resolveQrPayload('x/y', PREFIX)).resolves.toBeNull();
    await expect(resolveQrPayload('D/a b', PREFIX)).resolves.toBeNull();
    await expect(resolveQrPayload('D/', PREFIX)).resolves.toBeNull();
  });

  it('round-trips every form the encoder emits for a Drive link, to the same file', async () => {
    for (const dataUrl of [
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
      `https://drive.google.com/file/d/${ID}/view?usp=drivesdk`,
      `https://drive.google.com/file/d/${ID}`,
    ]) {
      const plan = await buildQrLaunchUrl('https://gps.csutil.com', dataUrl, {
        allowDriveShortForm: true,
      });
      expect(plan.candidates.map((c) => c.strategy)).toContain('drive');
      for (const candidate of plan.candidates) {
        const payload = new URL(candidate.url).searchParams.get('qr');
        const resolved = await resolveQrPayload(payload ?? '', PREFIX);
        expect(resolved, candidate.strategy).toContain(`/file/d/${ID}`);
      }
    }
  });
});
