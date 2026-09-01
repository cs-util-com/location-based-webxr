import { describe, expect, it, vi } from "vitest";
import {
  createSlamAppStore,
  recordGpsEvent,
  selectGpsPositions,
  selectZeroReference,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { RgbaImage } from "gps-plus-slam-app-framework/ar";
import type { Object3D } from "three";

import {
  CAMERA_FRAME_INTERVAL_MS,
  arButtonView,
  buildArEnableConfig,
  endTourArRuntime,
  startTourArRuntime,
  type ArEnableHooks,
  type TourArRuntimeDeps,
} from "./ar-mode";

/**
 * Why these tests matter: this module is where the QR-pose plan's M2
 * decisions become code, and every one of them fails SILENTLY when wrong:
 * - the isolation flags (camera access + texture ON, depth OFF in BOTH
 *   modes — QD-5/delta #7) gate whether camera frames exist at all; a flag
 *   flipped back to the MinimalExample defaults would leave the QR pipeline
 *   staring at nothing, with no error anywhere;
 * - `callbacks.cameraFrame` must ride into `initAR` (the frame source is
 *   constructed there and CANNOT be added later — `startCameraFrameCapture`
 *   warns-and-no-ops without it);
 * - `startSession` must be dispatched on the runtime start, because the
 *   gps-event-coordinator silently drops EVERY fix while recording is off
 *   (the framework's documented silent-drop trap, review #13) — alignment
 *   would simply never compute.
 */

function fakeHooks(): ArEnableHooks {
  return {
    container: {} as HTMLElement,
    onFrame: vi.fn(),
    onSessionEnd: vi.fn(),
    onGpsPosition: vi.fn(),
    onOrientation: vi.fn(),
  };
}

describe("buildArEnableConfig", () => {
  it("pins the M2 isolation flags: camera + texture ON, depth OFF", () => {
    const config = buildArEnableConfig(fakeHooks());

    expect(config.isolationOptions).toEqual({
      enableCameraAccess: true,
      enableDepthSensingFeature: false,
      enableCameraTextureAcquisition: true,
    });
    // Depth stays off end-to-end: no depth permission probe either.
    expect(config.requestDepth).toBeUndefined();
    // The QR flows anchor to detected codes / GPS, never to hit-test planes.
    expect(config.requestHitTest).toBeUndefined();
  });

  it("wires the camera-frame callback into the initAR callbacks", () => {
    const hooks = fakeHooks();
    const config = buildArEnableConfig(hooks);

    const image: RgbaImage = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    };
    config.callbacks?.cameraFrame?.onFrame(image);
    expect(hooks.onFrame).toHaveBeenCalledWith(image);
  });

  it("passes through session-end, GPS and orientation hooks", () => {
    const hooks = fakeHooks();
    const config = buildArEnableConfig(hooks);

    config.callbacks?.onSessionEnd?.({ requestedByApp: false });
    expect(hooks.onSessionEnd).toHaveBeenCalled();
    const gps = { latitude: 1, longitude: 2 };
    config.onGpsPosition?.(gps as never);
    expect(hooks.onGpsPosition).toHaveBeenCalledWith(gps);
    const orientation = { alpha: 1, beta: 2, gamma: 3 };
    config.onOrientation?.(orientation as never);
    expect(hooks.onOrientation).toHaveBeenCalledWith(orientation);
  });
});

