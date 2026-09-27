/**
 * Tests for the desktop-replay physics lifecycle.
 *
 * Why this test matters:
 * This module owns every per-replay resource — the occupancy view, the Rapier
 * runtime, the rAF step loop and the DOM listeners — behind ONE disposer. PR #197
 * review (gemini-code-assist, "critical") flagged that the pre-extraction glue
 * left the rAF loop running and the runtime/occupancy view undisposed forever, so
 * loading a second recording stacked orphaned loops + physics worlds + WebGL
 * geometries (a WASM crash once a world is freed, an unbounded leak otherwise).
 * These tests pin the fix: the loop steps while active, and the disposer STOPS the
 * loop (a straggler frame is a no-op), frees the runtime + occupancy view, and
 * unwires every listener — so a reload can never leak the previous session.
 * Factories + the rAF scheduler are injected so the whole lifecycle is headless.
 */

import { describe, it, expect, vi } from "vitest";
import {
  startReplayPhysics,
  type FrameScheduler,
  type ReplayPhysicsControls,
  type ReplayPhysicsFactories,
} from "./replay-physics";
import { STILL_STEPS } from "./ball-status";
import type { ReplaySessionController } from "gps-plus-slam-app-framework/state/replay-session";
import * as THREE from "three";

/** A DOM-element stand-in that records add/removeEventListener (node env: no DOM). */
function fakeEl(value = ""): {
  value: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  getBoundingClientRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
} {
  return {
    value,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
}

function harness(options: { shadows?: boolean; shadowProbe?: boolean } = {}) {
  const canvas = fakeEl();
  const meshStyleSelect = fakeEl("smooth");
  const meshShaderSelect = fakeEl("depth-shaded-wireframe");
  const statsEl = Object.assign(fakeEl(), { textContent: "" });
  const shadowToggle = Object.assign(fakeEl(), { checked: true });

  const sceneHandles = {
    scene: new THREE.Scene(),
    arWorldGroup: new THREE.Group(),
    arpose: new THREE.Object3D(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer,
  };
  const session = {
    getScene: () => sceneHandles,
    getStore: () => ({}),
  } as unknown as ReplaySessionController;

  const controls = {
    meshStyleSelect,
    meshShaderSelect,
    statsEl,
    onFrame: vi.fn(),
    shadows: options.shadows ?? true,
    shadowToggle,
    shadowProbe: options.shadowProbe ?? false,
  } as unknown as ReplayPhysicsControls;

  const scheduled: Array<(t: number) => void> = [];
  let nextHandle = 1;
  const scheduler: FrameScheduler = {
    request: vi.fn((cb: (t: number) => void) => {
      scheduled.push(cb);
      return nextHandle++;
    }),
    cancel: vi.fn(),
  };

  const occluder = { name: "the current occluder", getTriangleCount: () => 12 };
  const occupancyView = {
    getMesh: vi.fn(),
    getOcclusionMesh: vi.fn(() => occluder),
    setMeshMode: vi.fn(),
    setDebugStyle: vi.fn(),
    remesh: vi.fn(),
    depthStats: vi.fn(() => ({ samples: 0, lastSampleAtMs: null })),
    dispose: vi.fn(),
  };
  const runtime = {
    step: vi.fn(),
    spawnBallWithVelocity: vi.fn(),
    clearBalls: vi.fn(),
    ballCount: () => 0,
    balls: vi.fn(() => [] as { position: THREE.Vector3; radius: number }[]),
    colliderShapeCount: () => 0,
    colliderBuiltAtMs: () => null,
    dispose: vi.fn(),
  };
  let enabled = true;
  const shadows = {
    update: vi.fn(),
    isActive: () => enabled,
    inRange: () => true,
    isEnabled: () => enabled,
    setEnabled: vi.fn((on: boolean) => {
      enabled = on;
    }),
    diagnostics: () => ({
      cast: true,
      mapSize: 1024,
      mapAllocated: false,
      mapRenders: 1,
    }),
    dispose: vi.fn(),
  };
  const factories = {
    createOccupancyView: vi.fn(() => occupancyView),
    createPhysicsRuntime: vi.fn(() => runtime),
    startDemoShadows: vi.fn(() => shadows),
  } as unknown as ReplayPhysicsFactories;

  return {
    session,
    controls,
    scheduler,
    factories,
    scheduled,
    occupancyView,
    occluder,
    runtime,
    shadows,
    sceneHandles,
    canvas,
    meshStyleSelect,
    meshShaderSelect,
    statsEl,
    shadowToggle,
  };
}

/** The listener `el` registered for `type` (the fake records them). */
function listener(
  el: { addEventListener: ReturnType<typeof vi.fn> },
  type: string,
) {
  const call = el.addEventListener.mock.calls.find(([t]) => t === type);
  if (!call) throw new Error(`no ${type} listener`);
  return call[1] as () => void;
}

describe("startReplayPhysics", () => {
  // The shadow e2e measures every skin after a re-mesh (round 3: the Off and
  // Wireframe skins lost the shadow only once the room re-meshed). The
  // paused replay has no depth stream, so the probe's re-mesh must reach the
  // demo's own occupancy view, the one the receiver draws.
  it("routes the shadow probe's re-mesh to the occupancy view", () => {
    const win: { __physicsShadowProbe?: { remesh(): void } } = {};
    vi.stubGlobal("window", win);
    try {
      const h = harness({ shadowProbe: true });
      const dispose = startReplayPhysics(
        h.session,
        h.controls,
        h.scheduler,
        h.factories,
      );
      win.__physicsShadowProbe!.remesh();
      expect(h.occupancyView.remesh).toHaveBeenCalledTimes(1);
      dispose();
      expect(win.__physicsShadowProbe).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("steps the runtime + advances the perf panel each frame, re-scheduling the next", () => {
    const h = harness();
    const dispose = startReplayPhysics(
      h.session,
      h.controls,
      h.scheduler,
      h.factories,
    );

    expect(h.scheduler.request).toHaveBeenCalledTimes(1);
    h.scheduled[0]!(16);
    expect(h.runtime.step).toHaveBeenCalledWith(16);
    expect(h.controls.onFrame).toHaveBeenCalledTimes(1);
    // The tick re-armed the next frame (a live loop).
    expect(h.scheduler.request).toHaveBeenCalledTimes(2);

    dispose();
  });

  it("the disposer stops the loop + frees runtime/occupancy/listeners (PR #197 leak)", () => {
    const h = harness();
    const dispose = startReplayPhysics(
      h.session,
      h.controls,
      h.scheduler,
      h.factories,
    );
    const firstTick = h.scheduled[0]!;

    dispose();

    // The pending frame is cancelled, and a straggler frame that still fires is a
    // no-op — no step on a runtime whose world may already be freed.
    expect(h.scheduler.cancel).toHaveBeenCalledWith(1);
    firstTick(32);
    expect(h.runtime.step).not.toHaveBeenCalled();

    // Every owned resource + listener is released exactly once.
    expect(h.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(h.occupancyView.dispose).toHaveBeenCalledTimes(1);
    expect(h.canvas.removeEventListener).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
    );
    expect(h.canvas.removeEventListener).toHaveBeenCalledWith(
      "pointerup",
      expect.any(Function),
    );
    expect(h.meshStyleSelect.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(h.meshShaderSelect.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    // Idempotent: a second dispose must not double-free.
    dispose();
    expect(h.runtime.dispose).toHaveBeenCalledTimes(1);
  });

  // W4 AR shadows M3 (plan 2026-09-26-0549 §11): the replay scene gets the
  // same shadows as live AR, on its own renderer, fed the CURRENT occluder
  // and the ball count, updated after each physics step so a ball's shadow
  // is where the ball is.
  it("starts the AR shadows on the replay scene and updates them after each step", () => {
    const h = harness();
    const dispose = startReplayPhysics(
      h.session,
      h.controls,
      h.scheduler,
      h.factories,
    );
    const start = vi.mocked(h.factories.startDemoShadows);
    expect(start).toHaveBeenCalledTimes(1);
    const deps = start.mock.calls[0]![0];
    expect(deps.renderer).toBe(h.sceneHandles.renderer);
    expect(deps.scene).toBe(h.sceneHandles.scene);
    expect(deps.arWorldGroup).toBe(h.sceneHandles.arWorldGroup);
    // The recorded phone pose, not the orbit camera: the orbit camera sits
    // 5-200 m above the room, where the square would miss the floor (M1
    // review finding 1).
    expect(deps.getCamera()).toBe(h.sceneHandles.arpose);
    expect(deps.getOccluder()).toBe(h.occluder);
    expect(deps.ballCount()).toBe(0);

    h.scheduled[0]!(16);
    expect(h.shadows.update).toHaveBeenCalledTimes(1);
    expect(h.runtime.step.mock.invocationCallOrder[0]!).toBeLessThan(
      h.shadows.update.mock.invocationCallOrder[0]!,
    );

    dispose();
    expect(h.shadows.dispose).toHaveBeenCalledTimes(1);
  });

  // Round-2 plan M1: the shadow map is made ready once at start even when
  // the page opens with ?shadows=0, so the switch never recompiles the lit
  // materials mid-session; the page starts with them switched off.
  it("starts the shadows switched off with ?shadows=0, the switch unticked", () => {
    const h = harness({ shadows: false });
    const dispose = startReplayPhysics(
      h.session,
      h.controls,
      h.scheduler,
      h.factories,
    );
    expect(h.factories.startDemoShadows).toHaveBeenCalledTimes(1);
    expect(h.shadows.setEnabled).toHaveBeenLastCalledWith(false);
    expect(h.shadowToggle.checked).toBe(false);
    dispose();
  });

  it("the Shadows switch turns them off and on, and lets go on dispose", () => {
    const h = harness();
    const dispose = startReplayPhysics(
      h.session,
      h.controls,
      h.scheduler,
      h.factories,
    );
    expect(h.shadowToggle.checked).toBe(true);
    const onChange = listener(h.shadowToggle, "change");
    h.shadowToggle.checked = false;
    onChange();
    expect(h.shadows.setEnabled).toHaveBeenLastCalledWith(false);
    h.shadowToggle.checked = true;
    onChange();
    expect(h.shadows.setEnabled).toHaveBeenLastCalledWith(true);
    dispose();
    expect(h.shadowToggle.removeEventListener).toHaveBeenCalledWith(
      "change",
      onChange,
    );
  });

  // The status line (round-2 plan M1): resting and fallen balls, the
  // collider, and the shadows' state, from the runtime's stats callback.
  // M1 review finding 1: the viewer is the recorded phone pose, never the
  // orbit camera high above the room, or every resting ball read "fell
  // through" in a normal replay.
  it("writes the balls' state, the collider and the shadows into the stats line", () => {
    const h = harness();
    h.sceneHandles.camera.position.set(0, 200, 0);
    h.sceneHandles.arpose.position.set(0, 1.5, 0);
    h.sceneHandles.camera.updateMatrixWorld(true);
    h.sceneHandles.arpose.updateMatrixWorld(true);
    const dispose = startReplayPhysics(
      h.session,
      h.controls,
      h.scheduler,
      h.factories,
    );
    const onStats = vi.mocked(h.factories.createPhysicsRuntime).mock
      .calls[0]![2]!.onStats!;
    h.runtime.balls.mockReturnValue([
      { position: new THREE.Vector3(0, 0.1, 0), radius: 0.08 },
    ]);
    for (let i = 0; i <= STILL_STEPS; i++) onStats(1, 12);
    expect(h.statsEl.textContent).toBe(
      "balls 1 (1 resting, 1 in shadow range) · collider 12 tris · shadows on" +
        " · depth 0 · mesh 12 tris · collider not built" +
        " · rx off · sun cast, no map, renders 1",
    );
    h.shadowToggle.checked = false;
    listener(h.shadowToggle, "change")();
    onStats(1, 12);
    expect(h.statsEl.textContent).toBe(
      "balls 1 (1 resting, 1 in shadow range) · collider 12 tris · shadows off" +
        " · depth 0 · mesh 12 tris · collider not built" +
        " · rx off · sun cast, no map, renders 1",
    );
    dispose();
  });

  it("click-to-shoot fires a ball from the camera along the pointer ray", () => {
    const h = harness();
    startReplayPhysics(h.session, h.controls, h.scheduler, h.factories);

    const downHandler = h.canvas.addEventListener.mock.calls.find(
      (c) => c[0] === "pointerdown",
    )?.[1] as (e: { clientX: number; clientY: number; button: number }) => void;
    const upHandler = h.canvas.addEventListener.mock.calls.find(
      (c) => c[0] === "pointerup",
    )?.[1] as (e: { clientX: number; clientY: number; button: number }) => void;
    expect(downHandler).toBeTypeOf("function");
    expect(upHandler).toBeTypeOf("function");

    // The shot fires on release, not press — a press alone must not spawn
    // (it may be the start of an OrbitControls drag, see the drag test).
    downHandler({ clientX: 50, clientY: 50, button: 0 });
    expect(h.runtime.spawnBallWithVelocity).not.toHaveBeenCalled();
    upHandler({ clientX: 50, clientY: 50, button: 0 });
    expect(h.runtime.spawnBallWithVelocity).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: the replay canvas is shared with OrbitControls
  // (click-drag orbit is the framework replay scene's default camera mode), so
  // shooting on bare pointerdown fired an unwanted ball on EVERY camera drag
  // (PR #198 review, gemini-code-assist). A shot must only fire for a
  // stationary click: pointerup within the drag threshold of its pointerdown.
  it("an orbit drag (pointerdown, displaced pointerup) does not shoot", () => {
    const h = harness();
    startReplayPhysics(h.session, h.controls, h.scheduler, h.factories);

    const downHandler = h.canvas.addEventListener.mock.calls.find(
      (c) => c[0] === "pointerdown",
    )?.[1] as (e: { clientX: number; clientY: number; button: number }) => void;
    const upHandler = h.canvas.addEventListener.mock.calls.find(
      (c) => c[0] === "pointerup",
    )?.[1] as (e: { clientX: number; clientY: number; button: number }) => void;

    // Drag: down at (50,50), released 30 px away — an orbit gesture, no shot.
    downHandler({ clientX: 50, clientY: 50, button: 0 });
    upHandler({ clientX: 80, clientY: 50, button: 0 });
    expect(h.runtime.spawnBallWithVelocity).not.toHaveBeenCalled();

    // A subsequent clean click still shoots (drag state fully reset).
    downHandler({ clientX: 50, clientY: 50, button: 0 });
    upHandler({ clientX: 52, clientY: 51, button: 0 });
    expect(h.runtime.spawnBallWithVelocity).toHaveBeenCalledTimes(1);

    // A stray pointerup with no preceding pointerdown never shoots.
    upHandler({ clientX: 52, clientY: 51, button: 0 });
    expect(h.runtime.spawnBallWithVelocity).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: OrbitControls pans with the RIGHT button on the
  // same shared canvas, and the browser opens a context menu on right-click —
  // a stationary secondary-button release must not also fire a ball
  // (PR #205 review, coderabbit). Only the primary button shoots.
  it("a stationary right- or middle-button click does not shoot", () => {
    const h = harness();
    startReplayPhysics(h.session, h.controls, h.scheduler, h.factories);

    const downHandler = h.canvas.addEventListener.mock.calls.find(
      (c) => c[0] === "pointerdown",
    )?.[1] as (e: { clientX: number; clientY: number; button: number }) => void;
    const upHandler = h.canvas.addEventListener.mock.calls.find(
      (c) => c[0] === "pointerup",
    )?.[1] as (e: { clientX: number; clientY: number; button: number }) => void;

    // Right-button click (context menu / pan): stationary, but must not shoot.
    downHandler({ clientX: 50, clientY: 50, button: 2 });
    upHandler({ clientX: 50, clientY: 50, button: 2 });
    // Middle-button click: same rule.
    downHandler({ clientX: 50, clientY: 50, button: 1 });
    upHandler({ clientX: 50, clientY: 50, button: 1 });
    expect(h.runtime.spawnBallWithVelocity).not.toHaveBeenCalled();

    // A following primary click still shoots (no stuck state).
    downHandler({ clientX: 50, clientY: 50, button: 0 });
    upHandler({ clientX: 50, clientY: 50, button: 0 });
    expect(h.runtime.spawnBallWithVelocity).toHaveBeenCalledTimes(1);
  });

  it("wires the mesh-mode + shader dropdowns to the occupancy view", () => {
    const h = harness();
    startReplayPhysics(h.session, h.controls, h.scheduler, h.factories);

    const modeHandler = h.meshStyleSelect.addEventListener.mock.calls.find(
      (c) => c[0] === "change",
    )?.[1] as () => void;
    h.meshStyleSelect.value = "greedy";
    modeHandler();
    expect(h.occupancyView.setMeshMode).toHaveBeenCalledWith("greedy");

    const shaderHandler = h.meshShaderSelect.addEventListener.mock.calls.find(
      (c) => c[0] === "change",
    )?.[1] as () => void;
    h.meshShaderSelect.value = "wireframe";
    shaderHandler();
    expect(h.occupancyView.setDebugStyle).toHaveBeenCalledWith("wireframe");
  });
});
