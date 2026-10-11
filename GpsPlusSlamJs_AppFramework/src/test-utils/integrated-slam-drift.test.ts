/**
 * The shared drift model (`integrated-slam-drift.ts`).
 *
 * Why these tests matter: two sweeps (the Recorder's D28 `left` sweep and the
 * Tour Viewer's authoring-settle sweep) rest on this model, and their
 * verdicts scale with the drift it injects. If a refactor halved the
 * translation bias or turned the track the wrong way, both sweeps would
 * quietly report a smaller regression than the stated drift causes.
 */
import { describe, expect, it } from 'vitest';
import {
  driftedYaw,
  gaussMarkovGpsErrors,
  integrateOdometry,
  mulberry32,
  positionOnRoute,
  trackAt,
  type Waypoint,
} from './integrated-slam-drift.js';

/** A straight 200 m walk north at 1 m/s. */
const NORTH_200: Waypoint[] = [
  { tS: 0, at: [0, 0], walkedM: 0 },
  { tS: 200, at: [200, 0], walkedM: 200 },
];

describe('integrateOdometry', () => {
  it('adds the stated share of the distance walked along the bias direction', () => {
    const track = integrateOdometry({
      waypoints: NORTH_200,
      endS: 200,
      start: [0, 1.4, 0],
      frameYawAt: () => 0,
      biasDirRad: Math.PI / 2, // East
      transPct: 2,
    });
    const end = trackAt(track, 200);
    expect(end[0]).toBeCloseTo(200, 6);
    expect(end[2]).toBeCloseTo(4, 6); // 2 % of 200 m, to the East
    expect(end[1]).toBe(1.4);
  });

  it('turns each step by the frame yaw of its moment', () => {
    const rate = 2; // degrees per 100 m
    const track = integrateOdometry({
      waypoints: NORTH_200,
      endS: 200,
      start: [0, 0, 0],
      frameYawAt: (tS) =>
        driftedYaw(0, 1, rate, positionOnRoute(NORTH_200, tS).walkedM),
      biasDirRad: 0,
      transPct: 0,
    });
    // After 200 m at 2 degrees per 100 m the frame has turned 4 degrees,
    // so the last true North step is reported 4 degrees off North.
    const a = trackAt(track, 199);
    const b = trackAt(track, 200);
    const bearingDeg = (Math.atan2(b[2] - a[2], b[0] - a[0]) * 180) / Math.PI;
    expect(Math.abs(bearingDeg)).toBeCloseTo(4, 1);
    // The length of the path is unchanged: drift turns, it does not stretch.
    const end = trackAt(track, 200);
    expect(Math.hypot(end[0], end[2])).toBeLessThan(200);
    expect(Math.hypot(end[0], end[2])).toBeGreaterThan(199);
  });

  it('refuses a step that is not positive', () => {
    expect(() =>
      integrateOdometry({
        waypoints: NORTH_200,
        endS: 10,
        start: [0, 0, 0],
        frameYawAt: () => 0,
        biasDirRad: 0,
        transPct: 0,
        stepS: 0,
      })
    ).toThrow();
  });
});

describe('gaussMarkovGpsErrors', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = gaussMarkovGpsErrors(mulberry32(5), 50, 5);
    const b = gaussMarkovGpsErrors(mulberry32(5), 50, 5);
    const c = gaussMarkovGpsErrors(mulberry32(6), 50, 5);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    expect(a).toHaveLength(50);
  });
});
