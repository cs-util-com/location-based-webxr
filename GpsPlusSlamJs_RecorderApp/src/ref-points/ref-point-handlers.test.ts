/**
 * Ref-Point Handlers Tests
 *
 * Why these tests matter:
 * The ref-point handlers module encapsulates all reference-point state and
 * event handlers extracted from main.ts (Finding #7 — main.ts decomposition,
 * Step 2). These tests verify each handler's behavior in isolation, ensuring
 * the extraction preserves the exact same behavior as the original.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Vector3,
  Quaternion,
  GpsPoint,
} from 'gps-plus-slam-app-framework/core';
import type { ARPose } from 'gps-plus-slam-app-framework/types/ar-types';
import type * as StoreModule from '../state/recorder-store';
import type { RecorderStore } from '../state/recorder-store';
import type {
  RefPointObservation,
  RefPointMark,
} from '../storage/ref-point-loader';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockGetCurrentArPose,
  mockGetCurrentScenarioHandle,
  mockListRefPointIds,
  mockShowRefPointPicker,
  mockSaveRefPointObservation,
  mockExtractOdomPosition,
  mockExtractOdomRotation,
  mockShowError,
  mockUpdateStatus,
  mockShowToast,
  mockIsRefPointPickerVisible,
  mockCalcGpsCoords,
  mockFusedGpsFromOdom,
} = vi.hoisted(() => ({
  mockGetCurrentArPose: vi.fn<() => ARPose | null>().mockReturnValue(null),
  mockGetCurrentScenarioHandle: vi
    .fn<() => FileSystemDirectoryHandle | null>()
    .mockReturnValue(null),
  mockListRefPointIds: vi
    .fn<(h: FileSystemDirectoryHandle) => Promise<string[]>>()
    .mockResolvedValue([]),
  mockShowRefPointPicker: vi
    .fn<
      (
        ids: string[],
        usage: Map<string, number>
      ) => Promise<{ id: string; isNew: boolean } | null>
    >()
    .mockResolvedValue(null),
  mockSaveRefPointObservation: vi.fn().mockResolvedValue(undefined),
  mockExtractOdomPosition: vi
    .fn<(pose: ARPose) => Vector3>()
    .mockReturnValue([1, 2, 3] as Vector3),
  mockExtractOdomRotation: vi
    .fn<(pose: ARPose) => Quaternion>()
    .mockReturnValue([0, 0, 0, 1] as Quaternion),
  mockShowError: vi.fn(),
  mockUpdateStatus: vi.fn(),
  mockShowToast: vi.fn(),
  mockIsRefPointPickerVisible: vi.fn<() => boolean>().mockReturnValue(false),
  mockCalcGpsCoords: vi.fn().mockReturnValue({ lat: 49.123, lon: 8.456 }),
  mockFusedGpsFromOdom: vi.fn().mockReturnValue({ lat: 49.123, lon: 8.456 }),
}));

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  getCurrentArPose: mockGetCurrentArPose,
}));

vi.mock('../storage/scenario-storage', () => ({
  getCurrentScenarioHandle: mockGetCurrentScenarioHandle,
}));

vi.mock('gps-plus-slam-app-framework/utils/fused-path', () => ({
  fusedGpsFromOdom: mockFusedGpsFromOdom,
}));

vi.mock('../state/recorder-store', async () => {
  const actual: typeof StoreModule = await vi.importActual(
    '../state/recorder-store'
  );
  return {
    ...actual,
  };
});

vi.mock('../storage/ref-point-loader', () => ({
  listRefPointIds: mockListRefPointIds,
  saveRefPointObservation: mockSaveRefPointObservation,
}));

vi.mock('../ui/ref-point-picker', () => ({
  showRefPointPicker: mockShowRefPointPicker,
  isRefPointPickerVisible: mockIsRefPointPickerVisible,
  cancelRefPointPicker: vi.fn(),
  createRefPointPickerHtml: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/state/gps-event-coordinator', () => ({
  extractOdomPosition: mockExtractOdomPosition,
  extractOdomRotation: mockExtractOdomRotation,
}));

vi.mock('../ui/hud', () => ({
  showError: mockShowError,
  updateStatus: mockUpdateStatus,
}));

vi.mock('../ui/toast', () => ({
  showToast: mockShowToast,
  initToast: vi.fn(),
  TOAST_DURATION_ERROR: 8000,
}));

vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import {
  createRefPointHandlers,
  type RefPointHandlers,
  type RefPointHandlersDeps,
} from './ref-point-handlers';
import {
  refPointsReducer,
  addRefPointEntry,
  setImportedRefPointEntries,
  type RefPointEntry,
} from '../state/ref-points-slice';
import { gpsToH3 } from 'gps-plus-slam-app-framework/geo/h3-proximity';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Module-level reference to the store created by the most recent
 * `createMockStore()` call. Lets `seedImportedRefPoints` dispatch the
 * V2 sidecar action without each test having to thread the store
 * through. Set as a side effect of `createMockStore` below.
 */
let lastTestStore: RecorderStore | null = null;

/**
 * Test-only helper: seed the `refPoints` slice with sidecar-imported
 * known anchors. Replaces the removed `handlers.setImportedRefPoints`
 * convenience after 5.7a-3 Option C collapsed the legacy slice.
 */
function seedImportedRefPoints(refPoints: ImportedRefPoint[]): void {
  if (!lastTestStore) {
    throw new Error(
      'seedImportedRefPoints: no test store has been created yet'
    );
  }
  const entries = refPoints.map((rp) => importedToEntry(rp, Date.now()));
  lastTestStore.dispatch(setImportedRefPointEntries(entries));
}

/**
 * The seed shape the removed `storage/ref-point-importer.ts` used to produce
 * (deleted 2026-09-04: zero production callers). Kept local to the tests that
 * still seed the V2 slice with it.
 */
interface ImportedRefPoint {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly alt?: number;
  readonly sourceZipName: string;
}

function importedToEntry(rp: ImportedRefPoint, ts: number): RefPointEntry {
  return {
    id: gpsToH3(rp.lat, rp.lon),
    timestamp: ts,
    name: rp.name,
    rawGpsPoint: {
      id: `gps-${rp.id}`,
      latitude: rp.lat,
      longitude: rp.lon,
      altitude: rp.alt,
      timestamp: ts,
    },
  };
}

/**
 * Flip the `recording.isRecording` flag of the store created by the most
 * recent `createMockStore()` call — lets async mocks (e.g. the picker)
 * simulate the recording ending MID-flow (the stop-window race).
 */
let setLastStoreRecordingActive: (active: boolean) => void = () => {};

function createMockStore(
  gpsPositions: GpsPoint[] = [],
  options?: { alignmentMatrix?: number[]; isRecording?: boolean }
): RecorderStore {
  let refPointsState = refPointsReducer(undefined, { type: '@@INIT' });
  // Production state always carries the recording slice; the persistence
  // middleware (and the handler's stop-window guard) read
  // `recording.isRecording`, so the mock must model it.
  let isRecordingFlag = options?.isRecording ?? true;
  setLastStoreRecordingActive = (active) => {
    isRecordingFlag = active;
  };

  const store = {
    getState: vi.fn().mockImplementation(() => ({
      recording: { isRecording: isRecordingFlag },
      gpsData: {
        zero: { lat: 49.0, lng: 8.0 },
        gpsEvents: {
          gpsPositions,
          alignmentMatrix: options?.alignmentMatrix ?? null,
        },
      },
      refPoints: refPointsState,
    })),
    subscribe: vi.fn().mockReturnValue(() => {}),
    dispatch: vi
      .fn()
      .mockImplementation((action: { type: string; payload?: unknown }) => {
        if (action.type.startsWith('refPoints/')) {
          refPointsState = refPointsReducer(refPointsState, action);
        }
        return action;
      }),
    replaceReducer: vi.fn(),
    writeFrame: vi.fn(),
    writeSessionMetadata: vi.fn(),
  } as unknown as RecorderStore;
  lastTestStore = store;
  return store;
}

