/**
 * Unit tests for the desktop walk simulator wiring.
 *
 * Why these tests matter: the simulator is the demo's desktop mode AND the
 * host that drives the framework HUD in explicit-tick mode. These tests pin
 * the wiring with injected fakes (renderer/controls/scheduler/window/HUD):
 * explicit-tick creation (autoRegisterFrameUpdate: false — the frame loop is
 * never ticked outside a WebXR session), per-frame hud.update(dt), the
 * slider-driven HUD re-creation, WASD movement reaching the camera, and a
 * leak-free dispose. The real rendering + real-HUD math run in the
 * Playwright e2e.
 */
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import type { WayfindingHudOptions } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

import {
  startDesktopSim,
  type FrameScheduler,
  type SimControls,
  type SimRenderer,
  type WindowLike,
} from "./desktop-sim";
import { SIM_EYE_HEIGHT, SIM_WAYPOINTS } from "./sim-waypoints";
// The accent token comes from the vendored design.css at runtime; jsdom has
// no sheet, so the reader is mocked to exercise both outcomes.
vi.mock("./design-token", () => ({
  readCssToken: vi.fn((): string | undefined => undefined),
}));
import { readCssToken } from "./design-token";

function makeHarness(configOverride?: {
  distanceMin?: number;
  imageIndicators?: boolean;
}) {
  const listeners = new Map<string, EventListener[]>();
  const windowLike = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
  } as unknown as WindowLike;

  const dispatch = (type: string, event: unknown): void => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event as Event);
    }
  };

  const frameCallbacks: Array<(t: number) => void> = [];
  const scheduler = {
    request: vi.fn((cb: (t: number) => void) => frameCallbacks.push(cb)),
    cancel: vi.fn(),
  } satisfies FrameScheduler;
  /** Run the single pending frame callback at the given timestamp. */
  const step = (timestampMs: number): void => {
    const cb = frameCallbacks.shift();
    if (!cb) throw new Error("no frame scheduled");
    cb(timestampMs);
  };

  const domElement = { remove: vi.fn() } as unknown as HTMLElement;
  const renderer = {
    domElement,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  } satisfies SimRenderer;
  const controls = {
    target: new THREE.Vector3(),
    enableDamping: false,
    update: vi.fn(),
    dispose: vi.fn(),
  } satisfies SimControls;
  const container = { appendChild: vi.fn() } as unknown as HTMLElement;

  const hudInstances: Array<{
    update: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const createHudImpl = vi.fn((_options: WayfindingHudOptions) => {
    const hud = { update: vi.fn(), dispose: vi.fn() };
    hudInstances.push(hud);
    return hud;
  });

  let config = {
    distanceMin: configOverride?.distanceMin ?? 8,
    distanceMax: 12,
    indicatorScale: 1,
    imageIndicators: configOverride?.imageIndicators ?? false,
  };
  const statuses: string[] = [];

  const sim = startDesktopSim({
    container,
    getConfig: () => config,
    onStatus: (text) => statuses.push(text),
    createHudImpl,
    createRenderer: () => renderer,
    createControls: () => controls,
    scheduler,
    windowLike,
  });

  return {
    sim,
    scheduler,
    step,
    dispatch,
    listeners,
    renderer,
    controls,
    container,
    createHudImpl,
    hudInstances,
    statuses,
    setConfig: (next: typeof config) => {
      config = next;
    },
  };
}

