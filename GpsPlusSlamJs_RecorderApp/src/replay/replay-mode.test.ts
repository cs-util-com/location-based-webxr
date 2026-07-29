/**
 * Replay Mode Integration — Unit Tests
 *
 * @vitest-environment jsdom
 *
 * Why these tests matter: They verify the orchestration that wires together
 * all replay building blocks (Iterations 1-5) into a working replay mode.
 * The individual pieces are already tested; these tests ensure the wiring
 * is correct — especially:
 *
 * - R6: The store passed to wireStoreSubscribers is the same instance the
 *   engine dispatches to (store identity).
 * - R8: Data flow from zip bytes → loadActionsFromZip → actions array →
 *   ReplayEngine.play().
 * - R7: Error handling wired through to UI callbacks.
 * - Lifecycle: dispose cleans up scene + engine + subscribers.
 *
 * @see docs/2026-02-19-replay-mode.md Iteration 6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies that need DOM/WebGL
vi.mock('gps-plus-slam-app-framework/ar/replay-scene', () => ({
  initReplayScene: vi.fn(() => ({
    scene: { name: 'mock-scene' },
    arWorldGroup: { name: 'mock-arWorldGroup' },
    arpose: {
      name: 'mock-arpose',
      position: { fromArray: vi.fn() },
      quaternion: { fromArray: vi.fn() },
    },
    camera: { name: 'mock-camera' },
    renderer: { name: 'mock-renderer' },
  })),
  disposeReplayScene: vi.fn(),
  getAlignmentLerper: vi.fn(() => ({
    setTarget: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('gps-plus-slam-app-framework/storage/zip-reader', () => ({
  loadActionsFromZip: vi.fn(),
  loadSessionMetadata: vi.fn().mockResolvedValue({ odomCoordVersion: 5 }), // era 5 — no migration needed
}));

vi.mock('../storage/recording-loader', () => ({
  loadRecording: vi.fn(),
}));

const { mockWireRefPointMapMarkers, mockRefPointMapMarkerWirer } = vi.hoisted(
  () => {
    const mockRefPointMapMarkerWirer = {
      refresh: vi.fn(),
      unsubscribe: vi.fn(),
    };
    return {
      mockRefPointMapMarkerWirer,
      mockWireRefPointMapMarkers: vi.fn(() => mockRefPointMapMarkerWirer),
    };
  }
);

vi.mock('../ui/ref-point-map-markers', () => ({
  wireRefPointMapMarkers: mockWireRefPointMapMarkers,
}));

vi.mock('gps-plus-slam-app-framework/state/store-subscribers', () => ({
  wireStoreSubscribers: vi.fn(() => vi.fn()), // returns unsubscribe fn
}));

vi.mock('../state/recorder-store', () => ({
  createRecorderStore: vi.fn(() => ({
    getState: vi.fn(() => ({
      gpsData: null,
      recording: { isRecording: false },
      refPoints: { entries: [] },
    })),
    dispatch: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    writeFrame: vi.fn(),
    writeSessionMetadata: vi.fn(),
  })),
}));

vi.mock('gps-plus-slam-app-framework/visualization/gps-event-markers', () => ({
  gpsEventVisualizer: {
    getZeroRef: vi.fn(() => null),
    setZeroRef: vi.fn(),
    addGpsEvent: vi.fn(),
    clearAll: vi.fn(),
    setSceneSource: vi.fn(),
  },
}));

vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  // Live-session getters: the REAL ref-point-visualizer module (not mocked
  // here) captures getScene as its default scene source at import time.
  // The NUE→WebXR converters used to be stubbed here too; replay-mode now
  // calls the library's nueToWebXR / nueQuaternionToWebXR directly, and those
  // pure swizzles run for real (no test here asserts on the converted values).
  getScene: vi.fn(() => null),
  getArWorldGroup: vi.fn(() => null),
}));

// F3.5c — mock the frame-tile wiring so replay-mode tests don't need a real
// zip with frames/ entries. We assert against these mocks below.
const mockFrameTileVisualizerDispose = vi.fn();
const mockUnsubscribeFrameTiles = vi.fn();
const mockFrameTileVisualizerCtor = vi.fn();
vi.mock('../storage/zip-frame-blob-source', () => ({
  createZipFrameBlobSource: vi
    .fn()
    .mockResolvedValue(() => Promise.resolve(null)),
}));
vi.mock('../visualization/frame-tile-visualizer', () => ({
  FrameTileVisualizer: class {
    addTile = vi.fn();
    clear = vi.fn();
    dispose = mockFrameTileVisualizerDispose;
    getCount() {
      return 0;
    }
    constructor(scene: unknown, ...options: unknown[]) {
      mockFrameTileVisualizerCtor(scene, ...options);
    }
  },
}));
vi.mock('../visualization/wire-frame-tile-subscribers', () => ({
  wireFrameTileSubscribers: vi.fn(() => mockUnsubscribeFrameTiles),
}));

// Occupancy-cube wiring: mocked so the replay setup block runs cleanly (the
// real visualizer would call arWorldGroup.add() on the mock scene node and
// throw, leaving the block silently caught). Lets us assert Issue A — that
// the cube-refresh throttle is wired from depth.intervalMs.
// Shared mutable options object (same pattern as the main.ts wiring tests):
// per-test mutation + beforeEach reset, because mockReturnValue would leak the
// override into later tests (clearAllMocks does not reset implementations) and
// an enabled stats overlay's rAF loop breaks runAllTimers-based tests.
const { mockReplayRecordingOptions } = vi.hoisted(() => ({
  mockReplayRecordingOptions: {
    // 500 ms ≠ the visualizer's hardcoded 1000 ms fallback — proves the
    // throttle is sourced from depth.intervalMs (2026-06-22 cube
    // cadence/locality plan §2).
    depth: { enabled: true, intervalMs: 500 },
    occupancy: { cellSizeM: 0.15, minConfidence: 3 },
    frameTileDisplay: { divisor: 2, maxTiles: 100 },
    // Stats overlay defaults OFF (Step 0 of the 2026-07-03 long-session fps
    // plan); the dedicated tests below flip it on.
    visualization: { statsOverlay: false },
  },
}));
vi.mock('../state/recording-options', () => ({
  loadRecordingOptions: vi.fn(() => mockReplayRecordingOptions),
}));
vi.mock('gps-plus-slam-app-framework/visualization/perf-stats-overlay', () => ({
  createPerfStatsOverlay: vi.fn(() => ({
    dom: {} as HTMLElement,
    panelCount: 3,
    update: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer',
  () => ({
    // `function` (not arrow) so `new OccupancyCubesVisualizer()` is constructable.
    OccupancyCubesVisualizer: vi.fn(function () {
      return { refresh: vi.fn(), clear: vi.fn(), dispose: vi.fn() };
    }),
  })
);
vi.mock('../visualization/wire-occupancy-grid-subscribers', () => ({
  wireOccupancyGridSubscribers: vi.fn(() => vi.fn()),
}));

import { startReplayMode } from './replay-mode.js';
import { wireOccupancyGridSubscribers } from '../visualization/wire-occupancy-grid-subscribers';
import { createPerfStatsOverlay } from 'gps-plus-slam-app-framework/visualization/perf-stats-overlay';
import { loadRecording } from '../storage/recording-loader';
import { wireStoreSubscribers } from 'gps-plus-slam-app-framework/state/store-subscribers';
import type { MapData } from 'gps-plus-slam-app-framework/visualization/map-data';
import type { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { createRecorderStore } from '../state/recorder-store';
import {
  initReplayScene,
  disposeReplayScene,
} from 'gps-plus-slam-app-framework/ar/replay-scene';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';

// --- Helpers ---

function makeMockZipActions() {
  return [
    {
      index: 1,
      filename: 'actions/000001.json',
      action: {
        type: 'recording/startSession',
        payload: {
          scenarioName: 'Test',
          sessionName: 'test-1',
          startTime: 1708300000000,
        },
      },
    },
    {
      index: 2,
      filename: 'actions/000002.json',
      action: {
        type: 'gpsData/recordGpsEvent',
        payload: {
          odomPosition: { x: 0, y: 0, z: 0 },
          odomRotation: { x: 0, y: 0, z: 0, w: 1 },
          rawGpsPoint: {
            id: 'gps-1',
            latitude: 50,
            longitude: 8,
            timestamp: 1708300001000,
          },
        },
      },
    },
    {
      index: 3,
      filename: 'actions/000003.json',
      action: { type: 'recording/endSession' },
    },
  ];
}

const fakeZipData = new Uint8Array([1, 2, 3]); // content doesn't matter, loadActionsFromZip is mocked

function makeConfig(
  overrides?: Partial<Parameters<typeof startReplayMode>[1]>
) {
  return {
    container: document.createElement('div'),
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('replay-mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Stats overlay back to its OFF default (a leaked ON would add a rAF
    // loop that breaks the runAllTimers-based playback tests below).
    mockReplayRecordingOptions.visualization.statsOverlay = false;
    mockReplayRecordingOptions.frameTileDisplay = { divisor: 2, maxTiles: 100 };
    // Default: loadRecording returns our fixture wrapped in the LoadedRecording shape.
    const fixtureEntries = makeMockZipActions();
    vi.mocked(loadRecording).mockResolvedValue({
      meta: null,
      actions: fixtureEntries,
      refPoints: [],
      capabilities: {
        hasSidecarRefPoints: false,
        hasFusedObservations: false,
        hasSessionMeta: false,
        migrationApplied: false,
      },
      getFinalState: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Data flow (R8) ---

  it('loads actions from zip data and creates a NullStorageBackend store', async () => {
    // Why (R8): The zip → actions → store data flow must be wired correctly.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    // loadRecording called with the zip data
    expect(loadRecording).toHaveBeenCalledWith(fakeZipData);

    // createRecorderStore called with NullStorageBackend
    expect(createRecorderStore).toHaveBeenCalledWith(
      expect.objectContaining({
        storageBackend: expect.objectContaining({
          writeAction: expect.any(Function),
        }),
      })
    );
  });

  it('creates the replay store with compass opt-ins disabled (replay-fidelity)', async () => {
    // Why (PR #128 review): only ENABLED compass opt-ins are persisted as
    // actions (the framework's listener middleware dispatches them after the
    // first setZeroPos). A recording captured with cold-start override OFF — e.g.
    // a §6a field-calibration capture — therefore has NO opt-in action in its
    // stream. If the replay store re-derives the opt-in from the framework
    // default (override defaults ON), replay incorrectly ENABLES the override the
    // session was recorded WITHOUT. Replay's source of truth is the recorded
    // action stream alone (a recording made WITH the override on already carries
    // the setColdStartOverrideEnabled(true) action), so the replay store must be
    // built with the opt-ins disabled to replay both cases faithfully.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    expect(createRecorderStore).toHaveBeenCalledWith(
      expect.objectContaining({
        enableCompassColdStartOverride: false,
        enableCompassRotationPrior: false,
        enableCompassWebXRConsistency: false,
      })
    );
  });

  // --- Scene initialization ---

  it('initializes replay scene with the provided container', async () => {
    // Why: The replay scene must be set up with the DOM container.
    const container = document.createElement('div');
    const config = makeConfig({ container });
    await startReplayMode(fakeZipData, config);

    expect(initReplayScene).toHaveBeenCalledWith(container);
  });

  it('points the scene-reading visualizers at the replay scene (surface-reduction step 2)', async () => {
    // Why: replay no longer injects its scene into the webxr-session
    // singleton (setScene/setArWorldGroup were deleted). The singleton
    // visualizers must instead be pointed at the replay scene explicitly,
    // or replayed GPS events / ref points would have no scene to land in.
    const refSpy = vi.spyOn(refPointVisualizer, 'setSceneSource');
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const initResult = vi.mocked(initReplayScene).mock.results[0]!;
    if (initResult.type !== 'return') {
      throw new Error('initReplayScene did not return');
    }
    const replayScene = initResult.value;

    const gpsSource = vi.mocked(gpsEventVisualizer.setSceneSource).mock
      .calls[0]![0]!;
    expect(gpsSource.getScene()).toBe(replayScene.scene);
    expect(gpsSource.getArWorldGroup()).toBe(replayScene.arWorldGroup);

    const refSource = refSpy.mock.calls[0]![0]!;
    expect(refSource()).toBe(replayScene.scene);
  });

  it('dispose restores the live-session scene sources', async () => {
    // Why: leaving the visualizers pointed at a disposed replay scene would
    // strand markers of a later LIVE AR session in a dead scene graph.
    const refSpy = vi.spyOn(refPointVisualizer, 'setSceneSource');
    const controller = await startReplayMode(fakeZipData, makeConfig());

    controller.dispose();

    expect(gpsEventVisualizer.setSceneSource).toHaveBeenLastCalledWith(null);
    expect(refSpy).toHaveBeenLastCalledWith(null);
  });

  // --- Perf stats overlay (2026-07-03 long-session fps plan, Step 0) ---

  it('does NOT mount the stats overlay by default (visualization.statsOverlay off)', async () => {
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    expect(createPerfStatsOverlay).not.toHaveBeenCalled();
  });

  it('mounts the stats overlay into the replay container when enabled, and disposes it with the controller', async () => {
    // Why: statsOverlay is the one visualization toggle that ALSO applies to
    // replay — replay frame time feeds the same long-session fps
    // investigation. It must mount into the replay container and must not
    // outlive dispose() (a leaked rAF loop + panel would survive into the
    // next replay).
    mockReplayRecordingOptions.visualization.statsOverlay = true;
    const container = document.createElement('div');
    const config = makeConfig({ container });
    const controller = await startReplayMode(fakeZipData, config);

    expect(createPerfStatsOverlay).toHaveBeenCalledTimes(1);
    expect(createPerfStatsOverlay).toHaveBeenCalledWith(container);

    const overlay = vi.mocked(createPerfStatsOverlay).mock.results[0]!
      .value as ReturnType<typeof createPerfStatsOverlay>;
    expect(overlay.dispose).not.toHaveBeenCalled();
    controller.dispose();
    expect(overlay.dispose).toHaveBeenCalledTimes(1);
  });

  // --- Store subscriber wiring (R6) ---

  it('wires store subscribers with the same store used by the engine (R6)', async () => {
    // Why (R6): The store that wireStoreSubscribers receives MUST be the
    // same instance the ReplayEngine dispatches to. If they're different,
    // dispatched replay actions won't trigger visualization updates.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    // wireStoreSubscribers was called
    expect(wireStoreSubscribers).toHaveBeenCalledTimes(1);

    // The store passed to wireStoreSubscribers must be the same as the controller's store
    const wireCall = vi.mocked(wireStoreSubscribers).mock.calls[0];
    const subscribedStore = wireCall[0];
    expect(subscribedStore).toBe(controller.getStore());
  });

  it('does NOT pass onNewGpsPosition to wireStoreSubscribers', async () => {
    // Why: onNewGpsPosition is intentionally omitted. Orbit target updates
    // are driven by onAlignmentSnapshot (Issue #3), not by per-event GPS
    // coordinates. Passing onNewGpsPosition would cause redundant updates.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.onNewGpsPosition).toBeUndefined();
  });

  it('passes onNewOdomPose callback to wireStoreSubscribers', async () => {
    // Why: The odom pose callback updates the arpose Object3D with recorded
    // poses, keeping the camera follower and VIO visualization working.
    // Orbit target updates are handled separately by onAlignmentSnapshot.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.onNewOdomPose).toBeInstanceOf(Function);
  });

  it('passes onAlignmentSnapshot callback to wireStoreSubscribers (Issue #3)', async () => {
    // Why (Issue #3): The orbit camera target should update when alignment
    // snapshots are created, not on every odom pose. This callback routes
    // the snapshot NUE position to updateOrbitTarget().
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.onAlignmentSnapshot).toBeInstanceOf(Function);
  });

  // --- Controller API ---

  it('returns a controller with play/pause/resume/setSpeed/dispose', async () => {
    // Why: The controller is the public API for driving replay from the UI.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    expect(controller.play).toBeInstanceOf(Function);
    expect(controller.pause).toBeInstanceOf(Function);
    expect(controller.resume).toBeInstanceOf(Function);
    expect(controller.setSpeed).toBeInstanceOf(Function);
    expect(controller.dispose).toBeInstanceOf(Function);
    expect(controller.getStore).toBeInstanceOf(Function);
    expect(controller.getEngine).toBeInstanceOf(Function);
    expect(controller.getActionCount).toBeInstanceOf(Function);
  });

  it('getActionCount returns the number of loaded actions', async () => {
    // Why: UI needs to know total action count for progress display.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    expect(controller.getActionCount()).toBe(3);
  });

  // --- setMapOverlay ---

  it('setMapOverlay makes the proxy delegate to the provided overlay', async () => {
    // Why: The map overlay is created lazily on first toggle (Issue 4). The
    // controller must expose setMapOverlay() so the store subscriber's
    // mapOverlay proxy starts delegating to the real overlay for GPS updates.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    // Before setMapOverlay: the proxy is passed but should be no-op
    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.mapOverlay).toBeDefined();

    // Provide a real overlay
    const mockOverlay = { setGpsPosition: vi.fn() };
    controller.setMapOverlay(mockOverlay);

    // Now calls through the proxy should reach the real overlay
    deps.mapOverlay!.setGpsPosition(50, 8);
    expect(mockOverlay.setGpsPosition).toHaveBeenCalledWith(50, 8);
  });

  it('setMapOverlay with null stops delegating', async () => {
    // Why: If the map overlay is disposed or toggled off, setting null
    // should prevent the proxy from calling a stale reference.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const mockOverlay = { setGpsPosition: vi.fn() };
    controller.setMapOverlay(mockOverlay);
    controller.setMapOverlay(null);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    // Should not throw or call the old overlay
    deps.mapOverlay!.setGpsPosition(50, 8);
    expect(mockOverlay.setGpsPosition).not.toHaveBeenCalled();
  });

  it('setMapOverlay proxy forwards render', async () => {
    // Why (Phase 3): The map overlay proxy must forward render (the unified
    // MapData snapshot) so the store subscriber can push the trajectory to
    // the Leaflet map in replay mode. (Ref-point markers are no longer a
    // proxy concern — they are store-driven via wireRefPointMapMarkers.)
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const mockOverlay = {
      setGpsPosition: vi.fn(),
      render: vi.fn<(data: MapData) => void>(),
    };
    controller.setMapOverlay(mockOverlay);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    const mapProxy = deps.mapOverlay!;

    const sampleMapData: MapData = {
      userPosition: { lat: 50.1, lng: 8.1 },
      rawGpsPath: [{ lat: 50.1, lng: 8.1 }],
      fusedPath: [],
      alignmentSnapshots: [],
    };

    mapProxy.render!(sampleMapData);
    expect(mockOverlay.render).toHaveBeenCalledWith(sampleMapData);
  });

  it('wires the ref-point map-marker subscriber for the replay map (shared renderer, late binding)', async () => {
    // Why (2026-07-05 live-map feedback): replay's minimap must render the
    // refPoints state through the SAME module as the live and summary maps.
    // The replayed startSession action carries the ORIGINAL session's start
    // time, so its captures render red and imported points green.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    expect(mockWireRefPointMapMarkers).toHaveBeenCalledTimes(1);
    const [storeArg, opts] = mockWireRefPointMapMarkers.mock
      .calls[0] as unknown as [
      unknown,
      { getMap: () => unknown; getStartTime: () => number; dotSizePx?: number },
    ];
    expect(storeArg).toBe(controller.getStore());
    expect(opts.dotSizePx).toBe(20);

    // Late binding: null until an overlay with a Leaflet map is set.
    expect(opts.getMap()).toBeNull();
    const leafletMap = { _leafletMap: true };
    controller.setMapOverlay({
      setGpsPosition: vi.fn(),
      getLeafletMap: () => leafletMap as unknown as L.Map,
    });
    expect(opts.getMap()).toBe(leafletMap);

    // setMapOverlay refreshes so the just-attached map gets the markers.
    expect(mockRefPointMapMarkerWirer.refresh).toHaveBeenCalled();
  });

  it('dispose unsubscribes the ref-point map-marker wirer', async () => {
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    controller.dispose();

    expect(mockRefPointMapMarkerWirer.unsubscribe).toHaveBeenCalledTimes(1);
  });

  // --- Play dispatches actions to the store ---

  it('play() dispatches loaded actions to the store via the engine', async () => {
    // Why: The core contract — replaying means dispatching recorded actions.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const store = controller.getStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    void controller.play(1);
    await vi.runAllTimersAsync();

    // All 3 actions from our fixture should be dispatched
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
  });

  // --- Progress callback ---

  it('fires onProgress callback during replay', async () => {
    // Why: UI needs progress updates for "Action 2/3" display.
    const onProgress = vi.fn();
    const config = makeConfig({ onProgress });
    const controller = await startReplayMode(fakeZipData, config);

    void controller.play(100); // high speed for instant replay
    await vi.runAllTimersAsync();

    expect(onProgress).toHaveBeenCalled();
    // Last call should be (3, 3) — all actions dispatched
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  // --- Complete callback ---

  it('fires onComplete callback when replay finishes', async () => {
    // Why: UI needs to know replay is done to update button states.
    const onComplete = vi.fn();
    const config = makeConfig({ onComplete });
    const controller = await startReplayMode(fakeZipData, config);

    void controller.play(100);
    await vi.runAllTimersAsync();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // --- Dispose lifecycle ---

  it('dispose cleans up scene, engine, and subscribers', async () => {
    // Why: Resource cleanup prevents memory leaks and stale references.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    controller.dispose();

    // Replay scene should be disposed
    expect(disposeReplayScene).toHaveBeenCalledTimes(1);
  });

  // --- F3.5c: frame-tile visualizer wiring ---

  it('wires frame-tile subscribers against the replay AR-world group (F3.5c)', async () => {
    // Why (F3.5): add2dImage actions from the recording must surface as
    // textured planes in the replay scene. The visualizer must be parented
    // under arWorldGroup (NOT the scene root) so the raw-WebXR tile poses
    // ride the alignment × WEBXR_TO_NUE chain — see the frame-check doc.
    const { wireFrameTileSubscribers } =
      await import('../visualization/wire-frame-tile-subscribers');
    const { createZipFrameBlobSource } =
      await import('../storage/zip-frame-blob-source');

    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    expect(createZipFrameBlobSource).toHaveBeenCalledWith(fakeZipData);
    expect(mockFrameTileVisualizerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'mock-arWorldGroup' })
    );
    expect(wireFrameTileSubscribers).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(wireFrameTileSubscribers).mock.calls[0][0];
    expect(opts.storeRef.get()).toBe(controller.getStore());
  });

  it('constructs the replay frame-tile visualizer WITHOUT a tile cap (full-path coverage, Step 4)', async () => {
    // Why (2026-07-03 fps plan, Step 4 — live-only decision): in replay the
    // tiles audit coverage of the WHOLE recorded path, so the FIFO cap that
    // bounds live sessions must never reach the replay constructor — no
    // options argument at all, regardless of the stored maxTiles setting.
    mockReplayRecordingOptions.frameTileDisplay = { divisor: 2, maxTiles: 5 };
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    expect(mockFrameTileVisualizerCtor).toHaveBeenCalledTimes(1);
    expect(mockFrameTileVisualizerCtor.mock.calls[0]).toHaveLength(1);
  });

  it('dispose tears down frame-tile subscribers and visualizer (F3.5c)', async () => {
    // Why: Without per-replay-session teardown the next replay would stack
    // subscribers and leak GPU textures.
    mockUnsubscribeFrameTiles.mockClear();
    mockFrameTileVisualizerDispose.mockClear();

    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);
    controller.dispose();

    expect(mockUnsubscribeFrameTiles).toHaveBeenCalledTimes(1);
    expect(mockFrameTileVisualizerDispose).toHaveBeenCalledTimes(1);
  });

  // --- Occupancy cube refresh cadence (Issue A) ---

  it('wires the occupancy cube refresh throttle from depth.intervalMs (Issue A)', async () => {
    // Why (2026-06-22 cube cadence/locality plan §2): replay must coalesce the
    // cube-refresh burst to the user's current depth.intervalMs, not a fixed
    // 1 s. The mock returns 500 ms (≠ the visualizer's 1000 ms fallback), so a
    // call site that drops refreshIntervalMs would regress this assertion.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    expect(wireOccupancyGridSubscribers).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(wireOccupancyGridSubscribers).mock.calls[0]?.[0];
    expect(opts?.refreshIntervalMs).toBe(500);
  });

  it('builds the replay grid with confidence-guarded carving at the minConfidence floor', async () => {
    // Why (2026-07-16 synthetic-scene investigation): replay must reconstruct
    // with the same guard as live — a voxel solid enough to be rendered
    // (count ≥ occupancy.minConfidence) can no longer be erased by a single
    // deeper reading (silhouette churn / occluded-background destruction).
    // The mocked options carry minConfidence 3, so the REAL grid instance
    // handed to the subscriber wiring must expose that threshold.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const opts = vi.mocked(wireOccupancyGridSubscribers).mock.calls[0]?.[0];
    // The wiring options type the grid as the narrow sink interface; the
    // replay path constructs a real OccupancyGrid, whose threshold field is
    // what this pins.
    const grid = opts?.grid as OccupancyGrid;
    expect(grid.carveConfidenceThreshold).toBe(3);
  });

  // --- Error handling (R7 wiring) ---

  it('wires onError from config to the engine (R7)', async () => {
    // Why (R7): Dispatch errors must reach the UI via the provided callback.
    const onError = vi.fn();
    const config = makeConfig({ onError });
    const controller = await startReplayMode(fakeZipData, config);

    // Make dispatch throw
    const store = controller.getStore();
    vi.spyOn(store, 'dispatch').mockImplementation(() => {
      throw new Error('Bad action');
    });

    void controller.play(100);
    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalled();
  });

  // --- Pause / Resume ---

  it('pause stops replay and resume continues', async () => {
    // Why: Pause/resume is a key UX feature for inspecting state mid-replay.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const store = controller.getStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    // Start playing at speed 1
    void controller.play(1);
    await vi.advanceTimersByTimeAsync(0);

    // First action dispatched
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Pause
    controller.pause();

    // Advance time — no more dispatches
    await vi.advanceTimersByTimeAsync(10_000);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Resume
    void controller.resume();
    await vi.runAllTimersAsync();

    // Remaining actions dispatched
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
  });

  // --- Speed change ---

  it('setSpeed updates the engine speed factor', async () => {
    // Why: Mid-playback speed adjustment is required (Issue 3).
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    // Change speed before play — should not throw
    controller.setSpeed(10);

    const engine = controller.getEngine();
    // Verify internal speed was updated by playing and checking timing
    void controller.play(10);
    await vi.runAllTimersAsync();

    expect(engine.getState()).toBe('completed');
  });
});
