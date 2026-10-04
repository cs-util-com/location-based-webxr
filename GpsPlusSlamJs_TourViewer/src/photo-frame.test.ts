/**
 * Why these tests matter (QR perf plan 2026-09-23, M4 review finding 2): the
 * creator's photo is placed with the pose of the frame it encodes. Frames stop
 * arriving while tracking is lost, but the last one stays in `latestFrame`, so
 * without an age limit a tap during a loss would mint a photo from a frame of
 * unbounded age - self-consistent, but not what the creator is looking at.
 * Before M4 that tap was refused (the tap-time pose was null during a loss);
 * this keeps that behaviour explicitly.
 */

import { describe, expect, it } from "vitest";
import { PHOTO_FRAME_MAX_AGE_MS, usablePhotoFrame } from "./photo-frame.js";

const frameAt = (capturedAtMs: number) => ({
  image: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
  cameraPose: {
    position: [0, 0, 0] as const,
    rotation: [0, 0, 0, 1] as const,
  },
  capturedAtMs,
});

describe("usablePhotoFrame", () => {
  it("accepts a frame captured within the age limit", () => {
    const frame = frameAt(10_000);
    expect(usablePhotoFrame(frame, 10_000 + PHOTO_FRAME_MAX_AGE_MS)).toBe(
      frame,
    );
  });

  it("refuses a frame older than the limit (e.g. frozen by a tracking loss)", () => {
    expect(
      usablePhotoFrame(frameAt(10_000), 10_001 + PHOTO_FRAME_MAX_AGE_MS),
    ).toBeNull();
  });

  it("refuses when there is no frame yet", () => {
    expect(usablePhotoFrame(null, 0)).toBeNull();
  });

  it("allows several capture intervals of slack, so a busy frame loop is not refused", () => {
    expect(PHOTO_FRAME_MAX_AGE_MS).toBeGreaterThanOrEqual(4 * 125);
  });
});
