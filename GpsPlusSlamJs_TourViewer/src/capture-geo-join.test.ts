import { describe, expect, it } from "vitest";
import { Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from "three";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  assessReplayedJoin,
  preflightCaptureJoin,
  computeCaptureGeoJoin,
  type ReplayedJoinState,
} from "./capture-geo-join";

// Activates the library's gated math (fusedGpsFromOdom) — the documented
// test path this suite already uses elsewhere.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

/**
 * Why these tests matter (geo-join plan Rev 2): every decline reason in the
 * assessment IS the product's fallback contract — a wrong `ok` places a
 * coherent-looking cloud of photos at wrong positions (the cold review's
 * findings 3 and 8), and a wrong decline silently keeps the ring forever.
 * The transform test pins the frame contract end-to-end with hand-checkable
 * numbers: identity-rotation alignment with a pure translation, so the
 * expected geo offsets are readable by eye.
 */

const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

/** Column-major 4x4: identity rotation + translation [tN, tU, tE]. */
function translation(tN: number, tU: number, tE: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tN, tU, tE, 1];
}

function baseState(overrides?: {
  matrix?: readonly number[];
  points?: ReplayedJoinState["gpsData"] extends infer G
    ? G extends { odometryPath: { points: infer P } }
      ? P
      : never
    : never;
  pairCount?: number;
}): ReplayedJoinState {
  return {
    gpsData: {
      zero: { lat: 47.5, lon: 8.7 },
      gpsEvents: {
        gpsPositions: new Array<unknown>(overrides?.pairCount ?? 5).fill({}),
        alignmentMatrix: overrides?.matrix ?? translation(2, 0, 3),
        alignmentRotation: [0, 0, 0, 1],
        gpsAccuracyMedian: 4.2,
      },
      odometryPath: {
        points: overrides?.points ?? [
          {
            imageFile: "images/a.jpg",
            position: [1, 0, 0],
            rotation: [0, 0, 0, 1],
            width: 640,
            height: 480,
          },
        ],
      },
    },
  };
}

const CURRENT_ERA = { odomCoordVersion: 5 };

describe("assessReplayForJoin", () => {
  it("accepts a solved current-era recording and reports its quality", () => {
    const verdict = assessReplayedJoin(baseState());
    expect(verdict).toEqual({
      ok: true,
      quality: { pairCount: 5, gpsAccuracyMedianM: 4.2 },
    });
  });

  it.each([[null], [{}], [{ odomCoordVersion: 2 }]])(
    "preflight declines a non-current-era recording (%o) BEFORE any replay — legacy actions without the RecorderApp migration double-convert every pose",
    (meta) => {
      expect(preflightCaptureJoin(meta, []).ok).toBe(false);
    },
  );

  it("preflight accepts the current era with no segmenting actions", () => {
    expect(preflightCaptureJoin(CURRENT_ERA, ["gpsData/setZeroPos"]).ok).toBe(
      true,
    );
  });

  it.each([
    ["gpsData/odometryTrackingRestarted"],
    ["gpsData/arLoopClosureDetected"],
  ])(
    "declines when the recording contains %s — the final alignment is only valid for the last segment",
    (type) => {
      expect(preflightCaptureJoin(CURRENT_ERA, [type]).ok).toBe(false);
    },
  );

  it("declines a null gpsData, a missing zero, too few pairs, and no captures — each with plain words", () => {
    expect(assessReplayedJoin({ gpsData: null }).ok).toBe(false);
    const noZero = baseState();
    noZero.gpsData!.zero = null;
    expect(assessReplayedJoin(noZero).ok).toBe(false);
    expect(assessReplayedJoin(baseState({ pairCount: 2 })).ok).toBe(false);
    expect(assessReplayedJoin(baseState({ points: [] })).ok).toBe(false);
  });

  it("declines the IDENTITY alignment — the degenerate solve's default, not a real solve", () => {
    const verdict = assessReplayedJoin(baseState({ matrix: IDENTITY16 }));
    expect(verdict.ok).toBe(false);
  });
});

