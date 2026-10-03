/**
 * The GPS anchor's `'mature-alignment'` start-up (owner decision D33,
 * 2026-10-03): an object placed live gets its GPS point fixed through the
 * fused alignment once the session's GPS extent reaches the maturity floor
 * (`state/alignment-maturity.ts`, 80 m) at or after the placement - or, when
 * the session ends first, through the alignment the caller settles it on.
 *
 * Why these tests matter: the default start-up medians seven 1 Hz samples of
 * the object through whatever alignment is current, so an object placed
 * before the yaw is observable is fixed through GPS noise, and one fixed at
 * the END of a long walk inherits all the SLAM drift after it (8.4 m at
 * 500 m with 1 % / 1 degree per 100 m, `visit-settle.left-behind.test.ts`).
 * The new start-up must fix the point through exactly the first mature
 * alignment - not the lerped group matrix, not a later alignment - and must
 * never touch the object while it waits, so the placed object stays rigid.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import { createGpsAnchor, type GpsAnchorOptions } from './gps-anchor.js';
import { worldNueToGps } from './frame-conversions.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { makeNonTrivialAlignment } from '../test-utils/non-trivial-alignment.js';
import { MATURE_GPS_EXTENT_M } from '../state/alignment-maturity.js';
import type { LatLong } from '../core/index.js';

afterEach(() => {
  clearFrameUpdates();
});

const ZERO: LatLong = { lat: 48.0, lon: 11.0 };

/** The live inputs the anchor reads, changed by each test between ticks. */
interface Live {
  alignment: readonly number[] | null;
  zero: LatLong | null;
  extentM: number | null;
}

function env(live: Live, overrides: Partial<GpsAnchorOptions> = {}) {
  const arWorldGroup = new THREE.Group();
  const object3D = new THREE.Object3D();
  arWorldGroup.add(object3D);
  // The group's matrix is the LERPED visual alignment, deliberately not the
  // solved one: the fix must go through the solved alignment.
  arWorldGroup.matrixAutoUpdate = false;
  arWorldGroup.matrix.fromArray(makeNonTrivialAlignment(1234));
  arWorldGroup.matrixWorldNeedsUpdate = true;
  object3D.position.set(3, -1.2, -4);
  const committed: LatLong[] = [];
  const anchor = createGpsAnchor({
    object3D,
    arWorldGroup,
    camera: new THREE.PerspectiveCamera(),
    gpsPoint: { lat: 0, lon: 0 },
    startup: 'mature-alignment',
    mode: 'snap-every-tick',
    getAlignmentMatrix: () => live.alignment,
    getGpsZeroRef: () => live.zero,
    getGpsExtentM: () => live.extentM,
    onBootstrapComplete: (p) => committed.push(p),
    ...overrides,
  });
  return { anchor, object3D, committed };
}

/** Where the object's local (odometry-NUE) position lands in GPS through
 *  `alignment`: what a fix through that alignment must commit. */
function through(
  local: THREE.Vector3,
  alignment: readonly number[],
  zero: LatLong
): LatLong & { altitude?: number } {
  const world = local
    .clone()
    .applyMatrix4(new THREE.Matrix4().fromArray(alignment));
  return worldNueToGps(world, zero);
}

function expectPoint(
  actual: LatLong & { altitude?: number },
  expected: LatLong & { altitude?: number }
): void {
  expect(actual.lat).toBeCloseTo(expected.lat, 9);
  expect(actual.lon).toBeCloseTo(expected.lon, 9);
  expect(actual.altitude ?? 0).toBeCloseTo(expected.altitude ?? 0, 6);
}

