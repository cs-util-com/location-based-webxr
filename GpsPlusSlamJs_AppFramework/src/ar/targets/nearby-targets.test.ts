import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEARBY_PARAMS,
  firstIndexAtOrAfter,
  nearbyTargets,
  timeSlot,
  type ArPose,
  type Fix,
  type LivePose,
  type NearbyInput,
  type Target,
} from './nearby-targets.js';

const NOW = 1_800_000_000_000;
const P = DEFAULT_NEARBY_PARAMS;

function target(
  key: string,
  north: number,
  east: number,
  extra: Partial<Target> = {}
): Target {
  return { key, kind: 'qr', north, east, accM: 5, reachM: 3, ...extra };
}

function fix(t: number, north: number, east: number, accM = 5): Fix {
  return { t, north, east, accM };
}

function input(over: Partial<NearbyInput>): NearbyInput {
  return {
    targets: [],
    fixes: [],
    newestFixAtMs: null,
    arPoses: [],
    live: null,
    nowMs: NOW,
    params: P,
    ...over,
  };
}

/** A visitor standing at (n, e) with a fix every second for 10 s. */
function standing(n: number, e: number, accM = 5): Fix[] {
  return Array.from({ length: 10 }, (_, i) =>
    fix(NOW - 9_000 + i * 1_000, n, e, accM)
  );
}

describe('nearbyTargets: a heading-uncertain target', () => {
  // Why this test matters: a heading-uncertain mint's spot can be off by
  // about its alignment's GPS extent: its accuracy is max(own, default)
  // plus headingWideningK times the extent. K 0 (or an extent of 0) leaves
  // the target exactly as it was: its own accuracy, not raised to the
  // default.
  it('widens by headingWideningK x alignmentGpsExtentM over max(own, default)', () => {
    const openAt = (t: Target, k: number) =>
      [0, 5, 10, 15, 20, 25, 30, 35, 40].filter(
        (d) =>
          nearbyTargets(
            input({
              targets: [{ ...t, east: d }],
              fixes: standing(0, 0, 3),
              newestFixAtMs: NOW,
              params: { ...P, headingWideningK: k },
            })
          ).open.length > 0
      );
    const plain = (accM: number) => target('x', 0, 0, { accM });
    const uncertain = (accM: number) =>
      target('x', 0, 0, { accM, alignmentGpsExtentM: 6 });
    // K 1: own 8 + 6 = 14; own 2 rises to the default 5 first: 11.
    expect(openAt(uncertain(8), 1)).toEqual(openAt(plain(14), 1));
    expect(openAt(uncertain(2), 1)).toEqual(openAt(plain(11), 1));
    expect(openAt(uncertain(2), 1)).not.toEqual(openAt(plain(8), 1));
    // K 0: unwidened.
    expect(openAt(uncertain(8), 0)).toEqual(openAt(plain(8), 0));
    expect(openAt(uncertain(8), 0)).not.toEqual(openAt(plain(14), 0));
    // Own 2 at K 0 stays 2 (R_enter 8.4 m), not the default 5 (11.7 m).
    expect(openAt(uncertain(2), 0)).toEqual(openAt(plain(2), 0));
    expect(openAt(uncertain(2), 0)).not.toEqual(openAt(plain(5), 0));
    const flat = target('x', 0, 0, { accM: 2, alignmentGpsExtentM: 0 });
    expect(openAt(flat, 1)).toEqual(openAt(plain(2), 1));
  });

  // Why this test matters: a malformed extent must not widen (or poison)
  // the accuracy. Own 8 m, fixes 3 m: R_enter = 3 + 1.5 x hypot(3, 8) =
  // 15.8 m, R_leave 25.6 m. A negative extent applied (8 - 1 = 7 m) gives
  // R_enter 14.4 m, closed at 15 m; an infinite one opens at 30 m; NaN
  // decides nothing, closed at 15 m.
  it('ignores an extent that is not finite and >= 0', () => {
    const opens = (east: number, extent?: number) =>
      nearbyTargets(
        input({
          targets: [
            target('x', 0, east, {
              accM: 8,
              ...(extent === undefined ? {} : { alignmentGpsExtentM: extent }),
            }),
          ],
          fixes: standing(0, 0, 3),
          newestFixAtMs: NOW,
        })
      ).open.length;
    expect(opens(15)).toBe(1);
    expect(opens(30)).toBe(0);
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(opens(15, bad)).toBe(1);
      expect(opens(30, bad)).toBe(0);
    }
  });
});

