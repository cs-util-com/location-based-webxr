/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import { OSM_ATTRIBUTION } from "gps-plus-slam-osm";
import { createPreviewSession } from "./preview-session.js";
import type { PreviewSessionOptions } from "./preview-session.js";
import type {
  OsmBuildingLayer,
  OsmBuildingLayerOptions,
  OsmBuildingStatus,
} from "./osm-building-layer.js";
import type { WalkInput } from "../core/walk-simulator.js";

const ORIGIN = { lat: 48.137, lon: 11.575 };

const createOsmBuildingLayerMock =
  vi.fn<(options: OsmBuildingLayerOptions) => OsmBuildingLayer>();
vi.mock("./osm-building-layer.js", () => ({
  createOsmBuildingLayer: (options: OsmBuildingLayerOptions) =>
    createOsmBuildingLayerMock(options),
}));

function fakeRenderer() {
  const domElement = document.createElement("canvas");
  return {
    domElement,
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
  };
}

/** Hand-driven `requestAnimationFrame`: tests decide when a frame happens. */
function fakeClock() {
  let time = 0;
  let pending: ((t: number) => void) | null = null;
  return {
    now: () => time,
    raf: (callback: (t: number) => void) => {
      pending = callback;
      return 1;
    },
    cancel: vi.fn(),
    /** Run one frame `seconds` later. */
    advance(seconds: number) {
      time += seconds * 1000;
      const callback = pending;
      pending = null;
      callback?.(time);
    },
    isScheduled: () => pending !== null,
  };
}

function stubControls(input: WalkInput, yawDeltaRad = 0) {
  return {
    sample: () => ({ input, yawDeltaRad, pitchDeltaRad: 0 }),
    dispose: vi.fn(),
  };
}

/**
 * Never touches the network: real desktop previews use a live
 * `OverpassSource` (see osm-building-layer.ts), which these tests must not.
 */
function fakeOsmBuildings(): OsmBuildingLayer {
  return {
    group: new Group(),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    dispose: vi.fn<() => void>(),
    getStatus: vi.fn<() => OsmBuildingStatus>(() => "idle"),
    onStatusChange: vi.fn(() => vi.fn()),
    setEnabled: vi.fn(),
  };
}

let container: HTMLElement;

