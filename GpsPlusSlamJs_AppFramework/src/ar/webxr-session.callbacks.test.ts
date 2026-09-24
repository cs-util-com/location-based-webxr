/**
 * initAR `callbacks` contract tests (surface-reduction step 1, 2026-07-11).
 *
 * Why these tests matter:
 * The 13 pre-init setter exports were folded into a single `ArSessionCallbacks`
 * struct passed to initAR. These tests pin the new contract:
 *  - the `tracking` group arrives as store + callbacks TOGETHER: initAR resets
 *    the slice and wires the phase→callback translation in one step (the old
 *    half-wired setTrackingStore/setTrackingCallbacks split is impossible),
 *  - phase transitions on the injected store fire the host's
 *    onLost / onRestarted / onRecovered callbacks,
 *  - `rebindTrackingStore` (the ONE runtime mutation that survived the fold,
 *    for the recorder's per-recording store swap) detaches the previous
 *    store's phase subscription — exactly the old setter's semantics.
 *
 * This file is isolated from webxr-session.test.ts because it mocks
 * THREE.WebGLRenderer and navigator.xr (same pattern as
 * webxr-session.init-guard.test.ts / webxr-session.session-end.test.ts).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as THREE from 'three';

// A reference space the rebind test can fire `reset` on; null (the old
// behaviour) for every other test.
const hoisted = vi.hoisted(() => ({
  referenceSpace: null as EventTarget | null,
}));

// Mock only WebGLRenderer (jsdom has no WebGL context). Spreading `...actual`
// keeps every other THREE export real.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();

  class MockWebGLRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    setAnimationLoop = vi.fn();
    xr = {
      enabled: false,
      setSession: vi.fn().mockResolvedValue(undefined),
      getReferenceSpace: vi.fn(() => hoisted.referenceSpace),
    };
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

import {
  initAR,
  resetWebXRState,
  rebindTrackingStore,
  type TrackingSubscribableStore,
} from './webxr-session.js';
import {
  resetTracking,
  type TrackingPhase,
  type TrackingSliceState,
} from '../state/tracking-slice.js';
import type { OdometryTrackingRestartedPayload } from 'gps-plus-slam-js';

const MINIMAL_ISOLATION = {
  enableDomOverlay: false,
  enableCameraAccess: false,
  enableDepthSensingFeature: false,
  enableCss3dRenderer: false,
  enableCameraTextureAcquisition: false,
  applyChromiumProjectionLayerWorkaround: false,
};

/**
 * Minimal hand-rolled store satisfying {@link TrackingSubscribableStore}:
 * records dispatches, lets the test flip the tracking phase and notify
 * subscribers synchronously (like a real Redux store would).
 */
