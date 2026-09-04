// @vitest-environment jsdom
/**
 * Why these tests matter: the wheel is used only in the field, where a
 * dispatch that landed in a dead store, or arrived before the store was
 * decided, would look exactly like "the setting does nothing" - the complaint
 * that motivated the whole feature. These pin the two traps the design routes
 * around (the store swap and the pre-`setZeroPos` no-op), the per-CONTROL
 * contract (a preset tap must not rewrite the operator's compass config - PR
 * #405/#406 review), the seeding of untouched controls from the store, the
 * replay suspension, the readout's honesty before the first fix, and the
 * penalty box being disabled where it is provably inert.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  createDebugWheel,
  dispatchWheelSettings,
  formatWheelReadout,
  seedWheelSettings,
  WHEEL_DEFAULTS,
  WHEEL_HEADING_PENALTY_DEFAULT,
  sameOverrides,
  type WheelControl,
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
  decide(extra?: Record<string, unknown>): void;
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
    decide(extra: Record<string, unknown> = {}) {
      gpsData = {
        gpsEvents: {
          alignmentRotationInDegree: [0, 47.25, 0],
          gpsPositions: [1, 2, 3],
          compassAppliedWeight: 0.8,
          compassTrust: { state: 'trusted' },
        },
        ...extra,
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
const payloads = (store: FakeStore): unknown[] =>
  store.dispatched.map((a) => (a as { payload: unknown }).payload);
const flush = () => new Promise<void>((r) => queueMicrotask(r));
const only = (...c: WheelControl[]) => new Set<WheelControl>(c);

const COMPASS_SEVEN = [
  'gpsData/setCompassRotationPriorEnabled',
  'gpsData/setColdStartOverrideEnabled',
  'gpsData/setCompassVoteWeight',
  'gpsData/setCompassTrustGateMode',
  'gpsData/setCompassPairSelectionEnabled',
  'gpsData/setCompassTrustAgreeToleranceDeg',
  'gpsData/setCompassWebXRConsistencyEnabled',
];

describe('dispatchWheelSettings - one control, its own setting', () => {
  it('the preset alone is ONE action', () => {
    const store = fakeStore();
    dispatchWheelSettings(
      store,
      { ...WHEEL_DEFAULTS, presetId: 'f100' },
      only('presetId')
    );
    expect(types(store)).toEqual(['gpsData/setAlignmentOverrides']);
    expect(payloads(store)[0]).toEqual({ timeWeightFactor: 100 });
  });

  it('the compass slider is the seven compass settings, prior on at that weight', () => {
    const store = fakeStore();
    dispatchWheelSettings(
      store,
      { ...WHEEL_DEFAULTS, compassInfluence: 0.5, pairSelection: 'hard' },
      only('compassInfluence')
    );
    expect(types(store)).toEqual(COMPASS_SEVEN);
    const p = payloads(store);
    expect(p[0]).toBe(true); // prior on
    expect(p[1]).toBe(false); // cold-start off while the prior drives
    expect(p[2]).toBe(0.5);
    expect(p[4]).toBe(true); // pair selection reflects the wheel ('hard')
  });

  it('at influence 0 the slider silences the compass with three settings', () => {
    const store = fakeStore();
    dispatchWheelSettings(
      store,
      { ...WHEEL_DEFAULTS, compassInfluence: 0, pairSelection: 'soft' },
      only('compassInfluence')
    );
    const p = payloads(store);
    expect(p[0]).toBe(false);
    expect(p[1]).toBe(false);
    expect(p[2]).toBe(0);
    expect(p[4]).toBe(false);
  });

  it('the gate, the pair selection, the trust prerequisite and the penalty each send their own setter(s)', () => {
    const gate = fakeStore();
    dispatchWheelSettings(
      gate,
      { ...WHEEL_DEFAULTS, trustGateMode: 'latch' },
      only('trustGateMode')
    );
    expect(types(gate)).toEqual(['gpsData/setCompassTrustGateMode']);
    expect(payloads(gate)[0]).toBe('latch');

    const pairs = fakeStore();
    dispatchWheelSettings(
      pairs,
      { ...WHEEL_DEFAULTS, pairSelection: 'hard' },
      only('pairSelection')
    );
    expect(types(pairs)).toEqual([
      'gpsData/setCompassPairSelectionEnabled',
      'gpsData/setCompassPairSelectionMode',
    ]);
    expect(payloads(pairs)).toEqual([true, 'hard']);

    const trust = fakeStore();
    dispatchWheelSettings(
      trust,
      { ...WHEEL_DEFAULTS, pairSelectionRequireTrust: false },
      only('pairSelectionRequireTrust')
    );
    expect(types(trust)).toEqual([
      'gpsData/setCompassPairSelectionRequireTrust',
    ]);

    const penalty = fakeStore();
    dispatchWheelSettings(
      penalty,
      { ...WHEEL_DEFAULTS, headingPenalty: 0.25 },
      only('headingPenalty')
    );
    expect(types(penalty)).toEqual(['gpsData/setRobustSolverHeadingPenalty']);
  });

  it('every control together is eleven actions, and the shipped preset clears with null', () => {
    const store = fakeStore();
    dispatchWheelSettings(store, { ...WHEEL_DEFAULTS, presetId: 'shipped' });
    expect(types(store)).toHaveLength(11);
    expect(payloads(store)[0]).toBeNull();
  });
});

describe('dispatchWheelSettings - pair selection never re-arms a silenced compass (PR #407 review)', () => {
  // Why this test matters: "GPS only" is the control arm of every A/B made
  // with the slider. Two taps in either order must end in the same config,
  // or the tester's control arm silently runs compass-guided pair selection.
  it('slider to 0 then pairs on, and pairs on then slider to 0, both end with pair selection off', () => {
    const a = fakeStore();
    dispatchWheelSettings(
      a,
      { ...WHEEL_DEFAULTS, compassInfluence: 0 },
      only('compassInfluence')
    );
    dispatchWheelSettings(
      a,
      { ...WHEEL_DEFAULTS, compassInfluence: 0, pairSelection: 'soft' },
      only('pairSelection')
    );
    const b = fakeStore();
    dispatchWheelSettings(
      b,
      { ...WHEEL_DEFAULTS, pairSelection: 'soft' },
      only('pairSelection')
    );
    dispatchWheelSettings(
      b,
      { ...WHEEL_DEFAULTS, compassInfluence: 0, pairSelection: 'soft' },
      only('compassInfluence')
    );
    const lastEnabled = (s: FakeStore) =>
      s.dispatched
        .filter(
          (x) =>
            (x as { type: string }).type ===
            'gpsData/setCompassPairSelectionEnabled'
        )
        .at(-1) as { payload: boolean };
    expect(lastEnabled(a).payload).toBe(false);
    expect(lastEnabled(b).payload).toBe(false);
    // With the compass on, the same tap enables it.
    const c = fakeStore();
    dispatchWheelSettings(
      c,
      { ...WHEEL_DEFAULTS, pairSelection: 'hard' },
      only('pairSelection')
    );
    expect(lastEnabled(c).payload).toBe(true);
  });
});

describe('sameOverrides', () => {
  it('ignores key order, treats null and undefined as the shipped defaults, and rejects a different value', () => {
    expect(
      sameOverrides(
        { timeWeightFactor: 100, gpsAccuracyExponent: 0.75 },
        { gpsAccuracyExponent: 0.75, timeWeightFactor: 100 }
      )
    ).toBe(true);
    expect(sameOverrides(null, undefined)).toBe(true);
    expect(sameOverrides(null, { timeWeightFactor: 100 })).toBe(false);
    expect(
      sameOverrides({ timeWeightFactor: 100 }, { timeWeightFactor: 25 })
    ).toBe(false);
  });
});

describe('seedWheelSettings - untouched controls show the session', () => {
  it('matches a preset whose overrides arrive in a different key order', () => {
    const s = seedWheelSettings(WHEEL_DEFAULTS, new Set(), {
      gpsData: {
        alignmentOverrides: {
          gpsAccuracyExponent: 0.75,
          timeWeightFactor: 100,
        },
      },
    });
    expect(s.presetId).toBe('f100-exp075');
  });

  it('reads the gate, pair selection, prerequisite, penalty and a matching preset from a decided store', () => {
    const seeded = seedWheelSettings(WHEEL_DEFAULTS, new Set(), {
      gpsData: {
        alignmentOverrides: { timeWeightFactor: 100 },
        compassTrustGateMode: 'latch',
        compassPairSelectionEnabled: true,
        compassPairSelectionMode: 'hard',
        compassPairSelectionRequireTrust: false,
        robustSolverHeadingPenalty: 0.25,
      },
    });
    expect(seeded.presetId).toBe('f100');
    expect(seeded.trustGateMode).toBe('latch');
    expect(seeded.pairSelection).toBe('hard');
    expect(seeded.pairSelectionRequireTrust).toBe(false);
    expect(seeded.headingPenalty).toBe(0.25);
  });

  it('seeds the slider from the vote weight only while the Stage-C prior is on', () => {
    const on = seedWheelSettings(WHEEL_DEFAULTS, new Set(), {
      gpsData: { compassRotationPriorEnabled: true, compassVoteWeight: 0.8 },
    });
    expect(on.compassInfluence).toBe(0.8);
    // A Stage-0 session (prior off) has no slider position: default kept.
    const off = seedWheelSettings(WHEEL_DEFAULTS, new Set(), {
      gpsData: { compassRotationPriorEnabled: false, compassVoteWeight: 0.8 },
    });
    expect(off.compassInfluence).toBe(WHEEL_DEFAULTS.compassInfluence);
  });

  it('never overwrites a control the tester touched, and leaves everything alone before the store is decided', () => {
    const current = { ...WHEEL_DEFAULTS, trustGateMode: 'ramp' as const };
    const seeded = seedWheelSettings(current, only('trustGateMode'), {
      gpsData: { compassTrustGateMode: 'latch' },
    });
    expect(seeded.trustGateMode).toBe('ramp');
    expect(seedWheelSettings(current, new Set(), { gpsData: null })).toBe(
      current
    );
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
  const mount = (store: RecorderStore) => {
    const ref = createStoreRef<RecorderStore>(store);
    const wheel = createDebugWheel({
      storeRef: ref,
      controlsRoot: controls,
      overlayRoot: overlay,
    });
    wheel.attach();
    return { wheel, ref };
  };

  it('mounts a gear in the controls and a hidden panel in the overlay root, and toggles it', () => {
    const { wheel } = mount(fakeStore());
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
    const { wheel } = mount(store);
    store.decide();
    await flush();
    expect(store.dispatched).toEqual([]);
    expect(wheel.touched()).toBe(false);
  });

  it('a preset-only tap dispatches ONE action and leaves the compass config untouched', () => {
    // The headline use case: an A/B between presets must differ in the
    // preset and nothing else.
    const store = fakeStore();
    store.decide({
      compassRotationPriorEnabled: false,
      compassVoteWeight: 0.8,
    });
    mount(store);
    const preset = overlay.querySelector(
      '#debug-wheel-preset'
    ) as HTMLSelectElement;
    preset.value = 'f100';
    preset.dispatchEvent(new Event('change'));
    expect(types(store)).toEqual(['gpsData/setAlignmentOverrides']);
  });

  it('shows the session: untouched controls are seeded from a decided store', () => {
    const store = fakeStore();
    store.decide({
      compassTrustGateMode: 'latch',
      compassPairSelectionEnabled: true,
      compassPairSelectionMode: 'hard',
    });
    const { wheel } = mount(store);
    expect(wheel.values().trustGateMode).toBe('latch');
    expect(wheel.values().pairSelection).toBe('hard');
    expect(
      (overlay.querySelector('#debug-wheel-gate') as HTMLSelectElement).value
    ).toBe('latch');
    expect(store.dispatched).toEqual([]); // seeding is a read, never a write
  });

  it('holds a change made before the first fix and flushes it once the store is decided, from a microtask', async () => {
    const store = fakeStore();
    const { wheel } = mount(store);
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
    expect(types(store)).toEqual(['gpsData/setAlignmentOverrides']);
  });

  it('re-applies every touched control to a swapped-in store (Start Recording), once per store', async () => {
    const first = fakeStore();
    first.decide();
    const { wheel, ref } = mount(first);
    wheel.set({ compassInfluence: 0.8 });
    wheel.set({ presetId: 'f100' });
    expect(types(first)).toEqual([
      ...COMPASS_SEVEN,
      'gpsData/setAlignmentOverrides',
    ]);
    const second = fakeStore();
    ref.set(second);
    await flush();
    expect(second.dispatched).toEqual([]); // undecided: waits for its first fix
    second.decide();
    await flush();
    // Both touched controls, in dispatch order preset-first.
    expect(types(second)).toEqual([
      'gpsData/setAlignmentOverrides',
      ...COMPASS_SEVEN,
    ]);
    expect(payloads(second)[3]).toBe(0.8);
    second.dispatch({ type: 'noise' });
    await flush();
    expect(second.dispatched).toHaveLength(9);
  });

  // Production order since PR #407 review: the recording handlers swap the
  // store FIRST and call resume() after, so resume() lands on the new store
  // and never on the outgoing replay one - the sequence below mirrors that.
  it('does not drive a store while suspended (replay), and resumes onto the current store', async () => {
    const recording = fakeStore();
    recording.decide();
    const { wheel, ref } = mount(recording);
    wheel.set({ trustGateMode: 'latch' });
    expect(types(recording)).toEqual(['gpsData/setCompassTrustGateMode']);
    wheel.suspend();
    const replay = fakeStore();
    ref.set(replay);
    replay.decide();
    await flush();
    expect(replay.dispatched).toEqual([]);
    wheel.set({ presetId: 'f100' }); // held while suspended
    expect(replay.dispatched).toEqual([]);
    const next = fakeStore();
    next.decide();
    ref.set(next);
    await flush();
    expect(next.dispatched).toEqual([]); // still suspended
    wheel.resume();
    expect(types(next)).toEqual([
      'gpsData/setAlignmentOverrides',
      'gpsData/setCompassTrustGateMode',
    ]);
  });

  // Why this test matters (PR #411 review): `applied` means "this store has
  // everything the tester touched". A change held while suspended made that
  // false for a store already marked applied, and resume() onto the SAME
  // store would have skipped the held change. Unreachable from the UI today
  // (every resume follows a fresh store), reachable through the e2e set() hook.
  it('re-applies a change held while suspended even when resuming onto the same store', async () => {
    const store = fakeStore();
    store.decide();
    const { wheel } = mount(store);
    wheel.set({ trustGateMode: 'latch' });
    expect(types(store)).toEqual(['gpsData/setCompassTrustGateMode']);
    wheel.suspend();
    wheel.set({ presetId: 'f100' }); // held: the store is suspended
    expect(types(store)).toEqual(['gpsData/setCompassTrustGateMode']);
    wheel.resume(); // same store, already marked applied before the hold
    await flush();
    expect(types(store)).toEqual([
      'gpsData/setCompassTrustGateMode',
      'gpsData/setAlignmentOverrides',
      'gpsData/setCompassTrustGateMode',
    ]);
  });

  it('dispatches the compass slider on RELEASE, not on every drag step', () => {
    const store = fakeStore();
    store.decide();
    const { wheel } = mount(store);
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
    expect(types(store)).toEqual(COMPASS_SEVEN);
  });

  it('disables the heading-penalty box unless the selected preset enables the robust solver', () => {
    const store = fakeStore();
    store.decide();
    const { wheel } = mount(store);
    const box = overlay.querySelector(
      '#debug-wheel-heading-penalty'
    ) as HTMLInputElement;
    const hint = overlay.querySelector(
      '#debug-wheel-heading-penalty-hint'
    ) as HTMLElement;
    expect(box.disabled).toBe(true);
    expect(hint.textContent).toContain('robust');
    // The programmatic path still lets the e2e hook set the value.
    wheel.set({ headingPenalty: WHEEL_HEADING_PENALTY_DEFAULT });
    expect(wheel.values().headingPenalty).toBe(WHEEL_HEADING_PENALTY_DEFAULT);
    // The one robust preset enables the box; leaving it disables it again.
    wheel.set({ presetId: 'f50-robust-exp1' });
    expect(box.disabled).toBe(false);
    expect(hint.textContent).toBe('');
    wheel.set({ presetId: 'shipped' });
    expect(box.disabled).toBe(true);
  });

  it('shows the readout when opened and keeps it live while open', () => {
    const store = fakeStore();
    mount(store);
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
      'yaw 47.3° · churn – · compass 0.80 trusted · 3 fixes'
    );
  });

  it('shows the yaw churn over the fixes it saw, sampled once per fix, even while closed', () => {
    const store = fakeStore();
    mount(store);
    const ev = (yaw: number, fixes: number) => ({
      gpsEvents: {
        alignmentRotationInDegree: [0, yaw, 0],
        gpsPositions: Array.from({ length: fixes }, (_, i) => i),
        compassAppliedWeight: 0.8,
        compassTrust: { state: 'trusted' },
      },
    });
    store.decide(ev(47.25, 3));
    store.decide(ev(47.75, 4)); // step 0.5
    store.decide(ev(47.75, 4)); // same fix: no step
    store.decide(ev(48.75, 5)); // step 1.0
    const gear = controls.querySelector(
      '#btn-debug-wheel'
    ) as HTMLButtonElement;
    const readout = overlay.querySelector(
      '#debug-wheel-readout'
    ) as HTMLElement;
    gear.click();
    expect(readout.textContent).toBe(
      'yaw 48.8° · churn 0.75°/fix (2) · compass 0.80 trusted · 5 fixes'
    );
  });

  it('starts a fresh churn window for a swapped-in store', () => {
    const first = fakeStore();
    const { ref } = mount(first);
    first.decide();
    first.decide({
      gpsEvents: {
        alignmentRotationInDegree: [0, 57.25, 0],
        gpsPositions: [1, 2, 3, 4],
        compassAppliedWeight: 0.8,
        compassTrust: { state: 'trusted' },
      },
    });
    const second = fakeStore();
    ref.set(second);
    second.decide();
    const gear = controls.querySelector(
      '#btn-debug-wheel'
    ) as HTMLButtonElement;
    const readout = overlay.querySelector(
      '#debug-wheel-readout'
    ) as HTMLElement;
    gear.click();
    expect(readout.textContent).toBe(
      'yaw 47.3° · churn – · compass 0.80 trusted · 3 fixes'
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
    expect(line).toBe('yaw – · churn – · compass – · 0 fixes');
  });

  it('wraps a negative yaw into 0..360', () => {
    expect(
      formatWheelReadout({
        gpsData: {
          gpsEvents: {
            alignmentRotationInDegree: [0, -90, 0],
            gpsPositions: [1],
          },
        },
      })
    ).toBe('yaw 270.0° · churn – · compass – · 1 fixes');
  });

  it('prints the churn summary with its step count', () => {
    expect(
      formatWheelReadout(
        {
          gpsData: {
            gpsEvents: {
              alignmentRotationInDegree: [0, 10, 0],
              gpsPositions: [1, 2],
            },
          },
        },
        { medianStepDeg: 0.4567, steps: 30 }
      )
    ).toBe('yaw 10.0° · churn 0.46°/fix (30) · compass – · 2 fixes');
  });
});
