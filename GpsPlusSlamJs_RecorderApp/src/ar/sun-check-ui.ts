/**
 * The recorder's sun check (plan
 * 2026-09-24-0100-ar-sun-overlay-heading-check-plan.md §4.1, M3): the HUD
 * line, the safety reminder, the Mark button with its in-progress state, and
 * the last three results, over the framework's `startSunCheck` controller.
 *
 * The toggle is the debug wheel's; the check itself needs a live AR scene,
 * so it runs only while the toggle is on AND the UI is attached (between
 * Enter-AR and the session's end).
 */

import type { SunCheck } from 'gps-plus-slam-app-framework/ar/sun-check';

import type { SunSighting, SunSightingRecord } from './sun-sighting-note';

type SunMarkResult = Awaited<ReturnType<SunCheck['mark']>>;
type SunCheckStatus = ReturnType<SunCheck['status']>;
type Severity = 'info' | 'warning' | 'error';

export interface SunCheckUiDeps {
  /** The `#app` dom-overlay root (composites over the AR view). */
  readonly root: HTMLElement;
  /** Starts the framework check on the live AR scene. */
  readonly startCheck: () => SunCheck;
  /** The first-enable safety note; resolves true when acknowledged. */
  readonly confirmSafety: () => Promise<boolean>;
  readonly showToast: (
    message: string,
    options: { severity: Severity; duration?: number }
  ) => void;
  /**
   * Called at a Mark's PRESS: returns that Mark's recorder, bound to the
   * recording current then (`sun-sighting-note.ts`), which logs an accepted
   * sighting and says whether a recording kept it.
   */
  readonly recorderAtPress: () => SunSightingRecord;
  /**
   * The check turned itself off (it could not start when an AR session
   * attached), so the wheel's box can show it; `setEnabled` reports its own
   * result instead.
   */
  readonly onEnabledChange?: (enabled: boolean) => void;
  /** Repeats `f` every `ms`, returns the cancel (default `setInterval`). */
  readonly every?: (ms: number, f: () => void) => () => void;
}

export interface SunCheckUi {
  /** The wheel's toggle; resolves to the state actually reached. */
  setEnabled(on: boolean): Promise<boolean>;
  isEnabled(): boolean;
  /** An AR session is live: start the check if enabled. */
  attach(): void;
  /** The AR session ended: dispose the check, remove the HUD. */
  detach(): void;
  dispose(): void;
}

/** The first-enable note (owner default Q11; plan §4.3). */
export const SUN_SAFETY_NOTE =
  'Never look at the sun directly or through any optics. Compare on the ' +
  'screen only. Hold the phone at eye height between your eyes and the sun, ' +
  'so the phone shades your eyes, and lower it between Marks.';

const REMINDER = 'Never look at the sun - compare on the screen only.';
const STATUS_REFRESH_MS = 250;
const RESULT_TOAST_MS = 6000;
const HISTORY_LENGTH = 3;
/** Below this an error reads "on true" rather than inventing a side. */
const ON_TRUE_DEG = 0.05;
/**
 * Below this apparent elevation refraction dominates the error budget (plan
 * §5, owner default Q5/Q6: the useful window starts at 5°): a warning.
 */
const LOW_SUN_DEG = 5;

const HIDDEN_TEXT: Record<
  NonNullable<SunCheckStatus['hiddenBecause']>,
  string
> = {
  'no-position': 'Sun check: waiting for the GPS origin',
  'no-alignment': 'Sun check: waiting for the alignment',
  'not-tracking': 'Sun check: tracking lost',
  'sun-down': 'Sun check: the sun is below the horizon',
};

const REFUSAL_TEXT: Record<
  Exclude<Extract<SunMarkResult, { ok: false }>['reason'], 'moved'>,
  string
> = {
  'no-position': 'No GPS origin yet - start a recording and wait for a fix',
  'no-alignment': 'No alignment yet - walk until it has settled',
  'not-tracking': 'Tracking was lost - try again',
  'sun-down': 'The sun is below the horizon',
  busy: 'A Mark is already running',
  'no-frames': 'No camera frames arrived - try again',
  disposed: 'The sun check stopped',
};