function createFakeTrackingStore() {
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const listeners = new Set<() => void>();
  let phase: TrackingPhase = 'initializing';
  let lastRestartedPayload: OdometryTrackingRestartedPayload | null = null;

  const store: TrackingSubscribableStore = {
    dispatch: (action) => {
      dispatched.push(action);
      return action;
    },
    getState: () => ({
      tracking: { phase, lastRestartedPayload } as TrackingSliceState,
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    store,
    dispatched,
    listeners,
    setPhase(
      next: TrackingPhase,
      payload: OdometryTrackingRestartedPayload | null = null
    ): void {
      phase = next;
      lastRestartedPayload = payload;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('initAR callbacks.tracking wiring', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetWebXRState();
    container = document.createElement('div');
    document.body.appendChild(container);

    const mockSession = {
      addEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('navigator', {
      xr: {
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
    });
  });

  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    container.remove();
    hoisted.referenceSpace = null;
  });

  it('resets the tracking slice and subscribes to the injected store at init', async () => {
    const fake = createFakeTrackingStore();

    await initAR(
      container,
      MINIMAL_ISOLATION,
      {},
      {
        tracking: { store: fake.store },
      }
    );

    // Clean-slate dispatch so the previous session's phase cannot leak.
    expect(fake.dispatched).toContainEqual(resetTracking());
    // Phase subscription established (store + callbacks arrive together —
    // there is no half-wired state to warn about any more).
    expect(fake.listeners.size).toBe(1);
  });

  it('translates phase transitions into the host onLost/onRestarted/onRecovered callbacks', async () => {
    const fake = createFakeTrackingStore();
    const onLost = vi.fn();
    const onRecovered = vi.fn();
    const onRestarted = vi.fn();

    await initAR(
      container,
      MINIMAL_ISOLATION,
      {},
      {
        tracking: { store: fake.store, onLost, onRecovered, onRestarted },
      }
    );

    // initializing → tracking: initial acquisition, no callback.
    fake.setPhase('tracking');
    // tracking → lost
    fake.setPhase('lost');
    expect(onLost).toHaveBeenCalledTimes(1);
    // lost → tracking with a restart payload (Case 2)
    const payload = {
      odomOffset: [0, 0, 0],
    } as unknown as OdometryTrackingRestartedPayload;
    fake.setPhase('tracking', payload);
    expect(onRestarted).toHaveBeenCalledWith(payload);
    // tracking → lost → tracking with NO payload (Case 1: seamless recovery)
    fake.setPhase('lost');
    fake.setPhase('tracking');
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  // Why this test matters (2026-07-11-1811-tracking-rebind-dormant-phase-
  // subscription-followup.md; QR near-frontal pose plan §22-§23): the
  // recorder swaps its store on every Start Recording. The rebind used to
  // tear the phase subscription down WITHOUT re-subscribing, so for the
  // rest of the session no onLost / onRestarted fired - no restart action
  // was recorded, no QR frame epoch moved, no alignment re-basing happened.
  // The subscription must MOVE to the new store.
  it('rebindTrackingStore moves the phase subscription to the new store mid-session', async () => {
    const first = createFakeTrackingStore();
    const onLost = vi.fn();
    const onRestarted = vi.fn();
    await initAR(
      container,
      MINIMAL_ISOLATION,
      {},
      { tracking: { store: first.store, onLost, onRestarted } }
    );
    expect(first.listeners.size).toBe(1);

    const second = createFakeTrackingStore();
    rebindTrackingStore(second.store);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);

    // The OLD store's transitions no longer reach the host ...
    first.setPhase('tracking');
    first.setPhase('lost');
    expect(onLost).not.toHaveBeenCalled();
    // ... the NEW store's do, restarts included (with the clean-up dispatch).
    const payload = {} as OdometryTrackingRestartedPayload;
    second.setPhase('tracking');
    second.setPhase('lost');
    expect(onLost).toHaveBeenCalledTimes(1);
    second.setPhase('tracking', payload);
    expect(onRestarted).toHaveBeenCalledWith(payload);
    expect(
      second.dispatched.some(
        (a) => a.type === 'tracking/clearLastRestartedPayload'
      )
    ).toBe(true);
  });

  // Without a live session there is nothing to move: initAR subscribes.
  it('rebindTrackingStore before initAR subscribes to nothing', () => {
    const fake = createFakeTrackingStore();
    rebindTrackingStore(fake.store);
    expect(fake.listeners.size).toBe(0);
  });

  // The reference space's reset listener must dispatch the origin reset into
  // the CURRENT store, not the one captured at initAR (it used to keep
  // writing into the orphaned boot store).
  it('dispatches a reference-space reset into the rebound store', async () => {
    const space = new EventTarget();
    hoisted.referenceSpace = space;
    const first = createFakeTrackingStore();
    await initAR(
      container,
      MINIMAL_ISOLATION,
      {},
      { tracking: { store: first.store } }
    );
    const second = createFakeTrackingStore();
    rebindTrackingStore(second.store);
    const before = first.dispatched.length;
    space.dispatchEvent(new Event('reset'));
    expect(first.dispatched.length).toBe(before);
    expect(
      second.dispatched.some((a) => a.type === 'tracking/originReset')
    ).toBe(true);
  });

  it('does not touch tracking when the group is absent', async () => {
    const fake = createFakeTrackingStore();

    await initAR(container, MINIMAL_ISOLATION);

    expect(fake.dispatched).toHaveLength(0);
    expect(fake.listeners.size).toBe(0);
  });
});
