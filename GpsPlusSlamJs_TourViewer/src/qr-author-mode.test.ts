import { describe, expect, it, vi } from "vitest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";

import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";

import {
  authorStatusLine,
  buildAuthorControllerConfig,
  syntheticAuthorLevel,
  type AuthorPipelineDeps,
} from "./qr-author-mode";

/**
 * Why these tests matter: author mode is the half of the QR-pose loop that
 * WRITES the anchor every later visitor relocalizes against — a wrong frame
 * conversion here is stamped into the printed code's level file forever, and
 * every mistake is silent (a pose is just numbers). The three load-bearing
 * decisions pinned here come straight from the plan's M3 deltas:
 * - the synthetic level is GEO-LESS with the printed size as an INPUT
 *   (delta #1/#8): the controller then emits detections without voting, and
 *   never re-fetches an HTML launch page at 8 Hz;
 * - the controller runs `minIntervalMs: 0` because the camera-frame source
 *   is the single cadence owner (Option A);
 * - minting converts raw-WebXR → GPS-world NUE via alignment × WEBXR_TO_NUE
 *   (delta #2 wired the STABLE pose; the conversion is proven by a
 *   round-trip through the stack's own GPS→NUE direction).
 */

// The geodesy the mint rides on is licence-gated; constructing the store is
// the documented activation path, and it is exactly what production does
// before any mint can happen (main.ts creates the AR store at boot).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const GOOD_ALIGNMENT_INFO = {
  hasMatrix: true,
  sampleCount: 5,
  gpsAccuracyM: 4.2,
};

function fakeDeps(): AuthorPipelineDeps {
  return {
    frontEnd: {
      kind: "barcode-detector" as const,
      detect: () => Promise.resolve(null),
    },
    solvePose: () => null,
    getCameraPose: () => null,
    getIntrinsics: () => null,
    recordDetection: vi.fn(),
    onError: vi.fn(),
  };
}

describe("syntheticAuthorLevel", () => {
  it("is geo-less and carries the printed size as its only physical fact", () => {
    const level = syntheticAuthorLevel(0.18);
    expect(level).toEqual({ version: 1, qr: { physicalSizeM: 0.18 } });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-positive/non-finite printed size (%s)",
    (sizeM) => {
      expect(() => syntheticAuthorLevel(sizeM)).toThrow();
    },
  );
});

describe("buildAuthorControllerConfig", () => {
  it("resolves the synthetic geo-less level locally for any decoded text", async () => {
    const config = buildAuthorControllerConfig(0.25, fakeDeps());
    // The decoded QR text is a printed LAUNCH URL (an HTML page) — fetching
    // it for real would fail validation and flap the status at 8 Hz.
    const level = await config.fetchLevel(
      "https://gps.csutil.com/tour/?qr=x&c=1",
    );
    expect(level).toEqual({ version: 1, qr: { physicalSizeM: 0.25 } });
  });

  it("runs minIntervalMs 0 — the frame source is the single cadence owner", () => {
    const config = buildAuthorControllerConfig(0.2, fakeDeps());
    expect(config.minIntervalMs).toBe(0);
  });

  it("routes detections into the injected recorder", () => {
    const deps = fakeDeps();
    const config = buildAuthorControllerConfig(0.2, deps);
    const event = { text: "t", timestamp: 1 } as QrDetectionEvent;
    config.onDetection?.(event);
    expect(deps.recordDetection).toHaveBeenCalledWith(event);
  });
});

// The status line is the author's only view into the mint gate; the mint
// itself now lives in the framework (qr-mint-level.test.ts) because a
// second authoring surface needs it.
describe("authorStatusLine", () => {
  it("gates the mint button on BOTH a stable pose and a live alignment", () => {
    // Why this matters: minting with either half missing writes a garbage
    // anchor into the printed code. The readout is the author's only view
    // into the gate, so each blocked state must say WHAT is missing.
    const stable = {
      status: "stable" as const,
      pose: {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      translationSpreadM: 0.01,
      rotationSpreadDeg: 1.2,
      inlierCount: 8,
      sampleCount: 8,
    };
    const noAlign = { hasMatrix: false, sampleCount: 0 };
    expect(authorStatusLine(null, null, noAlign).canMint).toBe(false);
    const measuring = authorStatusLine(
      "text",
      { ...stable, status: "measuring" as const },
      GOOD_ALIGNMENT_INFO,
    );
    expect(measuring.canMint).toBe(false);
    expect(measuring.text).toMatch(/measuring/i);
    // Milestone review #1 — the identity-matrix hole: a matrix EXISTS from
    // the very first GPS fix (the store ships identity), so a matrix-only
    // gate is vacuous and would mint a heading wrong by the session's
    // arbitrary WebXR yaw. The gate must count solved-in fixes.
    const identityOnly = authorStatusLine("text", stable, {
      hasMatrix: true,
      sampleCount: 1,
    });
    expect(identityOnly.canMint).toBe(false);
    // The constant is the tuning knob M5 may raise - the readout must
    // follow it, not restate 3.
    expect(identityOnly.text).toMatch(
      new RegExp(String.raw`1 of ${MIN_ALIGNMENT_SAMPLES} fixes`),
    );
    const ready = authorStatusLine("text", stable, GOOD_ALIGNMENT_INFO);
    expect(ready.canMint).toBe(true);
    expect(ready.text).toMatch(/ready/i);
  });
});
