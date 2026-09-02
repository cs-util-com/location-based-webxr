// @vitest-environment jsdom
/**
 * Why these tests matter: the wheel is used only in the field, where a
 * dispatch that landed in a dead store, or arrived before the store was
 * decided, would look exactly like "the setting does nothing" - the complaint
 * that motivated the whole feature. These pin the two traps the design routes
 * around (the store swap and the pre-`setZeroPos` no-op), the "untouched
 * wheel dispatches nothing" contract, the exact set of actions a settings
 * object implies (including a preset that turns the robust solver OFF), and
 * the readout's honesty before the first fix.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  createDebugWheel,
  dispatchWheelSettings,
  formatWheelReadout,
  WHEEL_DEFAULTS,
  WHEEL_HEADING_PENALTY_DEFAULT,
  type WheelSettings,
} from './hud-debug-wheel';
import { createStoreRef } from '../state/store-ref';
import {
  createRecorderStore,
  type RecorderStore,
} from '../state/recorder-store';

// The library's action creators are licence-gated; building one real recorder
// store activates the community licence for the process, exactly as the app
// does at boot. The fake stores below only capture dispatches.
beforeAll(() => {
  createRecorderStore();
});

interface FakeStore extends RecorderStore {
  readonly dispatched: unknown[];
  decide(): void;
}

/** A store whose `gpsData` is null until `decide()`; records every dispatch. */
function fakeStore(): FakeStore {
  const listeners = new Set<() => void>();
  let gpsData: unknown = null;
  const dispatched: unknown[] = [];
  const store = {
    dispatched,
    getState: () => ({ gpsData }),
    dispatch: (action: unknown) => {
      dispatched.push(action);
      for (const l of listeners) l();
      return action;
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    decide() {
      gpsData = {
        gpsEvents: {
          alignmentRotationInDegree: [0, 47.25, 0],
          gpsPositions: [1, 2, 3],
          compassAppliedWeight: 0.8,
          compassTrust: { state: 'trusted' },
        },
      };
      for (const l of listeners) l();
    },
    writeFrame: vi.fn(),
    writeSessionMetadata: vi.fn(),
    flushPendingActionWrites: vi.fn(),
  } as unknown as FakeStore;
  return store;
}

const types = (store: FakeStore): string[] =>
  store.dispatched.map((a) => (a as { type: string }).type);

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('dispatchWheelSettings', () => {
  it('dispatches the preset, the seven compass settings and the three options - eleven actions', () => {
    const store = fakeStore();
    dispatchWheelSettings(store, {
      ...WHEEL_DEFAULTS,
      presetId: 'f100',
      compassInfluence: 0.5,
      pairSelection: 'hard',
      pairSelectionRequireTrust: false,
      headingPenalty: 0.25,
    });
    expect(types(store)).toEqual([
      'gpsData/setAlignmentOverrides',
      'gpsData/setCompassRotationPriorEnabled',
      'gpsData/setColdStartOverrideEnabled',
      'gpsData/setCompassVoteWeight',
      'gpsData/setCompassTrustGateMode',
      'gpsData/setCompassPairSelectionEnabled',
      'gpsData/setCompassTrustAgreeToleranceDeg',
      'gpsData/setCompassWebXRConsistencyEnabled',
      'gpsData/setCompassPairSelectionMode',
      'gpsData/setCompassPairSelectionRequireTrust',
      'gpsData/setRobustSolverHeadingPenalty',
    ]);
    const payloads = store.dispatched.map(
      (a) => (a as { payload: unknown }).payload
    );
    expect(payloads[0]).toEqual({ timeWeightFactor: 100 });
    expect(payloads[1]).toBe(true); // prior on at influence > 0
    expect(payloads[2]).toBe(false); // cold-start off while the prior drives
    expect(payloads[3]).toBe(0.5);
    expect(payloads[5]).toBe(true); // pair selection on ('hard')
    expect(payloads[8]).toBe('hard');
    expect(payloads[9]).toBe(false);
    expect(payloads[10]).toBe(0.25);
  });

  it('at influence 0 silences the compass with three settings, and pair selection stays off', () => {
    const store = fakeStore();
    dispatchWheelSettings(store, {
      ...WHEEL_DEFAULTS,
      compassInfluence: 0,
      pairSelection: 'soft',
    });
    const p = store.dispatched.map((a) => (a as { payload: unknown }).payload);
    expect(p[1]).toBe(false);
    expect(p[2]).toBe(false);
    expect(p[3]).toBe(0);
    expect(p[5]).toBe(false);
  });

  it('the shipped preset clears the overrides with null, and can turn the robust solver back off', () => {
    // A preset that switched the robust solver on must be undoable within the
    // session: the shipped entry clears the overrides (null), which the
    // tri-state mapping turns into the library default.
    const store = fakeStore();
    dispatchWheelSettings(store, { ...WHEEL_DEFAULTS, presetId: 'shipped' });
    expect((store.dispatched[0] as { payload: unknown }).payload).toBeNull();
  });
});

describe('createDebugWheel', () => {
  let controls: HTMLElement;
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="controls"></div><div id="app"></div>';
    controls = document.getElementById('controls')!;
    overlay = document.getElementById('app')!;
  });

  it('mounts a gear in the controls and a hidden panel in the overlay root, and toggles it', () => {
    const wheel = createDebugWheel({
      storeRef: createStoreRef(fakeStore()),
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    const gear = controls.querySelector(
      '#btn-debug-wheel'
    ) as HTMLButtonElement;
    const panel = overlay.querySelector('#debug-wheel-panel') as HTMLElement;
    expect(gear).not.toBeNull();
    expect(panel.hidden).toBe(true);
    gear.click();
    expect(panel.hidden).toBe(false);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    gear.click();
    expect(panel.hidden).toBe(true);
    wheel.dispose();
    expect(controls.querySelector('#btn-debug-wheel')).toBeNull();
    expect(overlay.querySelector('#debug-wheel-panel')).toBeNull();
  });

  it('dispatches NOTHING until the tester touches a control', async () => {
    const store = fakeStore();
    const wheel = createDebugWheel({
      storeRef: createStoreRef(store),
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    store.decide();
    await flush();
    expect(store.dispatched).toEqual([]);
    expect(wheel.touched()).toBe(false);
  });

  it('holds a change made before the first fix and flushes it once the store is decided, from a microtask', async () => {
    const store = fakeStore();
    const wheel = createDebugWheel({
      storeRef: createStoreRef(store),
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    const preset = overlay.querySelector(
      '#debug-wheel-preset'
    ) as HTMLSelectElement;
    preset.value = 'f100';
    preset.dispatchEvent(new Event('change'));
    expect(wheel.values().presetId).toBe('f100');
    expect(store.dispatched).toEqual([]); // undecided store: nothing yet
    store.decide();
    expect(store.dispatched).toEqual([]); // not inside the deciding dispatch
    await flush();
    expect(types(store)[0]).toBe('gpsData/setAlignmentOverrides');
    expect(store.dispatched).toHaveLength(11);
  });

  it('re-applies the touched settings to a swapped-in store (Start Recording)', async () => {
    const first = fakeStore();
    first.decide();
    const ref = createStoreRef<RecorderStore>(first);
    const wheel = createDebugWheel({
      storeRef: ref,
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    wheel.set({ compassInfluence: 0.8 });
    expect(first.dispatched).toHaveLength(11);
    const second = fakeStore();
    ref.set(second); // the recorder swaps its store
    await flush();
    expect(second.dispatched).toEqual([]); // undecided: waits for its first fix
    second.decide();
    await flush();
    expect(second.dispatched).toHaveLength(11);
    expect((second.dispatched[3] as { payload: number }).payload).toBe(0.8);
    // And only once per store.
    second.dispatch({ type: 'noise' });
    await flush();
    expect(second.dispatched).toHaveLength(12);
  });

  it('applies every later change immediately to a decided store', () => {
    const store = fakeStore();
    store.decide();
    const wheel = createDebugWheel({
      storeRef: createStoreRef(store),
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    const penalty = overlay.querySelector(
      '#debug-wheel-heading-penalty'
    ) as HTMLInputElement;
    penalty.checked = true;
    penalty.dispatchEvent(new Event('change'));
    expect(wheel.values().headingPenalty).toBe(WHEEL_HEADING_PENALTY_DEFAULT);
    expect(types(store)).toHaveLength(11);
    expect((store.dispatched[10] as { payload: number }).payload).toBe(
      WHEEL_HEADING_PENALTY_DEFAULT
    );
  });

  it('dispatches the compass slider on RELEASE, not on every drag step', () => {
    // Every dispatch is persisted into the recording; a drag must not write
    // eleven actions per notch. The label still follows the drag.
    const store = fakeStore();
    store.decide();
    const wheel = createDebugWheel({
      storeRef: createStoreRef(store),
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    const slider = overlay.querySelector(
      '#debug-wheel-compass'
    ) as HTMLInputElement;
    const label = overlay.querySelector(
      '#debug-wheel-compass-value'
    ) as HTMLElement;
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input'));
    slider.value = '0.8';
    slider.dispatchEvent(new Event('input'));
    expect(label.textContent).toBe('0.80');
    expect(store.dispatched).toEqual([]);
    expect(wheel.touched()).toBe(false);
    slider.dispatchEvent(new Event('change'));
    expect(wheel.values().compassInfluence).toBe(0.8);
    expect(store.dispatched).toHaveLength(11);
  });

  it('shows the readout when opened and keeps it live while open', () => {
    const store = fakeStore();
    const wheel = createDebugWheel({
      storeRef: createStoreRef(store),
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    const gear = controls.querySelector(
      '#btn-debug-wheel'
    ) as HTMLButtonElement;
    const readout = overlay.querySelector(
      '#debug-wheel-readout'
    ) as HTMLElement;
    gear.click();
    expect(readout.textContent).toBe('waiting for the first GPS fix');
    store.decide();
    expect(readout.textContent).toBe(
      'yaw 47.3° · compass 0.80 trusted · 3 fixes'
    );
  });
});

describe('formatWheelReadout', () => {
  it('never prints NaN: a missing weight reads as a dash, a missing yaw as a dash', () => {
    const line = formatWheelReadout({
      gpsData: {
        gpsEvents: {
          alignmentRotationInDegree: [0, NaN, 0],
          gpsPositions: [],
          compassAppliedWeight: undefined,
        },
      },
    });
    expect(line).toBe('yaw – · compass – · 0 fixes');
  });

  it('wraps a negative yaw into 0..360', () => {
    const s: WheelSettings = WHEEL_DEFAULTS;
    void s;
    expect(
      formatWheelReadout({
        gpsData: {
          gpsEvents: {
            alignmentRotationInDegree: [0, -90, 0],
            gpsPositions: [1],
          },
        },
      })
    ).toBe('yaw 270.0° · compass – · 1 fixes');
  });
});
