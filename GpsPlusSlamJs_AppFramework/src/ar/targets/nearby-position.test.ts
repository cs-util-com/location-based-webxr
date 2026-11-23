import '../../test-setup.js';
import { describe, expect, it } from 'vitest';
import {
  createNearbyPositionSource,
  odomNueOfWebXr,
  type NearbyGpsEvents,
  type NearbyGpsPoint,
} from './nearby-position.js';
import {
  DEFAULT_NEARBY_PARAMS,
  nearbyTargets,
  type LivePose,
} from './nearby-targets.js';
import { calcRelativeCoordsInMeters } from '../../core/index.js';

const NOW = 1_800_000_000_000;
const ZERO = { lat: 47, lon: 8 };
const H = DEFAULT_NEARBY_PARAMS.H;
/** A yaw of 90 deg plus a shift, column-major: odom (n, u, e) maps to
 *  world (e + 10, u, -n + 20) - north from the odom east axis. */
const ALIGN = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 10, 0, 20, 1];

function point(t: number, over: Partial<NearbyGpsPoint> = {}): NearbyGpsPoint {
  return {
    latitude: 47.0001,
    longitude: 8.0001,
    latLongAccuracy: 4,
    timestamp: t,
    ...over,
  };
}

function events(
  rows: readonly [NearbyGpsPoint, readonly [number, number, number]][]
): NearbyGpsEvents {
  return {
    gpsPositions: rows.map((r) => r[0]),
    odometryPositions: rows.map((r) => r[1]),
  };
}

function source(
  ev: () => NearbyGpsEvents | null,
  alignment: ArrayLike<number> | null,
  live: () => LivePose | null = () => null
) {
  return createNearbyPositionSource({
    gpsEvents: ev,
    alignment: () => alignment,
    zero: () => ZERO,
    live,
    lookBackMs: H,
  });
}