/**
 * Step 5.4 test helper: seed a known geo anchor directly in `refPoints`
 * so the H3 proximity matcher (`selectKnownAnchorsByCell`) can find it
 * without routing through the legacy `importedRefPoints` field.
 */
function populateKnownAnchor(
  store: RecorderStore,
  anchor: {
    name?: string;
    lat: number;
    lon: number;
    timestamp?: number;
  }
): void {
  const ts = anchor.timestamp ?? Date.now();
  const id = gpsToH3(anchor.lat, anchor.lon);
  store.dispatch(
    addRefPointEntry({
      id,
      timestamp: ts,
      name: anchor.name,
      rawGpsPoint: {
        id: `gps-${id}`,
        latitude: anchor.lat,
        longitude: anchor.lon,
        timestamp: ts,
      },
    })
  );
}

/**
 * Step 5.7 helpers: query the V2 dispatch stream for ref-point markings.
 *
 * Production source-of-truth is the `refPoints/addRefPointEntry` action.
 * These helpers replace the previous `mockMarkReferencePoint.mock.calls`
 * lookups (the parallel `gpsData/markReferencePoint` dispatch was dropped
 * in Step 5.7 of the 2026-05-27 slice-collapse plan).
 */
interface V2EntryPayload {
  id: string;
  timestamp?: number;
  name?: string;
  rawGpsPoint: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
  position?: Vector3;
  rotation?: Quaternion;
  gpsPoint?: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
}

function getMarkCalls(store: RecorderStore): V2EntryPayload[] {
  const dispatchMock = store.dispatch as unknown as {
    mock: { calls: Array<[unknown]> };
  };
  return dispatchMock.mock.calls
    .map((c) => c[0] as { type?: string; payload?: unknown })
    .filter((a) => a?.type === 'refPoints/addRefPointEntry')
    .map((a) => a.payload as V2EntryPayload);
}

function getLastV2Payload(store: RecorderStore): V2EntryPayload | undefined {
  return getMarkCalls(store).at(-1);
}

function expectMarkDispatchedTimes(store: RecorderStore, n: number): void {
  expect(getMarkCalls(store).length).toBe(n);
}

function getDispatchedCurrentMark(store: RecorderStore): RefPointMark {
  // Step 5.7: source-of-truth dispatch is the V2 `refPoints/addRefPointEntry`
  // action. Synthesise the legacy `RefPointMark` shape for assertion convenience
  // by combining the V2 payload (id / timestamp / rawGpsPoint / gpsPoint?) with
  // the latest extractOdomPosition / extractOdomRotation mock returns (the same
  // values the production handler computes from the AR pose right before the
  // dispatch).
  const dispatchMock = store.dispatch as unknown as {
    mock: { calls: Array<[unknown]> };
  };
  const v2Calls = dispatchMock.mock.calls
    .map((c) => c[0] as { type?: string; payload?: unknown })
    .filter((a) => a?.type === 'refPoints/addRefPointEntry');
  const payload = v2Calls.at(-1)?.payload as
    | {
        id: string;
        timestamp?: number;
        rawGpsPoint: {
          latitude: number;
          longitude: number;
          altitude?: number;
        };
        gpsPoint?: {
          latitude: number;
          longitude: number;
          altitude?: number;
        };
      }
    | undefined;
  if (!payload) {
    throw new Error(
      'Expected a refPoints/addRefPointEntry action to have been dispatched'
    );
  }
  const position = mockExtractOdomPosition.mock.results.at(-1)?.value as
    | Vector3
    | undefined;
  const rotation = mockExtractOdomRotation.mock.results.at(-1)?.value as
    | Quaternion
    | undefined;
  const fused = payload.gpsPoint ?? payload.rawGpsPoint;
  return {
    id: payload.id,
    odomPosition: position ?? ([0, 0, 0] as Vector3),
    odomRotation: rotation ?? ([0, 0, 0, 1] as Quaternion),
    gpsPosition: {
      lat: fused.latitude,
      lon: fused.longitude,
      altitude: fused.altitude,
    },
    timestamp: payload.timestamp ?? Date.now(),
  };
}

/**
 * Assert that at least one `refPoints/addRefPointEntry` action was
 * dispatched (Step 5.7: the V2 slice is the canonical mark log).
 */
function expectCurrentRefPointDispatched(store: RecorderStore): void {
  const dispatchMock = store.dispatch as unknown as {
    mock: { calls: Array<[unknown]> };
  };
  const v2Calls = dispatchMock.mock.calls
    .map((c) => c[0] as { type?: string })
    .filter((a) => a?.type === 'refPoints/addRefPointEntry');
  expect(v2Calls.length).toBeGreaterThan(0);
}

function createMockGpsPoint(overrides?: Partial<GpsPoint>): GpsPoint {
  return {
    latitude: 49.0,
    longitude: 8.0,
    altitude: 100,
    accuracy: 5,
    altitudeAccuracy: 10,
    heading: null,
    speed: null,
    timestamp: Date.now(),
    ...overrides,
  } as GpsPoint;
}

function createMockArPose(): ARPose {
  return {
    position: { x: 1, y: 2, z: 3 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

function createDefaultDeps(
  overrides?: Partial<RefPointHandlersDeps>
): RefPointHandlersDeps {
  // If the caller supplies a `getStore`, reuse it so `lastTestStore`
  // (set by `createMockStore`) reflects the store the handlers will
  // actually dispatch into. Otherwise create a fresh mock store.
  const store = overrides?.getStore
    ? overrides.getStore()
    : createMockStore([createMockGpsPoint()]);
  lastTestStore = store;
  return {
    getStore: () => store,
    getCurrentSessionName: () => 'recording-test-session',
    ...overrides,
  };
}

function createMockScenarioHandle(
  name = 'TestScenario'
): FileSystemDirectoryHandle {
  return { kind: 'directory', name } as unknown as FileSystemDirectoryHandle;
}

// ── Test suites ────────────────────────────────────────────────────────

describe('createRefPointHandlers', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createRefPointHandlers(createDefaultDeps());
  });

  // Why: The factory must return an object with the public handler functions.
  // Imported-ref-point reads/writes and session usage now live in the
  // `refPoints` slice (Step 5.7a-3 Option C); the factory no longer
  // exposes those accessors.
  it('should return all handler functions', () => {
    expect(handlers.handleMarkRefPoint).toBeTypeOf('function');
    expect(handlers.reset).toBeTypeOf('function');
  });
});

// ============================================================================
// handleMarkRefPoint — validation
// ============================================================================

describe('handleMarkRefPoint — validation', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly reset mock return values that may bleed from other tests
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(null);
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue(null);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    handlers = createRefPointHandlers(createDefaultDeps());
  });

  // Why: If the picker is already visible, duplicate calls must be ignored
  // to prevent overwriting the currentResolver (2026-02-27 Issue 2).
  it('should return early if picker is already visible', async () => {
    mockIsRefPointPickerVisible.mockReturnValue(true);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
  });

  // Why: AR pose is required to record odometry data for the ref point.
  it('should show error if AR pose is not available', async () => {
    mockGetCurrentArPose.mockReturnValue(null);

    await handlers.handleMarkRefPoint();

    expect(mockShowError).toHaveBeenCalledWith(
      'Cannot mark reference point - AR tracking not available'
    );
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
  });

  // Why: GPS data is required to geo-reference the ref point.
  it('should show error if no GPS data is available', async () => {
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    const emptyStore = createMockStore([]);
    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => emptyStore })
    );

    await handlers.handleMarkRefPoint();

    expect(mockShowError).toHaveBeenCalledWith(
      'Cannot mark reference point - no GPS data available'
    );
  });
});

