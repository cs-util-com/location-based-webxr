/**
 * Live-AR wiring tests for ar-mode.
 *
 * Why these tests matter: the AR path is mostly device-only WebXR glue
 * (verified manually, per the header of ar-mode.ts), but the CONFIG wiring
 * is testable and is exactly what drifts silently: the isolation options
 * (camera/depth features must stay OFF for this tap-to-place demo), the
 * hit-test request, the tracking store group, and the slider→HUD re-creation
 * contract. The framework calls are mocked at their deep subpaths.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";

vi.mock("gps-plus-slam-app-framework/ar/webxr-session", () => ({
  initAR: vi.fn().mockResolvedValue(undefined),
  endARSession: vi.fn().mockResolvedValue(undefined),
  getArWorldGroup: vi.fn(() => new THREE.Group()),
  getCamera: vi.fn(() => new THREE.PerspectiveCamera()),
}));
vi.mock("gps-plus-slam-app-framework/ar/xr-frame-loop", () => ({
  registerXrFrameUpdate: vi.fn(() => vi.fn()),
}));
// The store is incidental to this wiring test (the real one enforces
// licensing) — a dispatch stub is all ar-mode needs.
vi.mock("gps-plus-slam-app-framework/state/create-slam-app-store", () => ({
  createSlamAppStore: vi.fn(() => ({ dispatch: vi.fn() })),
}));
vi.mock("gps-plus-slam-app-framework/storage/null-storage-backend", () => ({
  NullStorageBackend: class {},
}));
vi.mock("gps-plus-slam-app-framework/visualization/hit-test-reticle", () => ({
  createReticleMesh: vi.fn(() => new THREE.Mesh()),
  updateReticle: vi.fn(),
}));
vi.mock("gps-plus-slam-app-framework/visualization/wayfinding-hud", () => ({
  createWayfindingHud: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
}));

import { startArMode, type ArModeDeps } from "./ar-mode";
import { initAR } from "gps-plus-slam-app-framework/ar/webxr-session";
import { createWayfindingHud } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

function makeDeps() {
  return {
    container: {} as HTMLElement,
    getConfig: () => ({ distanceMin: 1.5, distanceMax: 3, indicatorScale: 1 }),
    onStatus: vi.fn((_text: string) => undefined),
    onError: vi.fn((_message: string) => undefined),
  } satisfies ArModeDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startArMode", () => {
  it("boots initAR with camera/depth features OFF, hit-test ON, and the tracking store", async () => {
    const mode = await startArMode(makeDeps());
    expect(initAR).toHaveBeenCalledWith(
      expect.anything(),
      {
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
      { requestHitTest: true },
      { tracking: { store: expect.anything() } },
    );
    mode.dispose();
  });

  it("creates the HUD in the default self-registering mode from the current config", async () => {
    const mode = await startArMode(makeDeps());
    expect(createWayfindingHud).toHaveBeenCalledTimes(1);
    const options = vi.mocked(createWayfindingHud).mock.calls[0]![0];
    expect(options.distanceMin).toBe(1.5);
    expect(options.distanceMax).toBe(3);
    // No explicit-tick override: inside a session the frame loop ticks it.
    expect(options.autoRegisterFrameUpdate).toBeUndefined();
    expect(options.getTargets()).toEqual([]); // nothing placed yet
    mode.dispose();
  });

  it("re-creates the HUD on refreshHud (slider change)", async () => {
    const mode = await startArMode(makeDeps());
    mode.refreshHud();
    expect(createWayfindingHud).toHaveBeenCalledTimes(2);
    mode.dispose();
  });

  it("surfaces an initAR failure via onError and returns an inert handle", async () => {
    vi.mocked(initAR).mockRejectedValueOnce(new Error("no session"));
    const deps = makeDeps();
    const mode = await startArMode(deps);
    expect(deps.onError).toHaveBeenCalledWith("no session");
    expect(createWayfindingHud).not.toHaveBeenCalled();
    expect(mode.placedCount()).toBe(0);
    expect(() => {
      mode.refreshHud();
      mode.dispose();
    }).not.toThrow();
  });
});
