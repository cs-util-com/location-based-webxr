/**
 * @vitest-environment jsdom
 */
import {
  AudioContext as ThreeAudioContext,
  Group,
  Matrix4,
  PerspectiveCamera,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sampleTour } from "../../store/fixtures/sample-tour.js";
import { loadTour } from "../../store/tour-slice.js";
import { createViewingStore } from "../../store/viewing-store.js";
import type { AssetProvider } from "../../store/types.js";
import type { ArSeams } from "./ar-seams.js";
import {
  resolveTargetRayMatrix,
  startArScene,
  type ArRuntime,
} from "./ar-scene-runtime.js";

function fakeAudioContext() {
  const context = {
    state: "running" as const,
    destination: {},
    createGain: vi.fn(),
  };
  context.createGain.mockImplementation(() => ({
    context,
    connect: vi.fn(),
    gain: { value: 1 },
  }));
  return context as unknown as AudioContext;
}

afterEach(() => {
  ThreeAudioContext.setContext(undefined as unknown as AudioContext);
});

describe("startArScene", () => {
  it("refreshes the seams each frame before anything created by the scene ticks", () => {
    // The anchors register on the same frame loop when the scene adopts the
    // tour, so the refresh must be registered first to run before them.
    const log: string[] = [];
    const frameUpdates: ((dt: number, elapsed: number) => void)[] = [];
    const store = createViewingStore();
    store.dispatch(loadTour(sampleTour));
    const seams: ArSeams = {
      createAnchor: vi.fn(() => {
        log.push("createAnchor");
        return {
          isFullyAnchored: false,
          setGpsPoint: vi.fn(),
          markMovedExternally: vi.fn(),
          dispose: vi.fn(),
        };
      }),
      toWorld: vi.fn(() => null),
      getUserWorldPos: vi.fn(() => {
        log.push("getUserWorldPos");
        return new Vector3();
      }),
      update: vi.fn(() => {
        log.push("update");
      }),
    };
    const runtime: ArRuntime = {
      getArWorldGroup: () => new Group(),
      getCamera: () => new PerspectiveCamera(),
      getXrSession: () => null,
      getXrReferenceSpace: () => null,
      enableArWorldGroupAlignment: () => ({ dispose: vi.fn() }),
      registerFrameUpdate: (fn) => {
        log.push("registerFrameUpdate");
        frameUpdates.push(fn);
        return vi.fn();
      },
      selectAlignmentMatrix: () => null,
      selectZeroReference: () => null,
    };
    const assetProvider: AssetProvider = {
      getAssetUrl: vi.fn(() => new Promise<string>(() => {})),
      release: vi.fn(),
    };

    startArScene({
      store,
      assetProvider,
      audioContext: fakeAudioContext(),
      runtime,
      seams,
      domElement: document.createElement("canvas"),
    });
    expect(log.indexOf("registerFrameUpdate")).toBeLessThan(
      log.indexOf("createAnchor"),
    );

    log.length = 0;
    for (const update of frameUpdates) update(0.016, 1);
    expect(log[0]).toBe("update");
    expect(log).toContain("getUserWorldPos");
  });
});

describe("resolveTargetRayMatrix", () => {
  const event = (matrix: number[]) => ({
    inputSource: { targetRaySpace: {} },
    frame: { getPose: () => ({ transform: { matrix } }) },
  });

  it("lifts the WebXR-space ray through the camera's parent into scene space", () => {
    const world = new Group();
    world.position.set(10, 0, 0);
    const arpose = new Group();
    world.add(arpose);
    const camera = new PerspectiveCamera();
    arpose.add(camera);
    const pose = new Matrix4().makeTranslation(0, 0, -1).toArray();

    const out = resolveTargetRayMatrix(event(pose), {}, camera, new Matrix4());

    const origin = new Vector3().setFromMatrixPosition(out as Matrix4);
    expect(origin.toArray()).toEqual([10, 0, -1]);
  });

  it("returns null without a frame or reference space", () => {
    const camera = new PerspectiveCamera();
    const noFrame = { inputSource: { targetRaySpace: {} } };
    expect(
      resolveTargetRayMatrix(noFrame, {}, camera, new Matrix4()),
    ).toBeNull();
    expect(
      resolveTargetRayMatrix(event([]), null, camera, new Matrix4()),
    ).toBeNull();
  });
});