// ============================================================================
// handleMarkRefPoint — picker integration
// ============================================================================

describe('handleMarkRefPoint — picker integration', () => {
  let handlers: RefPointHandlers;
  let store: RecorderStore;
  const mockArPose = createMockArPose();
  const mockGpsPoint = createMockGpsPoint();

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly reset mock return values
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue(null);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    store = createMockStore([mockGpsPoint]);
    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
  });

  // Why: When imported refs are far from GPS (no nearby match), the picker
  // should show with empty suggestions (IDs are now H3 hex, meaningless to users).
  it('should show picker with empty suggestions when no nearby match', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue(['scenarioPoint']);
    mockShowRefPointPicker.mockResolvedValue({ id: 'MyNew', isNew: true });

    // Imported refs are far from GPS (49, 8) — won't match as re-observation
    seedImportedRefPoints([
      {
        id: 'importedA',
        name: 'Imported A',
        lat: 10,
        lon: 20,
        sourceZipName: 'z.zip',
      },
      {
        id: 'scenarioPoint',
        name: 'Scenario Point',
        lat: 10,
        lon: 20,
        sourceZipName: 'z2.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalled();
    const passedIds = mockShowRefPointPicker.mock.calls[0][0];
    // No suggestions — scenario IDs are H3 hex, imported names are for distant locations
    expect(passedIds).toEqual([]);
  });

  // Why: Even with no scenario handle, picker gets empty suggestions for new refs.
  it('should show picker with empty suggestions when no scenario handle and no nearby match', async () => {
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockShowRefPointPicker.mockResolvedValue({ id: 'NewRef', isNew: true });
    seedImportedRefPoints([
      {
        id: 'importedOnly',
        name: 'importedOnly',
        lat: 10,
        lon: 20,
        sourceZipName: 'z.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalled();
    const passedIds = mockShowRefPointPicker.mock.calls[0][0];
    expect(passedIds).toEqual([]);
  });

  // Why: When an imported ref point is near the current GPS position, the
  // handler should skip the picker and directly capture as a re-observation.
  it('should bypass picker when GPS matches an imported ref point', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);

    // Imported ref at same coords as GPS position (49, 8)
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    // Picker should NOT be shown
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
    // But the ref point should still be dispatched with H3 ID
    const payload = getLastV2Payload(store);
    expect(payload).toBeDefined();
    expect(payload!.id).toMatch(/^[0-9a-f]{15}$/);
  });

  // Why: The raw WebXR AR pose (odomPosition/odomRotation) is the
  // load-bearing input the investigation harness recomputes alignment
  // from. The dispatch site previously discarded it (underscore-prefixed
  // params); this asserts it now reaches the addRefPointEntry payload
  // verbatim in the raw WebXR frame (NOT webxrToNUE-converted). See
  // 2026-05-29-investigation-harness-refpoint-source-migration-plan.md §E.
  it('should carry the raw WebXR AR pose on the dispatched payload', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1.5, -2.25, 3.75] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0.1, 0.2, 0.3, 0.9] as Quaternion);

    seedImportedRefPoints([
      { id: 'Bank', name: 'Bank', lat: 49.0, lon: 8.0, sourceZipName: 'p.zip' },
    ]);

    await handlers.handleMarkRefPoint();

    const payload = getLastV2Payload(store);
    expect(payload).toBeDefined();
    expect(payload!.position).toEqual([1.5, -2.25, 3.75]);
    expect(payload!.rotation).toEqual([0.1, 0.2, 0.3, 0.9]);
  });

  // Why: Re-observation should use the imported ref point's display name (not H3 index)
  // as the persisted display name, so users see the original name.
  it('should use imported ref point display name for re-observation', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);

    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const [, persistedId, persistedName] =
      mockSaveRefPointObservation.mock.calls[0];
    expect(persistedId).toMatch(/^[0-9a-f]{15}$/);
    expect(persistedName).toBe('Bank');
  });

  // Why: When picker returns null (cancelled), no dispatch or persist should happen.
  it('should return early if picker is cancelled', async () => {
    mockShowRefPointPicker.mockResolvedValue(null);

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).not.toHaveBeenCalled();
  });

  // Why: For new ref points (no nearby match), the picker should receive
  // an empty suggestion list since scenario IDs are now H3 hex strings
  // that are meaningless to users. The picker becomes a simple name input.
  it('should pass empty suggestions to picker for new ref points', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue(['8b1f1a5c2e3d4f1']);
    mockShowRefPointPicker.mockResolvedValue({ id: 'My Point', isNew: true });

    // Imported refs far away — no nearby match, new ref point flow
    seedImportedRefPoints([
      {
        id: 'FarAway',
        name: 'Far Away',
        lat: 10,
        lon: 20,
        sourceZipName: 'z.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalled();
    const passedIds = mockShowRefPointPicker.mock.calls[0][0];
    expect(passedIds).toEqual([]);
  });
});

// ============================================================================
// handleMarkRefPoint — Step 5.4: matcher reads refPoints
// ============================================================================

describe('handleMarkRefPoint — Step 5.4 matcher source', () => {
  /**
   * Why this test matters:
   * Step 5.4 of the 2026-05-27 slice-collapse plan switches the H3
   * proximity matcher from `selectCachedKnownRefPoints(state.refPoints)`
   * to `selectKnownAnchorsByCell(state.refPoints)`. After the swap, a
   * known anchor stored only in `refPoints` (i.e. no entry in the
   * legacy `importedRefPoints` field) must still trigger the
   * re-observation path and propagate its human-readable name through
   * to the persisted observation.
   *
   * Before the handler change this test fails (matcher sees an empty
   * legacy list → no nearby match → picker is shown). After the change
   * it passes.
   */
  it('re-observes via refPoints anchor when legacy importedRefPoints is empty', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // Seed refPoints only — legacy importedRefPoints stays empty.
    populateKnownAnchor(store, {
      name: 'Bench Corner',
      lat: 49.0,
      lon: 8.0,
    });

    await handlers.handleMarkRefPoint();

    // Re-observation path: picker must NOT be shown.
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
    // The persisted display name must come from the refPoints anchor.
    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const persistedName = mockSaveRefPointObservation.mock.calls[0][2];
    expect(persistedName).toBe('Bench Corner');
  });

  /**
   * Why this test matters:
   * `checkNearbyRefPoint` is the capture-button label feeder and must
   * also use the new matcher source. The asymmetry of having the mark
   * path read from refPoints while the label path still reads from
   * the legacy slice would surface as a stale or empty button label.
   */
  it('checkNearbyRefPoint resolves displayName via refPoints', () => {
    const store = createMockStore();
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    populateKnownAnchor(store, {
      name: 'Bank',
      lat: 49.0,
      lon: 8.0,
    });

    expect(handlers.checkNearbyRefPoint(49.0, 8.0)?.displayName).toBe('Bank');
  });
});

// ============================================================================
// handleMarkRefPoint — dispatch, persist, visualize
// ============================================================================

