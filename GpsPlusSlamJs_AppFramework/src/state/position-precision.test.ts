import { describe, expect, it } from 'vitest';
import {
  CODE_HELD_ERROR_M,
  DEVICE_ACCURACY_WINDOW_FIXES,
  POSITION_PRECISION_CEILING_M,
  TELL_APART_FACTOR,
  canTellApart,
  positionPrecision,
  type PositionPrecision,
  type PositionPrecisionInput,
  type PrecisionGpsPoint,
} from './position-precision.js';

/** A device fix (no source stamp: the library reads an absent stamp as device). */
const device = (latLongAccuracy: number | undefined): PrecisionGpsPoint => ({
  latLongAccuracy,
});
/** A synthetic reading a scanned code adds to the store. */
const synthetic = (latLongAccuracy: number): PrecisionGpsPoint => ({
  latLongAccuracy,
  source: 'synthetic-qr',
});

const NONE: PositionPrecision = {
  source: 'none',
  accuracyM: null,
  tooWeak: true,
};

describe('position precision: one judgement of how precise a position is', () => {
  // Why this test matters: every app reads these four numbers; a silent edit
  // would move the "GPS too weak" line, the median's reach and the rule for
  // telling targets apart in all of them at once. The factor's value comes
  // from `position-precision.sweep.test.ts`.
  it('names the ceiling, the window, the code-held length and the factor', () => {
    expect(POSITION_PRECISION_CEILING_M).toBe(25);
    expect(DEVICE_ACCURACY_WINDOW_FIXES).toBe(10);
    expect(CODE_HELD_ERROR_M).toBe(1);
    expect(TELL_APART_FACTOR).toBe(1.5);
  });

  // Why this test matters: a code that holds the alignment is the most
  // precise position there is, and its precision has no measured number - it
  // shows as "code", never as a figure that looks measured. Codes-only mode
  // (no location permission, so no device fix at all) must read the same.
  it('reads an aligned position a code holds as "code", with no number, whatever the fixes say', () => {
    const code: PositionPrecision = {
      source: 'code',
      accuracyM: null,
      tooWeak: false,
    };
    expect(
      positionPrecision({ position: 'aligned', codeHold: true, gpsPoints: [] })
    ).toEqual(code);
    expect(
      positionPrecision({
        position: 'aligned',
        codeHold: true,
        gpsPoints: [device(40), device(45), device(60)],
      })
    ).toEqual(code);
  });

  // Why this test matters: with no position the app has nothing to judge, and
  // a reader that checks only `tooWeak` must still never guide on it. But
  // `tooWeak` on "none" is NOT a verdict on GPS: a tracking drop or location
  // permission off reads the same, so a display or a weak-fix path that
  // mapped `tooWeak` straight onto "GPS too weak" would fire on every
  // tracking drop. This pins the shape a caller must branch on: source
  // first, then `tooWeak`.
  it('reads no position as "none" with no number and too weak - a fail-safe, not a GPS verdict', () => {
    const p = positionPrecision({
      position: null,
      codeHold: true,
      gpsPoints: [device(3), device(4)],
    });
    expect(p.source).toBe('none');
    expect(p.tooWeak).toBe(true);
    expect(p.accuracyM).toBeNull();
    expect(p).toEqual(NONE);
  });

  // Why this test matters: a plain-JS caller (or a TypeScript one reading an
  // optional field) may leave the position undefined. A strict `=== null`
  // check sent that down the aligned path and judged a position the app does
  // not have; undefined must read like null. A kind this version does not
  // know is a caller bug, not data, and must fail loudly rather than be
  // judged as some position.
  it('reads an undefined position like no position, and refuses a kind it does not know', () => {
    const judge = (position: unknown) =>
      positionPrecision({
        position: position as PositionPrecisionInput['position'],
        codeHold: true,
        gpsPoints: [device(3)],
      });
    expect(judge(undefined)).toEqual(NONE);
    for (const bad of ['Aligned', 'fix', '', 0, true, {}]) {
      expect(() => judge(bad)).toThrow(RangeError);
    }
  });

  // Why this test matters: the store holds the synthetic readings a scanned
  // code adds, with a fixed accuracy of their own. Mixed into the median they
  // would report a phone in an urban canyon as precise. Only device fixes
  // speak for GPS precision; a stamp this version does not know is not one.
  it('takes the median of the device fixes only, never a synthetic or unknown reading', () => {
    const p = positionPrecision({
      position: 'aligned',
      codeHold: false,
      gpsPoints: [
        device(3),
        synthetic(0.5),
        device(9),
        { latLongAccuracy: 0.5, source: 'synthetic-beacon' },
        device(5),
        synthetic(0.5),
        synthetic(0.5),
      ],
    });
    expect(p).toEqual({ source: 'gps', accuracyM: 5, tooWeak: false });
  });

  // Why this test matters: the window is the latest ten fixes that carry a
  // usable accuracy (finite, positive). An older fix must fall out, and a fix
  // with no or a nonsense accuracy must neither count nor take a slot.
  it('reads the latest ten device fixes with a usable accuracy', () => {
    const old = [device(30), device(30), device(30)];
    const recent = [2, 4, 4, 6, 6, 8, 8, 10, 10, 12].map(device);
    const junk = [
      device(undefined),
      device(Number.NaN),
      device(0),
      device(-4),
      device(Number.POSITIVE_INFINITY),
    ];
    const p = positionPrecision({
      position: 'aligned',
      codeHold: false,
      gpsPoints: [...old, ...recent.slice(0, 5), ...junk, ...recent.slice(5)],
    });
    // Median of the ten recent: (6 + 8) / 2. One old 30 m fix in the window
    // would make it 8; a junk value taking a slot would shorten the window
    // to the five newest (10), and an infinite one counted would make it 8.
    expect(p.accuracyM).toBe(7);
    expect(recent).toHaveLength(DEVICE_ACCURACY_WINDOW_FIXES);
  });

  // Why this test matters: the ceiling is a threshold, so both sides of it
  // are pinned: exactly at it still guides, just above it does not.
  it('calls a GPS position too weak only above the ceiling', () => {
    const at = (m: number) =>
      positionPrecision({
        position: 'aligned',
        codeHold: false,
        gpsPoints: [device(m)],
      });
    expect(at(POSITION_PRECISION_CEILING_M)).toEqual({
      source: 'gps',
      accuracyM: POSITION_PRECISION_CEILING_M,
      tooWeak: false,
    });
    expect(at(POSITION_PRECISION_CEILING_M + 0.001).tooWeak).toBe(true);
    expect(at(POSITION_PRECISION_CEILING_M + 0.001).source).toBe('gps');
  });

  // Why this test matters: the ceiling is the caller's to vary (the sweep
  // runs 10-50 m), and the judgement must honour a caller's value on both
  // sides; a zero, negative or infinite ceiling is a caller bug that would
  // make every position too weak (or none), silently.
  it('honours a caller ceiling and refuses one that is not a positive, finite number', () => {
    const p = (m: number, ceilingM: number) =>
      positionPrecision({
        position: 'aligned',
        codeHold: false,
        gpsPoints: [device(m)],
        ceilingM,
      });
    expect(p(12, 10).tooWeak).toBe(true);
    expect(p(10, 10).tooWeak).toBe(false);
    expect(p(30, 50).tooWeak).toBe(false);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => p(5, bad)).toThrow(RangeError);
    }
  });

  // Why this test matters: a lone raw fix standing in for the position is
  // judged by the worse of the median and its own accuracy, so one wild fix
  // after a run of good ones cannot hide behind the median; and a code says
  // nothing about where a raw fix puts the visitor.
  it('judges a lone fix by the worse of the median and its own, and never as "code"', () => {
    const points = [device(4), device(5), device(6)];
    const lone = (loneFixAccuracyM: number | null, codeHold = false) =>
      positionPrecision({
        position: 'lone-fix',
        codeHold,
        gpsPoints: points,
        loneFixAccuracyM,
      });
    expect(lone(40)).toEqual({ source: 'gps', accuracyM: 40, tooWeak: true });
    expect(lone(3)).toEqual({ source: 'gps', accuracyM: 5, tooWeak: false });
    expect(lone(null)).toEqual({ source: 'gps', accuracyM: 5, tooWeak: false });
    expect(lone(Number.NaN).accuracyM).toBe(5);
    expect(lone(8, true)).toEqual({
      source: 'gps',
      accuracyM: 8,
      tooWeak: false,
    });
  });

  // Why this test matters: which position is judged is the app's choice, and
  // an aligned one does not get worse because the latest raw fix is old or
  // wild - only a lone fix carries its own accuracy.
  it('never lets the lone fix speak for an aligned position', () => {
    expect(
      positionPrecision({
        position: 'aligned',
        codeHold: false,
        gpsPoints: [device(4)],
        loneFixAccuracyM: 80,
      })
    ).toEqual({ source: 'gps', accuracyM: 4, tooWeak: false });
  });

  // Why this test matters: with no code and no device fix that states an
  // accuracy, nothing speaks for the position's precision. The real cases
  // are codes-only mode (no device fix at all) once the app ends the code's
  // hold on an event - a new odometry frame, another tour, re-entering AR -
  // while the tracking report still reads ready on the code's synthetic
  // points. It must read as "none", not as a GPS position of unknown but
  // acceptable precision.
  it('reads a position with no code and no known device accuracy as "none"', () => {
    for (const position of ['aligned', 'lone-fix'] as const) {
      expect(
        positionPrecision({
          position,
          codeHold: false,
          gpsPoints: [synthetic(0.5), device(undefined)],
        })
      ).toEqual(NONE);
    }
  });
});