describe('nearbyTargets: the state', () => {
  // Why this test matters: the state picks the detector's cadence; a fresh
  // fix under the ceiling is the only way into 'gps'.
  it("reads 'gps' with a fix no older than F", () => {
    const r = nearbyTargets(
      input({ fixes: standing(0, 0), newestFixAtMs: NOW - 1_000 })
    );
    expect(r.state).toBe('gps');
  });

  // Why this test matters: F is inclusive: a fix exactly F old is still
  // GPS, one millisecond older is not (the property pins the other side).
  it("reads 'gps' with the newest fix exactly F old", () => {
    const at = NOW - P.F;
    const r = nearbyTargets(
      input({ fixes: [fix(at, 0, 0)], newestFixAtMs: at })
    );
    expect(r.state).toBe('gps');
  });

  // Why this test matters: a stale fix must not count as GPS; without a
  // live pose and its paired AR pose the gate knows nothing.
  it("reads 'unknown' with a stale fix and no live pose", () => {
    const fixes = [fix(NOW - 6_000, 0, 0)];
    const r = nearbyTargets(input({ fixes, newestFixAtMs: NOW - 6_000 }));
    expect(r.state).toBe('unknown');
  });

  // Why this test matters: 'dr' needs both a live pose and the AR pose of
  // the newest device fix; either missing must give 'unknown'.
  it("reads 'dr' only with a live pose and a device AR sample at or before the newest fix", () => {
    const fixes = [fix(NOW - 8_000, 0, 0)];
    const live: LivePose = {
      t: NOW,
      north: 2,
      east: 0,
      ar: [2, 0, 0],
      accM: 5,
    };
    const paired: ArPose = { t: NOW - 8_000, pos: [0, 0, 0], device: true };
    const base = { fixes, newestFixAtMs: NOW - 8_000, live };
    expect(nearbyTargets(input({ ...base, arPoses: [paired] })).state).toBe(
      'dr'
    );
    expect(nearbyTargets(input({ ...base, arPoses: [] })).state).toBe(
      'unknown'
    );
    expect(
      nearbyTargets(input({ ...base, arPoses: [paired], live: null })).state
    ).toBe('unknown');
    // A vote sample alone is no anchor: it marks a code, not the visitor.
    expect(
      nearbyTargets(input({ ...base, arPoses: [{ ...paired, device: false }] }))
        .state
    ).toBe('unknown');
    // A sample newer than the newest fix is no anchor either.
    expect(
      nearbyTargets(
        input({ ...base, arPoses: [{ ...paired, t: NOW - 7_000 }] })
      ).state
    ).toBe('unknown');
  });

  // Why this test matters: distance gating can drop the odometry sample of
  // a device fix, so the anchor is the newest device sample at or before the
  // newest fix, not one whose t equals it. The drift is measured from there.
  it("anchors 'dr' on an earlier device sample when the newest fix's sample was gated out", () => {
    const fixes = [fix(NOW - 9_000, 0, -20, 3), fix(NOW - 8_000, 0, -20, 3)];
    const arPoses: ArPose[] = [
      { t: NOW - 9_000, pos: [0, 0, 0], device: true },
    ];
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 20],
      accM: 3,
    };
    const run = (east: number) =>
      nearbyTargets(
        input({
          targets: [target('x', 0, east, { accM: 0.0001, reachM: 0 })],
          fixes,
          newestFixAtMs: NOW - 8_000,
          arPoses,
          live,
        })
      );
    expect(run(0).state).toBe('dr');
    // s_dr = 3 + 0.03 x 20 = 3.6 m: R_enter = 5.4 m.
    expect(run(5.3).open).toHaveLength(1);
    expect(run(5.5).open.length).toBe(0);
  });

  // Why this test matters: several samples can share one t (a lock's four
  // votes, stamped like a fix). t is no key: the anchor is the newest
  // DEVICE sample, never a vote at a code's corner.
  it('anchors on the device sample when votes share its t', () => {
    const t0 = NOW - 8_000;
    const arPoses: ArPose[] = [
      { t: t0, pos: [0, 0, 0], device: true },
      { t: t0, pos: [30, 0, 0], device: false },
      { t: t0, pos: [30, 0, 1], device: false },
    ];
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 0],
      accM: 3,
    };
    const r = nearbyTargets(
      input({
        targets: [target('x', 0, 4.4, { accM: 0.0001, reachM: 0 })],
        fixes: [fix(t0, 0, 0, 3)],
        newestFixAtMs: t0,
        arPoses,
        live,
      })
    );
    // Anchored on the device sample: no drift, R_enter = 4.5 m. Anchored on
    // a vote it would be 3 + 0.9 = 3.9 m x 1.5 = 5.85 m - still open, so the
    // test pins the drift by a target the vote anchor would open alone.
    expect(r.state).toBe('dr');
    expect(r.open).toHaveLength(1);
    const far = nearbyTargets(
      input({
        targets: [target('x', 0, 5, { accM: 0.0001, reachM: 0 })],
        fixes: [fix(t0, 0, 0, 3)],
        newestFixAtMs: t0,
        arPoses,
        live,
      })
    );
    expect(far.open).toEqual([]);
  });

  // Why this test matters: a vote sample stored after the newest device
  // sample (a lock between two fixes, or after the newest one) sits at a
  // code's corner, not where the device was: it must never anchor 'dr'.
  it('never anchors on a vote sample at a later t', () => {
    const t0 = NOW - 8_000;
    const arPoses: ArPose[] = [
      { t: t0, pos: [0, 0, 0], device: true },
      { t: t0 + 1_000, pos: [0, 0, 30], device: false },
      { t: t0 + 3_000, pos: [0, 0, 30], device: false },
    ];
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 0],
      accM: 3,
    };
    const r = nearbyTargets(
      input({
        targets: [target('x', 0, 5, { accM: 0.0001, reachM: 0 })],
        fixes: [fix(t0, 0, 0, 3), fix(t0 + 2_000, 0, 0, 3)],
        newestFixAtMs: t0 + 2_000,
        arPoses,
        live,
      })
    );
    // Anchored on the device sample: no drift, R_enter 4.5 m, closed at
    // 5 m. A vote anchor would drift 30 m: R_enter 5.85 m, open.
    expect(r.state).toBe('dr');
    expect(r.open).toEqual([]);
  });

  // Why this test matters: several device samples may share one t; the
  // last stored is the anchor, so the order of storage decides, not a
  // search that could pick either.
  it('takes the last stored of several device samples at one t', () => {
    const t0 = NOW - 8_000;
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 0],
      accM: 3,
    };
    const run = (arPoses: ArPose[]) =>
      nearbyTargets(
        input({
          targets: [target('x', 0, 5, { accM: 0.0001, reachM: 0 })],
          fixes: [fix(t0, 0, 0, 3)],
          newestFixAtMs: t0,
          arPoses,
          live,
        })
      ).open.length;
    const near = { t: t0, pos: [0, 0, 0] as const, device: true };
    const far = { t: t0, pos: [0, 0, 30] as const, device: true };
    // Last stored near: no drift, closed; last stored far: 30 m drift, open.
    expect(run([far, near])).toBe(0);
    expect(run([near, far])).toBe(1);
  });

  // Why this test matters: above the 25 m ceiling the position is too weak
  // to gate by, even with a fresh fix.
  it("reads 'unknown' when acc_fix is above the ceiling", () => {
    const r = nearbyTargets(
      input({ fixes: standing(0, 0, 30), newestFixAtMs: NOW - 1_000 })
    );
    expect(r.state).toBe('unknown');
    expect(
      nearbyTargets(
        input({ fixes: standing(0, 0, 25), newestFixAtMs: NOW - 1_000 })
      ).state
    ).toBe('gps');
  });

  // Why this test matters: a tracking restart empties the odometry series;
  // the gate must fall back to 'unknown', never dead-reckon from nothing.
  it("reads 'unknown' after a tracking restart emptied the series", () => {
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 0],
      accM: 5,
    };
    const r = nearbyTargets(
      input({
        fixes: [],
        newestFixAtMs: NOW - 20_000,
        arPoses: [],
        live,
        targets: [target('a', 0, 0)],
      })
    );
    expect(r.state).toBe('unknown');
    expect(r.open).toEqual([]);
  });

  // Why this test matters: codes-only. Only QR lock votes grow the series,
  // four per lock at the code's corners. They must never anchor 'dr' nor
  // invent a position: newestFixAtMs is null, so the state is 'unknown'.
  it("reads 'unknown' for the codes-only input (vote samples plus live, no device fix)", () => {
    const votes: ArPose[] = [];
    for (const t of [NOW - 20_000, NOW - 10_000]) {
      for (const [n, e] of [
        [5, 5],
        [5, 5.2],
        [5.2, 5.2],
        [5.2, 5],
      ] as const) {
        votes.push({ t, pos: [n, 0, e], device: false });
      }
    }
    for (const accM of [1, null]) {
      const live: LivePose = { t: NOW, north: 4, east: 4, ar: [4, 0, 4], accM };
      const r = nearbyTargets(
        input({
          fixes: [],
          newestFixAtMs: null,
          arPoses: votes,
          live,
          targets: [target('near', 4, 4), target('far', 400, 0)],
        })
      );
      expect(r.state).toBe('unknown');
      expect(r.open).toEqual([]);
    }
  });
});