describe("computeCaptureGeoJoin", () => {
  it("maps captures through the alignment to geo with ABSOLUTE altitude", () => {
    // Alignment = translate [2, 0, 3] (NUE); capture at odom [1, 0, 0] →
    // aligned [3, 0, 3] = 3 m North, 3 m East of the zero, altitude 0
    // (absolute — fusedGpsFromOdom's documented contract).
    const [pose] = computeCaptureGeoJoin(baseState());
    expect(pose!.imageFile).toBe("images/a.jpg");
    expect(pose!.geo.lat).toBeGreaterThan(47.5); // moved North
    expect(pose!.geo.lon).toBeGreaterThan(8.7); // moved East
    expect(pose!.geo.altitude).toBe(0);
    expect(pose!.width).toBe(640);
    // ~3 m of latitude ≈ 2.7e-5 degrees; assert the right magnitude so a
    // units mistake (degrees-vs-metres) cannot pass.
    expect(pose!.geo.lat - 47.5).toBeGreaterThan(1e-5);
    expect(pose!.geo.lat - 47.5).toBeLessThan(1e-4);
  });

  // DIRECTIONAL tests, not component tests (this milestone's cold review,
  // finding 1): the state stores basis-CONJUGATED quaternions, and a
  // composition missing the trailing basis factor yawed every plane 90°
  // while every component-level assertion on identity captures stayed
  // green. These pin what the visitor actually sees: where the plane's
  // FRONT (+Z of PlaneGeometry) points in NUE (x=North, z=East).
  const front = (q: readonly [number, number, number, number]) =>
    new ThreeVector3(0, 0, 1)
      .applyQuaternion(new ThreeQuaternion(q[0], q[1], q[2], q[3]))
      .toArray();

  it("an identity capture (camera looking North) yields a SOUTH-facing plane front", () => {
    const [pose] = computeCaptureGeoJoin(baseState());
    const [fx, fy, fz] = front(pose!.rotationNue);
    expect(fx).toBeCloseTo(-1, 10); // South
    expect(fy).toBeCloseTo(0, 10);
    expect(fz).toBeCloseTo(0, 10);
  });

  it("the alignment's rotation composes on the LEFT (world frame), turning the front with it", () => {
    const state = baseState();
    const alignmentQ: [number, number, number, number] = [
      0,
      Math.SQRT1_2,
      0,
      Math.SQRT1_2,
    ];
    state.gpsData!.gpsEvents = {
      ...state.gpsData!.gpsEvents,
      alignmentRotation: alignmentQ,
    };
    const [pose] = computeCaptureGeoJoin(state);
    const expected = new ThreeVector3(-1, 0, 0) // the identity-capture front
      .applyQuaternion(
        new ThreeQuaternion(
          alignmentQ[0],
          alignmentQ[1],
          alignmentQ[2],
          alignmentQ[3],
        ),
      )
      .toArray();
    const got = front(pose!.rotationNue);
    expect(got[0]).toBeCloseTo(expected[0], 10);
    expect(got[1]).toBeCloseTo(expected[1], 10);
    expect(got[2]).toBeCloseTo(expected[2], 10);
  });

  it("a stored NUE yaw turns the front by the same yaw (yaws commute with the basis)", () => {
    const state = baseState();
    const yaw90: [number, number, number, number] = [
      0,
      Math.SQRT1_2,
      0,
      Math.SQRT1_2,
    ];
    state.gpsData!.odometryPath = {
      points: [
        {
          imageFile: "images/a.jpg",
          position: [1, 0, 0],
          rotation: yaw90,
        },
      ],
    };
    const [pose] = computeCaptureGeoJoin(state);
    const expected = new ThreeVector3(-1, 0, 0)
      .applyQuaternion(
        new ThreeQuaternion(yaw90[0], yaw90[1], yaw90[2], yaw90[3]),
      )
      .toArray();
    const got = front(pose!.rotationNue);
    expect(got[0]).toBeCloseTo(expected[0], 10);
    expect(got[1]).toBeCloseTo(expected[1], 10);
    expect(got[2]).toBeCloseTo(expected[2], 10);
  });

  it("throws when called without a passing assessment (programming error, not a fallback)", () => {
    expect(() => computeCaptureGeoJoin({ gpsData: null })).toThrow(
      /assess before computing/,
    );
  });
});
