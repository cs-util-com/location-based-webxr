import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  canTellApart,
  positionPrecision,
  type PositionKind,
  type PositionPrecision,
  type PositionPrecisionInput,
  type PrecisionGpsPoint,
} from './position-precision.js';

/** An accuracy as a store may hold it: usually a plausible number, sometimes
 *  missing or nonsense (external data). */
const accuracyArb = fc.oneof(
  { weight: 8, arbitrary: fc.double({ min: 0.5, max: 80, noNaN: true }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      undefined,
      Number.NaN,
      0,
      -3,
      Number.POSITIVE_INFINITY
    ),
  }
);

/** A reading with the time it was taken: the judgement must not read it. */
type TimedPoint = PrecisionGpsPoint & { readonly timestamp: number };

const devicePointArb: fc.Arbitrary<TimedPoint> = fc.record({
  latLongAccuracy: accuracyArb,
  timestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
});

/** A reading that is not a device fix: a code's synthetic reading, or a
 *  stamp this version does not know. */
const otherPointArb: fc.Arbitrary<TimedPoint> = fc.record({
  latLongAccuracy: accuracyArb,
  source: fc.constantFrom('synthetic-qr', 'synthetic-beacon'),
  timestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
});

const kindArb: fc.Arbitrary<PositionKind | null> = fc.constantFrom(
  'aligned',
  'lone-fix',
  null
);

const inputArb: fc.Arbitrary<
  Omit<PositionPrecisionInput, 'gpsPoints'> & {
    readonly gpsPoints: readonly TimedPoint[];
  }
> = fc.record({
  position: kindArb,
  codeHold: fc.boolean(),
  gpsPoints: fc.array(fc.oneof(devicePointArb, otherPointArb), {
    maxLength: 30,
  }),
  loneFixAccuracyM: fc.oneof(
    fc.constant(null),
    accuracyArb.map((a) => a ?? null)
  ),
});

const spacingArb = fc.double({ min: 0.1, max: 200, noNaN: true });

/** Every device accuracy times `k` (k >= 1): the same fixes, each worse. */
function worsened(
  points: readonly PrecisionGpsPoint[],
  k: number
): PrecisionGpsPoint[] {
  return points.map((p) =>
    typeof p.latLongAccuracy === 'number'
      ? { ...p, latLongAccuracy: p.latLongAccuracy * k }
      : p
  );
}

const isDevice = (p: PrecisionGpsPoint) => p.source === undefined;

/** An accuracy a position can be judged by: finite and positive. */
const usable = (a: unknown): boolean =>
  typeof a === 'number' && Number.isFinite(a) && a > 0;

/** `a` implies `b`: one unconditional assertion per claim. */
const implies = (a: boolean, b: boolean): boolean => !a || b;