const WARNING_TEXT = (
  warning: Extract<SunMarkResult, { ok: true }>['warnings'][number],
  elDeg: number
): string => {
  switch (warning) {
    case 'high-sun':
      return `sun high (${elDeg.toFixed(0)}°): heading less precise`;
    case 'target-changed':
      return 'the alignment changed during the Mark';
    case 'alignment-moving':
      return 'the alignment was moving';
  }
};

/** The HUD line for the controller's status. */
export function describeSunStatus(status: SunCheckStatus): string {
  if (
    status.visible &&
    status.sunAzDeg !== undefined &&
    status.sunElDeg !== undefined
  ) {
    return (
      `Sun az ${status.sunAzDeg.toFixed(1)}° el ${status.sunElDeg.toFixed(1)}° ` +
      '(apparent) · centre the cross on the sun ON THE SCREEN, then Mark'
    );
  }
  return status.hiddenBecause
    ? HIDDEN_TEXT[status.hiddenBecause]
    : 'Sun check: waiting';
}

/**
 * Where the CONTENT sits against the real sun (owner default Q13), not the
 * maths sign: `h > 0` (the app's azimuths too large) draws the virtual sun,
 * and all content with it, LEFT of true; `v > 0` draws it low.
 */
function describeOffsets(sighting: SunSighting): string {
  const h = sighting.headingErrDeg;
  const v = sighting.elevationErrDeg;
  const heading =
    Math.abs(h) < ON_TRUE_DEG
      ? 'on true heading'
      : `${Math.abs(h).toFixed(1)}° ${h > 0 ? 'left' : 'right'} of true`;
  const elevation =
    Math.abs(v) < ON_TRUE_DEG
      ? 'level'
      : `${Math.abs(v).toFixed(1)}° ${v > 0 ? 'low' : 'high'}`;
  return `Content ${heading} · ${elevation}`;
}

/** The toast for a Mark's result. */
export function describeSunMark(
  result: SunMarkResult,
  recorded: 'recorded' | 'not-recording'
): { message: string; severity: Severity } {
  if (!result.ok) {
    if (result.reason === 'moved') {
      return {
        message: `Moved ${(result.spreadDeg ?? 0).toFixed(1)}° during the Mark - hold still and try again`,
        severity: 'warning',
      };
    }
    return { message: REFUSAL_TEXT[result.reason], severity: 'warning' };
  }
  const { sighting, warnings } = result;
  const el = sighting.sunElApparentDeg;
  const lowSun =
    el < LOW_SUN_DEG
      ? [`sun low (${el.toFixed(0)}°): refraction makes it less certain`]
      : [];
  const parts = [
    describeOffsets(sighting),
    `sun el ${el.toFixed(0)}°`,
    ...lowSun,
    ...warnings.map((w) => WARNING_TEXT(w, el)),
    recorded === 'recorded'
      ? 'recorded'
      : 'not recorded (no recording running)',
  ];
  return {
    message: parts.join(' · '),
    severity: warnings.length + lowSun.length > 0 ? 'warning' : 'info',
  };
}

const defaultEvery = (ms: number, f: () => void): (() => void) => {
  const id = setInterval(f, ms);
  return () => clearInterval(id);
};

