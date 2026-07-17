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
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import { createReticleMesh } from "gps-plus-slam-app-framework/visualization/hit-test-reticle";
import { createWayfindingHud } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

function makeDeps() {
  return {
    container: {} as HTMLElement,
    getConfig: () => ({ distanceMin: 1.5, distanceMax: 3, indicatorScale: 1 }),
    onStatus: vi.fn((_text: string) => undefined),
    onHint: vi.fn((_message: string) => undefined),
    onError: vi.fn((_message: string) => undefined),
  } satisfies ArModeDeps;
}

/** Minimal XR frame context for the captured registerXrFrameUpdate callback. */
function makeFrameContext() {
  const sessionHandlers = new Map<string, () => void>();
  const session = {
    addEventListener: vi.fn((type: string, handler: () => void) => {
      sessionHandlers.set(type, handler);
    }),
    requestReferenceSpace: vi.fn(() => Promise.resolve({})),
    // No requestHitTestSource — the source stays null (older-runtime path).
  };
  return {
    context: {
      frame: { getHitTestResults: vi.fn(() => []) },
      referenceSpace: {},
      session,
    },
    /** Fire the AR "tap". */
    select: () => sessionHandlers.get("select")?.(),
  };
}

/** Run the frame callback ar-mode registered with the (mocked) XR frame loop. */
function runXrFrame(context: unknown): void {
  const callback = vi.mocked(registerXrFrameUpdate).mock.calls[0]![0] as (
    ctx: unknown,
  ) => void;
  callback(context);
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

  // Why this test matters (AR-onboarding revision): without the spawned
  // examples the demo boots into "tap something and then nothing visible
  // happens" — the examples must appear exactly once, on the first tracked
  // frame, and land beyond the activation distance so the HUD is live in
  // second one.
  it("spawns the three example waypoints once, on the first XR frame", async () => {
    const deps = makeDeps();
    const mode = await startArMode(deps);
    const options = vi.mocked(createWayfindingHud).mock.calls[0]![0];
    expect(options.getTargets().length).toBe(0); // nothing before frame 1

    const { context } = makeFrameContext();
    runXrFrame(context);
    expect(options.getTargets().length).toBe(3);
    expect(mode.placedCount()).toBe(3);

    runXrFrame(context); // second frame must not duplicate
    expect(options.getTargets().length).toBe(3);
    mode.dispose();
  });

  // Why this test matters: a tap with no surface under the reticle used to
  // be silently ignored (against the repo's async-feedback rule) — it must
  // surface a hint and place nothing.
  it("flashes a hint instead of placing when the reticle has no surface", async () => {
    const deps = makeDeps();
    const mode = await startArMode(deps);
    const { context, select } = makeFrameContext();
    runXrFrame(context); // wires select + spawns examples

    const reticle = vi.mocked(createReticleMesh).mock.results[0]!
      .value as THREE.Mesh;
    reticle.visible = false;
    select();
    expect(deps.onHint).toHaveBeenCalledWith(
      "Point the camera at the floor, then tap.",
    );
    expect(mode.placedCount()).toBe(3); // examples only — nothing placed

    reticle.visible = true;
    select();
    expect(mode.placedCount()).toBe(4); // visible reticle places normally
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
