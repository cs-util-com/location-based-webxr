// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type {
  SunCheck,
  SunCheckDeps,
} from 'gps-plus-slam-app-framework/ar/sun-check';

import type { RecorderStore } from '../state/recorder-store';
import { createStoreRef } from '../state/store-ref';
import {
  attachSunCheckToSession,
  createRecorderSunCheck,
  sunCheckStoreReaders,
} from './recorder-sun-check';
import { SUN_SAFETY_NOTE } from './sun-check-ui';

/** A store whose state is only what the sun check reads. */
const storeWith = (gpsData: unknown) =>
  ({ getState: () => ({ gpsData }) }) as unknown as RecorderStore;

/** A pure yaw of `deg` clockwise from north, as an NUE column-major matrix. */
const yawMatrix = (deg: number): number[] => {
  const m = new THREE.Matrix4().makeRotationY((-deg * Math.PI) / 180);
  return m.toArray();
};

describe('sunCheckStoreReaders', () => {
  // WHY: the library's LatLong spells longitude `lon`, the check's `lng`;
  // passing the state through unmapped would compute the sun at longitude
  // undefined (the sidecar's own example had this wrong).
  it('maps the zero reference to lat/lng, or null before the first fix', () => {
    const ref = createStoreRef(storeWith({ zero: { lat: 50.9, lon: 6.9 } }));
    expect(sunCheckStoreReaders(ref).getZeroReference()).toEqual({
      lat: 50.9,
      lng: 6.9,
    });
    ref.set(storeWith(null));
    expect(sunCheckStoreReaders(ref).getZeroReference()).toBeNull();
  });

  // WHY: the recorder swaps stores per recording; the readers must follow
  // the swap, never a captured store (the store-ref rule).
  it('reads the CURRENT store at every call', () => {
    const ref = createStoreRef(storeWith({ zero: { lat: 1, lon: 2 } }));
    const readers = sunCheckStoreReaders(ref);
    ref.set(storeWith({ zero: { lat: 3, lon: 4 } }));
    expect(readers.getZeroReference()).toEqual({ lat: 3, lng: 4 });
  });

  // WHY: the target yaw must use the SAME convention as the drawn yaw the
  // controller reads from the scene (alignmentYawDeg), or "target changed"
  // would fire on every Mark.
  it('gives the target yaw clockwise from north, or null without an alignment', () => {
    const ref = createStoreRef(
      storeWith({ gpsEvents: { alignmentMatrix: yawMatrix(30) } })
    );
    const yaw = sunCheckStoreReaders(ref).getTargetYawDeg?.();
    expect(yaw).toBeCloseTo(30, 9);
    ref.set(storeWith({ gpsEvents: {} }));
    expect(sunCheckStoreReaders(ref).getTargetYawDeg?.()).toBeNull();
  });
});

describe('createRecorderSunCheck', () => {
  const setup = (scene: THREE.Object3D | null) => {
    document.body.innerHTML = '<div id="app"></div>';
    const start = vi.fn(
      (_deps: SunCheckDeps) =>
        ({
          marker: {},
          status: () => ({ visible: false, hiddenBecause: 'no-position' }),
          mark: vi.fn(),
          dispose: vi.fn(),
        }) as unknown as SunCheck
    );
    const confirm = vi.fn(() => Promise.resolve(true));
    const showToast = vi.fn();
    const ui = createRecorderSunCheck({
      storeRef: createStoreRef(storeWith(null)),
      appContainer: document.getElementById('app')!,
      getScene: () => scene,
      getArWorldGroup: () => (scene ? new THREE.Group() : null),
      isStopInProgress: () => false,
      isReplaying: () => false,
      showToast,
      confirm,
      start,
    });
    return { ui, start, confirm, showToast };
  };

  it('shows the safety note with the plan text, then starts on the live scene', async () => {
    const scene = new THREE.Scene();
    const { ui, start, confirm } = setup(scene);
    ui.attach();
    expect(await ui.setEnabled(true)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: SUN_SAFETY_NOTE })
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0].scene).toBe(scene);
  });

  it('refuses to start without a live AR scene, with an error toast', async () => {
    const { ui, start, showToast } = setup(null);
    ui.attach();
    expect(await ui.setEnabled(true)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('no AR scene'),
      expect.objectContaining({ severity: 'error' })
    );
  });
});

describe('attachSunCheckToSession', () => {
  /**
   * A session-disposer registry that honours `unregister`, like the
   * framework's, and a scope that records its entries.
   */
  const harness = () => {
    const ui = { attach: vi.fn(), detach: vi.fn() } as unknown as Parameters<
      typeof attachSunCheckToSession
    >[0];
    let disposers: Array<() => void> = [];
    const scoped: Array<() => void> = [];
    attachSunCheckToSession(
      ui,
      {
        add: (_n: string, d: () => void) => scoped.push(d),
        wire: vi.fn(),
      } as never,
      (d) => {
        disposers.push(d);
        return () => {
          disposers = disposers.filter((x) => x !== d);
        };
      }
    );
    const endSession = () => {
      const run = disposers;
      disposers = [];
      for (const d of run) d();
    };
    const unwindScope = () => {
      for (const d of scoped) d();
    };
    return { ui, endSession, unwindScope, pending: () => disposers.length };
  };

  // WHY: the recorder's scope unwinds only at the NEXT Enter-AR, so the
  // session's end must detach the HUD on its own.
  it('detaches at the session end, before the scope unwinds', () => {
    const { ui, endSession, unwindScope } = harness();
    expect(ui.attach).toHaveBeenCalledTimes(1);
    endSession();
    expect(ui.detach).toHaveBeenCalledTimes(1);
    unwindScope(); // the next Enter-AR
    expect(ui.detach).toHaveBeenCalledTimes(2); // idempotent in the UI
  });

  // WHY (M3 review finding 4): a failed Enter-AR or a reset unwinds the
  // scope FIRST; the scope's entry must detach, and must unregister the
  // session disposer so a later session's end does not act on this UI.
  it('detaches at the scope unwind and unregisters the session disposer', () => {
    const { ui, endSession, unwindScope, pending } = harness();
    unwindScope();
    expect(ui.detach).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(0);
    endSession();
    expect(ui.detach).toHaveBeenCalledTimes(1);
  });
});
