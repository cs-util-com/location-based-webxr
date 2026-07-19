/**
 * Live-AR wiring tests for ar-mode.
 *
 * Why this test matters: the AR path is mostly device-only WebXR glue
 * (verified manually, per the header of ar-mode.ts), but its CONFIG wiring is
 * testable and drifted in the field: the demo relied on the framework's
 * conservative depth-sampling fallback (16×16 @ 1 Hz) and reconstructed
 * visibly slower than the RecorderApp (2026-07-16 field feedback). This pins
 * that the demo starts depth capture at the shared framework reconstruction
 * cadence — the same single tuning source the recorder defaults read, so the
 * two apps can never drift apart again.
 */
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
} from "gps-plus-slam-app-framework/ar/depth-sampler";

vi.mock("gps-plus-slam-app-framework/ar/webxr-session", () => ({
  initAR: vi.fn().mockResolvedValue(undefined),
  endARSession: vi.fn().mockResolvedValue(undefined),
  getArWorldGroup: vi.fn(() => new THREE.Group()),
  getCamera: vi.fn(() => null),
  startDepthCapture: vi.fn(),
  stopDepthCapture: vi.fn(),
}));
vi.mock("gps-plus-slam-app-framework/ar/xr-frame-loop", () => ({
  registerXrFrameUpdate: vi.fn(() => vi.fn()),
}));
// The store is incidental to this wiring test (and the real one enforces
// licensing) — a dispatch stub is all ar-mode needs.
vi.mock("gps-plus-slam-app-framework/state/create-slam-app-store", () => ({
  createSlamAppStore: vi.fn(() => ({ dispatch: vi.fn() })),
}));
vi.mock("./occupancy-view", () => ({
  createOccupancyView: vi.fn(() => ({
    getMesh: vi.fn(() => new THREE.Mesh()),
    setMeshMode: vi.fn(),
    setDebugStyle: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("./physics-runtime", () => ({
  createPhysicsRuntime: vi.fn(() => ({ step: vi.fn(), dispose: vi.fn() })),
}));

import { startArMode } from "./ar-mode";
import { startDepthCapture } from "gps-plus-slam-app-framework/ar/webxr-session";

// Plain fakes instead of a DOM environment: ar-mode only reads `.value`,
// sets `.textContent` and registers change listeners on these elements.
function makeDeps() {
  const fakeSelect = () =>
    ({
      value: "smooth",
      addEventListener: vi.fn(),
    }) as unknown as HTMLSelectElement;
  return {
    container: {} as HTMLElement,
    statsEl: { textContent: "" } as unknown as HTMLElement,
    meshStyleSelect: fakeSelect(),
    meshShaderSelect: fakeSelect(),
    onError: vi.fn(),
  };
}

describe("startArMode depth wiring", () => {
  it("starts depth capture at the framework reconstruction cadence (recorder parity)", async () => {
    const dispose = await startArMode(makeDeps());
    expect(startDepthCapture).toHaveBeenCalledWith({
      intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
      gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
    });
    dispose();
  });
});