describe('createNearbyPositionSource', () => {
  // Why this test matters: a QR lock adds four vote samples at the code's
  // corners. They mark the code, not the visitor: they stay out of `fixes`
  // and out of `newestFixAtMs`, but stay in `arPoses`, flagged not-device.
  it('takes device samples only for fixes and newestFixAtMs', () => {
    const vote = { source: 'synthetic-qr' as const, latLongAccuracy: 1 };
    const ev = events([
      [point(NOW - 3_000), [0, 0, 0]],
      [point(NOW - 1_000, vote), [5, 0, 5]],
      [point(NOW - 1_000, vote), [5, 0, 6]],
    ]);
    const p = source(() => ev, ALIGN).position(NOW);
    expect(p.fixes.map((f) => f.t)).toEqual([NOW - 3_000]);
    expect(p.newestFixAtMs).toBe(NOW - 3_000);
    expect(p.arPoses.map((a) => a.device)).toEqual([true, false, false]);
  });

  // Why this test matters: with an alignment the visitor's past positions
  // are the odometry through it (the alignment carries the AR-to-NUE
  // rotation a raw fix lacks), each judged by the rolling device median.
  it('maps odometry through the alignment, with the rolling median accuracy', () => {
    const ev = events([
      [point(NOW - 3_000, { latLongAccuracy: 2 }), [1, 0, 0]],
      [point(NOW - 2_000, { latLongAccuracy: 8 }), [0, 0, 3]],
      [point(NOW - 1_000, { latLongAccuracy: 20 }), [0, 0, 0]],
    ]);
    const p = source(() => ev, ALIGN).position(NOW);
    expect(p.fixes.map((f) => [f.north, f.east])).toEqual([
      [10, 19],
      [13, 20],
      [10, 20],
    ]);
    expect(p.fixes.map((f) => f.accM)).toEqual([2, 5, 8]);
    // The AR series stays in odom-NUE.
    expect(p.arPoses[1]?.pos).toEqual([0, 0, 3]);
  });

  // Why this test matters: without an alignment a fix stands alone, judged
  // by the worse of the device median and its own accuracy.
  it('uses the fixes themselves without an alignment, the worse accuracy each', () => {
    const ev = events([
      [point(NOW - 2_000, { latLongAccuracy: 3 }), [0, 0, 0]],
      [point(NOW - 1_000, { latLongAccuracy: 9 }), [0, 0, 0]],
    ]);
    const p = source(() => ev, null).position(NOW);
    const nue = calcRelativeCoordsInMeters(
      ZERO,
      { lat: 47.0001, lon: 8.0001 },
      0,
      0
    );
    expect(p.fixes[0]?.north).toBeCloseTo(nue[0]);
    expect(p.fixes[0]?.east).toBeCloseTo(nue[2]);
    expect(p.fixes.map((f) => f.accM)).toEqual([3, 9]);
  });

  // Why this test matters (cost): position() runs at about 60 Hz; the
  // conversion runs once per gpsEvents reference, not per call.
  it('rebuilds once per gpsEvents reference', () => {
    let reads = 0;
    const rows = events([[point(NOW - 1_000), [0, 0, 0]]]);
    const counted: NearbyGpsEvents = {
      get gpsPositions() {
        reads += 1;
        return rows.gpsPositions;
      },
      odometryPositions: rows.odometryPositions,
    };
    let current = counted;
    const s = source(() => current, ALIGN);
    s.position(NOW);
    s.position(NOW + 10);
    s.position(NOW + 20);
    expect(reads).toBe(1);
    current = { ...rows };
    s.position(NOW + 30);
    current = counted;
    s.position(NOW + 40);
    expect(reads).toBe(2);
  });

  // Why this test matters (cost): only the samples within H reach the
  // kernel, found by binary search, whatever the session length.
  it('hands over only the samples within H on a 3 600-fix series', () => {
    const rows: [NearbyGpsPoint, [number, number, number]][] = [];
    for (let i = 0; i < 3_600; i += 1) {
      rows.push([point(NOW - 3_600_000 + i * 1_000), [i, 0, 0]]);
    }
    const p = source(() => events(rows), ALIGN).position(NOW);
    expect(p.fixes).toHaveLength(H / 1_000);
    expect(p.arPoses).toHaveLength(H / 1_000);
    expect(p.fixes[0]!.t).toBeGreaterThanOrEqual(NOW - H);
  });

  // Why this test matters: the H trim also caps 'dr'. After a fix gap
  // longer than H the anchor sample is gone, so the state is 'unknown',
  // never a stale 'dr' on an anchor from long ago.
  it("gives 'unknown', never a stale 'dr', after a fix gap longer than H", () => {
    const last = NOW - H - 5_000;
    const ev = events([[point(last), [0, 0, 0]]]);
    const live: LivePose = {
      t: NOW,
      north: 3,
      east: 3,
      ar: [3, 0, 3],
      accM: 4,
    };
    const p = source(
      () => ev,
      ALIGN,
      () => live
    ).position(NOW);
    expect(p.newestFixAtMs).toBe(last);
    expect(p.arPoses).toEqual([]);
    const r = nearbyTargets({
      ...p,
      targets: [],
      nowMs: NOW,
      params: DEFAULT_NEARBY_PARAMS,
    });
    expect(r.state).toBe('unknown');
    // Within H the same gap is still dead reckoning.
    const inside = source(
      () => ev,
      ALIGN,
      () => live
    ).position(last + H - 1);
    expect(
      nearbyTargets({
        ...inside,
        targets: [],
        nowMs: last + H - 1,
        params: DEFAULT_NEARBY_PARAMS,
      }).state
    ).toBe('dr');
  });

  // Why this test matters: the H trim also cuts the AR gate's path term.
  // For a sighting older than H, the walk between the sighting and the
  // window start is lost: the path is the straight step from the sighting
  // to the first sample inside H, so R_AR is narrower than the full path
  // would make it. Pinned so the trade is visible.
  it('cuts the AR path of a sighting older than H to the straight step into the window', () => {
    const rows: [NearbyGpsPoint, [number, number, number]][] = [];
    // An excursion 100 m north and back before the window, then standing.
    rows.push([point(NOW - H - 30_000), [100, 0, 0]]);
    rows.push([point(NOW - H - 20_000), [0, 0, 0]]);
    rows.push([point(NOW - 1_000), [0, 0, 0]]);
    const live: LivePose = {
      t: NOW,
      north: 0,
      east: 0,
      ar: [0, 0, 3],
      accM: 4,
    };
    const p = source(
      () => events(rows),
      ALIGN,
      () => live
    ).position(NOW);
    const sighting = { t: NOW - H - 40_000, pos: [0, 0, 0] as const };
    const r = nearbyTargets({
      ...p,
      nowMs: NOW,
      params: DEFAULT_NEARBY_PARAMS,
      targets: [
        {
          key: 's',
          kind: 'qr',
          north: 999,
          east: 999,
          accM: 1,
          reachM: 0.5,
          sighting,
        },
      ],
    });
    // Trimmed path 0 + 3 = 3 m: R_AR = 0.5 + 1 + 0.09 = 1.59 m < 3 m. The
    // full path (200 + 3 m) would give 7.6 m and open it.
    expect(r.open).toEqual([]);
  });

  // Why this test matters: external data. Unsorted, non-finite and missing
  // values never break the binary search nor reach the kernel.
  it('drops non-finite samples and sorts an unsorted series', () => {
    const ev = events([
      [point(NOW - 1_000), [1, 0, 1]],
      [point(NOW - 3_000), [3, 0, 3]],
      [point(Number.NaN), [0, 0, 0]],
      [point(NOW - 2_000, { latLongAccuracy: Number.NaN }), [Number.NaN, 0, 0]],
    ]);
    const p = source(() => ev, ALIGN).position(NOW);
    expect(p.arPoses.map((a) => a.t)).toEqual([NOW - 3_000, NOW - 1_000]);
    expect(p.fixes.map((f) => f.t)).toEqual([NOW - 3_000, NOW - 1_000]);
    expect(source(() => null, ALIGN).position(NOW)).toEqual({
      fixes: [],
      arPoses: [],
      newestFixAtMs: null,
      live: null,
    });
  });

  // Why this test matters: the live pose is read on every call, never
  // memoised with the series (it moves between fixes).
  it('reads the live pose per call', () => {
    let n = 0;
    const s = source(
      () => events([]),
      ALIGN,
      () => ({ t: NOW, north: (n += 1), east: 0, ar: [0, 0, 0], accM: null })
    );
    expect(s.position(NOW).live?.north).toBe(1);
    expect(s.position(NOW).live?.north).toBe(2);
  });
});

describe('odomNueOfWebXr', () => {
  // Why this test matters: one AR frame for every AR position. A visitor at
  // WebXR (200, 0, 0) is odom-NUE (0, 0, 200); mixing the frames would make
  // a standing visitor a 283 m step.
  it('converts a WebXR position to odom-NUE and rejects non-finite input', () => {
    expect(odomNueOfWebXr({ x: 200, y: 1, z: 0 })).toEqual([-0, 1, 200]);
    expect(odomNueOfWebXr({ x: 0, y: 0, z: -5 })).toEqual([5, 0, 0]);
    expect(odomNueOfWebXr({ x: Number.NaN, y: 0, z: 0 })).toBeNull();
    expect(odomNueOfWebXr(null)).toBeNull();
  });
});