export function createSunCheckUi(deps: SunCheckUiDeps): SunCheckUi {
  const every = deps.every ?? defaultEvery;
  let enabled = false;
  let attached = false;
  let disposed = false;
  let safetyAcknowledged = false;
  let check: SunCheck | null = null;
  let stopRefresh: (() => void) | null = null;
  let busy = false;
  const history: string[] = [];

  // --- DOM (built once, mounted only while the check runs) ------------------
  const panel = document.createElement('div');
  panel.id = 'sun-check';
  // Bottom of the screen: instructions at the top edge would pull the gaze
  // up toward the sun (plan §4.3).
  panel.className =
    'fixed left-2 right-2 bottom-40 z-[60] rounded-xl bg-black/75 text-white text-xs p-2 space-y-1';
  const status = document.createElement('div');
  status.id = 'sun-check-status';
  status.className = 'font-mono';
  const reminder = document.createElement('div');
  reminder.id = 'sun-check-reminder';
  reminder.className = 'text-amber-300';
  reminder.textContent = REMINDER;
  const historyList = document.createElement('div');
  historyList.id = 'sun-check-history';
  historyList.className = 'font-mono text-gray-300';
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'btn-sun-mark';
  button.className =
    'min-h-12 min-w-24 rounded-full bg-fuchsia-700 hover:bg-fuchsia-600 text-white font-bold px-4 disabled:opacity-60';
  button.textContent = 'Mark';
  button.setAttribute('aria-busy', 'false');
  panel.append(status, reminder, historyList, button);

  const refreshStatus = (): void => {
    if (!check) return;
    try {
      status.textContent = describeSunStatus(check.status());
    } catch {
      status.textContent = 'Sun check: waiting';
    }
  };

  const renderHistory = (): void => {
    historyList.replaceChildren(
      ...history.map((line) => {
        const row = document.createElement('div');
        row.textContent = line;
        return row;
      })
    );
  };

  const stop = (): void => {
    stopRefresh?.();
    stopRefresh = null;
    check?.dispose();
    check = null;
    panel.remove();
  };

  /** Starts the check when enabled and attached; false if it failed. */
  const run = (): boolean => {
    if (!enabled || !attached || disposed || check) return true;
    try {
      check = deps.startCheck();
    } catch (err) {
      enabled = false;
      deps.showToast(
        `Sun check could not start: ${err instanceof Error ? err.message : String(err)}`,
        { severity: 'error' }
      );
      deps.onEnabledChange?.(false);
      return false;
    }
    deps.root.append(panel);
    refreshStatus();
    stopRefresh = every(STATUS_REFRESH_MS, refreshStatus);
    return true;
  };

  const setIdle = (): void => {
    busy = false;
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    button.textContent = 'Mark';
  };

  const onMark = async (): Promise<void> => {
    if (busy || !check) return;
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Hold still… 1 s';
    try {
      // Bound NOW: a store swapped while the Mark runs is another recording.
      let record: SunSightingRecord | null = null;
      let bindError: unknown = null;
      try {
        record = deps.recorderAtPress();
      } catch (err) {
        bindError = err;
      }
      const result = await check.mark();
      let recorded: 'recorded' | 'not-recording' = 'not-recording';
      if (result.ok) {
        try {
          if (!record) {
            throw bindError instanceof Error
              ? bindError
              : new Error(String(bindError));
          }
          recorded = record(result.sighting);
        } catch (err) {
          deps.showToast(
            `Sun Mark measured but could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
            { severity: 'error', duration: RESULT_TOAST_MS }
          );
          return;
        } finally {
          history.unshift(describeOffsets(result.sighting));
          history.length = Math.min(history.length, HISTORY_LENGTH);
          renderHistory();
        }
      }
      const { message, severity } = describeSunMark(result, recorded);
      deps.showToast(message, { severity, duration: RESULT_TOAST_MS });
    } finally {
      setIdle();
    }
  };
  button.addEventListener('click', () => void onMark());

  return {
    async setEnabled(on) {
      if (disposed) return false;
      if (!on) {
        enabled = false;
        stop();
        return false;
      }
      if (!safetyAcknowledged) {
        safetyAcknowledged = await deps.confirmSafety();
        if (!safetyAcknowledged) return false;
      }
      enabled = true;
      return run();
    },
    isEnabled: () => enabled,
    attach() {
      attached = true;
      run();
    },
    detach() {
      attached = false;
      stop();
    },
    dispose() {
      disposed = true;
      enabled = false;
      stop();
    },
  };
}
