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

function harness() {
  const canvas = fakeEl();
  const meshStyleSelect = fakeEl("smooth");
  const meshShaderSelect = fakeEl("depth-shaded-wireframe");
  const statsEl = fakeEl();

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

  const occupancyView = {
    getMesh: vi.fn(),
    setMeshMode: vi.fn(),
    setDebugStyle: vi.fn(),
    dispose: vi.fn(),
  };
  const runtime = {
    step: vi.fn(),
    spawnBallWithVelocity: vi.fn(),
    clearBalls: vi.fn(),
    ballCount: () => 0,
    colliderShapeCount: () => 0,
    dispose: vi.fn(),
  };
  const factories = {
    createOccupancyView: vi.fn(() => occupancyView),
    createPhysicsRuntime: vi.fn(() => runtime),
  } as unknown as ReplayPhysicsFactories;

  return {
    session,
    controls,
    scheduler,
    factories,
    scheduled,
    occupancyView,
    runtime,
    canvas,
    meshStyleSelect,
    meshShaderSelect,
  };
}

describe("startReplayPhysics", () => {
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

  it("click-to-shoot fires a ball from the camera along the pointer ray", () => {
    const h = harness();
    startReplayPhysics(h.session, h.controls, h.scheduler, h.factories);

    const pointerHandler = h.canvas.addEventListener.mock.calls.find(
      (c) => c[0] === "pointerdown",
    )?.[1] as (e: { clientX: number; clientY: number }) => void;
    expect(pointerHandler).toBeTypeOf("function");

    pointerHandler({ clientX: 50, clientY: 50 });
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
