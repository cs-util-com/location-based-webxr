/**
 * @vitest-environment jsdom
 *
 * The depth pipeline's WIRING into the session lifecycle — spied, not real.
 *
 * Why this is a separate file from `ar-mode.test.ts`: that file keeps the
 * REAL `ar-depth-pipeline` so its full-chain test exercises the genuine fold →
 * floor → offset path, and `vi.mock` is file-wide — one file cannot have both.
 * What only a spy pipeline can see is the wiring itself: that every captured
 * sample reaches `fold`, and that `clear` runs in the SAME callback that
 * re-bases the odometry. Both failures are silent — a grid nobody feeds
 * estimates nothing forever, and a grid nobody clears keeps cells from a dead
 * odometry frame, which produces a plausible-looking WRONG floor inside the
 * estimator's acceptance band (plan §2.4).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

const mocks = vi.hoisted(() => ({
  initAR: vi.fn<(...args: unknown[]) => Promise<void>>(),
  endARSession: vi.fn(),
  getScene: vi.fn(),
  getArWorldGroup: vi.fn(),
  getCamera: vi.fn(),
  getRenderer: vi.fn(),
  getCurrentArPose: vi.fn(),
  startDepthCapture: vi.fn(),
  registerXrFrameUpdate: vi.fn(),
  enableArWorldGroupAlignment: vi.fn(),
  pipeline: {
    grid: {},
    fold: vi.fn(),
    clear: vi.fn(),
  },
  createArDepthPipeline: vi.fn(),
}));

vi.mock("gps-plus-slam-app-framework/ar", () => ({
  initAR: mocks.initAR,
  endARSession: mocks.endARSession,
  getScene: mocks.getScene,
  getArWorldGroup: mocks.getArWorldGroup,
  getCamera: mocks.getCamera,
  getRenderer: mocks.getRenderer,
  getCurrentArPose: mocks.getCurrentArPose,
  startDepthCapture: mocks.startDepthCapture,
  registerXrFrameUpdate: mocks.registerXrFrameUpdate,
}));
vi.mock("gps-plus-slam-app-framework/visualization", () => ({
  enableArWorldGroupAlignment: mocks.enableArWorldGroupAlignment,
}));
// The real action creator runs the library's licence check when invoked
// outside a licensed store — irrelevant to the wiring under test here, where
// only "dispatch was called" matters.
vi.mock("gps-plus-slam-app-framework/core", () => ({
  odometryTrackingRestarted: (payload: unknown) => ({
    type: "odometry/trackingRestarted",
    payload,
  }),
}));
vi.mock("./ar-depth-pipeline.js", () => ({
  AR_DEPTH_SAMPLER_CONFIG: { intervalMs: 200, gridSize: 24, rgb: false },
  createArDepthPipeline: mocks.createArDepthPipeline,
}));

import { startArMode, type ArModeDeps } from "./ar-mode.js";

const scene = new THREE.Scene();
const arWorldGroup = new THREE.Group();

const COLOGNE = { lat: 50.9413, lon: 6.9583 };

function deps(overrides: Partial<ArModeDeps> = {}): ArModeDeps {
  return {
    container: document.createElement("div"),
    store: {
      getState: () => ({}),
      subscribe: () => () => undefined,
      dispatch: vi.fn(),
    },
    buildingView: {
      localRoot: new THREE.Scene(),
      attachContentTo: () => undefined,
      setArShellMaterial: () => undefined,
    } as unknown as ArModeDeps["buildingView"],
    origin: COLOGNE,
    sceneAnchor: { lat: 50.9423, lng: 6.9593 },
    enuFrameAt: () => ({ toEnu: () => ({ x: 0, y: 0 }) }),
    onError: vi.fn(),
    autoElevation: { terrainHeightM: () => 100 },
    ...overrides,
  } as ArModeDeps;
}

/** The callbacks handed to initAR, typed to what this file reaches into. */
const sessionCallbacks = () =>
  mocks.initAR.mock.calls[0]?.[3] as {
    depth?: { onCaptured: (sample: unknown) => void };
    tracking: { onRestarted: (payload: unknown) => void };
  };

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  mocks.initAR.mockResolvedValue(undefined);
  mocks.getScene.mockReturnValue(scene);
  mocks.getArWorldGroup.mockReturnValue(arWorldGroup);
  mocks.getCamera.mockReturnValue(
    new THREE.PerspectiveCamera(70, 1, 0.01, 200),
  );
  mocks.getRenderer.mockReturnValue(null);
  mocks.getCurrentArPose.mockReturnValue(null);
  mocks.registerXrFrameUpdate.mockReturnValue(() => undefined);
  mocks.enableArWorldGroupAlignment.mockReturnValue({ dispose: vi.fn() });
  mocks.createArDepthPipeline.mockReturnValue(mocks.pipeline);
});

describe("the depth pipeline wiring", () => {
  it("folds every captured depth sample into the session grid", async () => {
    await startArMode(deps());

    const sample = { timestamp: 1, points: [] };
    sessionCallbacks().depth?.onCaptured(sample);

    expect(mocks.pipeline.fold).toHaveBeenCalledWith(sample);
  });

  it("clears the grid in the SAME callback that re-bases the odometry", async () => {
    // After `odometryTrackingRestarted` the frame the cells were measured in
    // no longer exists. The clear and the dispatch are ONE event, wired in one
    // place, so they cannot drift apart.
    const d = deps();
    await startArMode(d);

    sessionCallbacks().tracking.onRestarted({ some: "payload" });

    expect(mocks.pipeline.clear).toHaveBeenCalledTimes(1);
    // And the dispatch still happens — the clear must never replace it.
    expect(d.store.dispatch).toHaveBeenCalledTimes(1);
  });

  it("creates no pipeline at all without the autoElevation dep (kill switch)", async () => {
    const d = deps({ autoElevation: undefined });
    await startArMode(d);

    expect(mocks.createArDepthPipeline).not.toHaveBeenCalled();
    expect(sessionCallbacks().depth).toBeUndefined();
    // And a restart still dispatches, exactly as before the feature existed.
    sessionCallbacks().tracking.onRestarted({ some: "payload" });
    expect(d.store.dispatch).toHaveBeenCalledTimes(1);
  });
});