describe("createGpsAnchor - 'mature-alignment' start-up (D33)", () => {
  it('waits without touching the object, then fixes the point through the first mature alignment', () => {
    const live: Live = {
      alignment: makeNonTrivialAlignment(1),
      zero: ZERO,
      extentM: 3,
    };
    const { anchor, object3D, committed } = env(live);
    const local = object3D.position.clone();
    expect(anchor.phase).toBe('bootstrap');

    live.alignment = makeNonTrivialAlignment(2);
    live.extentM = MATURE_GPS_EXTENT_M - 0.5;
    anchor.__tickForTests(1, 1);
    expect(anchor.phase).toBe('bootstrap');
    expect(object3D.position.equals(local)).toBe(true);
    expect(committed).toHaveLength(0);

    const mature = makeNonTrivialAlignment(3);
    live.alignment = mature;
    live.extentM = MATURE_GPS_EXTENT_M;
    anchor.__tickForTests(1, 2);
    expect(anchor.phase).toBe('anchored');
    expect(anchor.isFullyAnchored).toBe(true);
    expectPoint(anchor.gpsPoint, through(local, mature, ZERO));
    expect(committed).toEqual([anchor.gpsPoint]);

    // Fixed: a later alignment never moves the point.
    const fixed = anchor.gpsPoint;
    live.alignment = makeNonTrivialAlignment(4);
    live.extentM = 400;
    anchor.__tickForTests(1, 3);
    expect(anchor.gpsPoint).toBe(fixed);
    expect(committed).toHaveLength(1);
    anchor.dispose();
  });

  // Why this test matters: an object placed after the walk matured is fixed
  // through the alignment AT its placement - the anchor reads the alignment
  // when it is created, so a re-solve before the first frame does not count.
  it('fixes the point through the alignment at creation when the session is already mature', () => {
    const atPlacement = makeNonTrivialAlignment(7);
    const live: Live = { alignment: atPlacement, zero: ZERO, extentM: 150 };
    const { anchor, object3D } = env(live);
    const local = object3D.position.clone();
    live.alignment = makeNonTrivialAlignment(8);
    anchor.__tickForTests(1, 1);
    expect(anchor.phase).toBe('anchored');
    expectPoint(anchor.gpsPoint, through(local, atPlacement, ZERO));
    anchor.dispose();
  });

  // Why this test matters: the fallback. A session that ends before the
  // floor is reached settles every waiting object through the alignment it
  // followed to the end (the end-of-visit alignment), and says what it
  // committed; an anchor with nothing to wait for commits nothing.
  it('settles now through the latest usable alignment when asked before maturity', () => {
    const live: Live = {
      alignment: makeNonTrivialAlignment(1),
      zero: ZERO,
      extentM: 10,
    };
    const { anchor, object3D, committed } = env(live);
    const local = object3D.position.clone();
    const last = makeNonTrivialAlignment(5);
    live.alignment = last;
    live.extentM = 20;
    anchor.__tickForTests(1, 1);
    // A GPS gap at the end: the latest USABLE alignment stands.
    live.alignment = null;
    const settled = anchor.settleNow();
    expect(settled).not.toBeNull();
    expectPoint(settled!, through(local, last, ZERO));
    expect(anchor.phase).toBe('anchored');
    expect(committed).toEqual([settled]);
    expect(anchor.settleNow()).toBeNull();
    anchor.dispose();
  });

  it('settles nothing without a usable alignment, and stays waiting', () => {
    const live: Live = { alignment: null, zero: ZERO, extentM: 0 };
    const { anchor } = env(live);
    expect(anchor.settleNow()).toBeNull();
    expect(anchor.phase).toBe('bootstrap');
    live.alignment = makeNonTrivialAlignment(2);
    live.extentM = 90;
    anchor.__tickForTests(1, 1);
    expect(anchor.phase).toBe('anchored');
    anchor.dispose();
  });

  // Why this test matters: a moved object is a new placement - its point is
  // fixed again through the first mature alignment at or after the MOVE.
  it('re-opens on an external move', () => {
    const live: Live = {
      alignment: makeNonTrivialAlignment(1),
      zero: ZERO,
      extentM: 100,
    };
    const { anchor, object3D, committed } = env(live);
    anchor.__tickForTests(1, 1);
    expect(anchor.phase).toBe('anchored');
    object3D.position.set(-6, 0.4, 2);
    const atMove = makeNonTrivialAlignment(9);
    live.alignment = atMove;
    anchor.markMovedExternally();
    expect(anchor.phase).toBe('bootstrap');
    live.alignment = makeNonTrivialAlignment(10);
    anchor.__tickForTests(1, 2);
    expect(anchor.phase).toBe('anchored');
    expectPoint(
      anchor.gpsPoint,
      through(new THREE.Vector3(-6, 0.4, 2), atMove, ZERO)
    );
    expect(committed).toHaveLength(2);
    anchor.dispose();
  });

  // Why this test matters: the start-up needs the extent to judge maturity,
  // and is meaningless together with skipping the start-up; a silent
  // default would wait forever or never wait.
  it('refuses a configuration it cannot honour', () => {
    const live: Live = { alignment: null, zero: ZERO, extentM: 0 };
    expect(() => env(live, { getGpsExtentM: undefined })).toThrow(
      /getGpsExtentM/
    );
    expect(() => env(live, { skipBootstrap: true })).toThrow(/skipBootstrap/);
    expect(() => env(live, { matureGpsExtentM: 0 })).toThrow(RangeError);
  });

  // Why this test matters: the default start-up must stay exactly as it
  // was for every other app (its default is a later owner decision);
  // settling now is a no-op there.
  it('leaves the default start-up alone, where settling now commits nothing', () => {
    const live: Live = { alignment: null, zero: ZERO, extentM: 500 };
    const { anchor } = env(live, { startup: undefined });
    expect(anchor.settleNow()).toBeNull();
    expect(anchor.phase).toBe('bootstrap');
    anchor.dispose();
  });
});

describe("createGpsAnchor - 'mature-alignment' start-up (property)", () => {
  // Why this test matters: whatever sequence of alignments and extents the
  // session produces, the committed point is the object through the FIRST
  // mature alignment at or after creation - or, if none comes before the
  // session ends, through the last one (settle now).
  it('commits through the first mature alignment, else the last one on settle', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            seed: fc.integer({ min: 1, max: 10_000 }),
            extentM: fc.double({ min: 0, max: 200, noNaN: true }),
          }),
          { minLength: 1, maxLength: 12 }
        ),
        (steps) => {
          clearFrameUpdates();
          const first = steps[0]!;
          const live: Live = {
            alignment: makeNonTrivialAlignment(first.seed),
            zero: ZERO,
            extentM: first.extentM,
          };
          const { anchor, object3D } = env(live);
          const local = object3D.position.clone();
          let expected: readonly number[] | null =
            first.extentM >= MATURE_GPS_EXTENT_M ? live.alignment : null;
          steps.slice(1).forEach((step, i) => {
            live.alignment = makeNonTrivialAlignment(step.seed);
            live.extentM = step.extentM;
            if (expected === null && step.extentM >= MATURE_GPS_EXTENT_M) {
              expected = live.alignment;
            }
            anchor.__tickForTests(1, i + 1);
          });
          const matured = expected !== null;
          anchor.__tickForTests(1, steps.length);
          // Settling now commits exactly when nothing matured.
          expect(anchor.settleNow() === null).toBe(matured);
          expect(anchor.phase).toBe('anchored');
          expectPoint(
            anchor.gpsPoint,
            through(local, expected ?? live.alignment!, ZERO)
          );
          anchor.dispose();
        }
      ),
      { numRuns: 60 }
    );
  });
});
