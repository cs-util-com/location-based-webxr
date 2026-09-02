/**
 * The in-recording settings wheel - a gear in the AR HUD, visible only with
 * `?debug=1`, that switches alignment presets and compass options DURING a
 * running recording (2026-09-02, rotation-first search plan D8 / M3).
 *
 * WHY IT EXISTS. The settings modal is reachable only before Enter AR and its
 * values apply on the next session, so a tester comparing candidate configs
 * had to stop, change, restart. Every control here is a store action, so a
 * switch takes effect on the next GPS fix (the library re-solves per fix) and
 * lands in the recording's action stream, where the framework's replayer
 * re-applies it - what was seen in the field is reproducible offline.
 *
 * TWO TRAPS THE DESIGN ROUTES AROUND (cold-review finding 5):
 * - The recorder SWAPS its store at Start Recording and on replay. A dispatch
 *   into a captured store would be lost with it, so the wheel follows
 *   `storeRef` and re-applies whatever the tester touched to every new store.
 * - Every alignment setter is a no-op before `setZeroPos` (the `gpsData` slice
 *   is `null` until the first GPS fix). The wheel therefore watches the store
 *   and flushes once it is decided, from a microtask scheduled by the
 *   subscriber - never from inside the dispatch stack, which the persistence
 *   middleware's re-entrancy tripwire would (rightly) refuse.
 *
 * RELATIONSHIP TO THE SETTINGS MODAL. The modal's compass block stays the
 * PRE-SESSION persisted default and seeds each new store. The wheel is the
 * LIVE surface: it persists nothing, and only the CONTROL the tester touched
 * is dispatched (PR #405/#406 review: dispatching every control from the
 * wheel's defaults turned a preset A/B into a compass-config change) - a
 * preset tap sends one action, the compass slider the seven compass settings,
 * every other control its own setter. Untouched controls show the store's
 * values once it is decided.
 *
 * REPLAY. The recorder swaps a REPLAY store through the same `storeRef`; the
 * wheel must not drive it, or a recording made without the wheel would replay
 * against the tester's live config. `main.ts` suspends the wheel while replay
 * owns the store and resumes it for recording stores.
 *
 * See `hud-debug-wheel.ts.md`.
 */

import {
  setAlignmentOverrides,
  setColdStartOverrideEnabled,
  setCompassPairSelectionEnabled,
  setCompassPairSelectionMode,
  setCompassPairSelectionRequireTrust,
  setCompassRotationPriorEnabled,
  setCompassTrustAgreeToleranceDeg,
  setCompassTrustGateMode,
  setCompassVoteWeight,
  setCompassWebXRConsistencyEnabled,
  setRobustSolverHeadingPenalty,
  COMPASS_TRUST_GATE_MODES,
  COMPASS_PAIR_SELECTION_MODES,
  type CompassPairSelectionMode,
  type CompassTrustGateMode,
} from 'gps-plus-slam-app-framework/state';
import { compassSettingsFor } from 'gps-plus-slam-app-framework/utils/compass-influence-mapping';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  ALIGNMENT_PRESETS,
  SHIPPED_PRESET_ID,
  findAlignmentPreset,
} from '../alignment-presets';
import { followStore, type StoreRef } from '../state/store-ref';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('DebugWheel');

/** `'off'` = no compass-guided pair selection; otherwise the kernel's mode. */
type WheelPairSelection = 'off' | CompassPairSelectionMode;

export interface WheelSettings {
  readonly presetId: string;
  /** 0 = GPS only (three settings, see the mapping); 1 = full compass. */
  readonly compassInfluence: number;
  readonly trustGateMode: CompassTrustGateMode;
  readonly pairSelection: WheelPairSelection;
  readonly pairSelectionRequireTrust: boolean;
  /** Heading penalty of the robust solver, m/°; 0 = off. */
  readonly headingPenalty: number;
}

/**
 * The untouched wheel. `compassInfluence` 0.1 mirrors the library's shipped
 * steady-state weight; nothing is dispatched until the tester changes a
 * control, so these values describe the wheel, not the session.
 */
export const WHEEL_DEFAULTS: WheelSettings = {
  presetId: SHIPPED_PRESET_ID,
  compassInfluence: 0.1,
  trustGateMode: 'binary',
  pairSelection: 'off',
  pairSelectionRequireTrust: true,
  headingPenalty: 0,
};