describe('handleMarkRefPoint — full flow', () => {
  let handlers: RefPointHandlers;
  let mockStore: RecorderStore;
  const mockArPose = createMockArPose();
  const mockGpsPoint = createMockGpsPoint();

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly reset mock return values
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    mockStore = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => mockStore })
    );
  });

  // Why: The store must receive the markReferencePoint action with the correct payload.
  it('should dispatch markReferencePoint action', async () => {
    await handlers.handleMarkRefPoint();

    expect(mockStore.dispatch).toHaveBeenCalled();
  });

  // Why: The observation must be persisted to the scenario's refPoints/ directory.
  it('should persist ref point observation to disk', async () => {
    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const [handle, id, name] = mockSaveRefPointObservation.mock.calls[0];
    // ID is now H3 index, name is the picker-returned display text
    expect(id).toMatch(/^[0-9a-f]{15}$/);
    expect(name).toBe('bench');
    expect(handle).toBeDefined();
  });

  // Why: Re-observations should pass the picker name as display metadata.
  it('should use picker name as display name for existing ref points', async () => {
    mockShowRefPointPicker.mockResolvedValue({
      id: 'bench',
      isNew: false,
    });

    await handlers.handleMarkRefPoint();

    const name = mockSaveRefPointObservation.mock.calls[0][2];
    // Display name is now the raw picker text (no "Re-observation of" prefix)
    expect(name).toBe('bench');
  });

  // Why: The ref point must be visualized in the 3D scene. After Finding 5
  // (2026-04-30 plan) the visualization is driven by the Redux slice; the
  // call site dispatches addCurrentRefPointMark and the visualizer is
  // wired as a subscription consumer.
  it('should dispatch ref point to the store for visualization', async () => {
    await handlers.handleMarkRefPoint();

    expectCurrentRefPointDispatched(mockStore);
    const mark = getDispatchedCurrentMark(mockStore);
    // ID is now H3 index
    expect(mark.id).toMatch(/^[0-9a-f]{15}$/);
    expect(mark.odomPosition).toEqual([1, 2, 3]);
    expect(mark.odomRotation).toEqual([0, 0, 0, 1]);
  });

  // Why: The status bar must show the marked ref point's ID.
  it('should update status with marked ref point', async () => {
    await handlers.handleMarkRefPoint();

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.stringMatching(/^Marked reference point: [0-9a-f]{15}$/)
    );
  });

  // Why: If no scenario handle, persist should be skipped but dispatch/visualize still happen.
  it('should skip persist when no scenario handle', async () => {
    mockGetCurrentScenarioHandle.mockReturnValue(null);

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).not.toHaveBeenCalled();
    expect(mockStore.dispatch).toHaveBeenCalled();
    expectCurrentRefPointDispatched(mockStore);
  });

  // Why (Step 5.7 of 2026-05-27 slice-collapse plan): the dispatched V2
  // `addRefPointEntry` action must carry the fused-at-mark-time `gpsPoint`
  // snapshot (`RawGpsPoint` shape) when the live alignment matrix is in
  // effect. When the recorder has no alignment yet, the payload omits the
  // field and downstream consumers fall back to `rawGpsPoint`.
  it('should carry fused gpsPoint on V2 payload when alignmentMatrix is present', async () => {
    const matrix = new Array(16).fill(0) as number[];
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
    const storeWithMatrix = createMockStore([createMockGpsPoint()], {
      alignmentMatrix: matrix,
    });
    const localHandlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => storeWithMatrix })
    );

    await localHandlers.handleMarkRefPoint();

    const payload = getLastV2Payload(storeWithMatrix);
    expect(payload?.gpsPoint).toBeDefined();
    expect(payload?.gpsPoint?.latitude).toBe(49.123);
    expect(payload?.gpsPoint?.longitude).toBe(8.456);
  });

  it('should omit gpsPoint on V2 payload when no alignmentMatrix is in state', async () => {
    // mockStore created in beforeEach has alignmentMatrix=null.
    await handlers.handleMarkRefPoint();

    const payload = getLastV2Payload(mockStore);
    expect(payload?.gpsPoint).toBeUndefined();
  });
});

// ============================================================================
// handleMarkRefPoint — recording ends mid-flow (stop-window race)
// ============================================================================

describe('handleMarkRefPoint — recording ends mid-flow (stop-window race)', () => {
  // Why these tests matter: root cause of the 2026-07-11 zip-1 lost "A3"
  // action (indoor-loop enablement, sidecar cross-check §3.5 of the
  // implementation summary). The new-point picker can stay open across
  // Stop (user stop or system session end); the persistence middleware
  // gates `actions/` writes on `recording.isRecording`, so a post-stop
  // dispatch silently never reaches the recording while the ungated OPFS
  // sidecar write succeeds and the toast claimed plain success. The
  // handler must detect the ended recording, skip the dead dispatch, keep
  // the durable scenario-level observation, and tell the truth in the
  // toast (UI-feedback rule: the final state must reflect the durable end
  // state — which here is "scenario only, not in the recording").
  let handlers: RefPointHandlers;
  let mockStore: RecorderStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    mockStore = createMockStore([createMockGpsPoint()]);
    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => mockStore })
    );
  });

  it('new-point path: recording stops while the picker is open → no dispatch, sidecar kept, honest warning toast', async () => {
    mockShowRefPointPicker.mockImplementation(() => {
      setLastStoreRecordingActive(false); // Stop happened while picker open
      return Promise.resolve({ id: 'A3', isNew: true });
    });

    await handlers.handleMarkRefPoint();

    // The action can never reach the stopped recording — dispatching it
    // would only feign success; it must be skipped.
    expectMarkDispatchedTimes(mockStore, 0);
    // The scenario-level observation is durable, session-independent data
    // (zip-1's lost A3 became the cross-session anchor) — it must be kept.
    expect(mockSaveRefPointObservation).toHaveBeenCalledTimes(1);
    // The final toast must name the partial outcome, not claim plain success.
    const lastToast = mockShowToast.mock.calls.at(-1)!;
    expect(lastToast[0]).toContain('A3');
    expect(lastToast[0]).toMatch(/recording/i);
    expect(lastToast[0]).not.toBe('Marked "A3"');
    expect(lastToast[1]).toMatchObject({ severity: 'warning' });
  });

  it('re-observe path: recording already ended at tap time → no dispatch, sidecar kept, honest warning toast', async () => {
    // Known anchor at the GPS position ⇒ single-tap re-observe (no picker).
    seedImportedRefPoints([
      {
        id: 'A1',
        name: 'A1',
        lat: 49.0,
        lon: 8.0,
        alt: 100,
        sourceZipName: 'earlier-session.zip',
      },
    ]);
    setLastStoreRecordingActive(false);

    await handlers.handleMarkRefPoint();

    expectMarkDispatchedTimes(mockStore, 0);
    expect(mockSaveRefPointObservation).toHaveBeenCalledTimes(1);
    const lastToast = mockShowToast.mock.calls.at(-1)!;
    expect(lastToast[0]).toMatch(/^Re-observed "A1"/);
    expect(lastToast[0]).toMatch(/recording/i);
    expect(lastToast[1]).toMatchObject({ severity: 'warning' });
  });

  it('regression: while recording, the plain success toast and the dispatch are unchanged', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });

    await handlers.handleMarkRefPoint();

    expectMarkDispatchedTimes(mockStore, 1);
    const lastToast = mockShowToast.mock.calls.at(-1)!;
    expect(lastToast[0]).toBe('Marked "bench"');
    expect(lastToast[1]).toMatchObject({ severity: 'info' });
  });
});

// ============================================================================
// handleMarkRefPoint — concurrent call prevention
// ============================================================================