describe('canTellApart: can a position tell two targets this far apart', () => {
  const gps = (accuracyM: number): PositionPrecision => ({
    source: 'gps',
    accuracyM,
    tooWeak: false,
  });
  const code: PositionPrecision = {
    source: 'code',
    accuracyM: null,
    tooWeak: false,
  };

  // Why this test matters: the rule is "the factor times the position's
  // error length fits in half the spacing"; both sides of that boundary are
  // pinned, for a GPS position and for a code's.
  it('tells targets apart when factor x length fits in half the spacing', () => {
    const atBoundary = 2 * TELL_APART_FACTOR * 4;
    expect(canTellApart(gps(4), atBoundary)).toBe(true);
    expect(canTellApart(gps(4), atBoundary - 0.01)).toBe(false);
    const codeBoundary = 2 * TELL_APART_FACTOR * CODE_HELD_ERROR_M;
    expect(canTellApart(code, codeBoundary)).toBe(true);
    expect(canTellApart(code, codeBoundary - 0.01)).toBe(false);
  });

  // Why this test matters: no position and a position too weak to guide by
  // can tell nothing apart, however far apart the targets are - even with no
  // other target at all.
  it('never tells targets apart with no position or a too-weak one', () => {
    const weak: PositionPrecision = {
      source: 'gps',
      accuracyM: 30,
      tooWeak: true,
    };
    for (const p of [NONE, weak]) {
      expect(canTellApart(p, 1000)).toBe(false);
      expect(canTellApart(p, Number.POSITIVE_INFINITY)).toBe(false);
    }
  });

  // Why this test matters: the spacing comes from an app's geometry, which is
  // external data. Two targets on one spot, or a nonsense spacing, can never
  // be told apart; with no other target (infinite spacing) a usable position
  // has nothing to confuse.
  it('reads a zero, negative or NaN spacing as never, and an infinite one as always for a usable position', () => {
    for (const s of [0, -3, Number.NaN]) {
      expect(canTellApart(gps(1), s)).toBe(false);
      expect(canTellApart(code, s)).toBe(false);
    }
    expect(canTellApart(gps(20), Number.POSITIVE_INFINITY)).toBe(true);
    expect(canTellApart(code, Number.POSITIVE_INFINITY)).toBe(true);
  });

  // Why this test matters: the factor is the caller's to vary (the sweep
  // runs 0.5-3); a caller factor must move the boundary, and a factor that is
  // not a positive, finite number is a caller bug.
  it('honours a caller factor and refuses one that is not a positive, finite number', () => {
    expect(canTellApart(gps(4), 8, { factor: 1 })).toBe(true);
    expect(canTellApart(gps(4), 8, { factor: 1.01 })).toBe(false);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => canTellApart(gps(4), 8, { factor: bad })).toThrow(
        RangeError
      );
    }
  });

  // Why this test matters: a precision object built by hand (or read back
  // from somewhere) may carry a 'gps' source with no usable number; it must
  // not read as precise.
  it('never tells targets apart for a GPS position with no usable accuracy', () => {
    for (const accuracyM of [null, Number.NaN, -1, 0]) {
      expect(
        canTellApart({ source: 'gps', accuracyM, tooWeak: false }, 1000)
      ).toBe(false);
    }
  });
});
