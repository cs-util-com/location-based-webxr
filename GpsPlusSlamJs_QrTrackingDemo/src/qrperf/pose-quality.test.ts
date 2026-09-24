import { describe, expect, it } from "vitest";
import { createPoseQuality, type PoseQualitySample } from "./pose-quality.js";

type Quat = readonly [number, number, number, number];

/** Rotation about a unit axis, degrees, as an xyzw quaternion. */
function axisAngle(axis: readonly [number, number, number], deg: number): Quat {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

const IDENTITY: Quat = [0, 0, 0, 1];
const SQUARE = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
  { x: 100, y: 200 },
];

function sample(over: Partial<PoseQualitySample> = {}): PoseQualitySample {
  return {
    text: "code-a",
    qrRotationWorld: IDENTITY,
    corners: SQUARE,
    cameraPosition: [0, 0, 0],
    cameraRotation: IDENTITY,
    reprojectionErrorPx: 0.5,
    ...over,
  };
}

describe("pose quality: orientation jumps", () => {
  // Why this test matters: the jump numbers are the phone-side before/after
  // for the near-frontal pose fix (plan 2026-09-23-2314, M1); a jump must be
  // the angle between CONSECUTIVE poses of the SAME code.
  it("measures the angle between consecutive poses of one code", () => {
    const q = createPoseQuality();
    q.add(sample());
    q.add(sample({ qrRotationWorld: axisAngle([0, 1, 0], 4) }));
    const s = q.summary();
    expect(s.pairs).toBe(1);
    expect(s.jumpDeg.p50).toBeCloseTo(4, 6);
    expect(s.jumpShare).toEqual({ over3: 1, over5: 0, over10: 0 });
    expect(s.jumpsOver60).toBe(0);
  });

  // Why this test matters: two different codes in view would otherwise read
  // as one code jumping between two orientations.
  it("does not pair poses of different codes", () => {
    const q = createPoseQuality();
    q.add(sample());
    q.add(
      sample({ text: "code-b", qrRotationWorld: axisAngle([0, 1, 0], 45) }),
    );
    q.add(
      sample({ text: "code-b", qrRotationWorld: axisAngle([0, 1, 0], 46) }),
    );
    const s = q.summary();
    expect(s.pairs).toBe(1);
    expect(s.jumpDeg.max).toBeCloseTo(1, 6);
  });

  // Why this test matters: a corner-order snap (Cause A) is a 90 deg jump; it
  // must be counted apart from pose noise, not hidden inside the "over 10" share.
  it("counts jumps over 60 deg separately", () => {
    const q = createPoseQuality();
    q.add(sample());
    q.add(sample({ qrRotationWorld: axisAngle([0, 0, 1], 90) }));
    expect(q.summary().jumpsOver60).toBe(1);
  });
});

describe("pose quality: still-phone corner jitter", () => {
  // Why this test matters: jitter is only a statement about corner noise when
  // the camera did not move; a moving phone moves the corners for real.
  it("gates pairs by camera motion at a strict and a loose threshold", () => {
    const q = createPoseQuality();
    const moved = (dx: number) =>
      SQUARE.map((c) => ({ x: c.x + dx * 3, y: c.y + dx * 4 }));
    q.add(sample());
    q.add(sample({ cameraPosition: [0.001, 0, 0], corners: moved(1) })); // 1 mm
    q.add(sample({ cameraPosition: [0.005, 0, 0], corners: moved(2) })); // +4 mm
    q.add(sample({ cameraPosition: [0.02, 0, 0], corners: moved(3) })); // +15 mm
    const s = q.summary().stillJitterPx;
    expect(s.strict.n).toBe(1);
    expect(s.strict.p50).toBeCloseTo(5, 6); // (3, 4) px
    expect(s.loose.n).toBe(2);
  });

  it("treats a camera rotation like a camera move", () => {
    const q = createPoseQuality();
    q.add(sample());
    q.add(sample({ cameraRotation: axisAngle([0, 1, 0], 0.2) }));
    const s = q.summary().stillJitterPx;
    expect(s.strict.n).toBe(0); // 0.2 deg > 0.1 deg
    expect(s.loose.n).toBe(1); // 0.2 deg <= 0.3 deg
  });
});

describe("pose quality: reprojection error and wall elevation", () => {
  it("summarises the reprojection error of every sample", () => {
    const q = createPoseQuality();
    for (const e of [0.2, 0.4, 0.6, 0.8, 5])
      q.add(sample({ reprojectionErrorPx: e }));
    const s = q.summary().reprojectionPx;
    expect(s.n).toBe(5);
    expect(s.p50).toBeCloseTo(0.6, 6);
    expect(s.p95).toBeCloseTo(5, 6);
  });

  // Why this test matters: for a code on a vertical wall, the elevation of its
  // normal against gravity (WebXR's world is y-up) is an ABSOLUTE check of one
  // tilt axis, the one number the phone can compare against truth.
  it("reports the code normal's elevation, signed and absolute", () => {
    const q = createPoseQuality();
    q.add(sample()); // +z out of the face: horizontal normal
    q.add(sample({ qrRotationWorld: axisAngle([1, 0, 0], 10) })); // top tilted back
    const s = q.summary().wallElevationDeg;
    expect(s.n).toBe(2);
    expect(s.meanSigned).toBeCloseTo(-5, 6);
    expect(s.p95Abs).toBeCloseTo(10, 6);
  });

  it("returns empty summaries before any sample", () => {
    const s = createPoseQuality().summary();
    expect(s.pairs).toBe(0);
    expect(Number.isNaN(s.jumpDeg.p50)).toBe(true);
    expect(s.jumpShare).toEqual({ over3: 0, over5: 0, over10: 0 });
    expect(s.reprojectionPx.n).toBe(0);
    expect(s.wallElevationDeg.n).toBe(0);
  });
});

describe("pose quality invariants (deterministic grid)", () => {
  // Why this test matters: whatever a phone produces, the report must stay
  // internally consistent (p50 <= p95 <= max, shares in [0, 1] and ordered,
  // counts bounded by the window), or a screenshot shows impossible numbers.
  it("keeps summaries consistent across windows and jump sequences", () => {
    const violations: string[] = [];
    for (const window of [1, 2, 7, 40]) {
      for (const stepDeg of [0, 0.7, 4, 12, 95]) {
        for (const count of [1, 3, 10, 60]) {
          const q = createPoseQuality({ window });
          for (let k = 0; k < count; k++) {
            q.add(
              sample({
                qrRotationWorld: axisAngle(
                  [0, 1, 0],
                  k * stepDeg * ((k % 3) - 1),
                ),
                reprojectionErrorPx: (k % 5) * 0.3,
              }),
            );
          }
          const s = q.summary();
          const label = `${window}/${stepDeg}/${count}`;
          expect(s.pairs, label).toBeLessThanOrEqual(window);
          expect(s.reprojectionPx.n, label).toBeLessThanOrEqual(window);
          const { p50, p95, max } = s.jumpDeg;
          if (s.pairs > 0 && !(p50 <= p95 && p95 <= max)) {
            violations.push(`${label}: p50 ${p50} p95 ${p95} max ${max}`);
          }
          const { over3, over5, over10 } = s.jumpShare;
          expect(over3, label).toBeLessThanOrEqual(1);
          expect(over5, label).toBeLessThanOrEqual(over3);
          expect(over10, label).toBeLessThanOrEqual(over5);
          expect(over10, label).toBeGreaterThanOrEqual(0);
          expect(s.jumpsOver60, label).toBeLessThanOrEqual(s.pairs);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
