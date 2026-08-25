import { describe, expect, it } from 'vitest';

import { decideFallback, parseContentRangeTotal } from './range-probe.js';

/**
 * Why these tests matter: this pure function is the whole fallback policy,
 * lifted out of the network code so every branch is provable without a
 * server. The transport does one HEAD (for size) and one `Range: bytes=0-0`
 * GET (for support), hands the raw result here, and does what it's told. A
 * 200 means the host ignored the Range request and streamed the whole file —
 * so the caller already holds the bytes and switches straight to a local read
 * (the "still works, just no instant first read" guarantee). Getting this
 * table wrong is exactly the "range-unsupported link crashes instead of
 * falling back" failure this module exists to prevent.
 */

describe('parseContentRangeTotal', () => {
  it('reads the total from a satisfied range', () => {
    expect(parseContentRangeTotal('bytes 0-0/12345')).toBe(12345);
    expect(parseContentRangeTotal('bytes 0-1023/2048')).toBe(2048);
  });

  it('reads the total from an unsatisfied-range form (bytes */total)', () => {
    expect(parseContentRangeTotal('bytes */4096')).toBe(4096);
  });

  it('returns null when the total is unknown (*) or the header is absent/garbage', () => {
    expect(parseContentRangeTotal('bytes 0-0/*')).toBeNull();
    expect(parseContentRangeTotal(null)).toBeNull();
    expect(parseContentRangeTotal('nonsense')).toBeNull();
  });

  // Why this test matters (D3): a total beyond Number.MAX_SAFE_INTEGER parses
  // to an imprecise double; anchoring zip offsets to it corrupts reads. Only
  // safe integers may become an archive size.
  it('returns null for a total that is not a safe integer', () => {
    expect(parseContentRangeTotal('bytes 0-0/9007199254740993')).toBeNull();
  });
});

const SIZE = 4096;
const BODY = new Uint8Array([80, 75, 3, 4]); // "PK\x03\x04"

describe('decideFallback', () => {
  it('uses on-demand ranges when the probe returns 206 with a known size', () => {
    expect(decideFallback({ status: 206, size: SIZE })).toEqual({
      mode: 'ranges',
      size: SIZE,
    });
  });

  it('falls back to an eager local read when a 200 streams the whole file', () => {
    expect(decideFallback({ status: 200, size: SIZE, body: BODY })).toEqual({
      mode: 'eager-local',
      body: BODY,
    });
  });

  it('rejects a 404 as missing', () => {
    expect(decideFallback({ status: 404, size: null })).toEqual({
      mode: 'reject',
      cause: 'missing',
    });
  });

  it('rejects a 416 as a corrupt/empty archive', () => {
    expect(decideFallback({ status: 416, size: 0 })).toEqual({
      mode: 'reject',
      cause: 'corrupt',
    });
  });

  // Why this test matters (D3): ProbeResult.size is typed number|null but a
  // caller bug (NaN from an unvalidated header) must not become mode 'ranges'
  // with an unusable size — degrade to full-download at this boundary too.
  it.each([Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    'degrades to a full download when a 206 carries the unusable size %s',
    (size) => {
      expect(decideFallback({ status: 206, size })).toEqual({
        mode: 'full-download',
      });
    }
  );

  it('degrades to a full download when ranges work but the size is unreadable', () => {
    // 206 with no readable Content-Length or Content-Range total: ranges
    // work, but a range-reading archive parser needs the total size to find
    // its central directory. A plain download still yields a working (if
    // slower-to-start) result.
    expect(decideFallback({ status: 206, size: null })).toEqual({
      mode: 'full-download',
    });
  });

  it('rejects any other status (e.g. a 500) as an unusable link', () => {
    expect(decideFallback({ status: 500, size: null })).toEqual({
      mode: 'reject',
      cause: 'unusable-link',
    });
  });
});
