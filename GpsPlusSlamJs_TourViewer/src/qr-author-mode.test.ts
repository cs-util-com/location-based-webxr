import { describe, expect, it, vi } from "vitest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";

import {
  AUTHOR_DEFAULT_SIZE_M,
  authorStatusLine,
  buildAuthorControllerConfig,
  mintAuthorLevel,
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

const ZERO = { lat: 47.5, lon: 8.7 };
const IDENTITY_ALIGNMENT = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
] as const;

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

describe("mintAuthorLevel", () => {
  it("round-trips a raw-WebXR pose through the stack's GPS→NUE direction (identity alignment)", () => {
    // WebXR axes: X=East, Y=Up, Z=South. A raw position [1, 2, 3] therefore
    // sits 3 m SOUTH, 1 m EAST, 2 m up — i.e. NUE {x: -3, y: 2, z: 1}.
    const result = mintAuthorLevel({
      stablePose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY_ALIGNMENT,
      zero: ZERO,
      sizeM: 0.2,
      nowIso: "2026-08-25T20:30:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const geo = result.level.qr.geo;
    expect(geo).toBeDefined();
    const backNue = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo!.lat, lon: geo!.lon },
      geo!.alt,
      0,
    );
    expect(backNue[0]).toBeCloseTo(-3, 6);
    expect(backNue[1]).toBeCloseTo(2, 6);
    expect(backNue[2]).toBeCloseTo(1, 6);
  });

  it("applies the alignment on top of the WebXR basis (translation + yaw)", () => {
    // Alignment: rotate odom-NUE 90° about Up, then translate 10 m North.
    // Column-major columns: odom North → world East (0,0,1), Up → Up,
    // odom East → world South (-1,0,0), translation (10,0,0).
    const yaw90PlusShift = [
      0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 10, 0, 0, 1,
    ] as const;
    // Raw [0, 0, -5] = 5 m WebXR-north = odom-NUE {x: 5, y: 0, z: 0}.
    // Yaw: → world {x: 0, y: 0, z: 5}; shift: → {x: 10, y: 0, z: 5}.
    const result = mintAuthorLevel({
      stablePose: { position: [0, 0, -5], rotation: [0, 0, 0, 1] },
      alignmentMatrix: yaw90PlusShift,
      zero: ZERO,
      sizeM: 0.2,
      nowIso: "2026-08-25T20:30:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const geo = result.level.qr.geo!;
    const backNue = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo.lat, lon: geo.lon },
      geo.alt,
      0,
    );
    expect(backNue[0]).toBeCloseTo(10, 6);
    expect(backNue[1]).toBeCloseTo(0, 6);
    expect(backNue[2]).toBeCloseTo(5, 6);
  });

  it("exports JSON that survives the framework's own parser (the round-trip)", () => {
    const result = mintAuthorLevel({
      stablePose: { position: [0, 1.5, -2], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY_ALIGNMENT,
      zero: ZERO,
      sizeM: AUTHOR_DEFAULT_SIZE_M,
      nowIso: "2026-08-25T20:30:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parseQrLevel(JSON.parse(result.json));
    expect(reparsed.qr.physicalSizeM).toBe(AUTHOR_DEFAULT_SIZE_M);
    expect(reparsed.qr.geo?.rotation).toBeDefined();
    expect(reparsed.qr.mintQuality?.mintedAtIso).toBe(
      "2026-08-25T20:30:00.000Z",
    );
  });

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
    expect(authorStatusLine(null, null, false).canMint).toBe(false);
    const measuring = authorStatusLine(
      "text",
      { ...stable, status: "measuring" as const },
      true,
    );
    expect(measuring.canMint).toBe(false);
    expect(measuring.text).toMatch(/measuring/i);
    const noAlignment = authorStatusLine("text", stable, false);
    expect(noAlignment.canMint).toBe(false);
    expect(noAlignment.text).toMatch(/alignment/i);
    const ready = authorStatusLine("text", stable, true);
    expect(ready.canMint).toBe(true);
    expect(ready.text).toMatch(/ready/i);
  });

  it("refuses to mint before GPS alignment exists, in plain words", () => {
    const result = mintAuthorLevel({
      stablePose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      alignmentMatrix: null,
      zero: ZERO,
      sizeM: 0.2,
      nowIso: "2026-08-25T20:30:00.000Z",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/alignment/i) as unknown,
    });

    const noZero = mintAuthorLevel({
      stablePose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY_ALIGNMENT,
      zero: null,
      sizeM: 0.2,
      nowIso: "2026-08-25T20:30:00.000Z",
    });
    expect(noZero.ok).toBe(false);
  });
});
