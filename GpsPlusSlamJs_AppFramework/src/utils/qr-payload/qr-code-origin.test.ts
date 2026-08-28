import { describe, it, expect } from 'vitest';
import { qrCodeIsOurs } from './qr-code-origin.js';

const HOSTS = ['gps.csutil.com', 'localhost'];

describe('qrCodeIsOurs', () => {
  it('accepts our own launch URLs', () => {
    for (const text of [
      'https://gps.csutil.com/?qr=tour',
      'https://gps.csutil.com/?qr=~AbCd&n=2',
      'https://gps.csutil.com/tour/?qr=user/repo/file.zip',
      'http://localhost:5173/?qr=demo',
      'HTTPS://GPS.CSUTIL.COM/?qr=demo',
    ]) {
      expect(qrCodeIsOurs(text, HOSTS), text).toBe(true);
    }
  });

  it('refuses a foreign QR code before anything can fetch it', () => {
    // Why this test matters: this predicate is the ONLY thing standing
    // between "user points a phone at a sticker" and an outbound byte-range
    // request from the AR frame path. Every entry here is a real thing a
    // camera sees in the wild.
    for (const text of [
      'WIFI:S:CoffeeShop;T:WPA;P:hunter2;;',
      'mailto:someone@example.com',
      'tel:+4915112345678',
      'BEGIN:VCARD\nFN:A Person\nEND:VCARD',
      'just some text',
      '1234567890',
    ]) {
      expect(qrCodeIsOurs(text, HOSTS), text).toBe(false);
    }
  });

  it('refuses URLs on hosts we do not own', () => {
    for (const text of [
      'https://evil.example/?qr=tour',
      'https://raw.githubusercontent.com/user/repo/main/tour.zip',
      'https://drive.google.com/file/d/abc/view',
    ]) {
      expect(qrCodeIsOurs(text, HOSTS), text).toBe(false);
    }
  });

  it('is not fooled by a host that merely CONTAINS an allowed one', () => {
    // Why this test matters: suffix or substring matching is the classic way
    // this check gets written wrong, and it hands an attacker the whole
    // predicate. Matching is exact on the parsed hostname.
    for (const text of [
      'https://evil.gps.csutil.com/?qr=tour',
      'https://gps.csutil.com.evil.example/?qr=tour',
      'https://notgps.csutil.com/?qr=tour',
    ]) {
      expect(qrCodeIsOurs(text, HOSTS), text).toBe(false);
    }
  });

  it('is not fooled by an allowed host in the userinfo position', () => {
    // Why this test matters: `https://good.host@evil.example/` reads as ours
    // to a human and to a naive `startsWith`, but the request goes to
    // evil.example. The URL parser puts it in `username`, so exact hostname
    // matching is what saves us - pinned so a future rewrite cannot lose it.
    expect(
      qrCodeIsOurs('https://gps.csutil.com@evil.example/?qr=tour', HOSTS)
    ).toBe(false);
  });

  it('refuses non-http schemes even on an allowed host', () => {
    for (const text of [
      'javascript:alert(1)//gps.csutil.com/?qr=x',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      'ftp://gps.csutil.com/?qr=tour',
    ]) {
      expect(qrCodeIsOurs(text, HOSTS), text).toBe(false);
    }
  });

  it('requires a non-empty qr payload', () => {
    // Why this test matters: our own home page is not a code. Treating it as
    // one would start a pointless fetch on every glance at a poster of the
    // bare URL.
    for (const text of [
      'https://gps.csutil.com/',
      'https://gps.csutil.com/?qr=',
      'https://gps.csutil.com/?n=2',
    ]) {
      expect(qrCodeIsOurs(text, HOSTS), text).toBe(false);
    }
  });

  it('fails closed on an empty allowlist or a non-string', () => {
    // Why this test matters: a caller that forgot to configure hosts must
    // reach "nothing is ours", never "everything is ours".
    expect(qrCodeIsOurs('https://gps.csutil.com/?qr=tour', [])).toBe(false);
    expect(qrCodeIsOurs(undefined as unknown as string, HOSTS)).toBe(false);
    expect(qrCodeIsOurs('', HOSTS)).toBe(false);
  });
});