describe('nearbyTargets: acc_fix', () => {
  const t = target('t', 20, 0, { accM: 0.0001, reachM: 0 });

  /** Whether a target 20 m north opens for a visitor at the origin. */
  function opensAt(accM: number | null, fixAcc: number): boolean {
    const live: LivePose = { t: NOW, north: 0, east: 0, ar: [0, 0, 0], accM };
    const fixes = standing(0, 0, fixAcc);
    return (
      nearbyTargets(
        input({
          targets: [t],
          fixes,
          newestFixAtMs: NOW - 1_000,
          arPoses: [{ t: NOW - 1_000, pos: [0, 0, 0], device: true }],
          live,
        })
      ).open.length === 1
    );
  }

  // Why this test matters: the aligned median (here 14 m) sets the radius:
  // R_enter = 1.5 x 14 = 21 m reaches a target 20 m away.
  it('uses the live pose acc_fix (the aligned median)', () => {
    expect(opensAt(14, 5)).toBe(true);
    expect(opensAt(12, 5)).toBe(false);
  });

  // Why this test matters: under a code hold acc_fix is 1 m; a wide old
  // GPS median must not widen the live radius then (it stays 1.5 m).
  it('takes the code-hold 1 m for the live sample', () => {
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 0],
      accM: 1,
    };
    const r = nearbyTargets(
      input({
        targets: [target('t', 3, 0, { accM: 0.0001, reachM: 0 })],
        fixes: [fix(NOW - 1_000, 0, 100, 20)],
        newestFixAtMs: NOW - 1_000,
        arPoses: [{ t: NOW - 1_000, pos: [0, 0, 0], device: true }],
        live,
      })
    );
    // 3 m > 1.5 x 1 m: closed on the live sample's R_enter; 3 m < the
    // leave radius 1.3 x 1.5 + 5 m, so the scan goes on to the fix 100 m
    // away, beyond its own leave radius: closed.
    expect(r.open).toEqual([]);
  });

  // Why this test matters: a lone fix (no live pose) is judged by its own
  // sample accuracy, which the call site sets to the worse of the median and
  // the fix's own.
  it('a lone fix is judged by its own sample accuracy', () => {
    const lone = (acc: number) =>
      nearbyTargets(
        input({
          targets: [t],
          fixes: [fix(NOW - 1_000, 0, 0, acc)],
          newestFixAtMs: NOW - 1_000,
        })
      ).open.length;
    expect(lone(14)).toBe(1);
    expect(lone(12)).toBe(0);
  });

  // Why this test matters: null live accuracy takes the newest fix's.
  it('a live pose without an accuracy takes the newest fix accuracy', () => {
    expect(opensAt(null, 14)).toBe(true);
    expect(opensAt(null, 12)).toBe(false);
  });
});

