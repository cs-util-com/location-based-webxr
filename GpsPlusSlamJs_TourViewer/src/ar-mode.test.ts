import { describe, expect, it, vi } from "vitest";
import {
  createSlamAppStore,
  recordGpsEvent,
  selectGpsPositions,
  selectZeroReference,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar";
import type { Object3D } from "three";

import {
  CAMERA_FRAME_INTERVAL_MS,
  arButtonView,
  visitorStep,
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
    requestHitTest: true,
    trackingStore: { dispatch: vi.fn(), getState: vi.fn() } as never,
    onFrame: vi.fn(),
    onSessionEnd: vi.fn(),
    onGpsPosition: vi.fn(),
    onOrientation: vi.fn(),
  };
}

describe("buildArEnableConfig", () => {
  // Why (QR-first M1b-1): a visitor who declined location starts AR with
  // the framework's codes-only mode; the builder is where it must reach
  // enable(), and a default entry must keep the framework's default.
  it("forwards the codes-only location mode, and leaves the default alone", () => {
    expect(
      buildArEnableConfig({ ...fakeHooks(), location: "none" }).location,
    ).toBe("none");
    expect(buildArEnableConfig(fakeHooks()).location).toBeUndefined();
  });

  // Why (follow-up F11): an origin reset is told to whoever holds raw
  // WebXR geometry (the mesh cursor's grid). The solver's half - the
  // restart dispatch - is the 2026-10-02 follow-up's, so nothing here
  // dispatches it.
  it("tells the hook when tracking restarts at a new origin, and dispatches nothing", () => {
    const onTrackingRestarted = vi.fn();
    const hooks = { ...fakeHooks(), onTrackingRestarted };
    const config = buildArEnableConfig(hooks);
    config.callbacks?.tracking?.onRestarted?.({} as never);
    expect(onTrackingRestarted).toHaveBeenCalledTimes(1);
    expect(hooks.trackingStore.dispatch).not.toHaveBeenCalled();
    expect(
      buildArEnableConfig(fakeHooks()).callbacks?.tracking?.onRestarted,
    ).toBeUndefined();
  });

  it("pins the M2 isolation flags: camera + texture ON, depth OFF", () => {
    const config = buildArEnableConfig(fakeHooks());

    expect(config.isolationOptions).toEqual({
      enableCameraAccess: true,
      enableDepthSensingFeature: false,
      enableCameraTextureAcquisition: true,
    });
    // Depth stays off end-to-end: no depth permission probe either.
    expect(config.requestDepth).toBeUndefined();
    // The hit-test feature follows the hook: a creator's session needs it
    // for the placement reticle (guided-setup plan M4), a visitor's never
    // does - the QR flows anchor to detected codes / GPS, not hit-test planes.
    expect(config.requestHitTest).toBe(true);
    expect(
      buildArEnableConfig({ ...fakeHooks(), requestHitTest: false })
        .requestHitTest,
    ).toBe(false);
  });

  it("turns depth on ONLY for a recorded entry, with the samples wired to the hook (decision D4)", () => {
    // Why: a troubleshooting recording carries depth instead of camera
    // pictures (authoring recording plan 2026-09-28-0953, D4). The feature
    // is requested at session start, so it rides in here - and without a
    // recording it must stay off, as the isolation flags above pin, so a
    // visitor never pays for it.
    expect(fakeHooks().onDepthSample).toBeUndefined();
    expect(buildArEnableConfig(fakeHooks()).callbacks?.depth).toBeUndefined();

    const onDepthSample = vi.fn();
    const config = buildArEnableConfig({ ...fakeHooks(), onDepthSample });

    expect(config.isolationOptions).toEqual({
      enableCameraAccess: true,
      enableDepthSensingFeature: true,
      enableCameraTextureAcquisition: true,
    });
    // Still no depth PERMISSION probe: that one fails the whole entry on a
    // phone without depth, where the recording should simply have none.
    expect(config.requestDepth).toBeUndefined();
    const sample = { timestamp: 1, points: [] };
    config.callbacks?.depth?.onCaptured(sample as never);
    expect(onDepthSample).toHaveBeenCalledWith(sample);
  });

  it("wires the camera-frame callback into the initAR callbacks", () => {
    const hooks = fakeHooks();
    const config = buildArEnableConfig(hooks);

    const frame: CapturedCameraFrame = {
      image: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      capturedAtMs: 0,
    };
    config.callbacks?.cameraFrame?.onFrame(frame);
    expect(hooks.onFrame).toHaveBeenCalledWith(frame);
  });

  it("carries the tracking store so initAR feeds the tracking slice (flows plan M4)", () => {
    // Why this matters: the tracking-quality phase the placement trigger
    // reads is derived from `tracking/poseReceived`, which the framework's
    // initAR dispatches ONLY into the store handed to it here. The viewer
    // had mounted the slice since its creation and never fed it - the
    // phase sat at `initializing` and quality at `ar-lost` for every
    // session (the recorder's 2026-05-23 lesson, re-learned).
    const trackingStore = { dispatch: vi.fn(), getState: vi.fn() };
    const config = buildArEnableConfig({
      ...fakeHooks(),
      trackingStore: trackingStore as never,
    });
    expect(config.callbacks?.tracking?.store).toBe(trackingStore);
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
    ["checking", "visitor", "Checking AR support…", true],
    // A visitor's phone without AR copies the link for one that has it
    // (polish round M4a, the owner's V4); a creator's says what it is.
    ["unsupported", "visitor", "Copy link", false],
    ["unsupported", "creator", "AR not supported on this device", true],
    ["ready", "visitor", "Start the tour", false],
    ["ready", "creator", "Start creating", false],
    ["starting", "visitor", "Starting…", true],
    // The way out of AR (UI round 1, U2, review F2): it used to sit there
    // disabled as "Tour running" / "Setting up in AR".
    ["running", "visitor", "Exit AR", false],
    // A creator's one way out is Done (polish round M3, Q-Done): it
    // finishes when a finish can run, else just leaves.
    ["running", "creator", "Done", false],
    ["stopping", "visitor", "Stopping…", true],
  ] as const)("%s (%s) → %j / disabled=%s", (status, mode, label, disabled) => {
    expect(arButtonView({ status }, mode)).toEqual({
      label,
      disabled,
    });
  });

  it("a creator's Done says it is saving, and after a failed finish offers to leave (polish round M3)", () => {
    // Why: Done runs the finish; while it rebuilds the zip the button
    // must say so and not take a second tap, and a finish that failed
    // (offline) must not trap the creator in AR - the button then only
    // leaves, and the panel's Finish is the retry.
    const running = { status: "running" } as const;
    const idle = { pending: false, busy: false };
    // Tappable while saving (M3 review #1): the read of a hosted zip can
    // take minutes on mobile data, and a disabled button left only the
    // back gesture; a tap leaves AR and the finish carries on.
    expect(
      arButtonView(running, "creator", idle, { running: true, failed: false }),
    ).toEqual({ label: "Saving…", disabled: false });
    expect(
      arButtonView(running, "creator", idle, { running: false, failed: true }),
    ).toEqual({ label: "Close AR", disabled: false });
    // A visitor's button never reads the finish.
    expect(
      arButtonView(running, "visitor", idle, { running: true, failed: true }),
    ).toEqual({ label: "Exit AR", disabled: false });
  });

  it("a ready visitor button asks for the location first while the gate is pending (DEC-N2)", () => {
    const pending = { pending: true, busy: false };
    expect(arButtonView({ status: "ready" }, "visitor", pending)).toEqual({
      label: "Allow location",
      disabled: false,
    });
    // While the request runs the button says so and is disabled (async-UI).
    expect(
      arButtonView({ status: "ready" }, "visitor", {
        pending: true,
        busy: true,
      }),
    ).toEqual({ label: "Getting your location…", disabled: true });
    // A creator never has a pending gate; the flag is ignored for them.
    expect(arButtonView({ status: "ready" }, "creator", pending).label).toBe(
      "Start creating",
    );
  });

  it("a visitor who left AR with progress goes 'Back to the tour' (W4 build plan M2, §1.8)", () => {
    // Why: after leaving AR the start page shows the walk's progress, and
    // the start goes back into the same walk; the same #enter-ar tap, so
    // the session keeps its user activation. Without progress, or while
    // the location is still asked, the button reads as before.
    const idle = { pending: false, busy: false };
    const noFinish = { running: false, failed: false };
    expect(
      arButtonView({ status: "ready" }, "visitor", idle, noFinish, true),
    ).toEqual({ label: "Back to the tour", disabled: false });
    expect(
      arButtonView({ status: "ready" }, "visitor", idle, noFinish, false).label,
    ).toBe("Start the tour");
    expect(
      arButtonView(
        { status: "ready" },
        "visitor",
        { pending: true, busy: false },
        noFinish,
        true,
      ).label,
    ).toBe("Allow location");
    expect(
      arButtonView({ status: "ready" }, "creator", idle, noFinish, true).label,
    ).toBe("Start creating");
    // In AR the button is the way out, whatever the progress.
    expect(
      arButtonView({ status: "running" }, "visitor", idle, noFinish, true)
        .label,
    ).toBe("Exit AR");
  });

  it("error state offers a plain retry; the reason is the status line's (UI round 1, U1, review F5)", () => {
    // Why: the label used to be "Retry - NotAllowedError: ..." - a browser
    // exception on the only button. The cause now reads in plain words in
    // the status line (`visitorStatus`), the button only says what to do.
    const view = arButtonView(
      { status: "error", error: "NotAllowedError: camera denied" },
      "visitor",
    );
    expect(view.disabled).toBe(false);
    expect(view.label).toBe("Try again");
  });
});