describe("startDesktopSim", () => {
  it("mounts the canvas and creates the HUD in explicit-tick mode with the current config", () => {
    const h = makeHarness();
    expect(h.container.appendChild).toHaveBeenCalledWith(h.renderer.domElement);
    expect(h.createHudImpl).toHaveBeenCalledTimes(1);
    const options = h.createHudImpl.mock.calls[0]![0];
    expect(options.autoRegisterFrameUpdate).toBe(false);
    expect(options.distanceMin).toBe(8);
    // Default config: procedural indicators — no sprite URLs passed.
    expect(options.arrowSprite).toBeUndefined();
    expect(options.circleSprite).toBeUndefined();
    expect(options.getTargets().length).toBe(SIM_WAYPOINTS.length);
    h.sim.dispose();
  });

  // Why this test matters: same contract as ar-mode — the live accent token
  // is the HUD tint, and an absent sheet OMITS the option rather than passing
  // an empty string the framework would read as black.
  it("passes the design system's accent token as the indicator tint, and omits it when the sheet has none", () => {
    vi.mocked(readCssToken).mockReturnValueOnce("#123456");
    const tinted = makeHarness();
    expect(readCssToken).toHaveBeenCalledWith("--accent");
    expect(tinted.createHudImpl.mock.calls[0]![0].indicatorColor).toBe(
      "#123456",
    );
    tinted.sim.dispose();

    const untinted = makeHarness();
    expect("indicatorColor" in untinted.createHudImpl.mock.calls[0]![0]).toBe(
      false,
    );
    untinted.sim.dispose();
  });

  // Why this test matters: the desktop simulator is the e2e-observable host
  // of the image-indicator toggle — it must hand the fingerprintable asset
  // URLs to the HUD factory when (and only when) the config asks for them.
  it("passes the sprite asset URLs to the HUD when the config enables image indicators", () => {
    const h = makeHarness({ imageIndicators: true });
    const options = h.createHudImpl.mock.calls[0]![0];
    expect(options.arrowSprite).toMatch(/wayfinding-arrow.*\.svg$/);
    expect(options.circleSprite).toMatch(/wayfinding-diamond.*\.svg$/);
    h.sim.dispose();
  });

  // Why this test matters: the framework HUD parents every indicator to the
  // camera, and three.js only renders objects reachable from the scene root —
  // a camera outside the scene draws NO indicators even though the status
  // line (built from camera.children) still reports them. Field report
  // 2026-07-20: desktop showed no HUD elements while the phone AR mode did
  // (there the framework's arpose chain keeps the camera in the scene). This
  // pins the scene-graph wiring the status seam cannot see; the pixel-level
  // proof lives in playwright-tests/hud-render.spec.js.
  it("parents the camera into the scene so camera-attached HUD indicators render", () => {
    const h = makeHarness();
    h.step(0);
    const [scene, camera] = h.renderer.render.mock.calls[0] as [
      THREE.Scene,
      THREE.Camera,
    ];
    expect(camera.parent).toBe(scene);
    h.sim.dispose();
  });

  it("ticks the HUD with dt seconds and reports a status line every frame", () => {
    const h = makeHarness();
    h.step(1000);
    h.step(1016); // one 16 ms frame later
    const hud = h.hudInstances[0]!;
    expect(hud.update).toHaveBeenCalledTimes(2);
    expect(hud.update).toHaveBeenLastCalledWith(expect.closeTo(0.016, 3));
    expect(h.statuses.at(-1)).toContain(`targets ${SIM_WAYPOINTS.length}`);
    expect(h.renderer.render).toHaveBeenCalledTimes(2);
    h.sim.dispose();
  });

  it("moves the camera forward while 'w' is held (dt-scaled walk)", () => {
    const h = makeHarness();
    h.step(0);
    h.dispatch("keydown", { key: "w", target: null });
    h.step(1000); // 1 s at WALK_SPEED_MPS... capped dt (0.1 s) → 0.4 m
    h.step(1100); // another 0.1 s → 0.4 m
    // Camera starts at z=5 looking toward −z: z must have decreased.
    // (Exact distance depends on the dt cap — direction is the contract.)
    const statuses = h.statuses.join("\n");
    expect(statuses).toContain("targets");
    h.dispatch("keyup", { key: "w" });
    h.step(1116);
    expect(h.controls.update).toHaveBeenCalled();
    h.sim.dispose();
  });

  it("re-creates the HUD from the latest config on refreshHud", () => {
    const h = makeHarness();
    h.setConfig({
      distanceMin: 2,
      distanceMax: 4,
      indicatorScale: 0.5,
      imageIndicators: false,
    });
    h.sim.refreshHud();
    expect(h.hudInstances[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(h.createHudImpl).toHaveBeenCalledTimes(2);
    const options = h.createHudImpl.mock.calls[1]![0];
    expect(options.distanceMin).toBe(2);
    expect(options.indicatorScale).toBe(0.5);
    h.sim.dispose();
  });

  it("dispose cancels the loop, removes listeners, and releases resources exactly once", () => {
    const h = makeHarness();
    h.step(0);
    h.sim.dispose();
    h.sim.dispose(); // idempotent
    expect(h.scheduler.cancel).toHaveBeenCalledTimes(1);
    expect([...h.listeners.values()].flat()).toEqual([]);
    expect(h.hudInstances[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(h.controls.dispose).toHaveBeenCalledTimes(1);
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
    // A frame scheduled before dispose must be inert if it still fires.
    expect(() => h.step(50)).not.toThrow();
    expect(h.hudInstances[0]!.update).toHaveBeenCalledTimes(1);
  });

  it("clears held keys on window blur so movement never sticks", () => {
    const h = makeHarness();
    h.step(0);
    h.dispatch("keydown", { key: "w", target: null });
    h.dispatch("blur", {});
    const camera = new THREE.Vector3(0, SIM_EYE_HEIGHT, 5);
    h.step(100);
    h.step(200);
    // After blur no movement keys are held → nearest distance in the status
    // stays that of the untouched start pose.
    const nearestAtStart = SIM_WAYPOINTS.reduce(
      (min, w) => Math.min(min, camera.distanceTo(w.position)),
      Number.POSITIVE_INFINITY,
    );
    expect(h.statuses.at(-1)).toContain(`nearest ${nearestAtStart.toFixed(1)}`);
    h.sim.dispose();
  });
});