describe('nearbyTargets: the GPS gate', () => {
  // Why this test matters: the core promise of 'dr'. When fixes stop, the
  // live aligned pose keeps moving, so a target 40 m ahead opens and the one
  // at the last fix closes; s grows with the AR distance since the fix.
  it('follows the live pose when fixes stop and the visitor walks 40 m', () => {
    const fixAt = NOW - 30_000;
    const fixes = [fix(fixAt - 1_000, 0, 0, 3), fix(fixAt, 0, 0, 3)];
    const arPoses: ArPose[] = [
      { t: fixAt - 1_000, pos: [0, 0, 0], device: true },
      { t: fixAt, pos: [0, 0, 0], device: true },
    ];
    const live: LivePose = {
      t: NOW,
      north: 40,
      east: 0,
      ar: [40, 0, 0],
      accM: 3,
    };
    const r = nearbyTargets(
      input({
        targets: [
          target('ahead', 40, 0, { accM: 1, reachM: 2 }),
          target('behind', 0, 0, { accM: 1, reachM: 2 }),
        ],
        fixes,
        newestFixAtMs: fixAt,
        arPoses,
        live,
      })
    );
    expect(r.state).toBe('dr');
    expect(r.open.map((o) => o.key)).toEqual(['ahead']);
    expect(r.open[0]?.by).toBe('gps');
    // s_dr = sqrt(3^2 + 1^2) + 0.03 x 40 = 4.36 m: R_enter = 2 + 1.5 x 4.36
    // = 8.5 m. A target 8 m off the live pose opens, 9 m does not.
    const near = (offset: number) =>
      nearbyTargets(
        input({
          targets: [target('x', 40, offset, { accM: 1, reachM: 2 })],
          fixes,
          newestFixAtMs: fixAt,
          arPoses,
          live,
        })
      ).open.length;
    expect(near(8)).toBe(1);
    // Without the drift term R_enter would be 2 + 1.5 x 3.16 = 6.7 m.
    expect(near(9)).toBe(0);
  });

  // Why this test matters: hysteresis. A sample between the two radii
  // neither opens nor closes; the scan reaches back to a decisive one.
  it('keeps the gate open while the newest samples sit in the band', () => {
    const tg = target('t', 0, 0, { accM: 0.0001, reachM: 0 });
    // acc 4 m: R_enter = 6 m, R_leave = 1.3 x 6 + 5 = 12.8 m.
    const enteredThenBand = [
      fix(NOW - 5_000, 0, 5, 4),
      fix(NOW - 3_000, 0, 10, 4),
      fix(NOW - 1_000, 0, 12, 4),
    ];
    const leftThenBand = [
      fix(NOW - 5_000, 0, 20, 4),
      fix(NOW - 3_000, 0, 10, 4),
      fix(NOW - 1_000, 0, 12, 4),
    ];
    const run = (fixes: Fix[]) =>
      nearbyTargets(input({ targets: [tg], fixes, newestFixAtMs: NOW - 1_000 }))
        .open.length;
    expect(run(enteredThenBand)).toBe(1);
    expect(run(leftThenBand)).toBe(0);
  });

  // Why this test matters: the look-back H is the gate's whole memory: an
  // entry older than H no longer holds it open.
  it('closes when the only entry is older than H', () => {
    const tg = target('t', 0, 0, { accM: 0.0001, reachM: 0 });
    const fixes = [fix(NOW - 61_000, 0, 1, 4), fix(NOW - 1_000, 0, 10, 4)];
    const r = nearbyTargets(
      input({ targets: [tg], fixes, newestFixAtMs: NOW - 1_000 })
    );
    expect(r.open).toEqual([]);
  });

  // Why this test matters: external data. A sample whose accuracy is not a
  // finite positive number is ignored: it can never open a target.
  it('ignores a sample with a non-finite or non-positive accuracy', () => {
    const tg = target('t', 0, 0);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = nearbyTargets(
        input({
          targets: [tg],
          fixes: [fix(NOW - 2_000, 0, 500, 5), fix(NOW - 1_000, 0, 0, bad)],
          newestFixAtMs: NOW - 1_000,
        })
      );
      expect(r.open).toEqual([]);
    }
  });

  // Why this test matters: the open list comes in plain distance order.
  it('returns the open targets nearest first', () => {
    const r = nearbyTargets(
      input({
        targets: [target('b', 6, 0), target('a', 2, 0), target('c', 4, 0)],
        fixes: standing(0, 0),
        newestFixAtMs: NOW - 1_000,
      })
    );
    expect(r.open.map((o) => o.key)).toEqual(['a', 'c', 'b']);
    expect(r.open[0]?.distM).toBeCloseTo(2);
  });

  // Why this test matters: a target without accuracy takes the default
  // (5 m), and a target that cannot be placed never opens by GPS.
  it('defaults a missing target accuracy and skips a target without a position', () => {
    const tg = (accM: number | null) =>
      target('t', 0, 10.5, { accM, reachM: 0 });
    const run = (t: Target) =>
      nearbyTargets(
        input({
          targets: [t],
          fixes: standing(0, 0, 0.0001),
          newestFixAtMs: NOW - 1_000,
        })
      ).open.length;
    // s = 5 m (the default): R_enter = 7.5 m; with 7.1 m: 10.65 m.
    expect(run(tg(null))).toBe(0);
    expect(run(tg(7.1))).toBe(1);
    expect(run(target('nan', Number.NaN, 0))).toBe(0);
  });
});