/**
 * The recorder's own experiment policy for the shared mapping (plan
 * assumption): prior on whenever influence > 0, the gate and pair selection
 * from the wheel, the activating 15° tolerance the experiment combo used, the
 * consistency gate off.
 */
const WHEEL_TRUST_TOLERANCE_DEG = 15;
/** Recorder default for the heading penalty once switched on (plan assumption). */
export const WHEEL_HEADING_PENALTY_DEFAULT = 0.25;
const COMPASS_INFLUENCE_STEP = 0.05;

export type WheelControl = keyof WheelSettings;

/**
 * The dispatches ONE control implies. A control changes only its own setting:
 * the preset one action; the compass slider the seven compass settings (it
 * is the compass configuration - moving it engages the Stage-C prior at that
 * weight, 0 silences the compass); the gate, pair selection, trust
 * prerequisite and penalty their own setters. `controls` = every control
 * (the e2e hook's programmatic set, and the tests).
 */
export function dispatchWheelSettings(
  store: Pick<RecorderStore, 'dispatch'>,
  s: WheelSettings,
  controls: ReadonlySet<WheelControl> = ALL_CONTROLS
): void {
  if (controls.has('presetId')) {
    const preset = findAlignmentPreset(s.presetId);
    store.dispatch(setAlignmentOverrides(preset?.overrides ?? null));
  }
  if (controls.has('compassInfluence')) {
    const compass = compassSettingsFor(s.compassInfluence, {
      rotationPriorEnabled: true,
      trustGateMode: s.trustGateMode,
      pairSelectionEnabled: s.pairSelection !== 'off',
      trustToleranceDeg: WHEEL_TRUST_TOLERANCE_DEG,
      webXRConsistencyEnabled: false,
    });
    store.dispatch(
      setCompassRotationPriorEnabled(compass.rotationPriorEnabled)
    );
    store.dispatch(
      setColdStartOverrideEnabled(compass.coldStartOverrideEnabled)
    );
    store.dispatch(setCompassVoteWeight(compass.voteWeight));
    store.dispatch(setCompassTrustGateMode(compass.trustGateMode));
    store.dispatch(
      setCompassPairSelectionEnabled(compass.pairSelectionEnabled)
    );
    store.dispatch(setCompassTrustAgreeToleranceDeg(compass.trustToleranceDeg));
    store.dispatch(
      setCompassWebXRConsistencyEnabled(compass.webXRConsistencyEnabled)
    );
  }
  if (controls.has('trustGateMode') && !controls.has('compassInfluence')) {
    store.dispatch(setCompassTrustGateMode(s.trustGateMode));
  }
  if (controls.has('pairSelection')) {
    if (!controls.has('compassInfluence')) {
      store.dispatch(setCompassPairSelectionEnabled(s.pairSelection !== 'off'));
    }
    store.dispatch(
      setCompassPairSelectionMode(
        s.pairSelection === 'off' ? 'soft' : s.pairSelection
      )
    );
  }
  if (controls.has('pairSelectionRequireTrust')) {
    store.dispatch(
      setCompassPairSelectionRequireTrust(s.pairSelectionRequireTrust)
    );
  }
  if (controls.has('headingPenalty')) {
    store.dispatch(setRobustSolverHeadingPenalty(s.headingPenalty));
  }
}

const ALL_CONTROLS: ReadonlySet<WheelControl> = new Set<WheelControl>([
  'presetId',
  'compassInfluence',
  'trustGateMode',
  'pairSelection',
  'pairSelectionRequireTrust',
  'headingPenalty',
]);

/** The store fields the wheel reads back to show the session's real config. */
interface WheelSeedState {
  readonly gpsData: {
    readonly alignmentOverrides?: unknown;
    readonly compassRotationPriorEnabled?: boolean | undefined;
    readonly compassVoteWeight?: number | undefined;
    readonly compassTrustGateMode?: CompassTrustGateMode | undefined;
    readonly compassPairSelectionEnabled?: boolean | undefined;
    readonly compassPairSelectionMode?: CompassPairSelectionMode | undefined;
    readonly compassPairSelectionRequireTrust?: boolean | undefined;
    readonly robustSolverHeadingPenalty?: number | undefined;
  } | null;
}

/**
 * Read the untouched controls' values from a decided store, so the panel shows
 * the session rather than the wheel's defaults. The compass slider is seeded
 * from the vote weight only while the Stage-C prior is on; a Stage-0 session
 * has no slider position (the slider IS "prior on at this weight"), so it
 * keeps its default and its label says what moving it does.
 */
