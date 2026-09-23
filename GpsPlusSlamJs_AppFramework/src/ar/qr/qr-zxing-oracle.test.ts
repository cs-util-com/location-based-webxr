/**
 * QR pipeline against a REAL decoder: rendered symbol -> zxing-wasm -> the
 * production pose pipeline (`solveQrPose` + `PlanarPnpSquare` +
 * `intrinsicsFromProjection`), scored against the pose it was rendered at.
 *
 * Why these tests matter: before them every QR test injected hand-made
 * corners, so nothing proved that the pose pipeline works on corners a real
 * decoder reports from real pixels - with integer rounding, the decoder's own
 * edge definition and the projection matrix's pixel convention all in play.
 * They also pin the corner-order contract ("Cause A" in
 * `qr-pose-stability.test.ts`): with SYMBOL-relative corners, the pose is
 * right at every in-plane roll, so a 90-degree snap on device can only come
 * from a detector that orders corners by image position.
 *
 * Tolerances come from the opt-in sweep (`qr-zxing.sweep.test.ts`, 1024 px,
 * 0.6 m: max corner error 2.0 px, max rotation error 0.85 deg, max position
 * error 0.3 cm over 20 poses) with margin; results in
 * GpsPlusSlamJs_Docs/docs/2026-09-23-0104-qr-zxing-synthetic-sweep-findings.md.
 */

import { describe, expect, it } from 'vitest';
import {
  perspectiveProjection,
  qrPoseFacingCamera,
  renderQrFrame,
} from '../../test-utils/synthetic-qr-frame';
import { measureZxingPipeline } from '../../test-utils/qr-zxing-pipeline';

const PAYLOAD =
  'https://gps-plus-slam.csutil.workers.dev/tour/?t=S/k7Qm2xPz9LbV4nRw8TcY3hFd6JsA1eGu5oKi0MNq';
const SIZE_M = 0.16;
const W = 1024;
const H = 768;
const PROJECTION = perspectiveProjection({ fovYDeg: 50, aspect: W / H });

const MAX_CORNER_ERR_PX = 2.5;
const MAX_ROTATION_ERR_DEG = 2;
const MAX_POSITION_ERR_CM = 1;

async function measure(rollDeg: number, tiltXDeg = 20) {
  const qrPoseInCamera = qrPoseFacingCamera({
    distanceM: 0.6,
    tiltXDeg,
    rollDeg,
  });
  const frame = renderQrFrame({
    text: PAYLOAD,
    sizeM: SIZE_M,
    qrPoseInCamera,
    projection: PROJECTION,
    width: W,
    height: H,
    supersample: 2,
    noiseSigma: 2,
    seed: 11 + rollDeg,
  });
  return measureZxingPipeline(frame, {
    text: PAYLOAD,
    sizeM: SIZE_M,
    qrPoseInCamera,
    projection: PROJECTION,
  });
}

describe('QR pipeline through a real decoder (zxing-wasm oracle)', () => {
  it.each([0, 37, 90, 180, 270])(
    'recovers corners and pose of a code rolled %i deg, with symbol-relative corners',
    async (rollDeg) => {
      const m = await measure(rollDeg);
      expect(m.decoded).toBe(true);
      expect(m.maxCornerErrPx).toBeLessThanOrEqual(MAX_CORNER_ERR_PX);
      // A cyclic corner shift would show up as ~90 deg here, never a few deg.
      expect(m.rotationErrDeg).toBeLessThanOrEqual(MAX_ROTATION_ERR_DEG);
      expect(m.positionErrCm).toBeLessThanOrEqual(MAX_POSITION_ERR_CM);
    }
  );

  it('keeps the decoder corner bias well under a pixel (measured, not assumed to be zero)', async () => {
    // Integer corners bias the mean by up to half a pixel with no bug anywhere;
    // a bound of 1 px only catches a gross convention slip (e.g. corners at
    // module centres, or a flipped axis), which is what matters for the pose.
    const rows = await Promise.all([0, 90, 180, 270].map((r) => measure(r)));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(
      Math.abs(mean(rows.map((r) => r.meanSignedErrX ?? NaN)))
    ).toBeLessThan(1);
    expect(
      Math.abs(mean(rows.map((r) => r.meanSignedErrY ?? NaN)))
    ).toBeLessThan(1);
  });

  it('stays accurate with an off-centre principal point, as real AR projections have', async () => {
    // A sign slip on P[8]/P[9] in intrinsicsFromProjection (or a flipped cy)
    // is invisible with a symmetric frustum; here it would move the solved
    // pose by centimetres. Offsets are NDC units in the projection matrix.
    const projection = perspectiveProjection({
      fovYDeg: 50,
      aspect: W / H,
      offsetX: 0.06,
      offsetY: -0.05,
    });
    const qrPoseInCamera = qrPoseFacingCamera({
      distanceM: 0.6,
      tiltXDeg: 20,
      rollDeg: 30,
      offsetM: [0.04, -0.03],
    });
    const frame = renderQrFrame({
      text: PAYLOAD,
      sizeM: SIZE_M,
      qrPoseInCamera,
      projection,
      width: W,
      height: H,
      supersample: 2,
      noiseSigma: 2,
      seed: 5,
    });
    const m = await measureZxingPipeline(frame, {
      text: PAYLOAD,
      sizeM: SIZE_M,
      qrPoseInCamera,
      projection,
    });
    expect(m.decoded).toBe(true);
    expect(m.rotationErrDeg).toBeLessThanOrEqual(MAX_ROTATION_ERR_DEG);
    expect(m.positionErrCm).toBeLessThanOrEqual(MAX_POSITION_ERR_CM);
  });

  it('reports no detection for a frame without a code', async () => {
    const { zxingDetect } = await import('../../test-utils/qr-zxing-pipeline');
    const blank = {
      data: new Uint8ClampedArray(W * H * 4).fill(128),
      width: W,
      height: H,
    };
    await expect(zxingDetect(blank)).resolves.toBeNull();
  });
});