describe('nearbyTargets: the AR gate', () => {
  const fixAt = NOW - 30_000;
  const base = {
    fixes: [fix(fixAt, 500, 500, 5)],
    newestFixAtMs: fixAt,
  };

  // Why this test matters: R_AR grows with the AR path walked since the
  // sighting, measured from the sighting through the series to live.ar.
  it('opens within reachM + margin + alpha x path walked since the sighting', () => {
    const sighting: ArPose = { t: NOW - 20_000, pos: [0, 0, 0] };
    const arPoses: ArPose[] = [
      { t: NOW - 10_000, pos: [50, 0, 0], device: true },
      { t: NOW - 5_000, pos: [0, 0, 0], device: true },
    ];
    const run = (liveN: number, poses: ArPose[]) =>
      nearbyTargets(
        input({
          ...base,
          arPoses: poses,
          live: { t: NOW, north: 999, east: 999, ar: [liveN, 0, 0], accM: 5 },
          targets: [target('s', 900, 900, { reachM: 1, sighting, accM: 1 })],
        })
      ).open;
    // Path 50 + 50 + 5 = 105 m: R_AR = 1 + 1 + 3.15 = 5.15 m.
    expect(run(5, arPoses).map((o) => o.by)).toEqual(['ar']);
    // Without the walk out and back: path 5 m, R_AR = 2.15 m.
    expect(run(5, [])).toEqual([]);
    expect(run(2, [])).toHaveLength(1);
  });

  // Why this test matters: a lock's keep-alive stores vote rings at the
  // code's corners, about three per device fix for minutes. Counted as a
  // walk, the path would zig-zag camera, code, camera, and a just-scanned
  // code would stay open by AR far away. Only device samples are a walk.
  it('counts device samples only: vote rings between them leave R_AR unchanged', () => {
    const sighting: ArPose = { t: NOW - 20_000, pos: [0, 0, 0] };
    const device: ArPose[] = [
      { t: NOW - 10_000, pos: [0, 0, 0], device: true },
      { t: NOW - 5_000, pos: [0, 0, 0], device: true },
    ];
    const rings: ArPose[] = [0, 1, 2].map((i) => ({
      t: NOW - 8_000 + i,
      pos: [100, 0, i],
      device: false,
    }));
    const run = (poses: ArPose[]) =>
      nearbyTargets(
        input({
          ...base,
          arPoses: poses,
          live: { t: NOW, north: 999, east: 999, ar: [3, 0, 0], accM: 5 },
          targets: [target('s', 900, 900, { reachM: 1, sighting, accM: 1 })],
        })
      ).open;
    // Path 3 m: R_AR = 2.09 m, closed at 3 m. The rings would add 200 m.
    expect(run(device)).toEqual([]);
    expect(run([device[0]!, ...rings, device[1]!])).toEqual([]);
  });

  // Why this test matters: a code minted without a geo pose has no GPS
  // position, yet once seen it must stay searchable while the visitor is
  // still beside it; the GPS gate skips it, the AR gate does not.
  it('opens a target without a position by its sighting alone', () => {
    const r = nearbyTargets(
      input({
        ...base,
        live: { t: NOW, north: 0, east: 0, ar: [1, 0, 0], accM: 5 },
        targets: [
          target('nogeo', Number.NaN, Number.NaN, {
            reachM: 1,
            sighting: { t: NOW - 1_000, pos: [0, 0, 0] },
          }),
        ],
      })
    );
    expect(r.open.map((o) => [o.key, o.by])).toEqual([['nogeo', 'ar']]);
  });

  // Why this test matters (a contract example, not a wiring test): the
  // kernel measures live.ar against whatever point `sighting` holds; it
  // cannot tell a camera position from a target pose. This example shows
  // why the contract asks trackers for the camera position: a visitor who
  // read a code from 6 m away and has not moved stays open against the
  // camera point and closes against the code's pose (beyond reachM 1 +
  // margin 1). Whether a tracker passes the right point belongs in that
  // tracker's own wiring tests.
  it('measures from the sighting point it is given (contract example)', () => {
    const camera: ArPose = { t: NOW - 1_000, pos: [0, 0, 0] };
    const codePose: ArPose = { t: NOW - 1_000, pos: [6, 0, 0] };
    const run = (sighting: ArPose) =>
      nearbyTargets(
        input({
          ...base,
          live: { t: NOW, north: 999, east: 999, ar: [0, 0, 0], accM: 5 },
          targets: [target('s', 900, 900, { reachM: 1, sighting })],
        })
      ).open.map((o) => [o.key, o.by, o.distM]);
    expect(run(camera)).toEqual([['s', 'ar', 0]]);
    expect(run(codePose)).toEqual([]);
  });

  // Why this test matters: the AR gate needs the live AR pose.
  it('is closed without a live pose', () => {
    const r = nearbyTargets(
      input({
        ...base,
        targets: [
          target('s', 900, 900, {
            sighting: { t: NOW - 1_000, pos: [0, 0, 0] },
          }),
        ],
      })
    );
    expect(r.open).toEqual([]);
  });
});