describe("startTourArRuntime", () => {
  function fakeDeps(overrides: Partial<TourArRuntimeDeps> = {}): {
    deps: TourArRuntimeDeps;
    alignment: ReturnType<typeof vi.fn>;
    capture: ReturnType<typeof vi.fn>;
    worldGroup: Object3D;
  } {
    const worldGroup = { name: "fake-world-group" } as Object3D;
    const alignment = vi.fn();
    const capture = vi.fn();
    return {
      deps: {
        getArWorldGroup: () => worldGroup,
        enableArWorldGroupAlignment: alignment,
        startCameraFrameCapture: capture,
        now: () => 1234,
        ...overrides,
      },
      alignment,
      capture,
      worldGroup,
    };
  }

  it("dispatches startSession into the real recording slice (the silent-drop trap)", () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    const { deps } = fakeDeps();

    const result = startTourArRuntime(store, deps);

    expect(result.ok).toBe(true);
    const recording = store.getState().recording;
    expect(recording.isRecording).toBe(true);
    expect(recording.sessionMetadata?.contextTag).toBe("tour-viewer");
    expect(recording.sessionMetadata?.startTime).toBe(1234);
  });

  it("enables the world-group alignment binding with the store and group", () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    const { deps, alignment, worldGroup } = fakeDeps();

    startTourArRuntime(store, deps);

    expect(alignment).toHaveBeenCalledTimes(1);
    const options = alignment.mock.calls[0]?.[0] as {
      store: unknown;
      arWorldGroup: unknown;
    };
    expect(options.arWorldGroup).toBe(worldGroup);
    expect(options.store).toBe(store);
  });

  it("starts camera-frame capture at the single-cadence-owner interval", () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    const { deps, capture } = fakeDeps();

    startTourArRuntime(store, deps);

    expect(capture).toHaveBeenCalledWith({
      intervalMs: CAMERA_FRAME_INTERVAL_MS,
    });
  });

  it("fails loud (not silent) when no AR world group exists", () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    const { deps, alignment, capture } = fakeDeps({
      getArWorldGroup: () => null,
    });

    const result = startTourArRuntime(store, deps);

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/world group/i) as unknown,
    });
    // Nothing half-starts: no session, no alignment, no capture.
    expect(store.getState().recording.isRecording).toBe(false);
    expect(alignment).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("endTourArRuntime", () => {
  // Why this test matters (PR #359 review): the AR entry is re-enterable,
  // and without a teardown the first session's recording stayed open — its
  // GPS elements, anchored to the DEAD session's odom origin, then blended
  // into the next session's alignment solve. The teardown must close the
  // recording so a re-entry starts a clean session.
  it("closes the recording and stops capture, so a re-entry starts clean", () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    const { deps } = fakeDepsFor();
    startTourArRuntime(store, deps);
    expect(store.getState().recording.isRecording).toBe(true);

    // Seed a session zero + one odometry-GPS pair: the teardown must drop
    // the PAIRS (they anchor to the dead session's odometry origin) while
    // PRESERVING the zero (scene content is placed relative to it) - the
    // core resetGpsSessionData contract (M3 review #2, closed in 1.20).
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    store.dispatch(
      recordGpsEvent({
        odomPosition: [0, 0, 0],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: "fix-1",
          latitude: 47.5,
          longitude: 8.7,
          latLongAccuracy: 5,
          timestamp: 1756150000000,
        },
      }),
    );
    expect(selectGpsPositions(store.getState()).length).toBe(1);

    const stopCapture = vi.fn();
    endTourArRuntime(store, { stopCameraFrameCapture: stopCapture });

    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(store.getState().recording.isRecording).toBe(false);
    expect(selectGpsPositions(store.getState()).length).toBe(0);
    expect(selectZeroReference(store.getState())).toEqual({
      lat: 47.5,
      lon: 8.7,
    });

    // A second start must succeed and open a FRESH session.
    const second = startTourArRuntime(store, deps);
    expect(second.ok).toBe(true);
    expect(store.getState().recording.isRecording).toBe(true);
  });
});

function fakeDepsFor(): { deps: TourArRuntimeDeps } {
  const worldGroup = { name: "fake-world-group" } as Object3D;
  return {
    deps: {
      getArWorldGroup: () => worldGroup,
      enableArWorldGroupAlignment: vi.fn(),
      startCameraFrameCapture: vi.fn(),
      now: () => 1234,
    },
  };
}

describe("arButtonView", () => {
  it.each([
    ["checking", false, "Checking AR support…", true],
    ["unsupported", false, "AR not supported on this device", true],
    ["ready", false, "Start AR view", false],
    ["ready", true, "Start AR authoring", false],
    ["starting", false, "Starting…", true],
    ["running", false, "AR running", true],
    ["running", true, "Authoring in AR", true],
    ["stopping", false, "Stopping…", true],
  ] as const)(
    "%s (author=%s) → %j / disabled=%s",
    (status, authorMode, label, disabled) => {
      expect(arButtonView({ status }, authorMode)).toEqual({
        label,
        disabled,
      });
    },
  );

  it("error state offers a retry carrying the reason", () => {
    const view = arButtonView(
      { status: "error", error: "camera denied" },
      false,
    );
    expect(view.disabled).toBe(false);
    expect(view.label).toContain("camera denied");
  });
});
