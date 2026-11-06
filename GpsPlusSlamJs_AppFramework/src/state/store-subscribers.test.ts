/**
 * Store Subscribers — Unit Tests
 *
 * Tests for the extracted store subscriber logic (Iteration 4, Risk R2 fix).
 * This module decouples the subscriber wiring from main.ts so both the
 * recording path and the replay path can reuse the same subscriber logic.
 *
 * Why these tests matter:
 * - They verify that the extracted module behaves identically to the closures
 *   that were previously inlined in main.ts.
 * - They enable replay mode (Issue 2) by providing a reusable entry point for
 *   wiring store → visualizer subscriptions.
 * - They serve as regression guardrails: the main.ts refactor must not change
 *   observable behavior.
 */

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LatLong, Matrix4, Vector3, Quaternion } from 'gps-plus-slam-js';
import type { CombinedRootState } from './combined-root-state';
import {
  wireStoreSubscribers,
  type StoreSubscriberDeps,
  type SubscribableStore,
} from './store-subscribers';
import type { MapData } from '../visualization/map-data';

// ---------------------------------------------------------------------------
// Helpers — minimal mock factories
// ---------------------------------------------------------------------------

/** Build a minimal CombinedRootState with only the fields subscribers read. */
function makeState(
  overrides: {
    gpsData?: CombinedRootState['gpsData'];
  } = {}
): CombinedRootState {
  return {
    gpsData: overrides.gpsData ?? null,
    // Subscriber logic only reads gpsData; CombinedRootState
    // also has these other slices, faked as empty objects.
    gpsElements: {} as CombinedRootState['gpsElements'],
    arElements: {} as CombinedRootState['arElements'],
    recording: {} as CombinedRootState['recording'],
    tracking: {} as CombinedRootState['tracking'],
    trackingQuality: {} as CombinedRootState['trackingQuality'],
  };
}

/** Create a mock store whose getState returns the given state, and whose
 *  subscribe stores the listener for manual triggering. */
function makeMockStore(initialState: CombinedRootState) {
  let currentState = initialState;
  const listeners: Array<() => void> = [];

  return {
    store: {
      getState: () => currentState,
      subscribe: (listener: () => void) => {
        listeners.push(listener);
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) {
            listeners.splice(idx, 1);
          }
        };
      },
    } satisfies SubscribableStore,
    /** Replace the state and fire all listeners (simulates a dispatch). */
    setState(newState: CombinedRootState) {
      currentState = newState;
      for (const l of listeners) {
        l();
      }
    },
    /** Number of active listeners */
    get listenerCount() {
      return listeners.length;
    },
  };
}