describe('nearbyTargets: the look-back H caps the kernel itself', () => {
  // Why this test matters: the kernel's memory is H whatever it is fed: a
  // caller handing it the whole series must not keep 'dr' alive on an
  // anchor older than H.
  it("anchors 'dr' within H only, even when handed the whole series", () => {
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 0],
      accM: 3,
    };
    const at = (age: number) =>
      nearbyTargets(
        input({
          fixes: [fix(NOW - age, 0, 0, 3)],
          newestFixAtMs: NOW - age,
          arPoses: [{ t: NOW - age, pos: [0, 0, 0], device: true }],
          live,
        })
      ).state;
    expect(at(59_000)).toBe('dr');
    expect(at(61_000)).toBe('unknown');
  });

  // Why this test matters: acc_fix falls back to the newest fix's accuracy
  // when the live pose states none. A fix older than H is outside the
  // kernel's memory; its accuracy must not vouch for a fresh device fix
  // that carried none (the source drops such a fix from `fixes`).
  it('takes the fallback accuracy from fixes within H only', () => {
    const r = nearbyTargets(
      input({
        fixes: [fix(NOW - 70_000, 0, 0, 3)],
        newestFixAtMs: NOW - 1_000,
      })
    );
    expect(r.state).toBe('unknown');
  });

  // Why this test matters: a device fix stamped later than nowMs (a clock
  // step, a bad stamp) is not evidence of a fix within the last F; read
  // as fresh, a stamp far ahead would hold 'gps' for as long as it leads.
  // Within F of nowMs either way it still counts, so a few ms of skew
  // between the two clocks never flickers the state.
  it("reads 'gps' only for a fix within F of nowMs, either side", () => {
    const at = (t: number) =>
      nearbyTargets(input({ fixes: [fix(t, 0, 0, 3)], newestFixAtMs: t }))
        .state;
    expect(at(NOW + 50)).toBe('gps');
    expect(at(NOW + P.F)).toBe('gps');
    expect(at(NOW + P.F + 1)).toBe('unknown');
    expect(at(NOW + 3_600_000)).toBe('unknown');
  });

  // Why this test matters: the AR path is the walk within H; samples older
  // than H must not widen R_AR when a caller hands the whole series.
  it('counts the AR path within H only, even when handed the whole series', () => {
    const sighting: ArPose = { t: NOW - 70_000, pos: [0, 0, 0] };
    const inside: ArPose = { t: NOW - 50_000, pos: [0, 0, 0], device: true };
    const old: ArPose = { t: NOW - 65_000, pos: [50, 0, 0], device: true };
    const run = (arPoses: ArPose[]) =>
      nearbyTargets(
        input({
          arPoses,
          live: { t: NOW, north: 999, east: 999, ar: [5, 0, 0], accM: 5 },
          targets: [target('s', 900, 900, { reachM: 1, sighting, accM: 1 })],
        })
      ).open;
    // Within H the walk is 5 m: R_AR = 2.15 m, closed at 5 m. The old
    // sample would add 100 m (R_AR 5.15 m, open).
    expect(run([inside])).toEqual([]);
    expect(run([old, inside])).toEqual([]);
  });
});