export function seedWheelSettings(
  current: WheelSettings,
  touched: ReadonlySet<WheelControl>,
  state: WheelSeedState
): WheelSettings {
  const g = state.gpsData;
  if (!g) return current;
  const next: { -readonly [K in keyof WheelSettings]: WheelSettings[K] } = {
    ...current,
  };
  if (!touched.has('presetId')) {
    const o = g.alignmentOverrides;
    const match = ALIGNMENT_PRESETS.find(
      (p) => JSON.stringify(p.overrides ?? null) === JSON.stringify(o ?? null)
    );
    if (match) next.presetId = match.id;
  }
  if (
    !touched.has('compassInfluence') &&
    g.compassRotationPriorEnabled === true &&
    typeof g.compassVoteWeight === 'number'
  ) {
    next.compassInfluence = g.compassVoteWeight;
  }
  if (!touched.has('trustGateMode') && g.compassTrustGateMode !== undefined) {
    next.trustGateMode = g.compassTrustGateMode;
  }
  if (
    !touched.has('pairSelection') &&
    g.compassPairSelectionEnabled !== undefined
  ) {
    next.pairSelection = g.compassPairSelectionEnabled
      ? (g.compassPairSelectionMode ?? 'soft')
      : 'off';
  }
  if (
    !touched.has('pairSelectionRequireTrust') &&
    g.compassPairSelectionRequireTrust !== undefined
  ) {
    next.pairSelectionRequireTrust = g.compassPairSelectionRequireTrust;
  }
  if (
    !touched.has('headingPenalty') &&
    typeof g.robustSolverHeadingPenalty === 'number'
  ) {
    next.headingPenalty = g.robustSolverHeadingPenalty;
  }
  return next;
}

/** The live readout line: solved yaw, applied compass weight + trust, fix count. */
export function formatWheelReadout(state: {
  readonly gpsData: {
    readonly gpsEvents: {
      readonly alignmentRotationInDegree: readonly number[];
      readonly gpsPositions: readonly unknown[];
      readonly compassObservability?: number | undefined;
      readonly compassAppliedWeight?: number | undefined;
      readonly compassTrust?: { readonly state: string } | undefined;
    };
  } | null;
}): string {
  const ev = state.gpsData?.gpsEvents;
  if (!ev) return 'waiting for the first GPS fix';
  const yaw = ev.alignmentRotationInDegree[1];
  const yawText =
    typeof yaw === 'number' && Number.isFinite(yaw)
      ? `yaw ${(((yaw % 360) + 360) % 360).toFixed(1)}°`
      : 'yaw –';
  const w = ev.compassAppliedWeight;
  const weightText =
    typeof w === 'number' && Number.isFinite(w)
      ? `compass ${w.toFixed(2)} ${ev.compassTrust?.state ?? 'dormant'}`
      : 'compass –';
  return `${yawText} · ${weightText} · ${ev.gpsPositions.length} fixes`;
}

export interface DebugWheelDeps {
  readonly storeRef: StoreRef<RecorderStore>;
  /** Where the gear button goes (the `#controls` overlay). */
  readonly controlsRoot: HTMLElement;
  /** Where the panel goes (the `#app` DOM-overlay root, so it composites in AR). */
  readonly overlayRoot: HTMLElement;
}

export interface DebugWheel {
  attach(): void;
  dispose(): void;
  /** Current wheel values (not necessarily dispatched - see `touched`). */
  values(): WheelSettings;
  /** Whether the tester changed anything, i.e. whether the wheel dispatches at all. */
  touched(): boolean;
  /** Programmatic change, for the e2e hook; behaves like a tap on each key. */
  set(patch: Partial<WheelSettings>): void;
  /** Stop driving stores (replay owns the store); changes are held. */
  suspend(): void;
  /** Drive stores again; held changes reach the current store if decided. */
  resume(): void;
}

