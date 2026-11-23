import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_NEARBY_PARAMS,
  nearbyTargets,
  type Fix,
  type NearbyInput,
  type Target,
} from './nearby-targets.js';

const NOW = 1_800_000_000_000;
const P = DEFAULT_NEARBY_PARAMS;

/** One target at the origin, reach 2 m, accuracy 1 m. */
const TARGET: Target = {
  key: 't',
  kind: 'qr',
  north: 0,
  east: 0,
  accM: 1,
  reachM: 2,
};
/** acc_fix 4 m: s = sqrt(17), R_enter = 2 + 1.5 s, R_leave = 1.3 R_enter + 5. */
const ACC = 4;
const S = Math.hypot(ACC, 1);
const R_ENTER = 2 + 1.5 * S;
const R_LEAVE = 1.3 * R_ENTER + 5;

function run(fixes: Fix[], over: Partial<NearbyInput> = {}): NearbyInput {
  return {
    targets: [TARGET],
    fixes,
    newestFixAtMs: fixes.length > 0 ? fixes[fixes.length - 1]!.t : null,
    arPoses: [],
    live: null,
    nowMs: NOW,
    params: P,
    ...over,
  };
}

/** A point at a distance in (lo, hi) from the origin, any bearing. */
const pointBetween = (lo: number, hi: number) =>
  fc
    .tuple(
      fc.double({ min: lo + 0.01, max: hi - 0.01, noNaN: true }),
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true })
    )
    .map(([r, a]) => [r * Math.cos(a), r * Math.sin(a)] as const);

/** A series of `n` fixes one second apart ending at NOW - 1 s. */
function series(points: readonly (readonly [number, number])[]): Fix[] {
  return points.map(([n, e], i) => ({
    t: NOW - 1_000 * (points.length - i),
    north: n,
    east: e,
    accM: ACC,
  }));
}

describe('nearbyTargets properties', () => {
  // Why this test matters: a dwell rule (open only after N samples inside)
  // would fail this. Enter, then wander inside the band: stays open.
  it('a series that enters, then wanders in the band, stays open (within H)', () => {
    fc.assert(
      fc.property(
        pointBetween(0, R_ENTER),
        fc.array(pointBetween(R_ENTER, R_LEAVE), {
          minLength: 0,
          maxLength: 50,
        }),
        (inside, band) => {
          const r = nearbyTargets(run(series([inside, ...band])));
          expect(r.state).toBe('gps');
          expect(r.open.map((o) => o.key)).toEqual(['t']);
        }
      )
    );
  });

  // Why this test matters: the mirror image; leaving closes until a sample
  // comes back inside R_enter.
  it('a series that leaves, then wanders in the band, stays closed', () => {
    fc.assert(
      fc.property(
        pointBetween(0, R_ENTER),
        pointBetween(R_LEAVE, 500),
        fc.array(pointBetween(R_ENTER, R_LEAVE), {
          minLength: 0,
          maxLength: 50,
        }),
        (inside, outside, band) => {
          const r = nearbyTargets(run(series([inside, outside, ...band])));
          expect(r.open).toEqual([]);
        }
      )
    );
  });

  // Why this test matters: H is the gate's memory. A series that stays in
  // the band for longer than H closes.
  it('a series in the band longer than H closes', () => {
    fc.assert(
      fc.property(
        pointBetween(0, R_ENTER),
        fc.array(pointBetween(R_ENTER, R_LEAVE), {
          minLength: 61,
          maxLength: 90,
        }),
        (inside, band) => {
          const r = nearbyTargets(run(series([inside, ...band])));
          expect(r.open).toEqual([]);
        }
      )
    );
  });

  // Why this test matters: a worse accuracy (of the fixes or of the target)
  // must never close a target a better one opened, below the ceiling.
  it('is monotone in acc_fix and in the target accuracy', () => {
    fc.assert(
      fc.property(
        fc.array(pointBetween(0, 60), { minLength: 1, maxLength: 20 }),
        fc.double({ min: 0.5, max: 12, noNaN: true }),
        fc.double({ min: 0, max: 12, noNaN: true }),
        fc.double({ min: 0.5, max: 10, noNaN: true }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (points, acc, dAcc, tAcc, dT) => {
          const at = (a: number, ta: number) =>
            nearbyTargets({
              ...run(series(points).map((f) => ({ ...f, accM: a }))),
              targets: [{ ...TARGET, accM: ta }],
            }).open.length;
          fc.pre(at(acc, tAcc) === 1);
          expect(at(acc + dAcc, tAcc)).toBe(1);
          expect(at(acc, tAcc + dT)).toBe(1);
        }
      )
    );
  });

  // Why this test matters: a fix older than F is not GPS any more, from
  // one millisecond past F on (the unit test pins exactly F).
  it("never reads 'gps' when every fix is older than F", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: P.F + 1, max: 10 * P.H }),
        fc.array(pointBetween(0, 60), { minLength: 1, maxLength: 10 }),
        (age, points) => {
          // series() ends at NOW - 1 s: the newest fix is exactly age old.
          const fixes = series(points).map((f) => ({
            ...f,
            t: f.t + 1_000 - age,
          }));
          expect(nearbyTargets(run(fixes)).state).not.toBe('gps');
        }
      )
    );
  });

  // Why this test matters: the result is a function of the target set, not
  // of the order the tracker happens to list them in.
  it('is invariant to target order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            n: fc.double({ min: -60, max: 60, noNaN: true }),
            e: fc.double({ min: -60, max: 60, noNaN: true }),
          }),
          { minLength: 1, maxLength: 12 }
        ),
        fc.array(pointBetween(0, 30), { minLength: 1, maxLength: 10 }),
        fc.integer(),
        (ts, points, seed) => {
          const targets: Target[] = ts.map((p, i) => ({
            ...TARGET,
            key: `k${i}`,
            north: p.n,
            east: p.e,
          }));
          // Rotated by the seed, then reversed: a different order per run.
          const k = Math.abs(seed) % targets.length;
          const shuffled = [
            ...targets.slice(k),
            ...targets.slice(0, k),
          ].reverse();
          const fixes = series(points);
          expect(nearbyTargets({ ...run(fixes), targets: shuffled })).toEqual(
            nearbyTargets({ ...run(fixes), targets })
          );
        }
      )
    );
  });
});