describe('nearbyTargets: the live drift', () => {
  // Why this test matters: a live pose without a finite AR position has no
  // drift to add; a NaN drift would make the live sample decide nothing and
  // hand the decision to an older fix.
  it('adds no drift for a live pose without a finite AR position', () => {
    const r = nearbyTargets(
      input({
        targets: [target('t', 0, 0, { accM: 0.0001 })],
        fixes: [fix(NOW - 1_000, 0, 100, 3)],
        newestFixAtMs: NOW - 1_000,
        arPoses: [{ t: NOW - 1_000, pos: [0, 0, 0], device: true }],
        live: {
          t: NOW,
          north: 0,
          east: 0,
          ar: [Number.NaN, 0, Number.NaN],
          accM: 3,
        },
      })
    );
    expect(r.state).toBe('gps');
    expect(r.open.map((o) => o.key)).toEqual(['t']);
  });
});

describe('timeSlot', () => {
  // Why this test matters: the round robin is derived from the clock
  // alone; within one period the slot holds still, and it is in range.
  it('holds one slot per period, always in range', () => {
    for (let p = 0; p < 50; p += 1) {
      const s = timeSlot(NOW + p * 1_000, 1_000, 3);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(3);
      expect(timeSlot(NOW + p * 1_000 + 999, 1_000, 3)).toBe(s);
    }
  });

  // Why this test matters: a caller that sees only every second or third
  // period (a slow camera, a busy tracker) would, with a plain period
  // count mod n, see the same few slots forever whenever the stride shares
  // a factor with n, and starve the other targets. Every slot must still
  // come up.
  it('reaches every slot when only every second or third period is seen', () => {
    for (const stride of [2, 3]) {
      for (const n of [2, 3, 4, 6]) {
        const seen = new Set<number>();
        for (let p = 0; p < 300; p += stride) {
          seen.add(timeSlot(NOW + p * 1_000, 1_000, n));
        }
        expect(seen.size).toBe(n);
      }
    }
  });

  // Why this test matters: defensive boundary; no slot index out of range.
  it('rejects a bad period or count and maps a non-finite time to slot 0', () => {
    expect(() => timeSlot(0, 0, 3)).toThrow(RangeError);
    expect(() => timeSlot(0, 1_000, 0)).toThrow(RangeError);
    expect(() => timeSlot(0, 1_000, 1.5)).toThrow(RangeError);
    expect(timeSlot(Number.NaN, 1_000, 3)).toBe(0);
    const negative = timeSlot(-1, 1_000, 3);
    expect(negative).toBeGreaterThanOrEqual(0);
    expect(negative).toBeLessThan(3);
  });
});