export function createDebugWheel(deps: DebugWheelDeps): DebugWheel {
  let current: WheelSettings = WHEEL_DEFAULTS;
  const touched = new Set<WheelControl>();
  let suspended = false;
  let attached = false;
  let open = false;
  let unfollow: (() => void) | null = null;
  /** Stores this wheel already applied its settings to (re-applied per swap). */
  const applied = new WeakSet<object>();

  // --- DOM -----------------------------------------------------------------
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.id = 'btn-debug-wheel';
  gear.className =
    'bg-gray-700/80 hover:bg-gray-600 text-white font-bold py-2 px-3 rounded-full shadow-lg';
  gear.setAttribute('aria-label', 'Debug settings');
  gear.setAttribute('aria-expanded', 'false');
  gear.textContent = '⚙';

  const panel = document.createElement('div');
  panel.id = 'debug-wheel-panel';
  panel.className =
    'fixed left-2 right-2 bottom-24 z-[65] rounded-xl bg-black/85 text-white text-sm p-3 shadow-lg space-y-2';
  panel.hidden = true;
  gear.setAttribute('aria-controls', panel.id);

  const readout = document.createElement('div');
  readout.id = 'debug-wheel-readout';
  readout.className = 'text-xs text-gray-300 font-mono';
  readout.textContent = 'waiting for the first GPS fix';

  const row = (labelText: string, input: HTMLElement): HTMLElement => {
    const label = document.createElement('label');
    label.className = 'flex items-center justify-between gap-2';
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(text, input);
    return label;
  };
  const select = (
    id: string,
    values: readonly string[],
    labels: readonly string[],
    selected: string
  ): HTMLSelectElement => {
    const el = document.createElement('select');
    el.id = id;
    el.className = 'bg-gray-800 text-white rounded px-2 py-1';
    values.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = labels[i] ?? v;
      el.append(o);
    });
    el.value = selected;
    return el;
  };

  const presetSelect = select(
    'debug-wheel-preset',
    ALIGNMENT_PRESETS.map((p) => p.id),
    ALIGNMENT_PRESETS.map((p) => p.label),
    current.presetId
  );
  const influence = document.createElement('input');
  influence.type = 'range';
  influence.id = 'debug-wheel-compass';
  influence.min = '0';
  influence.max = '1';
  influence.step = String(COMPASS_INFLUENCE_STEP);
  influence.value = String(current.compassInfluence);
  const influenceValue = document.createElement('span');
  influenceValue.id = 'debug-wheel-compass-value';
  influenceValue.className = 'font-mono w-10 text-right';
  const gateSelect = select(
    'debug-wheel-gate',
    COMPASS_TRUST_GATE_MODES,
    COMPASS_TRUST_GATE_MODES,
    current.trustGateMode
  );
  const pairSelect = select(
    'debug-wheel-pairs',
    ['off', ...COMPASS_PAIR_SELECTION_MODES],
    ['off', ...COMPASS_PAIR_SELECTION_MODES.map((m) => `${m} cut`)],
    current.pairSelection
  );
  const requireTrust = document.createElement('input');
  requireTrust.type = 'checkbox';
  requireTrust.id = 'debug-wheel-require-trust';
  requireTrust.checked = current.pairSelectionRequireTrust;
  const penalty = document.createElement('input');
  penalty.type = 'checkbox';
  penalty.id = 'debug-wheel-heading-penalty';
  penalty.checked = current.headingPenalty > 0;
  const penaltyHint = document.createElement('span');
  penaltyHint.id = 'debug-wheel-heading-penalty-hint';
  penaltyHint.className = 'text-xs text-gray-400';
  const presetEnablesRobust = (): boolean =>
    findAlignmentPreset(current.presetId)?.overrides?.robustSolverEnabled ===
    true;

  const influenceLabel = (): string =>
    current.compassInfluence === 0
      ? 'GPS only'
      : current.compassInfluence.toFixed(2);

  const render = (): void => {
    presetSelect.value = current.presetId;
    influence.value = String(current.compassInfluence);
    influenceValue.textContent = influenceLabel();
    gateSelect.value = current.trustGateMode;
    pairSelect.value = current.pairSelection;
    requireTrust.checked = current.pairSelectionRequireTrust;
    penalty.checked = current.headingPenalty > 0;
    // The penalty only acts inside the robust solver; a preset that does not
    // switch it on makes the box provably inert, and the tester must be able
    // to tell that from "no effect on this walk" (PR #406 review).
    const robust = presetEnablesRobust();
    penalty.disabled = !robust;
    penaltyHint.textContent = robust ? '' : '(needs a robust-solver preset)';
  };

  const influenceRow = document.createElement('label');
  influenceRow.className = 'flex items-center justify-between gap-2';
  const influenceText = document.createElement('span');
  influenceText.textContent = 'compass';
  influenceRow.append(influenceText, influence, influenceValue);

  panel.append(
    readout,
    row('preset', presetSelect),
    influenceRow,
    row('trust gate', gateSelect),
    row('pair selection', pairSelect),
    row('pairs need trust', requireTrust),
    row('heading penalty', penalty)
  );
  penalty.parentElement?.append(penaltyHint);

  // --- behaviour -----------------------------------------------------------
  const applyTo = (
    store: RecorderStore,
    controls?: ReadonlySet<WheelControl>
  ): void => {
    if (suspended || touched.size === 0) return;
    if (store.getState().gpsData === null) return; // not decided yet
    dispatchWheelSettings(store, current, controls ?? touched);
    applied.add(store);
    log.info(`applied ${JSON.stringify(current)}`);
  };

  /** Called from event handlers only - top-level dispatches, never nested. */
  const change = (patch: Partial<WheelSettings>): void => {
    current = { ...current, ...patch };
    const now = new Set<WheelControl>();
    for (const k of Object.keys(patch) as WheelControl[]) {
      touched.add(k);
      now.add(k);
    }
    render();
    // Only the control(s) just touched go out now; a later store swap
    // re-applies everything ever touched.
    applyTo(deps.storeRef.get(), now);
  };

  const seed = (store: RecorderStore): void => {
    current = seedWheelSettings(current, touched, store.getState());
    render();
  };

  presetSelect.addEventListener('change', () =>
    change({ presetId: presetSelect.value })
  );
  // Drag shows the value; RELEASE dispatches. Unlike the OSM demo's slider,
  // every dispatch here is persisted into the recording, so applying on every
  // input step would write eleven actions per notch of a drag.
  influence.addEventListener('input', () => {
    influenceValue.textContent =
      Number(influence.value) === 0
        ? 'GPS only'
        : Number(influence.value).toFixed(2);
  });
  influence.addEventListener('change', () =>
    change({ compassInfluence: Number(influence.value) })
  );
  gateSelect.addEventListener('change', () =>
    change({ trustGateMode: gateSelect.value as CompassTrustGateMode })
  );
  pairSelect.addEventListener('change', () =>
    change({ pairSelection: pairSelect.value as WheelPairSelection })
  );
  requireTrust.addEventListener('change', () =>
    change({ pairSelectionRequireTrust: requireTrust.checked })
  );
  penalty.addEventListener('change', () =>
    change({
      headingPenalty: penalty.checked ? WHEEL_HEADING_PENALTY_DEFAULT : 0,
    })
  );

  const setOpen = (next: boolean): void => {
    open = next;
    panel.hidden = !next;
    gear.setAttribute('aria-expanded', String(next));
    if (next)
      readout.textContent = formatWheelReadout(deps.storeRef.get().getState());
  };
  gear.addEventListener('click', () => setOpen(!open));

  /**
   * Per store: refresh the readout on every change while the panel is open,
   * and flush the touched settings once the store becomes decided - from a
   * microtask, outside the dispatch that made it decided.
   */
  const attachStore = (store: RecorderStore): (() => void) => {
    let flushScheduled = false;
    let seeded = false;
    const listener = (): void => {
      if (open) readout.textContent = formatWheelReadout(store.getState());
      const decided = store.getState().gpsData !== null;
      if (decided && !seeded) {
        seeded = true;
        seed(store);
      }
      if (
        touched.size > 0 &&
        !suspended &&
        !applied.has(store) &&
        decided &&
        !flushScheduled
      ) {
        flushScheduled = true;
        queueMicrotask(() => {
          flushScheduled = false;
          if (!applied.has(store)) applyTo(store);
        });
      }
    };
    const unsubscribe = store.subscribe(listener);
    // A swapped-in store that is already decided: read it, then apply what was
    // touched (nothing, for an untouched wheel).
    if (store.getState().gpsData !== null) {
      seeded = true;
      seed(store);
      applyTo(store);
    }
    return unsubscribe;
  };

  return {
    attach() {
      if (attached) return;
      deps.controlsRoot.append(gear);
      deps.overlayRoot.append(panel);
      render();
      unfollow = followStore(deps.storeRef, attachStore);
      attached = true;
    },
    dispose() {
      if (!attached) return;
      unfollow?.();
      unfollow = null;
      gear.remove();
      panel.remove();
      attached = false;
    },
    values: () => current,
    touched: () => touched.size > 0,
    set: (patch) => change(patch),
    suspend() {
      suspended = true;
    },
    resume() {
      suspended = false;
      const store = deps.storeRef.get();
      if (!applied.has(store)) applyTo(store);
    },
  };
}