function session(overrides: Partial<PreviewSessionOptions> = {}) {
  const clock = fakeClock();
  const renderer = fakeRenderer();
  const instance = createPreviewSession({
    container,
    origin: ORIGIN,
    createRenderer: () => renderer,
    now: clock.now,
    raf: clock.raf,
    cancelRaf: clock.cancel,
    controls: stubControls({ forward: 0, strafe: 0, turn: 0 }),
    osmBuildings: fakeOsmBuildings(),
    ...overrides,
  });
  return { instance, clock, renderer };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("preview session", () => {
  it("exposes an AR-shaped runtime pinned to the tour's own origin", () => {
    const { instance } = session();

    expect(instance.runtime.getArWorldGroup()).not.toBeNull();
    expect(instance.runtime.getCamera()).not.toBeNull();
    // No WebXR here — component 8 falls back to pointer picking on the canvas.
    expect(instance.runtime.getXrSession()).toBeNull();
    expect(instance.runtime.selectZeroReference({})).toEqual(ORIGIN);
    // Identity alignment: the scene's world frame IS GPS-world NUE.
    expect(instance.runtime.selectAlignmentMatrix({})).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);

    instance.dispose();
  });

  it("walks the camera north while forward is held, and ticks the scene", () => {
    const tick = vi.fn();
    const { instance, clock } = session({
      controls: stubControls({ forward: 1, strafe: 0, turn: 0 }),
    });
    instance.runtime.registerFrameUpdate(tick);

    clock.advance(0.1);
    clock.advance(0.1);

    const pose = instance.getPose();
    expect(pose.x).toBeGreaterThan(0.2);
    expect(pose.z).toBeCloseTo(0, 5);
    // The camera IS the visitor: component 8 reads the walk off its pose.
    expect(instance.runtime.getCamera()!.position.x).toBeCloseTo(pose.x, 5);
    expect(instance.runtime.getCamera()!.position.y).toBeCloseTo(1.6, 5);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(tick.mock.calls[0]![0]).toBeCloseTo(0.1, 3);

    instance.dispose();
  });

  it("reports the walker's coordinate so the 2D map can follow", () => {
    const onPositionChange = vi.fn();
    const { instance, clock } = session({
      controls: stubControls({ forward: 1, strafe: 0, turn: 0 }),
      onPositionChange,
    });

    expect(onPositionChange).toHaveBeenCalledWith({
      lat: expect.closeTo(ORIGIN.lat, 6),
      lon: expect.closeTo(ORIGIN.lon, 6),
    });

    clock.advance(1);

    const latest = onPositionChange.mock.lastCall![0] as {
      lat: number;
      lon: number;
    };
    expect(latest.lat).toBeGreaterThan(ORIGIN.lat);

    instance.dispose();
  });

  it("walks the tour's breadcrumb by itself under autopilot", () => {
    const { instance, clock } = session({
      // 0.001° of longitude east of the origin — roughly 74 m.
      route: [ORIGIN, { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.001 }],
      controls: stubControls({ forward: 0, strafe: 0, turn: 0 }),
    });

    instance.setAutopilot(true);
    expect(instance.isAutopilot()).toBe(true);
    // 20 frames of 0.1 s — the loop clamps any longer gap, so a stalled tab
    // cannot teleport the visitor across the tour.
    for (let i = 0; i < 20; i += 1) clock.advance(0.1);

    const pose = instance.getPose();
    expect(pose.z).toBeGreaterThan(2);
    expect(pose.x).toBeCloseTo(0, 3);

    // Handing control back leaves the walker where the autopilot stopped.
    instance.setAutopilot(false);
    expect(instance.getPose()).toEqual(pose);

    instance.dispose();
  });

  it("hands out seams that track the walker it is driving", () => {
    const { instance, clock } = session({
      controls: stubControls({ forward: 1, strafe: 0, turn: 0 }),
    });

    clock.advance(0.1);

    expect(instance.seams.getUserWorldPos()!.x).toBeCloseTo(
      instance.getPose().x,
      5,
    );
    expect(instance.seams.toWorld(ORIGIN)!.x).toBeCloseTo(0, 3);

    instance.dispose();
  });

  it("loads the OSM building layer into the scene and disposes it on teardown", () => {
    const osmBuildings = fakeOsmBuildings();
    const { instance } = session({ osmBuildings });

    expect(osmBuildings.load).toHaveBeenCalledTimes(1);
    expect(osmBuildings.dispose).not.toHaveBeenCalled();

    instance.dispose();

    expect(osmBuildings.dispose).toHaveBeenCalledTimes(1);
  });

  it("shows the OSM attribution line for as long as the session is open", () => {
    const { instance } = session();

    const attribution = container.querySelector(".preview-attribution");
    expect(attribution?.textContent).toBe(OSM_ATTRIBUTION);

    instance.dispose();

    expect(container.querySelector(".preview-attribution")).toBeNull();
  });

  it("forwards osmBuildingsEnabled to createOsmBuildingLayer when no test double is given", () => {
    createOsmBuildingLayerMock.mockReturnValueOnce(fakeOsmBuildings());
    const clock = fakeClock();
    const renderer = fakeRenderer();
    const instance = createPreviewSession({
      container,
      origin: ORIGIN,
      createRenderer: () => renderer,
      now: clock.now,
      raf: clock.raf,
      cancelRaf: clock.cancel,
      controls: stubControls({ forward: 0, strafe: 0, turn: 0 }),
      osmBuildingsEnabled: false,
    });

    expect(createOsmBuildingLayerMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    instance.dispose();
  });

  it("delegates the OSM buildings status/enable methods to the underlying layer", () => {
    const osmBuildings = fakeOsmBuildings();
    const { instance } = session({ osmBuildings });

    instance.getOsmBuildingsStatus();
    expect(osmBuildings.getStatus).toHaveBeenCalled();

    const cb = vi.fn();
    instance.onOsmBuildingsStatusChange(cb);
    expect(osmBuildings.onStatusChange).toHaveBeenCalledWith(cb);

    instance.setOsmBuildingsEnabled(false);
    expect(osmBuildings.setEnabled).toHaveBeenCalledWith(false);

    instance.dispose();
  });

  it("stops the loop and gives back the canvas when disposed", () => {
    const { instance, clock, renderer } = session();

    clock.advance(0.1);
    expect(container.contains(renderer.domElement)).toBe(true);

    instance.dispose();

    expect(renderer.dispose).toHaveBeenCalled();
    expect(container.contains(renderer.domElement)).toBe(false);
    const renderCalls = renderer.render.mock.calls.length;
    clock.advance(0.1);
    expect(renderer.render.mock.calls.length).toBe(renderCalls);
  });
});