describe('handleMarkRefPoint — concurrent call prevention', () => {
  // Why: Two rapid taps on "Mark Reference Point" must not both proceed.
  // The synchronous lock prevents the second call from entering the async section.
  it('should block concurrent calls via synchronous lock', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);

    // Make showRefPointPicker slow to widen the race window
    let resolveShowPicker!: (
      value: { id: string; isNew: boolean } | null
    ) => void;
    mockShowRefPointPicker.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveShowPicker = resolve;
        })
    );

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // Launch two concurrent calls (simulates rapid double tap)
    const call1 = handlers.handleMarkRefPoint();
    const call2 = handlers.handleMarkRefPoint();

    // Resolve the first call's showRefPointPicker
    resolveShowPicker({ id: 'point1', isNew: true });

    await call1;
    await call2;

    // showRefPointPicker should only be called ONCE (the second call was blocked)
    expect(mockShowRefPointPicker).toHaveBeenCalledTimes(1);
  });

  // Why: After a call completes (even with error), the lock must be released.
  it('should release lock after completion', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue(null);
    mockGetCurrentArPose.mockReturnValue(null); // Will fail validation
    const handlers = createRefPointHandlers(createDefaultDeps());

    await handlers.handleMarkRefPoint(); // First call fails
    mockGetCurrentArPose.mockReturnValue(createMockArPose());

    // Second call should not be blocked
    await handlers.handleMarkRefPoint();
    // It should proceed (showError for first, then proceed for second)
    expect(mockShowError).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// handleMarkRefPoint — re-observation cooldown
// ============================================================================

describe('handleMarkRefPoint — re-observation cooldown', () => {
  /**
   * Why: Rapid double-taps on the re-observation button produce duplicate
   * markings for the same H3 cell (Aachen audit Issue 3). A per-cell cooldown
   * prevents accidental duplicates while still allowing intentional re-marks
   * after the cooldown expires.
   */
  it('should ignore a re-observation within the cooldown period', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // Import a ref point at the GPS position (49, 8) → re-observation path
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // First re-observation should succeed
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 1);

    // Second re-observation within cooldown should be silently ignored
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 1); // Still 1
  });

  it('should allow re-observation after cooldown expires', async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // First mark
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 1);

    // Advance past the cooldown (10 seconds)
    vi.advanceTimersByTime(11_000);

    // Second mark should now succeed
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 2);

    vi.useRealTimers();
  });

  it('should not apply cooldown to new ref points (picker path)', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    mockShowRefPointPicker.mockResolvedValue({ id: 'New Point', isNew: true });

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // No imported ref points → new ref point flow (picker shown)
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 1);

    // Second new ref point should still work immediately
    mockShowRefPointPicker.mockResolvedValue({
      id: 'Another Point',
      isNew: true,
    });
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 2);
  });

  // Why: reset() must clear the per-H3-cell cooldown map so that cooldown
  // state does not leak between recording sessions when the handler instance
  // is reused (Aachen audit Issue 3 follow-up).
  it('should clear re-observation cooldown on reset()', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // Import a ref point at the GPS position → re-observation path
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // First re-observation should succeed
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 1);

    // Cooldown is now active — second call should be ignored
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 1);

    // Reset should clear cooldown state
    handlers.reset();

    // Re-import ref points (reset clears them)
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // Re-observation should succeed immediately after reset (no cooldown)
    await handlers.handleMarkRefPoint();
    expectMarkDispatchedTimes(store, 2);
  });
});

// ============================================================================
// buildRefPointObservation — unit test
// ============================================================================

describe('buildRefPointObservation (via handleMarkRefPoint)', () => {
  // Why: The observation must include sessionId from getCurrentSessionName dep.
  it('should build observation with correct sessionId', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });
    mockExtractOdomPosition.mockReturnValue([10, 20, 30] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0.1, 0.2, 0.3, 0.9] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({
        getStore: () => store,
        getCurrentSessionName: () => 'recording-2026-03-05',
      })
    );

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.sessionId).toBe('recording-2026-03-05');
    expect(observation.arPose.position).toEqual([10, 20, 30]);
    expect(observation.arPose.rotation).toEqual([0.1, 0.2, 0.3, 0.9]);
    expect(observation.gpsPoint).toBe(mockGpsPoint);
  });
});

// ============================================================================
// H3-based reference point IDs
// ============================================================================

describe('handleMarkRefPoint — H3-based ID', () => {
  // Why: The naming bug (docs/2026-03-08-ref-point-naming-investigation.md)
  // showed that user-entered names are unreliable on mobile. The ref point ID
  // must be the H3 resolution-11 hex index computed from the GPS at capture
  // time, NOT the string the user typed in the picker. The picker-returned
  // name becomes optional display metadata only.

  let handlers: RefPointHandlers;
  let mockStore: RecorderStore;

  // GPS position for Loc 2 from the investigation (50.7475, 6.4812)
  const testGpsPoint = createMockGpsPoint({
    latitude: 50.7475,
    longitude: 6.4812,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockStore = createMockStore([testGpsPoint]);
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => mockStore })
    );
  });

  it('should use H3 index as the dispatched ref point ID, not the picker name', async () => {
    // User types "Bank" in the picker, but the ID must be the H3 index
    mockShowRefPointPicker.mockResolvedValue({ id: 'Bank', isNew: true });

    await handlers.handleMarkRefPoint();

    // The dispatched action must use the H3 index, not "Bank"
    const payload = getLastV2Payload(mockStore);
    expect(payload).toBeDefined();
    // H3 res-11 indices are 15-char hex strings
    expect(payload!.id).toMatch(/^[0-9a-f]{15}$/);
    expect(payload!.id).not.toBe('Bank');
  });

  it('should persist the ref point using H3 index as ID and picker name as display name', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'Bank', isNew: true });

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const [, persistedId, persistedName] =
      mockSaveRefPointObservation.mock.calls[0];
    // ID = H3 index (not "Bank")
    expect(persistedId).toMatch(/^[0-9a-f]{15}$/);
    // Display name = what the user typed
    expect(persistedName).toBe('Bank');
  });

  it('should produce the same H3 ID for the same GPS coordinates', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'Name1', isNew: true });
    await handlers.handleMarkRefPoint();

    const id1 = getLastV2Payload(mockStore)!.id;

    // Reset and mark again at the same GPS position but with different user name
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    mockShowRefPointPicker.mockResolvedValue({ id: 'Name2', isNew: true });
    await handlers.handleMarkRefPoint();

    const id2 = getLastV2Payload(mockStore)!.id;
    expect(id1).toBe(id2);
  });

  it('should visualize ref point with H3 index as ID', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'MyRef', isNew: true });

    await handlers.handleMarkRefPoint();

    const mark = getDispatchedCurrentMark(mockStore);
    expect(mark.id).toMatch(/^[0-9a-f]{15}$/);
    expect(mark.id).not.toBe('MyRef');
  });
});

/**
 * Tests for checkNearbyRefPoint.
 *
 * Why these tests matter:
 * The live ref point button needs to reactively show the name of a nearby
 * known ref point as the user walks. checkNearbyRefPoint is the bridge
 * between the GPS subscription and the button label update.
 * See: docs/2026-03-21-live-ref-point-button-plan.md, Change B.
 */
