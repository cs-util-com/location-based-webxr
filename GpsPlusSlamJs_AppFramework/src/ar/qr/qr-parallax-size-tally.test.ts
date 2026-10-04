/**
 * The parallax size tally and the measured-size offer (QR size consensus
 * plan §11-§13, S3a).
 *
 * Why these tests matter: both the QR demo's report and the TourViewer's
 * print check count parallax sizes by ONE rule (DEC-H3): a window read while
 * the code turned never counts (parallax needs a still code), a refused one
 * never counts, and consecutive windows share most of their views, so only
 * INDEPENDENT windows are evidence. The offer must stay silent on a correct
 * print: simulated sessions (§13) showed one window at 2 % offering on up to
 * 40 % of correct prints, three agreeing independent windows on none.
 */
import { describe, expect, it } from 'vitest';
import {
  createQrParallaxSizeTally,
  measuredSizeOffer,
  type QrParallaxSizeWindow,
} from './qr-parallax-size-tally';

const win = (
  sizeM: number,
  oldestTimestamp: number,
  newestTimestamp: number
) => ({
  sizeM,
  lateralBaselineM: 0.1,
  views: 8,
  oldestTimestamp,
  newestTimestamp,
});

describe('createQrParallaxSizeTally', () => {
  it('counts accepted, refused and turning windows per code', () => {
    const t = createQrParallaxSizeTally();
    expect(t.add('A', { parallax: win(0.155, 0, 3875), turning: false })).toBe(
      'accepted'
    );
    expect(t.add('A', { parallax: null, turning: false })).toBe('refused');
    expect(t.add('A', { parallax: win(0.5, 125, 4000), turning: true })).toBe(
      'turning'
    );
    expect(t.add('B', { parallax: win(0.2, 0, 3875), turning: false })).toBe(
      'accepted'
    );
    expect(t.counts('A')).toEqual({ accepted: 1, refused: 1, turning: 1 });
    expect(t.accepted('A').map((w) => w.sizeM)).toEqual([0.155]);
    expect(t.accepted('B').map((w) => w.sizeM)).toEqual([0.2]);
    expect(t.counts('C')).toEqual({ accepted: 0, refused: 0, turning: 0 });
  });

  // Consecutive windows over the newest 32 entries share most of them; a
  // window is independent evidence only once it starts after the last
  // counted one ended.
  it('keeps as independent only windows that start after the last counted one ended', () => {
    const t = createQrParallaxSizeTally();
    for (const [oldest, newest] of [
      [0, 3875],
      [125, 4000],
      [3875, 7750], // shares the counted window's last entry
      [4000, 7875],
      [8000, 11875],
    ]) {
      t.add('A', { parallax: win(0.155, oldest!, newest!), turning: false });
    }
    expect(t.independent('A').map((w) => w.oldestTimestamp)).toEqual([
      0, 4000, 8000,
    ]);
  });

  it('forgets one code, or all', () => {
    const t = createQrParallaxSizeTally();
    t.add('A', { parallax: win(0.155, 0, 1), turning: false });
    t.add('B', { parallax: win(0.155, 0, 1), turning: false });
    t.reset('A');
    expect(t.accepted('A')).toEqual([]);
    expect(t.accepted('B')).toHaveLength(1);
    t.reset();
    expect(t.accepted('B')).toEqual([]);
  });
});

describe('measuredSizeOffer', () => {
  const three = (a: number, b: number, c: number): QrParallaxSizeWindow[] => [
    win(a, 0, 1),
    win(b, 2, 3),
    win(c, 4, 5),
  ];

  it('offers the median once three independent windows agree past 2 %', () => {
    expect(measuredSizeOffer(three(0.1545, 0.155, 0.1552), 0.16)).toEqual({
      sizeM: 0.155,
    });
  });

  it('stays silent with fewer than three, within 2 %, or on both sides', () => {
    expect(
      measuredSizeOffer(three(0.1545, 0.155, 0.1552).slice(0, 2), 0.16)
    ).toBeNull();
    expect(measuredSizeOffer(three(0.158, 0.1585, 0.159), 0.16)).toBeNull();
    expect(measuredSizeOffer(three(0.154, 0.166, 0.155), 0.16)).toBeNull();
    // One window within the tolerance breaks "all past it".
    expect(measuredSizeOffer(three(0.154, 0.1595, 0.155), 0.16)).toBeNull();
  });

  it('offers a larger print too, and honours other settings', () => {
    expect(measuredSizeOffer(three(0.167, 0.168, 0.169), 0.16)).toEqual({
      sizeM: 0.168,
    });
    expect(
      measuredSizeOffer(three(0.167, 0.168, 0.169), 0.16, { tolerance: 0.06 })
    ).toBeNull();
    expect(
      measuredSizeOffer(three(0.167, 0.168, 0.169).slice(0, 2), 0.16, {
        windows: 2,
      })
    ).toEqual({ sizeM: 0.1675 });
  });

  it('uses the first windows, not the latest', () => {
    const w = [...three(0.155, 0.155, 0.155), win(0.18, 6, 7)];
    expect(measuredSizeOffer(w, 0.16)).toEqual({ sizeM: 0.155 });
  });

  it('refuses an unusable typed size', () => {
    expect(measuredSizeOffer(three(0.155, 0.155, 0.155), 0)).toBeNull();
    expect(
      measuredSizeOffer(three(0.155, 0.155, 0.155), Number.NaN)
    ).toBeNull();
  });
});