describe("visitorStep (polish round M4a, the owner's V4)", () => {
  // Why: a visitor's first tap only asks for the location (the browser's
  // prompt would otherwise eat the tap that starts AR, DEC-N2); V4 makes
  // that a visible "1 of 2" / "2 of 2" on the button, so the first tap
  // reads as progress, not as a tap that did nothing.
  const ready = { status: "ready" } as never;
  const idle = { pending: false, busy: false };

  it("counts the location tap as step 1 and the start as step 2", () => {
    expect(
      visitorStep("visitor", ready, { pending: true, busy: false }, false),
    ).toBe("1 of 2");
    expect(
      visitorStep("visitor", ready, { pending: true, busy: true }, true),
    ).toBe("1 of 2");
    expect(visitorStep("visitor", ready, idle, true)).toBe("2 of 2");
  });

  it("shows no step when the location was never asked, for a creator, or outside ready", () => {
    expect(visitorStep("visitor", ready, idle, false)).toBeNull();
    expect(
      visitorStep("creator", ready, { pending: true, busy: false }, true),
    ).toBeNull();
    for (const status of [
      "checking",
      "unsupported",
      "starting",
      "running",
      "error",
    ]) {
      expect(
        visitorStep(
          "visitor",
          { status } as never,
          { pending: true, busy: false },
          true,
        ),
        status,
      ).toBeNull();
    }
  });
});
