import { describe, expect, it } from "vitest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  assessReplayForJoin,
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

describe("assessReplayForJoin", () => {
  it("accepts a solved recording and reports its quality", () => {
    const verdict = assessReplayForJoin([], baseState());
    expect(verdict).toEqual({
      ok: true,
      quality: { pairCount: 5, gpsAccuracyMedianM: 4.2 },
    });
  });

  it.each([
    ["gpsData/odometryTrackingRestarted"],
    ["gpsData/arLoopClosureDetected"],
  ])(
    "declines when the recording contains %s — the final alignment is only valid for the last segment",
    (type) => {
      const verdict = assessReplayForJoin([type], baseState());
      expect(verdict.ok).toBe(false);
    },
  );

  it("declines a null gpsData, a missing zero, too few pairs, and no captures — each with plain words", () => {
    expect(assessReplayForJoin([], { gpsData: null }).ok).toBe(false);
    const noZero = baseState();
    noZero.gpsData!.zero = null;
    expect(assessReplayForJoin([], noZero).ok).toBe(false);
    expect(assessReplayForJoin([], baseState({ pairCount: 2 })).ok).toBe(false);
    expect(assessReplayForJoin([], baseState({ points: [] })).ok).toBe(false);
  });

  it("declines the IDENTITY alignment — the degenerate solve's default, not a real solve", () => {
    const verdict = assessReplayForJoin([], baseState({ matrix: IDENTITY16 }));
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

  it("composes the capture rotation with the alignment rotation (world = alignment ∘ capture)", () => {
    const state = baseState();
    // 90° yaw about Up for the ALIGNMENT, identity capture → world = the
    // alignment's own rotation, unchanged.
    state.gpsData!.gpsEvents = {
      ...state.gpsData!.gpsEvents,
      alignmentRotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    };
    const [pose] = computeCaptureGeoJoin(state);
    expect(pose!.rotationNue[1]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(pose!.rotationNue[3]).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("throws when called without a passing assessment (programming error, not a fallback)", () => {
    expect(() => computeCaptureGeoJoin({ gpsData: null })).toThrow(
      /assess before computing/,
    );
  });
});