describe('checkNearbyRefPoint', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const deps = createDefaultDeps();
    handlers = createRefPointHandlers(deps);
  });

  /**
   * Why this test matters:
   * When the user is near a known imported ref point, the method should
   * return an info object with its display name so the button label can be updated.
   */
  it('returns display name when within gridDisk of an imported ref point', () => {
    // Set imported ref points at a known location
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // Check from the same location — should match
    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result?.displayName).toBe('Bank');
  });

  /**
   * Why this test matters:
   * When the user is far from any known ref point, the method should
   * return undefined so the button reverts to the default label.
   */
  it('returns undefined when far from any imported ref point', () => {
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // Check from a distant location (~111 km away) — should not match
    const result = handlers.checkNearbyRefPoint(50.0, 9.0);
    expect(result).toBeUndefined();
  });

  /**
   * Why this test matters:
   * When no ref points have been imported, the method should always
   * return undefined regardless of position.
   */
  it('returns undefined when no imported ref points exist', () => {
    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result).toBeUndefined();
  });

  /**
   * Why this test matters:
   * After reset(), imported ref points are cleared, so proximity
   * checks should return undefined.
   */
  it('returns undefined after reset', () => {
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    handlers.reset();

    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result).toBeUndefined();
  });

  /**
   * Regression: cache invalidation on setImportedRefPoints.
   *
   * Why this test matters:
   * knownRefPoints are cached eagerly when setImportedRefPoints is called.
   * If someone removes the cache invalidation, the old ref points would
   * still be returned after updating — this test catches that.
   */
  it('reflects updated ref points after a second setImportedRefPoints call', () => {
    // Initial set: "Bank" at (49.0, 8.0)
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);
    expect(handlers.checkNearbyRefPoint(49.0, 8.0)?.displayName).toBe('Bank');

    // Replace with "Library" at a completely different location
    seedImportedRefPoints([
      {
        id: 'Library',
        name: 'Library',
        lat: 52.0,
        lon: 13.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // Old location should no longer match
    expect(handlers.checkNearbyRefPoint(49.0, 8.0)).toBeUndefined();
    // New location should match
    expect(handlers.checkNearbyRefPoint(52.0, 13.0)?.displayName).toBe(
      'Library'
    );
  });

  /**
   * Regression: gpsToH3 is not recomputed on every checkNearbyRefPoint call.
   *
   * Why this test matters:
   * checkNearbyRefPoint is called at ~1 Hz from the GPS subscription.
   * The H3 indices for imported ref points are deterministic and only
   * change when setImportedRefPoints is called. This test verifies that
   * repeated proximity checks return consistent results without relying
   * on re-mapping — if the cache were accidentally removed, the test
   * still passes behaviorally but documents the expected invariant.
   */
  it('returns consistent results across many rapid calls', () => {
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
      {
        id: 'Church',
        name: 'Church',
        lat: 49.001,
        lon: 8.001,
        sourceZipName: 'test.zip',
      },
    ]);

    // Simulate ~5 seconds of 1 Hz GPS updates at the same position
    for (let i = 0; i < 5; i++) {
      expect(handlers.checkNearbyRefPoint(49.0, 8.0)?.displayName).toBe('Bank');
    }
  });
});

// ============================================================================
// fusedGpsPoint in observation (Step 2 — prior ref points plan)
// ============================================================================

describe('buildRefPointObservation — fusedGpsPoint', () => {
  // Identity matrix — transforms odom position 1:1 to aligned position
  const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function setupFullFlowMocks(alignmentMatrix: number[] | null = null) {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint], {
      alignmentMatrix: alignmentMatrix ?? undefined,
    });
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'marker', isNew: true });
    mockExtractOdomPosition.mockReturnValue([5, 10, 15] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    mockCalcGpsCoords.mockReturnValue({ lat: 49.123, lon: 8.456 });
    mockFusedGpsFromOdom.mockReturnValue({ lat: 49.123, lon: 8.456 });
    return { store };
  }

  // Why: When the alignment matrix is available at mark time,
  // the observation should include a fused GPS position computed from
  // fusedGpsFromOdom(alignmentMatrix, odomPosition, zeroRef).
  it('should include fusedGpsPoint when alignment matrix is available', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeDefined();
    expect(observation.fusedGpsPoint!.latitude).toBe(49.123);
    expect(observation.fusedGpsPoint!.longitude).toBe(8.456);
  });

  // Why: Legacy recordings may not have an alignment matrix at mark time.
  // The observation should omit fusedGpsPoint gracefully.
  it('should omit fusedGpsPoint when alignment matrix is null', async () => {
    const { store } = setupFullFlowMocks(null);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeUndefined();
  });

  // Why: fusedGpsFromOdom must receive the alignment matrix, NUE odom position,
  // and zero reference. The odom position from extractOdomPosition is raw WebXR,
  // so it must be converted via webxrToNUE before being passed to fusedGpsFromOdom.
  it('should call fusedGpsFromOdom with alignmentMatrix, NUE odomPosition, zeroRef', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockFusedGpsFromOdom).toHaveBeenCalledTimes(1);
    // First arg: alignment matrix
    expect(mockFusedGpsFromOdom.mock.calls[0][0]).toEqual(IDENTITY_MATRIX);
    // Second arg: odom position converted to NUE via webxrToNUE([5, 10, 15]) = [-15, 10, 5]
    expect(mockFusedGpsFromOdom.mock.calls[0][1]).toEqual([-15, 10, 5]);
    // Third arg: zero reference from store
    expect(mockFusedGpsFromOdom.mock.calls[0][2]).toEqual({
      lat: 49.0,
      lng: 8.0,
    });
  });

  // Why: Without alignment matrix, fusedGpsFromOdom should not be called —
  // there is no fused GPS to compute.
  it('should not call fusedGpsFromOdom when alignment matrix is absent', async () => {
    const { store } = setupFullFlowMocks(null);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockFusedGpsFromOdom).not.toHaveBeenCalled();
  });

  // Why: When fusedGpsFromOdom returns altitude (origin has altitude),
  // the observation's fusedGpsPoint must include it — otherwise altitude
  // from the aligned VIO pipeline is silently lost.
  it('should include altitude when fusedGpsFromOdom returns it', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    mockFusedGpsFromOdom.mockReturnValue({
      lat: 49.123,
      lon: 8.456,
      altitude: 150.5,
    });
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeDefined();
    expect(observation.fusedGpsPoint!.altitude).toBe(150.5);
  });

  // Why: fusedGpsFromOdom expects NUE-convention input because the alignment
  // matrix is computed from NUE state data. Passing raw WebXR swaps axes.
  // webxrToNUE([x,y,z]) = [-z, y, x], so [10, 5, -3] → [3, 5, 10].
  it('should convert odomPosition to NUE before calling fusedGpsFromOdom', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    // Override with asymmetric values to detect axis swap
    mockExtractOdomPosition.mockReturnValue([10, 5, -3] as Vector3);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    await handlers.handleMarkRefPoint();

    expect(mockFusedGpsFromOdom).toHaveBeenCalledTimes(1);
    // webxrToNUE([10, 5, -3]) = [-(-3), 5, 10] = [3, 5, 10]
    expect(mockFusedGpsFromOdom.mock.calls[0][1]).toEqual([3, 5, 10]);
  });

  // Why: When the GPS origin has no altitude, fusedGpsFromOdom returns
  // altitude: undefined. The observation must reflect that (not NaN, not 0).
  it('should have undefined altitude when fusedGpsFromOdom returns no altitude', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    mockFusedGpsFromOdom.mockReturnValue({
      lat: 49.123,
      lon: 8.456,
    });
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeDefined();
    expect(observation.fusedGpsPoint!.altitude).toBeUndefined();
  });
});

// ============================================================================
// Current-session visualization — prefer fused GPS over raw
// ============================================================================

/**
 * Why these tests matter: the red sphere shown immediately after marking
 * must sit at the same spot where a future session's green sphere will
 * appear. The saved observation already carries fusedGpsPoint (§7 of
 * 2026-04-24-refpoint-positioning-investigation.md), and the loader now
 * prefers fused — so the in-session visualizer must match. Otherwise the
 * red sphere jumps position the next time the scenario is opened.
 */
