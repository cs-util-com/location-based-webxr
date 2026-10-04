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
    rebuild: vi.fn(),
    depthStats: vi.fn(() => ({ samples: 3, lastSampleAtMs: 9_800 })),
    dispose: vi.fn(),
  })),
}));
vi.mock("./physics-runtime", () => ({
  createPhysicsRuntime: vi.fn(() => ({
    step: vi.fn(),
    ballCount: vi.fn(() => 4),
    balls: vi.fn(() => []),
    colliderBuiltAtMs: vi.fn(() => 9_500),
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
    fakeRenderer: {
      name: "the session renderer",
      // What the receiver-flags reader reads: no program compiled yet.
      properties: { get: () => ({}) },
      getContext: () => ({}),
    },
    fakeScene: { name: "the session scene" },
    fakeOccluder: {
      name: "the current occluder",
      tris: 7,
      getTriangleCount(): number {
        return this.tris;
      },
    },
    fakeShadows: {
      update: vi.fn(),
      isActive: () => true,
      isEnabled: () => true,
      inRange: () => true,
      setEnabled: vi.fn(),
      diagnostics: () => ({
        cast: true,
        mapSize: 1024,
        mapAllocated: true,
        mapRenders: 2,
      }),
      dispose: vi.fn(),
    },
  }),
);

import { startArMode } from "./ar-mode";
import { STILL_STEPS } from "./ball-status";
import {
  getArWorldGroup,
  getCamera,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import { RECEIVER_NODE } from "./shadow-diagnostics";
import { startDemoShadows } from "./ar-shadows-wiring";
import { createPhysicsRuntime } from "./physics-runtime";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import { startDepthCapture } from "gps-plus-slam-app-framework/ar/webxr-session";
import { createOccupancyView } from "./occupancy-view";

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

// The first-visit report on r753: the balls rested but cast no shadow until
// the Mesh dropdown was switched and back (a new occluder, so a new
// receiver). Once, when the session is `visible` and the mesh has
// triangles, the demo takes that same path, before the shadows' update so
// the new occluder gets its receiver in the same frame; never before, never
// twice.
describe("startArMode first-visit receiver rebuild", () => {
  /** Starts AR with a receiver on the room, and a frame driver. */
  async function started(
    extra: Partial<Parameters<typeof startArMode>[0]> = {},
  ) {
    fakeShadows.update.mockClear();
    const dispose = await startArMode({ ...makeDeps(), ...extra });
    const view = vi.mocked(createOccupancyView).mock.results.at(-1)!.value as {
      rebuild: ReturnType<typeof vi.fn>;
    };
    const room = vi.mocked(getArWorldGroup).mock.results.at(-1)!
      .value as THREE.Group;
    const receiver = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.ShadowMaterial(),
    );
    receiver.name = RECEIVER_NODE;
    room.add(receiver);
    const frame = vi.mocked(registerXrFrameUpdate).mock.lastCall![0];
    const at = (visibilityState: string) =>
      frame({
        session: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          visibilityState,
        },
      } as never);
    return { dispose, view, at };
  }

  // The owner's report on r753: the balls rested, the shadow was missing
  // until the Mesh dropdown was switched and back. Once, when the session
  // is visible with a mesh (the fakes also give a receiver, an allocated
  // map and balls), the demo takes that path, before the shadows' update so
  // the new occluder gets its receiver in the same frame; never twice.
  it("rebuilds the occluder once, only when visible with a mesh, before the shadows update", async () => {
    const { dispose, view, at } = await started();
    fakeOccluder.tris = 0;
    at("visible"); // no mesh yet
    fakeOccluder.tris = 7;
    at("visible-blurred"); // the permission prompt's state
    at("hidden");
    expect(view.rebuild).not.toHaveBeenCalled();
    at("visible");
    expect(view.rebuild).toHaveBeenCalledTimes(1);
    expect(view.rebuild.mock.invocationCallOrder[0]!).toBeLessThan(
      fakeShadows.update.mock.invocationCallOrder.at(-1)!,
    );
    for (let i = 0; i < 5; i++) at("visible");
    expect(view.rebuild).toHaveBeenCalledTimes(1);
    dispose();
  });

  // `?rebuild=0`: the owner's A/B, the bug's state must stay on screen.
  it("never rebuilds with the rebuild turned off", async () => {
    const { dispose, view, at } = await started({ rebuild: false });
    fakeOccluder.tris = 7;
    for (let i = 0; i < 5; i++) at("visible");
    expect(view.rebuild).not.toHaveBeenCalled();
    dispose();
  });
});

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

// M1 review finding 3: in AR a tap on the DOM overlay fires the click AND
// an XR select, and a select shoots a ball; so each flip of the Shadows
// switch (or a dropdown) threw a ball. The panel cancels the XR half.
describe("startArMode panel taps", () => {
  it("keeps taps on the panel from also shooting, and lets go on dispose", async () => {
    const listeners = new Map<string, (e: Event) => void>();
    const panel = {
      addEventListener: (type: string, fn: (e: Event) => void) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as HTMLElement;
    const dispose = await startArMode({ ...makeDeps(), panel });
    const event = { preventDefault: vi.fn() } as unknown as Event;
    listeners.get("beforexrselect")!(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    dispose();
    expect(listeners.has("beforexrselect")).toBe(false);
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
    frame({
      session: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        visibilityState: "visible",
      },
    } as never);
    const runtime = vi.mocked(createPhysicsRuntime).mock.results.at(-1)!
      .value as { step: ReturnType<typeof vi.fn> };
    expect(fakeShadows.update).toHaveBeenCalledTimes(1);
    expect(runtime.step.mock.invocationCallOrder[0]!).toBeLessThan(
      fakeShadows.update.mock.invocationCallOrder[0]!,
    );

    dispose();
    expect(fakeShadows.dispose).toHaveBeenCalledTimes(1);
  });

  // Round-2 plan M1: the map is made ready once at start even with
  // ?shadows=0 (switching later must not recompile mid-session); the page
  // starts with them switched off, and the panel's switch turns them on.
  it("starts them switched off with ?shadows=0, and the switch turns them on", async () => {
    vi.mocked(startDemoShadows).mockClear();
    fakeShadows.setEnabled.mockClear();
    const listeners = new Map<string, () => void>();
    const shadowToggle = {
      checked: true,
      addEventListener: (type: string, fn: () => void) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as HTMLInputElement;
    const dispose = await startArMode({
      ...makeDeps(),
      shadows: false,
      shadowToggle,
    });
    expect(startDemoShadows).toHaveBeenCalledTimes(1);
    expect(fakeShadows.setEnabled).toHaveBeenLastCalledWith(false);
    expect(shadowToggle.checked).toBe(false);
    shadowToggle.checked = true;
    listeners.get("change")!();
    expect(fakeShadows.setEnabled).toHaveBeenLastCalledWith(true);
    dispose();
    expect(listeners.has("change")).toBe(false);
  });

  // The owner's view on the phone: resting and fallen balls, the collider,
  // and the shadows' state, with the viewer's height from the tracked
  // camera (a ball on the floor 1.4 m below it rests, it did not fall).
  // Then the diagnostics (r752 first-load report): the depth stream, the
  // mesh, the collider's age, and how long physics and AR took to start
  // after the tap, all on the page's one clock.
  it("writes the balls' state and the shadows into the stats line, the diagnostics into their own", async () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.5, 0);
    camera.updateMatrixWorld(true);
    vi.mocked(getCamera).mockReturnValue(camera);
    let clock = 10_000;
    const deps = {
      ...makeDeps(),
      now: () => clock,
      start: { tappedAtMs: 5_000, physicsReadyAtMs: 5_800 },
      diagnosticsEl: { textContent: "" } as unknown as HTMLElement,
      pageHidden: () => 1,
    };
    const dispose = await startArMode(deps);
    const onStats = vi.mocked(createPhysicsRuntime).mock.lastCall![2]!.onStats!;
    const runtime = vi.mocked(createPhysicsRuntime).mock.results.at(-1)!
      .value as { balls: ReturnType<typeof vi.fn> };
    runtime.balls.mockReturnValue([
      { position: new THREE.Vector3(0, 0.1, 0), radius: 0.08 },
    ]);
    for (let i = 0; i <= STILL_STEPS; i++) onStats(1, 7);
    expect(deps.statsEl.textContent).toBe(
      "balls 1 (1 resting, 1 in shadow range) · collider 7 tris · shadows on",
    );
    // The diagnostics come from the frame loop, at about 4 Hz, and see this
    // frame's visibility (the session goes visible at 10.2 s).
    const frame = vi.mocked(registerXrFrameUpdate).mock.lastCall![0];
    const listeners: Record<string, (e: Event) => void> = {};
    const session = {
      visibilityState: "visible-blurred",
      addEventListener: (type: string, fn: (e: Event) => void) => {
        listeners[type] = fn;
      },
      removeEventListener: vi.fn(),
    };
    frame({ session } as never);
    // A blur and back between two frames, seen only by the event.
    session.visibilityState = "hidden";
    listeners.visibilitychange!({ target: session } as unknown as Event);
    session.visibilityState = "visible";
    listeners.visibilitychange!({ target: session } as unknown as Event);
    clock = 10_200;
    frame({ session } as never); // inside the 250 ms: not rewritten
    expect(deps.diagnosticsEl.textContent).toContain("xr visible-blurred");
    clock = 10_300;
    frame({ session } as never);
    expect(deps.diagnosticsEl.textContent).toBe(
      "depth 3 (0.5 s ago) · mesh 7 tris · collider 0.8 s old" +
        " · rx off · sun cast, map 1024, renders 2" +
        " · xr visible, blurred 1x, hidden 1x (first 0.2 s)" +
        " · page hidden 1x · rebuild pending" +
        " · start: physics 0.8 s, AR 5.0 s",
    );
    dispose();
    vi.mocked(getCamera).mockReturnValue(null);
  });
});
