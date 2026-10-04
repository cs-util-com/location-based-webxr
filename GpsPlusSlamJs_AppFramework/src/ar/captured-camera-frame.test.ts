/**
 * Why these tests matter (QR perf plan 2026-09-23, M4): a detection's corners
 * describe the pixels of ONE camera frame, so the pose they are solved against
 * must be the camera pose of that same frame - not "the pose now", read after
 * an asynchronous decode (the lag closed by
 * `2026-08-30-0620-qr-pose-frame-pairing-followup.md`). The session builds a
 * `CapturedCameraFrame` at capture time; this is the one place the ARPose
 * object shape is reshaped into the solver's Pose tuples (previously copied in
 * the Recorder and the TourViewer).
 */

import { describe, expect, it } from 'vitest';
import { capturedCameraFrame, poseFromArPose } from './captured-camera-frame';

const AR_POSE = {
  position: { x: 1, y: 2, z: 3 },
  orientation: { x: 0, y: 0.6, z: 0, w: 0.8 },
};

describe('poseFromArPose', () => {
  it('reshapes position and orientation objects into [x, y, z] / [x, y, z, w] tuples', () => {
    expect(poseFromArPose(AR_POSE)).toEqual({
      position: [1, 2, 3],
      rotation: [0, 0.6, 0, 0.8],
    });
  });
});

describe('capturedCameraFrame', () => {
  const image = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

  it('pairs the image with the capture-time pose and an epoch-ms timestamp', () => {
    const frame = capturedCameraFrame(image, AR_POSE, 1500, 1_700_000_000_000);
    expect(frame).toEqual({
      image,
      cameraPose: { position: [1, 2, 3], rotation: [0, 0.6, 0, 0.8] },
      capturedAtMs: 1_700_000_001_500,
    });
  });

  it('returns null without a pose - an unpaired frame must not be delivered', () => {
    expect(capturedCameraFrame(image, null, 0, 0)).toBeNull();
  });
});