describe('position precision (property)', () => {
  // Why this test matters: the store mixes device fixes with the synthetic
  // readings a scanned code adds, and those carry a fixed accuracy of their
  // own. Whatever readings that are not device fixes sit where in the list,
  // the judgement must equal the one on the device fixes alone.
  it('never mixes a reading that is not a device fix into the judgement', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const deviceOnly = input.gpsPoints.filter(isDevice);
        expect(positionPrecision(input)).toEqual(
          positionPrecision({ ...input, gpsPoints: deviceOnly })
        );
      }),
      { numRuns: 400 }
    );
  });

  // Why this test matters: a code's trust ends only on events the app
  // reports through `codeHold`, never by the clock. The judgement reads no
  // time at all: giving every reading another timestamp - shifted as a long
  // GPS gap or a codes-only hour would, or redrawn so the gaps between
  // readings change too - changes nothing.
  it('reads no clock: every timestamp moved or redrawn, the judgement is the same', () => {
    fc.assert(
      fc.property(
        inputArb,
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.boolean(),
        fc.infiniteStream(fc.integer({ min: 0, max: 2_000_000_000_000 })),
        (input, shiftMs, redraw, times) => {
          const moved = input.gpsPoints.map((p) => ({
            ...p,
            timestamp: redraw ? times.next().value : p.timestamp + shiftMs,
          }));
          expect(positionPrecision({ ...input, gpsPoints: moved })).toEqual(
            positionPrecision(input)
          );
        }
      ),
      { numRuns: 300 }
    );
  });

  // Why this test matters: an aligned position a code holds is "code"
  // whatever the fixes are - none at all (codes-only mode), wild ones, old
  // ones - and only then.
  it('reads "code" exactly for an aligned position a code holds', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const p = positionPrecision(input);
        const held = input.position === 'aligned' && input.codeHold;
        const code = { source: 'code', accuracyM: null, tooWeak: false };
        expect(p.source === 'code').toBe(held);
        expect(held ? p : code).toEqual(code);
      }),
      { numRuns: 400 }
    );
  });

  // Why this test matters: "none" is the absence of any evidence - no
  // position, or no code and no device accuracy. It must always read too
  // weak, carry no number, and tell nothing apart at any spacing; any other
  // source must not be "none".
  it('reads "none" only with no position or no evidence, and then never as usable', () => {
    fc.assert(
      fc.property(inputArb, spacingArb, (input, spacingM) => {
        const p = positionPrecision(input);
        const anyDeviceAccuracy = input.gpsPoints.some(
          (q) => isDevice(q) && usable(q.latLongAccuracy)
        );
        const loneOwn =
          input.position === 'lone-fix' && usable(input.loneFixAccuracyM);
        const evidence =
          (input.position === 'aligned' && input.codeHold) ||
          anyDeviceAccuracy ||
          loneOwn;
        expect(p.source === 'none').toBe(input.position === null || !evidence);
        const unusable =
          p.tooWeak &&
          p.accuracyM === null &&
          !canTellApart(p, spacingM) &&
          !canTellApart(p, Number.POSITIVE_INFINITY);
        expect(implies(p.source === 'none', unusable)).toBe(true);
        expect(implies(p.source === 'gps', usable(p.accuracyM))).toBe(true);
      }),
      { numRuns: 400 }
    );
  });

  // Why this test matters: monotonicity is what makes the judgement safe to
  // build on - the same fixes, each reported worse, must never read as more
  // precise: never a smaller number, never "too weak" turning into usable,
  // never "cannot tell apart" turning into "can".
  it('never reads worse fixes as better', () => {
    fc.assert(
      fc.property(
        inputArb,
        fc.double({ min: 1, max: 20, noNaN: true }),
        spacingArb,
        (input, k, spacingM) => {
          const before = positionPrecision(input);
          const after = positionPrecision({
            ...input,
            gpsPoints: worsened(input.gpsPoints, k),
            loneFixAccuracyM:
              typeof input.loneFixAccuracyM === 'number'
                ? input.loneFixAccuracyM * k
                : (input.loneFixAccuracyM ?? null),
          });
          expect(after.source).toBe(before.source);
          // The source is unchanged, so both numbers are null or neither.
          expect((after.accuracyM ?? 0) >= (before.accuracyM ?? 0)).toBe(true);
          expect(implies(before.tooWeak, after.tooWeak)).toBe(true);
          expect(
            implies(
              canTellApart(after, spacingM),
              canTellApart(before, spacingM)
            )
          ).toBe(true);
        }
      ),
      { numRuns: 400 }
    );
  });

  // Why this test matters: a lone raw fix is never more precise than the
  // aligned position on the same fixes (it carries its own error on top),
  // and an aligned verdict does not move with the lone fix's accuracy.
  it('never judges a lone fix better than the aligned position, and an aligned one ignores the lone fix', () => {
    fc.assert(
      fc.property(inputArb, accuracyArb, (input, other) => {
        const aligned = positionPrecision({
          ...input,
          position: 'aligned',
          codeHold: false,
        });
        const lone = positionPrecision({
          ...input,
          position: 'lone-fix',
          codeHold: false,
        });
        expect(
          implies(
            aligned.accuracyM !== null,
            lone.accuracyM !== null && lone.accuracyM >= aligned.accuracyM!
          )
        ).toBe(true);
        expect(
          positionPrecision({
            ...input,
            position: 'aligned',
            codeHold: false,
            loneFixAccuracyM: other ?? null,
          })
        ).toEqual(aligned);
      }),
      { numRuns: 300 }
    );
  });
});

describe('canTellApart (property)', () => {
  const precisionArb: fc.Arbitrary<PositionPrecision> = inputArb.map((i) =>
    positionPrecision(i)
  );

  // Why this test matters: targets further apart are never harder to tell
  // apart, and a stricter factor never says yes where a looser one said no.
  it('is monotone in the spacing and in the factor', () => {
    fc.assert(
      fc.property(
        precisionArb,
        spacingArb,
        spacingArb,
        fc.double({ min: 0.25, max: 4, noNaN: true }),
        fc.double({ min: 0.25, max: 4, noNaN: true }),
        (p, s1, s2, f1, f2) => {
          const [near, far] = s1 <= s2 ? [s1, s2] : [s2, s1];
          const [loose, strict] = f1 <= f2 ? [f1, f2] : [f2, f1];
          expect(implies(canTellApart(p, near), canTellApart(p, far))).toBe(
            true
          );
          expect(
            implies(
              canTellApart(p, near, { factor: strict }),
              canTellApart(p, near, { factor: loose })
            )
          ).toBe(true);
        }
      ),
      { numRuns: 400 }
    );
  });

  // Why this test matters: a code-held position is the most precise there
  // is: wherever a GPS position can tell two targets apart, a code's can
  // too, whatever the GPS accuracy - so long as no GPS reading claims under
  // the code's own error length.
  it('a code tells apart whatever a GPS position at the code-held length or worse can', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 25, noNaN: true }),
        spacingArb,
        (accuracyM, spacingM) => {
          const gps: PositionPrecision = {
            source: 'gps',
            accuracyM,
            tooWeak: false,
          };
          const code: PositionPrecision = {
            source: 'code',
            accuracyM: null,
            tooWeak: false,
          };
          expect(
            implies(canTellApart(gps, spacingM), canTellApart(code, spacingM))
          ).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });
});