/** Create a full set of mock deps. */
function makeMockDeps() {
  return {
    applyAlignmentMatrix: vi.fn<(matrix: Matrix4) => void>(),
    gpsEventVisualizer: {
      getZeroRef: vi.fn<() => LatLong | null>().mockReturnValue(null),
      setZeroRef: vi.fn<(zero: LatLong) => void>(),
      addGpsEvent:
        vi.fn<
          (
            gpsCoords: Vector3,
            odomPosition: Vector3,
            accuracy?: { horizontal?: number; vertical?: number }
          ) => void
        >(),
      addAlignmentSnapshot: vi.fn<(nuePosition: Vector3) => void>(),
    },
    mapOverlay: {
      setGpsPosition: vi.fn<(lat: number, lon: number) => void>(),
      render: vi.fn<(data: MapData) => void>(),
    },
  } satisfies StoreSubscriberDeps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wireStoreSubscribers', () => {
  let deps: ReturnType<typeof makeMockDeps>;

  beforeEach(() => {
    deps = makeMockDeps();
  });

  // --- Subscription lifecycle ---

  it('subscribes to the store and returns an unsubscribe function', () => {
    // Why: wireStoreSubscribers must hook into the store's subscribe mechanism.
    // Uses multiple selector subscriptions internally (alignment, GPS, ref points).
    const mock = makeMockStore(makeState());
    expect(mock.listenerCount).toBe(0);

    const unsub = wireStoreSubscribers(mock.store, deps);
    expect(mock.listenerCount).toBeGreaterThan(0);
    expect(typeof unsub).toBe('function');
  });

  it('unsubscribe removes all listeners from the store', () => {
    // Why: callers must be able to tear down subscriptions cleanly
    const mock = makeMockStore(makeState());
    const unsub = wireStoreSubscribers(mock.store, deps);
    expect(mock.listenerCount).toBeGreaterThan(0);

    unsub();
    expect(mock.listenerCount).toBe(0);
  });

  it('after unsubscribe, state changes do not trigger callbacks', () => {
    // Why: prevents leak — after cleanup no deps should be called
    const mock = makeMockStore(makeState());
    const unsub = wireStoreSubscribers(mock.store, deps);
    unsub();

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [],
            odometryPositions: [],
          } as unknown as CombinedRootState['gpsData'] extends infer T
            ? T extends { gpsEvents: infer E }
              ? E
              : never
            : never,
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.applyAlignmentMatrix).not.toHaveBeenCalled();
  });

  // --- Alignment matrix ---

  it('applies alignment matrix when state has one', () => {
    // Why: core responsibility — alignment matrix must reach webxr-session
    const alignmentMatrix = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1,
    ] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix,
            gpsPositions: [],
            odometryPositions: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.applyAlignmentMatrix).toHaveBeenCalledWith(alignmentMatrix);
  });

  it('does not call gpsEventVisualizer.updateAlignment (scene-graph handles it)', () => {
    // Why: after Issue 5, fused markers live in arWorldGroup and get their
    // world position via scene-graph propagation. No manual updateAlignment needed.
    const alignmentMatrix = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix,
            gpsPositions: [],
            odometryPositions: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    // applyAlignmentMatrix should still be called (it sets arWorldGroup.matrix)
    expect(deps.applyAlignmentMatrix).toHaveBeenCalledWith(alignmentMatrix);
    // But no updateAlignment on the visualizer — scene-graph handles it
    expect(
      (deps.gpsEventVisualizer as Record<string, unknown>).updateAlignment
    ).toBeUndefined();
  });

  it('does not apply alignment when gpsData is null', () => {
    // Why: before setZeroPos, gpsData is null — must not crash
    const mock = makeMockStore(makeState({ gpsData: null }));
    wireStoreSubscribers(mock.store, deps);

    // Trigger subscriber with null gpsData
    mock.setState(makeState({ gpsData: null }));

    expect(deps.applyAlignmentMatrix).not.toHaveBeenCalled();
  });

  // --- GPS event visualization ---

  it('sets zero ref on gpsEventVisualizer when available and not yet set', () => {
    // Why: the visualizer uses the zero reference as a readiness gate
    // (addGpsEvent refuses to add markers until one is set). It is NOT used
    // for coordinate math — coords arrive pre-baked from the library reducer.
    deps.gpsEventVisualizer.getZeroRef.mockReturnValue(null);
    const zero = { lat: 50.1, lon: 8.2 };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero,
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [],
            odometryPositions: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.setZeroRef).toHaveBeenCalledWith(zero);
  });

  it('does not set zero ref if already set', () => {
    // Why: setZeroRef is one-shot (idempotent guard). This is safe — not a
    // divergence trap — because the field is only a readiness gate, never a
    // coordinate source, so it never needs to track later store changes.
    deps.gpsEventVisualizer.getZeroRef.mockReturnValue({ lat: 50.1, lon: 8.2 });
    const zero = { lat: 50.1, lon: 8.2 };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero,
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [],
            odometryPositions: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.setZeroRef).not.toHaveBeenCalled();
  });

  it('adds GPS event markers incrementally for new events', () => {
    // Why: core responsibility — new GPS events must produce visualization markers
    const gpsPoint1 = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odom1: Vector3 = [0.5, 0, 0.5];

    const gpsPoint2 = {
      id: 'gps-2',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.002,
      longitude: 8.002,
      coordinates: [2, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now() + 1000,
    };
    const odom2: Vector3 = [1.0, 0, 1.0];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    // First update: 1 GPS event
    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint1],
            odometryPositions: [odom1],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledTimes(1);
    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledWith(
      gpsPoint1.coordinates,
      odom1,
      undefined
    );

    // Second update: 2 GPS events — only the new one should be added
    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint1, gpsPoint2],
            odometryPositions: [odom1, odom2],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledTimes(2);
    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenLastCalledWith(
      gpsPoint2.coordinates,
      odom2,
      undefined
    );
  });

  it('skips GPS events where gpsPoint or odomPos is missing', () => {
    // Why: defensive — incomplete data should be silently skipped, not crash
    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [
              {
                id: 'gps-1',
                zeroRef: { lat: 50, lon: 8 },
                latitude: 50.001,
                longitude: 8.001,
                coordinates: [1, 0, 0] as Vector3,
                weight: 1,
                timestamp: Date.now(),
              },
            ],
            // odometryPositions has no matching entry
            odometryPositions: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.addGpsEvent).not.toHaveBeenCalled();
  });

  // --- showAccuracySpheres flag (rec31 altitude-drop investigation §3) ---
  // Why these tests matter: live recording mode must keep the legacy fixed
  // sphere (large ellipsoids are distracting); replay mode must forward
  // GPS 1σ accuracies so the new visual diagnostic is available.

  it('forwards latLongAccuracy / altitudeAccuracy when showAccuracySpheres is true', () => {
    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      altitude: 240,
      latLongAccuracy: 4.5,
      altitudeAccuracy: 12,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odom: Vector3 = [0.5, 0, 0.5];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, { ...deps, showAccuracySpheres: true });

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint],
            odometryPositions: [odom],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledWith(
      gpsPoint.coordinates,
      odom,
      { horizontal: 4.5, vertical: 12 }
    );
  });

  it('does NOT forward accuracies when showAccuracySpheres is false (default)', () => {
    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      altitude: 240,
      latLongAccuracy: 4.5,
      altitudeAccuracy: 12,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odom: Vector3 = [0.5, 0, 0.5];

    const mock = makeMockStore(makeState());
    // No showAccuracySpheres prop → default false
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint],
            odometryPositions: [odom],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledWith(
      gpsPoint.coordinates,
      odom,
      undefined
    );
  });

  it('passes through undefined accuracy fields when showAccuracySpheres is true', () => {
    // Why: the recording may have missing accuracy on some events (e.g. rec31
    // has altitudeAccuracy === undefined for every sample). The visualizer's
    // defensive fallback expects to see the partial object as-is, not get a
    // synthesized default — that's the visualizer's responsibility, not the
    // subscriber's.
    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      altitude: 240,
      latLongAccuracy: 4.5,
      // altitudeAccuracy intentionally missing
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odom: Vector3 = [0.5, 0, 0.5];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, { ...deps, showAccuracySpheres: true });

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint],
            odometryPositions: [odom],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledWith(
      gpsPoint.coordinates,
      odom,
      { horizontal: 4.5, vertical: undefined }
    );
  });

  // --- Map overlay ---

  it('centers the map on the SAME coordinate the dot shows (fused when aligned)', () => {
    // Why (2026-07-06 fused-dot feedback, Slice B): if the dot moves to the
    // fused position but centering keeps following raw GPS, the dot walks
    // off-center/off-screen exactly in the indoor scenario that motivated
    // the fix. Centering must consume the rebuilt MapData's userPosition —
    // one source of truth, no duplicated fused conversion. With alignment
    // present, that is the fused tip, NOT the raw fix. See
    // gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-06-1526-recorder-live-map-user-dot-fused-pose-user-feedback.md.
    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.123,
      longitude: 8.456,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint],
            odometryPositions: [[0.5, 0, 0.5]],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    // The rendered snapshot's userPosition (fused tip, per Slice A) is the
    // single source of truth for centering.
    const rendered = deps.mapOverlay.render.mock.calls.at(-1)?.[0];
    expect(rendered?.userPosition).toBeTruthy();
    expect(deps.mapOverlay.setGpsPosition).toHaveBeenCalledWith(
      rendered!.userPosition!.lat,
      rendered!.userPosition!.lng
    );
    // …and NOT the raw fix while an alignment exists.
    expect(deps.mapOverlay.setGpsPosition).not.toHaveBeenCalledWith(
      50.123,
      8.456
    );
  });

  it('centers the map on the raw fix while no alignment exists yet', () => {
    // Why: pre-alignment the fused path is empty, so the dot shows the raw
    // fix (decision 2) and centering must follow it — unchanged behavior.
    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.123,
      longitude: 8.456,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: null,
            gpsPositions: [gpsPoint],
            odometryPositions: [[0.5, 0, 0.5]],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.mapOverlay.setGpsPosition).toHaveBeenCalledWith(50.123, 8.456);
  });

  it('centers a render-less mapOverlay on the raw fix (no MapData to follow)', () => {
    // Why: the minimal { setGpsPosition } dep shape is supported; without
    // render there is no rebuilt MapData, so centering keeps the raw fix
    // (decision 6 of the 2026-07-06 doc) instead of paying a fused-path
    // recompute for an overlay that draws nothing.
    const setGpsPosition = vi.fn<(lat: number, lon: number) => void>();
    const depsNoRender: StoreSubscriberDeps = {
      ...deps,
      mapOverlay: { setGpsPosition },
    };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsNoRender);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [
              {
                id: 'gps-1',
                zeroRef: { lat: 50, lon: 8 },
                latitude: 50.123,
                longitude: 8.456,
                coordinates: [1, 0, 0] as Vector3,
                weight: 1,
                timestamp: Date.now(),
              },
            ],
            odometryPositions: [[0.5, 0, 0.5]],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(setGpsPosition).toHaveBeenCalledWith(50.123, 8.456);
  });

  it('keeps centering the map when the overlay render throws', () => {
    // Why: `mapOverlay.render` is an injected, consumer-supplied boundary
    // (Leaflet redraws can fail transiently, e.g. a disposed container racing
    // a late GPS tick). A render throw must neither skip `setGpsPosition`
    // centering nor propagate out of the store listener — an uncaught
    // subscriber exception breaks the whole dispatch chain for that action,
    // and it would recur on every GPS tick (PR #168 review, CodeRabbit).
    deps.mapOverlay.render.mockImplementation(() => {
      throw new Error('leaflet redraw failed');
    });

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    expect(() =>
      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: null,
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.123,
                  longitude: 8.456,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[0.5, 0, 0.5]],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      )
    ).not.toThrow();

    expect(deps.mapOverlay.render).toHaveBeenCalled();
    expect(deps.mapOverlay.setGpsPosition).toHaveBeenCalledWith(50.123, 8.456);
  });

  it('handles null mapOverlay gracefully', () => {
    // Why: replay mode may not have a map overlay (optional dependency)
    const depsNoMap: StoreSubscriberDeps = {
      ...deps,
      mapOverlay: null,
    };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsNoMap);

    // Should not throw when map overlay is null
    expect(() => {
      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[0.5, 0, 0.5]],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );
    }).not.toThrow();
  });

  it('does not update map overlay when no GPS positions exist', () => {
    // Why: before any GPS events, there's nothing to show on the map
    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [],
            odometryPositions: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.mapOverlay.setGpsPosition).not.toHaveBeenCalled();
  });

  it('renders raw GPS path on mapOverlay for new GPS events', () => {
    // Why: The Leaflet map overlay needs the raw GPS breadcrumbs to draw the
    // GPS path polyline. Each store change rebuilds the full MapData snapshot
    // and hands it to render(), so the rendered rawGpsPath must contain every
    // GPS event's lat/lng.
    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps);

    const gpsPoint1 = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const gpsPoint2 = {
      id: 'gps-2',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.002,
      longitude: 8.002,
      coordinates: [2, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint1, gpsPoint2],
            odometryPositions: [
              [0.5, 0, 0.5],
              [1.0, 0, 1.0],
            ],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(deps.mapOverlay.render).toHaveBeenCalled();
    const lastData = (
      deps.mapOverlay.render as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)![0] as MapData;
    expect(lastData.rawGpsPath).toEqual([
      { lat: 50.001, lng: 8.001, accuracy: undefined },
      { lat: 50.002, lng: 8.002, accuracy: undefined },
    ]);
  });

  it('handles mapOverlay without render gracefully', () => {
    // Why: Existing callers may pass a mapOverlay that only has setGpsPosition.
    // The render call is optional-chained and must not throw.
    const depsMinimal: StoreSubscriberDeps = {
      ...deps,
      mapOverlay: {
        setGpsPosition: vi.fn(),
        // No render
      },
    };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsMinimal);

    expect(() => {
      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[0.5, 0, 0.5]],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );
    }).not.toThrow();
  });

  // --- Orbit target auto-follow (Risk R9 fix) ---

  it('calls onNewGpsPosition with the latest GPS coordinates when a new event arrives', () => {
    // Why: In replay mode the orbit camera must auto-follow the latest GPS
    // position so the user sees events as they appear. Without this, the camera
    // stays at the origin and the user sees an empty scene (Risk R9).
    const onNewGpsPosition = vi.fn<(coords: Vector3) => void>();
    const depsWithOrbit: StoreSubscriberDeps = {
      ...deps,
      onNewGpsPosition,
    };

    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [3, 0.5, 7] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odom: Vector3 = [0.5, 0, 0.5];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsWithOrbit);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint],
            odometryPositions: [odom],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(onNewGpsPosition).toHaveBeenCalledTimes(1);
    expect(onNewGpsPosition).toHaveBeenCalledWith([3, 0.5, 7]);
  });

  it('calls onNewGpsPosition with the LAST new GPS coordinate when multiple events arrive', () => {
    // Why: When multiple events arrive at once (e.g. high-speed replay), the
    // orbit target should jump to the most recent position, not intermediate ones.
    const onNewGpsPosition = vi.fn<(coords: Vector3) => void>();
    const depsWithOrbit: StoreSubscriberDeps = {
      ...deps,
      onNewGpsPosition,
    };

    const gpsPoint1 = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const gpsPoint2 = {
      id: 'gps-2',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.002,
      longitude: 8.002,
      coordinates: [2, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now() + 1000,
    };
    const odom1: Vector3 = [0.5, 0, 0.5];
    const odom2: Vector3 = [1.0, 0, 1.0];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsWithOrbit);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint1, gpsPoint2],
            odometryPositions: [odom1, odom2],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    // Called once per new event
    expect(onNewGpsPosition).toHaveBeenCalledTimes(2);
    // Last call should be the latest position
    expect(onNewGpsPosition).toHaveBeenLastCalledWith([2, 0, 0]);
  });

  it('does not call onNewGpsPosition when callback is not provided', () => {
    // Why: The callback is optional — live recording mode does not pass it.
    // Ensures backwards compatibility (no crash when undefined).
    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps); // deps has no onNewGpsPosition

    expect(() => {
      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[0.5, 0, 0.5]],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );
    }).not.toThrow();
  });

  // --- Fresh counter per subscription ---

  it('each wireStoreSubscribers call starts with a fresh event counter', () => {
    // Why: when starting a new recording or replay, the counter must reset.
    // The old inline code used a module-level variable that was manually reset.
    // The extracted version must be self-contained per subscription.
    const gpsPoint1 = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odom1: Vector3 = [0.5, 0, 0.5];

    const stateWithOneEvent = makeState({
      gpsData: {
        zero: { lat: 50, lon: 8 },
        gpsEvents: {
          alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          gpsPositions: [gpsPoint1],
          odometryPositions: [odom1],
        },
        odometryPath: { positions: [], rotations: [] },
      } as unknown as CombinedRootState['gpsData'],
    });

    // First subscription
    const mock = makeMockStore(makeState());
    const unsub1 = wireStoreSubscribers(mock.store, deps);
    mock.setState(stateWithOneEvent);
    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledTimes(1);
    unsub1();

    // Reset mocks
    deps.gpsEventVisualizer.addGpsEvent.mockClear();

    // Second subscription — counter should be fresh, so the same event is added again
    const unsub2 = wireStoreSubscribers(mock.store, deps);
    mock.setState(stateWithOneEvent);
    expect(deps.gpsEventVisualizer.addGpsEvent).toHaveBeenCalledTimes(1);
    unsub2();
  });

  // --- 6.2: arpose odom pose subscriber ---

  it('calls onNewOdomPose with odom position and rotation when a new event arrives', () => {
    // Why: In replay mode the arpose Object3D must receive the recorded
    // odomPosition/odomRotation so camera (child of arpose) moves along
    // the recorded path. Without this subscriber, arpose stays at identity
    // and the replay camera never follows the recorded trajectory.
    const onNewOdomPose =
      vi.fn<(odomPosition: Vector3, odomRotation: Quaternion) => void>();
    const depsWithOdom: StoreSubscriberDeps = {
      ...deps,
      onNewOdomPose,
    };

    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [3, 0.5, 7] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odomPos: Vector3 = [1.5, 0.2, -0.8];
    const odomRot: Quaternion = [0.1, 0.2, 0.3, 0.9];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsWithOdom);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint],
            odometryPositions: [odomPos],
            odometryRotations: [odomRot],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(onNewOdomPose).toHaveBeenCalledTimes(1);
    expect(onNewOdomPose).toHaveBeenCalledWith(odomPos, odomRot);
  });

  it('calls onNewOdomPose for each new event incrementally', () => {
    // Why: When multiple events arrive, onNewOdomPose must fire for each
    // new event so arpose updates incrementally, matching the recording.
    const onNewOdomPose =
      vi.fn<(odomPosition: Vector3, odomRotation: Quaternion) => void>();
    const depsWithOdom: StoreSubscriberDeps = {
      ...deps,
      onNewOdomPose,
    };

    const gpsPoint1 = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [1, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const gpsPoint2 = {
      id: 'gps-2',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.002,
      longitude: 8.002,
      coordinates: [2, 0, 0] as Vector3,
      weight: 1,
      timestamp: Date.now() + 1000,
    };
    const odomPos1: Vector3 = [0.5, 0, 0.5];
    const odomRot1: Quaternion = [0, 0, 0, 1];
    const odomPos2: Vector3 = [1.0, 0, 1.0];
    const odomRot2: Quaternion = [0.1, 0.2, 0.3, 0.9];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsWithOdom);

    // First update: 1 event
    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint1],
            odometryPositions: [odomPos1],
            odometryRotations: [odomRot1],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );
    expect(onNewOdomPose).toHaveBeenCalledTimes(1);

    // Second update: 2 events — only the new one fires
    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint1, gpsPoint2],
            odometryPositions: [odomPos1, odomPos2],
            odometryRotations: [odomRot1, odomRot2],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );
    expect(onNewOdomPose).toHaveBeenCalledTimes(2);
    expect(onNewOdomPose).toHaveBeenLastCalledWith(odomPos2, odomRot2);
  });

  it('does not crash when onNewOdomPose is not provided', () => {
    // Why: Live recording mode does not pass onNewOdomPose (arpose is
    // identity during recording). Must not crash.
    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps); // deps has no onNewOdomPose

    expect(() => {
      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[0.5, 0, 0.5]],
              odometryRotations: [[0, 0, 0, 1]],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );
    }).not.toThrow();
  });

  it('skips onNewOdomPose when odom rotation is missing for an event', () => {
    // Why: Defensive — if odometryRotations array is shorter than
    // odometryPositions, skip rather than pass undefined.
    const onNewOdomPose =
      vi.fn<(odomPosition: Vector3, odomRotation: Quaternion) => void>();
    const depsWithOdom: StoreSubscriberDeps = {
      ...deps,
      onNewOdomPose,
    };

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsWithOdom);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [
              {
                id: 'gps-1',
                zeroRef: { lat: 50, lon: 8 },
                latitude: 50.001,
                longitude: 8.001,
                coordinates: [1, 0, 0] as Vector3,
                weight: 1,
                timestamp: Date.now(),
              },
            ],
            odometryPositions: [[0.5, 0, 0.5]],
            // odometryRotations is empty — no matching rotation
            odometryRotations: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(onNewOdomPose).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Alignment snapshot collection (Issue #1 — feedback session 2026-03-21)
  // ---------------------------------------------------------------------------
  describe('alignment snapshot collection', () => {
    const identity = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ] as Matrix4;
    const translation5 = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1,
    ] as Matrix4;
    const translation10 = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1,
    ] as Matrix4;

    function makeGpsState(
      overrides: {
        alignmentMatrix?: Matrix4 | null;
        gpsPositions?: Array<{
          latitude: number;
          longitude: number;
          zeroRef: LatLong;
          coordinates: Vector3;
          weight: number;
          timestamp: number;
        }>;
        odometryPositions?: Vector3[];
      } = {}
    ): CombinedRootState {
      return makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: overrides.alignmentMatrix ?? null,
            gpsPositions: overrides.gpsPositions ?? [],
            odometryPositions: overrides.odometryPositions ?? [],
            odometryRotations: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      });
    }

    it('calls addAlignmentSnapshot when alignment matrix first appears', () => {
      // Why: the first alignment update after the system starts is the first
      // "best GPS estimate" — it must be captured as a snapshot.
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, deps);

      // State change: alignment matrix appears with an odom position
      mock.setState(
        makeGpsState({
          alignmentMatrix: identity,
          gpsPositions: [
            {
              latitude: 50,
              longitude: 8,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [[1, 2, 3]],
        })
      );

      expect(
        deps.gpsEventVisualizer.addAlignmentSnapshot
      ).toHaveBeenCalledTimes(1);
      // identity × [1,2,3] = [1,2,3]
      const callArg =
        deps.gpsEventVisualizer.addAlignmentSnapshot.mock.calls[0][0];
      expect(callArg[0]).toBeCloseTo(1);
      expect(callArg[1]).toBeCloseTo(2);
      expect(callArg[2]).toBeCloseTo(3);
    });

    it('calls addAlignmentSnapshot when alignment matrix changes', () => {
      // Why: each alignment re-computation (after new GPS data) produces a
      // better GPS estimate — the snapshot captures the estimate at that time.
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, deps);

      // First alignment
      mock.setState(
        makeGpsState({
          alignmentMatrix: translation5,
          gpsPositions: [
            {
              latitude: 50,
              longitude: 8,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [[1, 0, 0]],
        })
      );
      expect(
        deps.gpsEventVisualizer.addAlignmentSnapshot
      ).toHaveBeenCalledTimes(1);

      // Second alignment (matrix changed)
      mock.setState(
        makeGpsState({
          alignmentMatrix: translation10,
          gpsPositions: [
            {
              latitude: 50,
              longitude: 8,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
            {
              latitude: 50.001,
              longitude: 8.001,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [5, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [
            [1, 0, 0],
            [2, 0, 0],
          ],
        })
      );
      expect(
        deps.gpsEventVisualizer.addAlignmentSnapshot
      ).toHaveBeenCalledTimes(2);

      // Second snapshot uses translation10 × [2,0,0] = [12, 0, 0]
      const call2 =
        deps.gpsEventVisualizer.addAlignmentSnapshot.mock.calls[1][0];
      expect(call2[0]).toBeCloseTo(12);
    });

    it('does NOT call addAlignmentSnapshot when alignment matrix is unchanged', () => {
      // Why: same alignment matrix means no new GPS data — no new snapshot needed.
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, deps);

      const state = makeGpsState({
        alignmentMatrix: identity,
        gpsPositions: [
          {
            latitude: 50,
            longitude: 8,
            zeroRef: { lat: 50, lon: 8 },
            coordinates: [0, 0, 0],
            weight: 1,
            timestamp: Date.now(),
          },
        ],
        odometryPositions: [[1, 0, 0]],
      });

      mock.setState(state);
      expect(
        deps.gpsEventVisualizer.addAlignmentSnapshot
      ).toHaveBeenCalledTimes(1);

      // Same state again (alignment unchanged — same object reference)
      mock.setState(state);
      expect(
        deps.gpsEventVisualizer.addAlignmentSnapshot
      ).toHaveBeenCalledTimes(1);
    });

    it('does NOT call addAlignmentSnapshot when there are no odom positions', () => {
      // Why: without an odometry position we have nothing to transform
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, deps);

      mock.setState(
        makeGpsState({
          alignmentMatrix: identity,
          odometryPositions: [],
        })
      );

      expect(
        deps.gpsEventVisualizer.addAlignmentSnapshot
      ).not.toHaveBeenCalled();
    });

    it('uses the latest odometry position for the snapshot', () => {
      // Why: the latest odom position is the current device position
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, deps);

      mock.setState(
        makeGpsState({
          alignmentMatrix: translation5,
          gpsPositions: [
            {
              latitude: 50,
              longitude: 8,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
            {
              latitude: 50.001,
              longitude: 8.001,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [5, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [
            [1, 0, 0],
            [3, 0, 0],
          ],
        })
      );

      // translation5 × [3,0,0] = [8, 0, 0] (uses last odom, not first)
      const callArg =
        deps.gpsEventVisualizer.addAlignmentSnapshot.mock.calls[0][0];
      expect(callArg[0]).toBeCloseTo(8);
    });

    it('computes correct NUE position with a non-trivial alignment matrix', () => {
      // Why: verifies the matrix×vector math is correct for arbitrary transforms
      // This matrix translates by (10, 20, 30) — column-major
      const translationMatrix = [
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1,
      ] as Matrix4;

      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, deps);

      mock.setState(
        makeGpsState({
          alignmentMatrix: translationMatrix,
          gpsPositions: [
            {
              latitude: 50,
              longitude: 8,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [[5, 0, 0]],
        })
      );

      // translation(10,20,30) × [5,0,0] = [15, 20, 30]
      const callArg =
        deps.gpsEventVisualizer.addAlignmentSnapshot.mock.calls[0][0];
      expect(callArg[0]).toBeCloseTo(15);
      expect(callArg[1]).toBeCloseTo(20);
      expect(callArg[2]).toBeCloseTo(30);
    });
  });

  // ---------------------------------------------------------------------------
  // onAlignmentSnapshot callback (Issue #3 — feedback session 2026-03-21)
  // ---------------------------------------------------------------------------
  describe('onAlignmentSnapshot callback', () => {
    const translation5 = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1,
    ] as Matrix4;

    function makeGpsState(
      overrides: {
        alignmentMatrix?: Matrix4 | null;
        gpsPositions?: Array<{
          latitude: number;
          longitude: number;
          zeroRef: LatLong;
          coordinates: Vector3;
          weight: number;
          timestamp: number;
        }>;
        odometryPositions?: Vector3[];
      } = {}
    ): CombinedRootState {
      return makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: overrides.alignmentMatrix ?? null,
            gpsPositions: overrides.gpsPositions ?? [],
            odometryPositions: overrides.odometryPositions ?? [],
            odometryRotations: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      });
    }

    it('calls onAlignmentSnapshot with the transformed NUE position when alignment changes', () => {
      // Why (Issue #3): Replay mode needs the snapshot NUE position to
      // update the orbit camera target. The onAlignmentSnapshot callback
      // provides this without coupling store-subscribers to the scene.
      const onAlignmentSnapshot = vi.fn();
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, { ...deps, onAlignmentSnapshot });

      mock.setState(
        makeGpsState({
          alignmentMatrix: translation5,
          gpsPositions: [
            {
              latitude: 50,
              longitude: 8,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [[2, 0, 0]],
        })
      );

      expect(onAlignmentSnapshot).toHaveBeenCalledTimes(1);
      // translation5 × [2,0,0] = [7, 0, 0]
      const callArg = onAlignmentSnapshot.mock.calls[0][0] as number[];
      expect(callArg[0]).toBeCloseTo(7);
      expect(callArg[1]).toBeCloseTo(0);
      expect(callArg[2]).toBeCloseTo(0);
    });

    it('is optional — no crash when omitted', () => {
      // Why: live recording mode does not need this callback
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, deps); // deps has no onAlignmentSnapshot

      expect(() =>
        mock.setState(
          makeGpsState({
            alignmentMatrix: translation5,
            gpsPositions: [
              {
                latitude: 50,
                longitude: 8,
                zeroRef: { lat: 50, lon: 8 },
                coordinates: [0, 0, 0],
                weight: 1,
                timestamp: Date.now(),
              },
            ],
            odometryPositions: [[1, 0, 0]],
          })
        )
      ).not.toThrow();
    });
  });

  // --- onNewGpsLatLng callback ---

  /**
   * Why these tests matter:
   * The onNewGpsLatLng callback enables live ref point button label updates
   * by forwarding raw lat/lng from each GPS event to the caller. This follows
   * the same optional callback pattern as onNewGpsPosition / onNewOdomPose.
   * See: docs/2026-03-21-live-ref-point-button-plan.md, Change C.
   */

  it('calls onNewGpsLatLng with latitude and longitude of each new GPS event', () => {
    const onNewGpsLatLng = vi.fn<(lat: number, lng: number) => void>();
    const depsWithLatLng: StoreSubscriberDeps = {
      ...deps,
      onNewGpsLatLng,
    };

    const gpsPoint = {
      id: 'gps-1',
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50.001,
      longitude: 8.001,
      coordinates: [3, 0.5, 7] as Vector3,
      weight: 1,
      timestamp: Date.now(),
    };
    const odom: Vector3 = [0.5, 0, 0.5];

    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, depsWithLatLng);

    mock.setState(
      makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gpsPositions: [gpsPoint],
            odometryPositions: [odom],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      })
    );

    expect(onNewGpsLatLng).toHaveBeenCalledTimes(1);
    expect(onNewGpsLatLng).toHaveBeenCalledWith(50.001, 8.001);
  });

  it('does not call onNewGpsLatLng when callback is not provided', () => {
    const mock = makeMockStore(makeState());
    wireStoreSubscribers(mock.store, deps); // deps has no onNewGpsLatLng

    expect(() => {
      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[0.5, 0, 0.5]],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );
    }).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Phase 1b: Map overlay — fused path, alignment snapshots, reference points
  // ---------------------------------------------------------------------------

  describe('map overlay fused path (render)', () => {
    // Why these tests matter:
    // The Leaflet map overlay shows a cyan fused path polyline. On each store
    // change the subscriber rebuilds the full MapData snapshot — whose fused
    // path is recomputed from the latest alignment matrix (D2) — and hands it
    // to render(). These tests assert the rendered fusedPath is correct.

    function lastRenderData(d: StoreSubscriberDeps): MapData {
      return (d.mapOverlay!.render as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )![0] as MapData;
    }

    it('renders fused GPS coordinates for new events', () => {
      // Why: the fused path is the alignment-corrected trajectory and must
      // appear as a cyan polyline on the Leaflet map overlay.
      const depsWithFused: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: {
          setGpsPosition: vi.fn(),
          render: vi.fn<(data: MapData) => void>(),
        },
      };

      const mock = makeMockStore(makeState());
      wireStoreSubscribers(mock.store, depsWithFused);

      // Identity alignment matrix — fused = raw odom in NUE
      // odom [10, 0, 0] in NUE (North=10m, Up=0, East=0)
      // zero (50, 8) → fused lat ≈ 50 + 10/110989 ≈ 50.0000901
      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[10, 0, 0] as Vector3],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );

      const data = lastRenderData(depsWithFused);
      expect(data.fusedPath).toHaveLength(1);
      // 10m north from lat 50 → lat ≈ 50 + 10/110989
      expect(data.fusedPath[0]!.lat).toBeCloseTo(50 + 10 / 110989, 4);
      expect(data.fusedPath[0]!.lng).toBeCloseTo(8, 4);
    });

    it('threads the user heading from the latest odometry rotation (Finding 2)', () => {
      // Why: the live overlay draws a true-north view-direction line. The
      // subscriber must feed selectOdometryRotations into buildMapData so the
      // rendered MapData carries userHeadingDeg. Identity rotation + identity
      // alignment ⇒ the camera looks North ⇒ heading 0.
      const depsWithFused: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: {
          setGpsPosition: vi.fn(),
          render: vi.fn<(data: MapData) => void>(),
        },
      };

      const mock = makeMockStore(makeState());
      wireStoreSubscribers(mock.store, depsWithFused);

      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[10, 0, 0] as Vector3],
              odometryRotations: [[0, 0, 0, 1]],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );

      const data = lastRenderData(depsWithFused);
      expect(data.userHeadingDeg).not.toBeNull();
      expect(data.userHeadingDeg!).toBeCloseTo(0, 3);
    });

    it('renders an empty fused path when the alignment matrix is missing', () => {
      // Why: without alignment, the fused transform is undefined — skip.
      const depsWithFused: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: {
          setGpsPosition: vi.fn(),
          render: vi.fn<(data: MapData) => void>(),
        },
      };

      const mock = makeMockStore(makeState());
      wireStoreSubscribers(mock.store, depsWithFused);

      mock.setState(
        makeState({
          gpsData: {
            zero: { lat: 50, lon: 8 },
            gpsEvents: {
              alignmentMatrix: null as unknown as Matrix4,
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[10, 0, 0] as Vector3],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );

      const data = lastRenderData(depsWithFused);
      expect(data.fusedPath).toEqual([]);
    });

    it('renders an empty fused path when zeroRef is missing', () => {
      // Why: without the GPS origin, NUE→GPS conversion is impossible.
      const depsWithFused: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: {
          setGpsPosition: vi.fn(),
          render: vi.fn<(data: MapData) => void>(),
        },
      };

      const mock = makeMockStore(makeState());
      wireStoreSubscribers(mock.store, depsWithFused);

      mock.setState(
        makeState({
          gpsData: {
            zero: null as unknown as { lat: number; lon: number },
            gpsEvents: {
              alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              gpsPositions: [
                {
                  id: 'gps-1',
                  zeroRef: { lat: 50, lon: 8 },
                  latitude: 50.001,
                  longitude: 8.001,
                  coordinates: [1, 0, 0] as Vector3,
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[10, 0, 0] as Vector3],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );

      const data = lastRenderData(depsWithFused);
      expect(data.fusedPath).toEqual([]);
    });

    it('handles mapOverlay without render gracefully', () => {
      // Why: existing callers may not provide render — must not crash.
      const depsNoRender: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: { setGpsPosition: vi.fn() },
      };
      const mock = makeMockStore(makeState());
      wireStoreSubscribers(mock.store, depsNoRender);

      expect(() => {
        mock.setState(
          makeState({
            gpsData: {
              zero: { lat: 50, lon: 8 },
              gpsEvents: {
                alignmentMatrix: [
                  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
                ],
                gpsPositions: [
                  {
                    id: 'gps-1',
                    zeroRef: { lat: 50, lon: 8 },
                    latitude: 50.001,
                    longitude: 8.001,
                    coordinates: [1, 0, 0] as Vector3,
                    weight: 1,
                    timestamp: Date.now(),
                  },
                ],
                odometryPositions: [[0.5, 0, 0.5]],
              },
              odometryPath: { positions: [], rotations: [] },
            } as unknown as CombinedRootState['gpsData'],
          })
        );
      }).not.toThrow();
    });
  });

  describe('map overlay alignment snapshots (addAlignmentSnapshot)', () => {
    // Why these tests matter:
    // When the alignment matrix changes, a snapshot NUE position is computed.
    // The subscriber already calls gpsEventVisualizer.addAlignmentSnapshot (3D).
    // It must also call mapOverlay.addAlignmentSnapshot with GPS lat/lon (2D).

    const identity = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ] as Matrix4;

    function makeGpsState(
      overrides: {
        alignmentMatrix?: Matrix4 | null;
        gpsPositions?: Array<{
          latitude: number;
          longitude: number;
          zeroRef: { lat: number; lon: number };
          coordinates: Vector3;
          weight: number;
          timestamp: number;
        }>;
        odometryPositions?: Vector3[];
      } = {}
    ): CombinedRootState {
      return makeState({
        gpsData: {
          zero: { lat: 50, lon: 8 },
          gpsEvents: {
            alignmentMatrix: overrides.alignmentMatrix ?? null,
            gpsPositions: overrides.gpsPositions ?? [],
            odometryPositions: overrides.odometryPositions ?? [],
            odometryRotations: [],
          },
          odometryPath: { positions: [], rotations: [] },
        } as unknown as CombinedRootState['gpsData'],
      });
    }

    it('renders alignment snapshot GPS coords when alignment changes', () => {
      // Why: the 2D map needs a red snapshot polyline; the snapshot GPS coords
      // are accumulated and passed through render() in MapData.alignmentSnapshots.
      const depsWithSnapshot: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: {
          setGpsPosition: vi.fn(),
          render: vi.fn<(data: MapData) => void>(),
        },
      };

      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, depsWithSnapshot);

      // identity × [10, 0, 0] = [10, 0, 0] (NUE: north=10, up=0, east=0)
      mock.setState(
        makeGpsState({
          alignmentMatrix: identity,
          gpsPositions: [
            {
              latitude: 50,
              longitude: 8,
              zeroRef: { lat: 50, lon: 8 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [[10, 0, 0]],
        })
      );

      const renderMock = depsWithSnapshot.mapOverlay!.render as ReturnType<
        typeof vi.fn
      >;
      expect(renderMock).toHaveBeenCalled();
      const data = renderMock.mock.calls.at(-1)![0] as MapData;
      expect(data.alignmentSnapshots).toHaveLength(1);
      expect(data.alignmentSnapshots[0]!.lat).toBeCloseTo(50 + 10 / 110989, 4);
      expect(data.alignmentSnapshots[0]!.lng).toBeCloseTo(8, 4);
    });

    it('renders no alignment snapshots when zeroRef is missing', () => {
      // Why: without GPS origin, NUE→GPS conversion is impossible.
      const depsWithSnapshot: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: {
          setGpsPosition: vi.fn(),
          render: vi.fn<(data: MapData) => void>(),
        },
      };

      const mock = makeMockStore(
        makeState({
          gpsData: {
            zero: null,
            gpsEvents: {
              alignmentMatrix: null,
              gpsPositions: [],
              odometryPositions: [],
              odometryRotations: [],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );
      wireStoreSubscribers(mock.store, depsWithSnapshot);

      mock.setState(
        makeState({
          gpsData: {
            zero: null,
            gpsEvents: {
              alignmentMatrix: identity,
              gpsPositions: [
                {
                  latitude: 50,
                  longitude: 8,
                  zeroRef: { lat: 50, lon: 8 },
                  coordinates: [0, 0, 0],
                  weight: 1,
                  timestamp: Date.now(),
                },
              ],
              odometryPositions: [[10, 0, 0]],
              odometryRotations: [],
            },
            odometryPath: { positions: [], rotations: [] },
          } as unknown as CombinedRootState['gpsData'],
        })
      );

      const renderMock = depsWithSnapshot.mapOverlay!.render as ReturnType<
        typeof vi.fn
      >;
      const lastData = renderMock.mock.calls.at(-1)?.[0] as MapData | undefined;
      expect(lastData?.alignmentSnapshots ?? []).toEqual([]);
    });

    it('handles mapOverlay without render gracefully', () => {
      // Why: existing callers may not provide render — must not crash.
      const depsNoRender: StoreSubscriberDeps = {
        ...deps,
        mapOverlay: { setGpsPosition: vi.fn() },
      };
      const mock = makeMockStore(makeGpsState());
      wireStoreSubscribers(mock.store, depsNoRender);

      expect(() => {
        mock.setState(
          makeGpsState({
            alignmentMatrix: identity,
            gpsPositions: [
              {
                latitude: 50,
                longitude: 8,
                zeroRef: { lat: 50, lon: 8 },
                coordinates: [0, 0, 0],
                weight: 1,
                timestamp: Date.now(),
              },
            ],
            odometryPositions: [[10, 0, 0]],
          })
        );
      }).not.toThrow();
    });
  });

  // RefPoint visualizer subscriptions moved to RecorderApp in Iter 3 of the
  // AppFramework / RecorderApp boundary migration. See
  // gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md
});