describe('visualizeRefPoint — prefers fused GPS', () => {
  const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function setup(alignmentMatrix: number[] | null) {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    const store = createMockStore([createMockGpsPoint()], {
      alignmentMatrix: alignmentMatrix ?? undefined,
    });
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'marker', isNew: true });
    mockExtractOdomPosition.mockReturnValue([5, 10, 15] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    return { store };
  }

  // Raw GPS from createMockGpsPoint is (49.0, 8.0). Fused below is (49.5, 8.5)
  // so the two sources are distinguishable.
  it('uses fused lat/lon for the current-session sphere when alignment is available', async () => {
    const { store } = setup(IDENTITY_MATRIX);
    mockFusedGpsFromOdom.mockReturnValue({
      lat: 49.5,
      lon: 8.5,
      altitude: 123,
    });
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expectCurrentRefPointDispatched(store);
    const mark = getDispatchedCurrentMark(store);
    expect(mark.gpsPosition).toEqual({
      lat: 49.5,
      lon: 8.5,
      altitude: 123,
    });
  });

  it('falls back to raw lat/lon when no alignment matrix is available', async () => {
    const { store } = setup(null);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const mark = getDispatchedCurrentMark(store);
    // createMockGpsPoint() raw GPS is (49.0, 8.0)
    expect(mark.gpsPosition?.lat).toBe(49.0);
    expect(mark.gpsPosition?.lon).toBe(8.0);
    // fusedGpsFromOdom must not have been called in this path
    expect(mockFusedGpsFromOdom).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Part B: isNeighborCell detection + forceNew (2026-04-18)
// ============================================================================

/**
 * Tests for checkNearbyRefPoint neighbor-cell detection.
 *
 * Why these tests matter:
 * The secondary "+" button should only appear when the user is in a
 * neighboring H3 cell (gridDisk match, different center cell) of a known
 * ref point. isNeighborCell drives the visibility of this button.
 * See: docs/2026-04-18-ref-point-proximity-button-improvements.md, Part B.
 */
describe('checkNearbyRefPoint — isNeighborCell', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createRefPointHandlers(createDefaultDeps());
  });

  // Why: When the user is in the exact same H3 cell as the ref point,
  // isNeighborCell should be false (no need to add a new ref point here).
  it('returns isNeighborCell=false when in the same center cell', () => {
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result).toBeDefined();
    expect(result!.isNeighborCell).toBe(false);
  });

  // Why: When the user is in a neighbor cell (within gridDisk but different
  // center cell), isNeighborCell should be true. At H3 res-11, a shift of
  // ~0.0003Â° (~33m) should land in a neighbor cell while still in the gridDisk.
  it('returns isNeighborCell=true when in a neighbor gridDisk cell', () => {
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // ~33m north — should be in a neighbor cell at H3 res-11 (~25m edge)
    const result = handlers.checkNearbyRefPoint(49.0003, 8.0);
    expect(result).toBeDefined();
    expect(result!.displayName).toBe('Bank');
    expect(result!.isNeighborCell).toBe(true);
  });

  // Why: When the user is far away (no match), undefined should be returned,
  // even with the new return type.
  it('returns undefined when outside all gridDisk zones', () => {
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    const result = handlers.checkNearbyRefPoint(50.0, 9.0);
    expect(result).toBeUndefined();
  });
});

/**
 * Tests for handleMarkRefPoint with forceNew option.
 *
 * Why these tests matter:
 * The "+" button calls handleMarkRefPoint({ forceNew: true }) to bypass
 * the re-observation fast-path and show the picker for a new ref point
 * even when the user is near a known one.
 * See: docs/2026-04-18-ref-point-proximity-button-improvements.md, Part B.
 */
describe('handleMarkRefPoint — forceNew', () => {
  // Why: When forceNew is true and re-observation would normally
  // fire, the picker should be shown instead of skipping.
  it('shows picker when forceNew=true even near a known ref point', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockGpsPoint = createMockGpsPoint({ latitude: 49.0, longitude: 8.0 });
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockShowRefPointPicker.mockResolvedValue({ id: 'NewPoint', isNew: true });

    const handlers = createRefPointHandlers({
      getStore: () => store,
      getCurrentSessionName: () => 'test-session',
    });

    // Import a ref point at the user's location — normally would trigger re-observation
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    await handlers.handleMarkRefPoint({ forceNew: true });

    // Picker should have been shown (forceNew bypassed re-observation)
    expect(mockShowRefPointPicker).toHaveBeenCalledOnce();
  });

  // Why: Without forceNew, the same scenario should NOT show the picker
  // because re-observation kicks in.
  it('skips picker without forceNew when near a known ref point', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockGpsPoint = createMockGpsPoint({ latitude: 49.0, longitude: 8.0 });
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());

    const handlers = createRefPointHandlers({
      getStore: () => store,
      getCurrentSessionName: () => 'test-session',
    });

    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    // Picker should NOT have been shown (re-observation path)
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
  });
});

// ============================================================================
// handleMarkRefPoint — re-observation toast feedback (Finding 3)
// ============================================================================

/**
 * Why these tests matter
 * ----------------------
 * Field test 2026-04-29 — Finding 3 in
 * `GpsPlusSlamJs_Docs/docs/2026-04-29-ref-points-user-feedback.md`: pressing
 * the capture button gives no visible feedback when the press lands on the
 * single-click re-observation branch (no picker is shown, so the user has no
 * confirmation that anything happened).
 *
 * Decision: show a toast **only** on the re-observation branch. The
 * picker-driven path (new ref point) already has implicit feedback via the
 * picker UI. The toast must fire after the on-disk persistence has settled
 * so it reflects the durable end state.
 */
