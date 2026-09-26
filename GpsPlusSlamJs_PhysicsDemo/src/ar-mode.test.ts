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
 *
 * The AR shadows (W4 AR shadows plan 2026-09-26-0549 §11) are pinned here
 * too: started on the session's own renderer and scene, fed the CURRENT
 * occluder and the ball count, updated in the XR frame AFTER the physics
 * step and before that frame's render (no lag), disposed with the session,
 * and not started at all under `?shadows=0`.
 */
import { describe, expect, it, vi } from "vitest";
import type * as ShadowsWiring from "./ar-shadows-wiring";
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
  getRenderer: vi.fn(() => fakeRenderer),
  getScene: vi.fn(() => fakeScene),
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
    getOcclusionMesh: vi.fn(() => fakeOccluder),
    setMeshMode: vi.fn(),
    setDebugStyle: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("./physics-runtime", () => ({
  createPhysicsRuntime: vi.fn(() => ({
    step: vi.fn(),
    ballCount: vi.fn(() => 4),
    dispose: vi.fn(),
  })),
}));
vi.mock("./ar-shadows-wiring", async (importOriginal) => ({
  ...(await importOriginal<typeof ShadowsWiring>()),
  startDemoShadows: vi.fn(() => fakeShadows),
}));

// Hoisted with the mocks that return them.
const { fakeRenderer, fakeScene, fakeOccluder, fakeShadows } = vi.hoisted(
  () => ({
    fakeRenderer: { name: "the session renderer" },
    fakeScene: { name: "the session scene" },
    fakeOccluder: { name: "the current occluder" },
    fakeShadows: { update: vi.fn(), isActive: () => true, dispose: vi.fn() },
  }),
);

import { startArMode } from "./ar-mode";
import { startDemoShadows } from "./ar-shadows-wiring";
import { createPhysicsRuntime } from "./physics-runtime";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
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

describe("startArMode AR shadows", () => {
  it("starts them on the session, updates them after each step, disposes them", async () => {
    vi.mocked(startDemoShadows).mockClear();
    fakeShadows.update.mockClear();
    fakeShadows.dispose.mockClear();
    const dispose = await startArMode(makeDeps());
    expect(startDemoShadows).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(startDemoShadows).mock.calls[0]![0];
    expect(deps.renderer).toBe(fakeRenderer);
    expect(deps.scene).toBe(fakeScene);
    expect(deps.getOccluder()).toBe(fakeOccluder);
    expect(deps.ballCount()).toBe(4);

    const frame = vi.mocked(registerXrFrameUpdate).mock.lastCall![0];
    frame({ session: { addEventListener: vi.fn() } } as never);
    const runtime = vi.mocked(createPhysicsRuntime).mock.results.at(-1)!
      .value as { step: ReturnType<typeof vi.fn> };
    expect(fakeShadows.update).toHaveBeenCalledTimes(1);
    expect(runtime.step.mock.invocationCallOrder[0]!).toBeLessThan(
      fakeShadows.update.mock.invocationCallOrder[0]!,
    );

    dispose();
    expect(fakeShadows.dispose).toHaveBeenCalledTimes(1);
  });

  it("starts none when the page switched them off (?shadows=0)", async () => {
    vi.mocked(startDemoShadows).mockClear();
    const dispose = await startArMode({ ...makeDeps(), shadows: false });
    expect(startDemoShadows).not.toHaveBeenCalled();
    dispose();
  });
});