describe('firstIndexAtOrAfter', () => {
  // Why this test matters: the H window is found by binary search; an off
  // by one drops or keeps a sample at the window edge.
  it('finds the first sample at or after a time', () => {
    const s = [{ t: 1 }, { t: 2 }, { t: 2 }, { t: 5 }];
    expect(firstIndexAtOrAfter(s, 0)).toBe(0);
    expect(firstIndexAtOrAfter(s, 2)).toBe(1);
    expect(firstIndexAtOrAfter(s, 3)).toBe(3);
    expect(firstIndexAtOrAfter(s, 6)).toBe(4);
    expect(firstIndexAtOrAfter([], 6)).toBe(0);
  });
});

describe('the parameters', () => {
  // Why this test matters: a bad parameter is a caller bug and must fail
  // loud, never silently open or close every gate.
  it('throws on a non-finite or out-of-range parameter', () => {
    for (const bad of [
      { c: -1 },
      { f: 0.5 },
      { H: Number.NaN },
      { ceilingM: 0 },
      { alpha: -0.1 },
    ]) {
      expect(() => nearbyTargets(input({ params: { ...P, ...bad } }))).toThrow(
        RangeError
      );
    }
    expect(() => nearbyTargets(input({ nowMs: Number.NaN }))).toThrow(
      RangeError
    );
  });
});