describe('handleMarkRefPoint — re-observation toast feedback', () => {
  function setupReObservationFixture() {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);
    return { handlers, store };
  }

  it('shows a toast naming the ref point on a single-click re-observation', async () => {
    const { handlers } = setupReObservationFixture();

    await handlers.handleMarkRefPoint();

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [message] = mockShowToast.mock.calls[0];
    expect(message).toContain('Bank');
  });

  it('fires the toast after the OPFS write resolves (durable state)', async () => {
    const { handlers } = setupReObservationFixture();

    // Order observers: capture call sequence across persist + toast.
    const callOrder: string[] = [];
    mockSaveRefPointObservation.mockImplementation(() => {
      callOrder.push('save');
      return Promise.resolve();
    });
    mockShowToast.mockImplementation(() => {
      callOrder.push('toast');
    });

    await handlers.handleMarkRefPoint();

    expect(callOrder).toEqual(['save', 'toast']);
  });

  // D4/F4-B (2026-06-16 user feedback): the picker-driven new-ref-point path
  // previously relied solely on the picker closing for feedback, which the field
  // tester reported as "no indicator that a marker was actually set". It now
  // confirms with a "Marked '<name>'" toast after the durable OPFS write, plus a
  // transient "Saving…" in-progress toast and an error toast on write failure.
  function setupNewPointFixture(pickerName = 'New Point') {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    const store = createMockStore([createMockGpsPoint()]);
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    mockShowRefPointPicker.mockResolvedValue({ id: pickerName, isNew: true });
    // No imported ref points near GPS → picker (new) path
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    return { handlers };
  }

  it('confirms with a "Marked" toast on the picker-driven new ref point path', async () => {
    const { handlers } = setupNewPointFixture('New Point');

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalledTimes(1);
    // Last toast is the durable-state confirmation naming the new point.
    const messages = mockShowToast.mock.calls.map((c) => c[0] as string);
    expect(messages.at(-1)).toContain('Marked');
    expect(messages.at(-1)).toContain('New Point');
  });

  it('shows an in-progress "Saving…" toast before the OPFS write, then the final confirmation', async () => {
    const { handlers } = setupNewPointFixture('New Point');

    const callOrder: string[] = [];
    mockShowToast.mockImplementation((msg: string) => {
      callOrder.push(msg.includes('Saving') ? 'saving' : 'final');
    });
    mockSaveRefPointObservation.mockImplementation(() => {
      callOrder.push('save');
      return Promise.resolve();
    });

    await handlers.handleMarkRefPoint();

    // In-progress toast fires before the durable write; the "Marked" toast after.
    expect(callOrder).toEqual(['saving', 'save', 'final']);
  });

  it('shows an error toast and reverts the in-progress state when the new-point OPFS write fails', async () => {
    const { handlers } = setupNewPointFixture('New Point');
    mockSaveRefPointObservation.mockRejectedValueOnce(new Error('disk full'));

    await handlers.handleMarkRefPoint();

    const calls = mockShowToast.mock.calls.map((c) => ({
      message: c[0] as string,
      severity: (c[1] as { severity?: string } | undefined)?.severity,
    }));
    // The in-progress "Saving…" toast fired first…
    expect(calls[0]?.message).toContain('Saving');
    // …and the final toast is an error naming the failed save (reverts it).
    expect(calls.at(-1)?.message).toContain('Could not save');
    expect(calls.at(-1)?.severity).toBe('error');
    // The existing HUD error channel still fires too.
    expect(mockShowError).toHaveBeenCalled();
  });

  it('does NOT show a toast when re-observation is rejected by the cooldown', async () => {
    const { handlers } = setupReObservationFixture();

    await handlers.handleMarkRefPoint();
    expect(mockShowToast).toHaveBeenCalledTimes(1);

    // Second tap inside the 10s cooldown window
    await handlers.handleMarkRefPoint();
    // Still only the first toast — cooldown rejections are silent
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('does NOT show a toast when the OPFS write fails', async () => {
    const { handlers } = setupReObservationFixture();
    mockSaveRefPointObservation.mockRejectedValueOnce(new Error('disk full'));

    await handlers.handleMarkRefPoint();

    // showError is the existing failure feedback channel
    expect(mockShowError).toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Step 5.2 + 5.7 (2026-05-27 slice-collapse plan): refPoints dispatch
// ============================================================================

/**
 * Why these tests matter: `handleMarkRefPoint` must dispatch a
 * `refPoints/addRefPointEntry` action carrying the H3-cell `id`,
 * `timestamp`, `rawGpsPoint`, and the picker/imported `name`. When an
 * alignment matrix is in effect at mark-time the entry's `gpsPoint`
 * snapshot carries the fused lat/lon; otherwise it is omitted
 * (consumers fall back to `rawGpsPoint`). Step 5.7 dropped the
 * previously-parallel `gpsData/markReferencePoint` dispatch — the V2
 * action is now the sole source of truth.
 */
describe('handleMarkRefPoint — refPoints dispatch (Step 5.2 / 5.7)', () => {
  function findV2Dispatch(
    store: RecorderStore
  ): { type: string; payload: unknown } | undefined {
    const dispatchMock = store.dispatch as unknown as {
      mock: { calls: Array<[{ type: string; payload: unknown }]> };
    };
    return dispatchMock.mock.calls
      .map((c) => c[0])
      .find((a) => a?.type === 'refPoints/addRefPointEntry');
  }

  it('dispatches refPoints/addRefPointEntry with id/timestamp/rawGpsPoint/name', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });
    const store = createMockStore([createMockGpsPoint()]);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    const before = Date.now();
    await handlers.handleMarkRefPoint();

    expectMarkDispatchedTimes(store, 1);
    const v2 = findV2Dispatch(store);
    expect(v2).toBeDefined();
    const v2Payload = v2!.payload as {
      id: string;
      timestamp: number;
      name?: string;
      rawGpsPoint: { latitude: number; longitude: number };
    };
    expect(v2Payload.id).toMatch(/^[0-9a-f]{15}$/);
    expect(v2Payload.timestamp).toBeGreaterThanOrEqual(before);
    expect(v2Payload.rawGpsPoint.latitude).toBe(49.0);
    expect(v2Payload.rawGpsPoint.longitude).toBe(8.0);
    expect(v2Payload.name).toBe('bench');
  });

  it('carries the fused snapshot on gpsPoint when an alignment matrix is in effect', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });
    mockFusedGpsFromOdom.mockReturnValueOnce({
      lat: 49.5,
      lon: 8.5,
      altitude: 250,
    });
    const matrix = new Array(16).fill(0) as number[];
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
    const store = createMockStore([createMockGpsPoint()], {
      alignmentMatrix: matrix,
    });
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const v2 = findV2Dispatch(store);
    const v2Payload = v2!.payload as {
      gpsPoint?: { latitude: number; longitude: number; altitude?: number };
      rawGpsPoint: { latitude: number; longitude: number; altitude?: number };
    };
    expect(v2Payload.gpsPoint).toBeDefined();
    expect(v2Payload.gpsPoint!.latitude).toBe(49.5);
    expect(v2Payload.gpsPoint!.longitude).toBe(8.5);
    expect(v2Payload.gpsPoint!.altitude).toBe(250);
    // The raw snapshot is preserved untouched
    expect(v2Payload.rawGpsPoint.latitude).toBe(49.0);
    expect(v2Payload.rawGpsPoint.longitude).toBe(8.0);
  });

  it('omits gpsPoint when no alignment matrix is in effect', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });
    // createMockStore default has alignmentMatrix=null
    const store = createMockStore([createMockGpsPoint()]);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const v2 = findV2Dispatch(store);
    const v2Payload = v2!.payload as { gpsPoint?: unknown };
    expect(v2Payload.gpsPoint).toBeUndefined();
  });

  it('propagates the nearby anchor name on re-observation', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    const store = createMockStore([createMockGpsPoint()]);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    // Imported ref point at the GPS position → re-observation path,
    // picker is bypassed, name comes from the matched anchor.
    seedImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    const v2 = findV2Dispatch(store);
    const v2Payload = v2!.payload as { name?: string };
    expect(v2Payload.name).toBe('Bank');
  });
});

// ============================================================================
// D5 (2026-07-05 folder-import feedback, Finding 5): neighbor-cell
// re-observations must append to the MATCHED definition, not create a sibling.
//
// Why these tests matter: the proximity matcher deliberately tolerates
// gridDisk neighbor cells, but the persist path used the user's CURRENT cell
// as the id — so a re-observation made a few metres off the original spot
// landed in a different refPoints/{id}.json, splitting one physical point's
// observation history into sibling definitions (two anchors/spheres, and
// fragmented data for averaging and the import gap-fill).
// ============================================================================

describe('handleMarkRefPoint — neighbor-cell re-observation routing (D5)', () => {
  const anchorLat = 49.0;
  const anchorLon = 8.0;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
  });

  it('persists a neighbor-cell re-observation under the matched anchor id (no sibling definition)', async () => {
    // ~33m north of the anchor — a neighbor cell at H3 res-11 (~25m edge),
    // still inside the gridDisk(1) match zone (same geometry as the
    // isNeighborCell tests above).
    const gps = createMockGpsPoint({ latitude: 49.0003, longitude: 8.0 });
    const store = createMockStore([gps]);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    populateKnownAnchor(store, {
      name: 'Bench Corner',
      lat: anchorLat,
      lon: anchorLon,
    });

    const anchorCell = gpsToH3(anchorLat, anchorLon);
    const currentCell = gpsToH3(49.0003, 8.0);
    // Sanity: this really is the neighbor-cell case, not same-cell.
    expect(currentCell).not.toBe(anchorCell);

    await handlers.handleMarkRefPoint();

    // Re-observation path (no picker), appended to the MATCHED definition.
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
    expect(mockSaveRefPointObservation).toHaveBeenCalledTimes(1);
    const [, persistedId, persistedName] =
      mockSaveRefPointObservation.mock.calls[0];
    expect(persistedId).toBe(anchorCell);
    expect(persistedName).toBe('Bench Corner');

    // The store entry (visualizer/matcher source) uses the matched id too —
    // one anchor, one sphere.
    expect(getLastV2Payload(store)?.id).toBe(anchorCell);
  });

  it('same-cell re-observation keeps the (identical) matched id — regression pin', async () => {
    const gps = createMockGpsPoint({
      latitude: anchorLat,
      longitude: anchorLon,
    });
    const store = createMockStore([gps]);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    populateKnownAnchor(store, {
      name: 'Bench Corner',
      lat: anchorLat,
      lon: anchorLon,
    });

    await handlers.handleMarkRefPoint();

    const [, persistedId] = mockSaveRefPointObservation.mock.calls[0];
    expect(persistedId).toBe(gpsToH3(anchorLat, anchorLon));
  });
});
