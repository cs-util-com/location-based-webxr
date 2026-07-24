/**
 * HUD / UI Module
 *
 * Manages the HTML overlay elements: status display, buttons, modals.
 */

import { getRequiredElement } from '../utils/dom-helpers';
import { DEFAULT_SCENARIO } from './session-browser';

// The HUD shared mutable state (host callbacks, permission/storage flags,
// cached required elements) and the UICallbacks contract live in
// hud-state.ts so extracted panels can share them without importing this
// module back (simplify-loop Area 5 stage C).
import { hudState, type UICallbacks } from './hud-state';

export type { UICallbacks } from './hud-state';

/**
 * Show the new-scenario section with its fade-in transition and focus the
 * name input. Shared helper (quality-review D-5 — the show/hide pair used to
 * be copied across the scenario change handler and `populateScenarios` and
 * had already drifted: the `populateScenarios` hide copy lost the transition
 * handling).
 */
function showNewScenarioSection(): void {
  const section = document.getElementById('new-scenario-section');
  const nameInput = document.getElementById(
    'new-scenario-name'
  ) as HTMLInputElement | null;
  // Show with transition: remove hidden, then add opacity.
  section?.classList.remove('hidden');
  // Use requestAnimationFrame to ensure transition triggers after display change
  requestAnimationFrame(() => {
    section?.classList.remove('opacity-0');
    section?.classList.add('opacity-100');
  });
  // Auto-focus the input to guide user to next action
  nameInput?.focus();
}

/**
 * Hide the new-scenario section, honoring the fade-out transition when one
 * applies (reduced motion / jsdom / 0s duration hide immediately, keeping
 * the element properly hidden from assistive tech). The deferred `hidden`
 * add re-checks the select so rapid toggles back to "__new__" are not
 * clobbered.
 */
function hideNewScenarioSection(scenarioSelect: HTMLSelectElement): void {
  const section = document.getElementById('new-scenario-section');
  // Hide with transition: remove opacity first
  section?.classList.remove('opacity-100');
  section?.classList.add('opacity-0');

  // Check if transitions are expected to run.
  // Use optional chaining for matchMedia (not available in jsdom without polyfill).
  const prefersReducedMotion =
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const transitionDuration = section
    ? getComputedStyle(section).transitionDuration
    : '0s';
  // Treat empty string (jsdom) or '0s' as no transition
  const hasTransition =
    !prefersReducedMotion &&
    transitionDuration !== '0s' &&
    transitionDuration !== '';

  if (hasTransition) {
    // Add hidden after transition completes to avoid visual glitches.
    // Use a timeout fallback in case transitionend never fires (browser bug,
    // rapid DOM changes, etc.). The fallback duration is slightly longer than
    // the CSS transition (300ms + 50ms buffer).
    const fallbackTimeoutMs = 350;
    const timeoutId = setTimeout(() => {
      if (scenarioSelect.value !== '__new__') {
        section?.classList.add('hidden');
      }
    }, fallbackTimeoutMs);

    // Note on cleanup: { once: true } auto-removes the listener after firing,
    // preventing accumulation. The element is never removed from the DOM (only
    // hidden via CSS), so no explicit cleanup is needed. The inner conditional
    // handles rapid toggles—if user switches back to "__new__" before transition
    // ends, we skip adding 'hidden'.
    section?.addEventListener(
      'transitionend',
      () => {
        clearTimeout(timeoutId);
        if (scenarioSelect.value !== '__new__') {
          section?.classList.add('hidden');
        }
      },
      { once: true }
    );
  } else {
    // No transition expected (reduced motion or 0s duration) — hide immediately.
    if (scenarioSelect.value !== '__new__') {
      section?.classList.add('hidden');
    }
  }
}

/**
 * Initialize UI event listeners
 */
export function initUI(cbs: UICallbacks): void {
  hudState.callbacks = cbs;

  // Critical setup modal elements - app cannot function without these
  const btnEnterAR = getRequiredElement<HTMLButtonElement>('btn-enter-ar');
  const scenarioSelect =
    getRequiredElement<HTMLSelectElement>('scenario-select');

  // Recording controls - core functionality
  const btnStart = getRequiredElement('btn-start');
  const btnStop = getRequiredElement('btn-stop');
  const btnRefPoint = getRequiredElement('btn-ref-point');

  // Secondary ref point button — always in DOM, shown only for Part B proximity feature
  const btnNewRefPoint = getRequiredElement('btn-new-ref-point');

  // Recording indicator element
  const recordingIndicator = getRequiredElement('recording-indicator');

  // Cache required elements for use in other functions
  hudState.cachedElements = {
    btnEnterAR,
    scenarioSelect,
    btnStart,
    btnStop,
    btnRefPoint,
    btnNewRefPoint,
    recordingIndicator,
  };

  // Optional elements - graceful degradation allowed
  const btnMap = document.getElementById('btn-map');
  const btnRequestPermissions = document.getElementById(
    'btn-request-permissions'
  );

  // Optional external backup buttons (Issue 1a - 2026-01-27 user feedback)
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnChooseSave = document.getElementById('btn-choose-save');

  // Wire up events for external backup buttons (optional)
  btnOpenFolder?.addEventListener('click', () => {
    void hudState.callbacks?.onOpenFolder();
  });

  btnChooseSave?.addEventListener('click', () => {
    void hudState.callbacks?.onChooseSaveLocation();
  });

  btnEnterAR.addEventListener('click', () => {
    void hudState.callbacks
      ?.onEnterAR()
      .then(() => {
        hideSetupModal();
        showArReadyControls();
      })
      .catch(() => {
        // Error already handled by main.ts handleEnterAR try/catch.
        // Ensure setup modal stays visible so user can retry.
        showSetupModal();
      });
  });

  btnStart.addEventListener('click', () => {
    void hudState.callbacks?.onStartRecording();
  });

  btnStop.addEventListener('click', () => {
    void hudState.callbacks?.onStopRecording();
  });

  btnRefPoint.addEventListener('click', () => {
    void hudState.callbacks?.onMarkRefPoint();
  });

  btnNewRefPoint.addEventListener('click', () => {
    void hudState.callbacks?.onMarkNewRefPoint();
  });

  // Optional map button
  btnMap?.addEventListener('click', () => {
    hudState.callbacks?.onToggleMap();
  });

  // Optional map zoom buttons
  const btnZoomIn = document.getElementById('btn-map-zoom-in');
  const btnZoomOut = document.getElementById('btn-map-zoom-out');
  btnZoomIn?.addEventListener('click', () => {
    hudState.callbacks?.onMapZoomIn();
  });
  btnZoomOut?.addEventListener('click', () => {
    hudState.callbacks?.onMapZoomOut();
  });

  // Permission request button
  btnRequestPermissions?.addEventListener('click', () => {
    void hudState.callbacks?.onRequestPermissions();
  });

  // Scenario dropdown logic — show/hide via the shared helpers (quality-review
  // D-5: the section toggling used to be copied across this handler and
  // populateScenarios and had already drifted).
  scenarioSelect.addEventListener('change', () => {
    if (scenarioSelect.value === '__new__') {
      showNewScenarioSection();
    } else {
      hideNewScenarioSection(scenarioSelect);

      // Notify main.ts about scenario change
      if (scenarioSelect.value) {
        hudState.callbacks?.onScenarioChange(scenarioSelect.value);
      }
    }
    validateEnterButton();
  });

  // New scenario name input - revalidate on typing
  const newScenarioName = document.getElementById(
    'new-scenario-name'
  ) as HTMLInputElement | null;
  // Pre-fill with the canonical default scenario so users can tap "Enter AR"
  // without typing when no existing scenarios are found (UX 2026-05-03).
  // Sourced from `DEFAULT_SCENARIO` so the canonical name lives in exactly
  // one place; HTML cannot import a TS constant directly.
  if (newScenarioName && newScenarioName.value === '') {
    newScenarioName.value = DEFAULT_SCENARIO;
  }
  newScenarioName?.addEventListener('input', () => {
    validateEnterButton();
  });

  // Initialize help section collapsed state from localStorage (Issue 2 - User Feedback)
  initHelpSection();

  // Set initial hint state
  validateEnterButton();
}

/**
 * Update the status text in the HUD
 */
export function updateStatus(text: string): void {
  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = text;
    statusText.className = 'text-green-400';
  }
}

/**
 * Update the folder-status display text.
 */
export function updateFolderStatus(text: string): void {
  const el = document.getElementById('folder-status');
  if (el) {
    el.textContent = text;
  }
}

/**
 * Update the save-status display text.
 */
export function updateSaveStatus(text: string): void {
  const el = document.getElementById('save-status');
  if (el) {
    el.textContent = text;
  }
}

/**
 * Show an error message
 */
export function showError(message: string): void {
  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = message;
    statusText.className = 'text-red-400';
  }

  // Also show WebXR warning in modal if relevant
  const warning = document.getElementById('webxr-warning');
  if (warning && message.toLowerCase().includes('webxr')) {
    warning.textContent = message;
    warning.classList.remove('hidden');
  }
}

/**
 * Reveal the prominent unsupported-platform notice in the setup modal.
 *
 * D1 (2026-06-16 user feedback, Finding 1): when `immersive-ar` WebXR is
 * unavailable the app drops into replay mode (see `switchToReplayMode`), which
 * suppresses the recording setup UI but previously left the *reason* unexplained
 * — the field tester experienced this as "the app only works on Chrome on
 * Android" with no in-app guidance. This banner states the cause (the browser
 * lacks the AR tracking the recorder needs — typically iOS) and the fix (open it
 * in Chrome on Android), while noting replay still works. The copy itself lives
 * in `index.html` (`#unsupported-platform-notice`); this only unhides it.
 *
 * Defensive: a no-op when the element is absent (e.g. trimmed test fixtures).
 */
export function showUnsupportedPlatformNotice(): void {
  const notice = document.getElementById('unsupported-platform-notice');
  if (notice) {
    notice.classList.remove('hidden');
  }
}

/**
 * Update GPS accuracy display
 */
export function updateGpsInfo(accuracy: number): void {
  const gpsInfo = document.getElementById('gps-info');
  const gpsAccuracy = document.getElementById('gps-accuracy');
  if (gpsInfo && gpsAccuracy) {
    gpsInfo.classList.remove('hidden');
    gpsAccuracy.textContent = `±${accuracy.toFixed(1)}m`;
    gpsAccuracy.className =
      accuracy < 10
        ? 'text-green-400'
        : accuracy < 30
          ? 'text-yellow-400'
          : 'text-red-400';
  }
}

/**
 * Update AR tracking status display
 */
export function updateArInfo(tracking: string): void {
  const arInfo = document.getElementById('ar-info');
  const arTracking = document.getElementById('ar-tracking');
  if (arInfo && arTracking) {
    arInfo.classList.remove('hidden');
    arTracking.textContent = tracking;
  }
}

/**
 * Update the live frame capture counter in the HUD.
 * Shown during recording so the user can immediately see if image capture is working.
 *
 * @param count - Number of frames captured so far
 */
export function updateFrameCount(count: number): void {
  const frameCountInfo = document.getElementById('frame-count-info');
  const frameCountSpan = document.getElementById('frame-count');
  if (frameCountInfo && frameCountSpan) {
    frameCountInfo.classList.remove('hidden');
    frameCountSpan.textContent = String(count);
    // Color: red if stuck at 0 after a while, green otherwise
    frameCountSpan.className = count > 0 ? 'text-green-400' : 'text-yellow-400';
  }
}

/**
 * Hide the frame count display (e.g., when recording stops).
 */
export function hideFrameCount(): void {
  const frameCountInfo = document.getElementById('frame-count-info');
  if (frameCountInfo) {
    frameCountInfo.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Tracking Quality indicator — lives in hud-tracking-quality-panel.ts
// (simplify-loop Area 5). Re-exported here so every HUD consumer (and the
// wiring tests' `vi.mock('./ui/hud')` factories) keeps this single seam.
// ---------------------------------------------------------------------------

export {
  updateTrackingQuality,
  hideTrackingQuality,
} from './hud-tracking-quality-panel';

// ---------------------------------------------------------------------------
// Sync + AbsCompass status rows — live in hud-status-rows.ts (simplify-loop
// Area 5, stage B). Re-exported here so every HUD consumer keeps this seam.
// ---------------------------------------------------------------------------

// (The AbsCompassStatusDisplay type is exported by hud-status-rows.ts itself;
// no consumer imports it by name — callers are structurally typed — so it is
// deliberately not re-exported here, which knip would flag as unused.)
export {
  updateSyncStatus,
  setAbsCompassStatus,
  hideAbsCompass,
} from './hud-status-rows';

/**
 * Hide the setup modal
 */
function hideSetupModal(): void {
  const modal = document.getElementById('setup-modal');
  modal?.classList.add('hidden');
}

/**
 * Show the setup modal.
 *
 * Used by the soft reset flow (Issue 4, 2026-02-06 user feedback) to return
 * the UI to the SETUP screen without a full page reload.
 */
export function showSetupModal(): void {
  const modal = document.getElementById('setup-modal');
  modal?.classList.remove('hidden');
}

/**
 * Options for resetUIForNewRecording.
 */
interface ResetUIOptions {
  /** If true, keep the folder-selected state (read folder handle persists). */
  keepFolder: boolean;
}

/**
 * Reset HUD state for a new recording session.
 *
 * Returns the UI to the SETUP screen: shows the setup modal, hides
 * recording/AR controls, clears the save location (each session needs a
 * new ZIP), and optionally preserves folder selection state.
 *
 * Issue 4 (2026-02-06 user feedback): Retain read permission on new recording.
 */
export function resetUIForNewRecording(options: ResetUIOptions): void {
  // Show setup modal, hide recording controls
  showSetupModal();
  if (hudState.cachedElements) {
    hudState.cachedElements.btnStart.classList.add('hidden');
    hudState.cachedElements.btnStop.classList.add('hidden');
    hudState.cachedElements.btnRefPoint.classList.add('hidden');
    hudState.cachedElements.recordingIndicator.classList.add('hidden');
  }

  // Always clear save location (new session = new ZIP)
  hudState.saveLocationSelected = false;
  const saveStatus = document.getElementById('save-status');
  if (saveStatus) {
    saveStatus.textContent = '';
  }

  // Conditionally clear the folder status display
  if (!options.keepFolder) {
    const folderStatus = document.getElementById('folder-status');
    if (folderStatus) {
      folderStatus.textContent = '';
    }
  }

  validateEnterButton();
}

/**
 * Show AR ready controls (after AR session starts, before recording begins).
 *
 * Per the Application State Machine (README.md#application-state-machine):
 * In AR_READY state, the Start button is visible so the user can
 * explicitly choose when to begin recording.
 *
 * Issue #2 fix: Previously this showed Stop button, which was confusing.
 */

const DEFAULT_REF_POINT_LABEL = '📍 Mark Point';

export function showArReadyControls(): void {
  if (!hudState.cachedElements) {
    throw new Error('showArReadyControls called before initUI()');
  }
  // Show Start button (user must explicitly start recording)
  hudState.cachedElements.btnStart.classList.remove('hidden');
  // Hide Stop button (not recording yet)
  hudState.cachedElements.btnStop.classList.add('hidden');
  // Hide ref point button (only available during recording)
  hudState.cachedElements.btnRefPoint.classList.add('hidden');
  // Hide secondary "add new ref point" button
  hudState.cachedElements.btnNewRefPoint.classList.add('hidden');
  // Hide recording indicator (not recording yet)
  hudState.cachedElements.recordingIndicator.classList.add('hidden');
  // Reset ref point button label for next session (Change D)
  hudState.cachedElements.btnRefPoint.textContent = DEFAULT_REF_POINT_LABEL;
  // Clear any leftover proximity hint (D3) so it does not linger into the
  // next AR_READY state before recording starts.
  updateRefPointHint(undefined);
}

/**
 * Update the ref point button label to reflect proximity to a known ref point.
 * Called on each GPS update during recording. Pass `undefined` to reset to default.
 */
export function updateRefPointButtonLabel(refPointName?: string): void {
  if (!hudState.cachedElements) {
    return;
  }
  hudState.cachedElements.btnRefPoint.textContent = refPointName
    ? `📍 Capture '${refPointName}'`
    : DEFAULT_REF_POINT_LABEL;
}

/**
 * Update the inline ref-point proximity hint (D3, 2026-06-16 user feedback,
 * Finding 3) so the button's name relabel reads as a *location confirmation*
 * rather than a mysterious "the marker name switched to an older one".
 *
 * - Not near a known point (`undefined`) → hint hidden; the "📍 Mark Point"
 *   button is self-explanatory and a persistent hint would just be clutter.
 * - Same cell as a known point (`isNeighborCell === false`) → "You're at
 *   '<name>' — tap 📍 to re-observe it." (the ➕ button is hidden here).
 * - Neighbour cell (`isNeighborCell === true`) → "Near '<name>' — tap 📍 to
 *   re-observe it, or ➕ to mark a new point here." (both options are live).
 *
 * Display-only: this changes no marking behaviour and adds no name-management
 * UI (names stay secondary to the H3 cell). Looks the element up lazily and is
 * a no-op when absent (trimmed test fixtures / pre-`initUI`).
 */
export function updateRefPointHint(nearby?: {
  displayName: string;
  isNeighborCell: boolean;
}): void {
  const hint = document.getElementById('ref-point-hint');
  if (!hint) {
    return;
  }
  if (!nearby) {
    hint.textContent = '';
    hint.classList.add('hidden');
    return;
  }
  hint.textContent = nearby.isNeighborCell
    ? `Near '${nearby.displayName}' — tap 📍 to re-observe it, or ➕ to mark a new point here.`
    : `You're at '${nearby.displayName}' — tap 📍 to re-observe it.`;
  hint.classList.remove('hidden');
}

/**
 * Show or hide the secondary "+" button for creating a new ref point
 * when the user is in a neighboring H3 cell of an existing ref point.
 * See: docs/2026-04-18-ref-point-proximity-button-improvements.md, Part B.
 */
export function setNewRefPointButtonVisible(visible: boolean): void {
  if (!hudState.cachedElements) {
    return;
  }
  hudState.cachedElements.btnNewRefPoint.classList.toggle('hidden', !visible);
}

/**
 * Show recording controls (after recording starts).
 *
 * Per the Application State Machine (README.md#application-state-machine):
 * In RECORDING state, the Stop button is visible and Start is hidden.
 */
export function showRecordingControls(): void {
  if (!hudState.cachedElements) {
    throw new Error('showRecordingControls called before initUI()');
  }
  hudState.cachedElements.btnStart.classList.add('hidden');
  hudState.cachedElements.btnStop.classList.remove('hidden');
  hudState.cachedElements.btnRefPoint.classList.remove('hidden');

  // A prior stop may have left the button in its busy state — ensure each new
  // recording starts with a clean, enabled "Stop" button.
  setStopButtonBusy(false);

  // Show recording indicator
  hudState.cachedElements.recordingIndicator.classList.remove('hidden');
}

/** Idle and in-progress labels for the recording Stop button. */
const STOP_BUTTON_IDLE_LABEL = '⏹ Stop';
const STOP_BUTTON_BUSY_LABEL = '⏹ Stopping…';

/**
 * Move the Stop button into (or out of) its in-progress state.
 *
 * Stopping a recording runs a final external sync that can take many seconds
 * for large sessions. Per the async-feedback rule (CLAUDE.md) the button must
 * become clearly non-idle for that duration: disabled (so it cannot be tapped
 * again — the double-tap that produced Sentry issue 7319627943), relabelled to
 * "Stopping…", and flagged `aria-busy` for assistive tech. Passing `false`
 * restores the idle label and re-enables the button.
 */
export function setStopButtonBusy(busy: boolean): void {
  if (!hudState.cachedElements) {
    throw new Error('setStopButtonBusy called before initUI()');
  }
  const btnStop = hudState.cachedElements.btnStop;
  btnStop.toggleAttribute('disabled', busy);
  btnStop.setAttribute('aria-busy', busy ? 'true' : 'false');
  btnStop.textContent = busy ? STOP_BUTTON_BUSY_LABEL : STOP_BUTTON_IDLE_LABEL;
}

/**
 * Hide recording controls and return to AR_READY state (after recording stops).
 *
 * This is semantically equivalent to showArReadyControls() but named for the
 * transition context (stopping recording) rather than the destination state.
 * Keeping both allows callers to express intent clearly.
 */
export function hideRecordingControls(): void {
  showArReadyControls();
}

// ---------------------------------------------------------------------------
// Enter-AR readiness gate (button validation, permission rows, save-location
// flags) — lives in hud-enter-ar-gate.ts (simplify-loop Area 5 stage C2).
// Re-exported here so every HUD consumer keeps this single seam.
// ---------------------------------------------------------------------------

// validateEnterButton is also called internally (initUI wiring,
// resetUIForNewRecording, populateScenarios), hence import + re-export.
import { validateEnterButton } from './hud-enter-ar-gate';

export {
  validateEnterButton,
  updatePermissionStatus,
  setPermissionsReady,
  setSaveLocationSelected,
  getSaveLocationSelected,
} from './hud-enter-ar-gate';

/**
 * Populate the scenario dropdown with existing scenarios
 */
export function populateScenarios(scenarios: string[]): void {
  if (!hudState.cachedElements) {
    throw new Error('populateScenarios called before initUI()');
  }
  const { scenarioSelect } = hudState.cachedElements;
  // sessionNotes is optional - graceful degradation allowed
  const sessionNotes = document.getElementById(
    'session-notes'
  ) as HTMLTextAreaElement | null;

  scenarioSelect.innerHTML = '';
  scenarioSelect.disabled = false;

  // Add "new scenario" option
  const newOption = document.createElement('option');
  newOption.value = '__new__';
  newOption.textContent = '+ Create new scenario';
  scenarioSelect.appendChild(newOption);

  // Add existing scenarios
  for (const name of scenarios) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    scenarioSelect.appendChild(opt);
  }

  // Enable notes
  if (sessionNotes) {
    sessionNotes.disabled = false;
  }

  // Select first existing scenario if available, otherwise handle new scenario flow
  if (scenarios.length > 0) {
    scenarioSelect.value = scenarios[0]!;
    // Programmatic value change doesn't fire 'change' event, so we need to
    // manually notify main.ts to sync currentScenarioName
    hudState.callbacks?.onScenarioChange(scenarios[0]!);
    // Hide new scenario section since an existing scenario is selected —
    // through the shared helper (quality-review D-5: this copy had drifted
    // and lost the fade-out transition handling).
    hideNewScenarioSection(scenarioSelect);
  } else {
    // No existing scenarios - the only option is "__new__"
    // Browser auto-selects it but doesn't fire change event, so we need to
    // manually show the new scenario input section and focus it
    scenarioSelect.value = '__new__';
    showNewScenarioSection();
  }

  validateEnterButton();
}

/**
 * Expand or collapse the optional "Import previous recordings" folder section,
 * and optionally show a one-line hint above the folder button.
 *
 * D5 (2026-06-05 recorder setup UX): the folder-read step is collapsed by
 * default and auto-expanded only when the chosen scenario has no saved
 * reference points in OPFS, with a recovery hint. Passing an empty/undefined
 * hint clears and hides the hint line. Degrades gracefully if the elements are
 * absent (e.g. minimal test DOM).
 */
export function setFolderImportExpanded(
  expanded: boolean,
  hint?: string
): void {
  const section = document.getElementById(
    'folder-import-section'
  ) as HTMLDetailsElement | null;
  if (section) {
    section.open = expanded;
  }
  const hintEl = document.getElementById('folder-import-hint');
  if (hintEl) {
    // The hint explains WHY the section auto-expanded, so it is gated on
    // `expanded` — a hint under a collapsed section would be inconsistent
    // state (PR #63 review).
    if (expanded && hint && hint.trim()) {
      hintEl.textContent = hint;
      hintEl.classList.remove('hidden');
    } else {
      hintEl.textContent = '';
      hintEl.classList.add('hidden');
    }
  }
}

/**
 * State of the folder-import progress display (D2, 2026-07-05 folder-import
 * feedback): `progress` while the eager ref-point indexing pass runs (one
 * event per ZIP), `done` as the durable end state, `null` to reset/hide
 * (failure and abort paths — the error itself surfaces via the toast/error
 * channel, not the bar).
 */
export type FolderImportProgressState =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'done'; refPointsWritten: number; zipFilesTotal: number }
  | null;

/** How long the ✓ end state stays visible before the bar hides itself. */
const FOLDER_IMPORT_PROGRESS_LINGER_MS = 4000;
let folderImportProgressHideTimer: ReturnType<typeof setTimeout> | null = null;

/** Durable ✓ end-state copy for the folder-import progress label. */
function folderImportDoneText(
  refPointsWritten: number,
  zipFilesTotal: number
): string {
  const recordings = `${zipFilesTotal} recording${zipFilesTotal === 1 ? '' : 's'}`;
  if (refPointsWritten > 0) {
    const points = `${refPointsWritten} reference point${refPointsWritten === 1 ? '' : 's'}`;
    return `✓ ${points} recovered from ${recordings}`;
  }
  return `✓ Reference points already up to date (${recordings} scanned)`;
}

/**
 * Drive the determinate progress bar (+ text label above it) inside the
 * folder-import section while recordings are indexed into per-scenario ref
 * points. Progress granularity is per ZIP file. Degrades gracefully when the
 * elements are absent (minimal test DOMs). Async-UX rule: the done state is
 * durable — it lingers for a few seconds before the bar hides itself; a
 * `null` reset also cancels a pending linger timer so a torn-down pass can
 * never resurface the bar.
 */
export function setFolderImportProgress(
  state: FolderImportProgressState
): void {
  const container = document.getElementById('folder-import-progress');
  const text = document.getElementById('folder-import-progress-text');
  const bar = document.getElementById('folder-import-progress-bar');
  if (!container || !text || !bar) return;

  if (folderImportProgressHideTimer !== null) {
    clearTimeout(folderImportProgressHideTimer);
    folderImportProgressHideTimer = null;
  }

  const hide = (): void => {
    container.classList.add('hidden');
    container.removeAttribute('aria-valuenow');
    bar.style.width = '0%';
    text.textContent = '';
  };

  if (state === null || (state.kind === 'progress' && state.total <= 0)) {
    hide();
    return;
  }

  container.classList.remove('hidden');
  if (state.kind === 'progress') {
    const donePct = Math.round((state.done / state.total) * 100);
    text.textContent = `Recovering reference points… ${state.done} / ${state.total} recordings`;
    bar.style.width = `${donePct}%`;
    // The static progressbar semantics (role/aria-valuemin/aria-valuemax)
    // live on the container in index.html; only the value is dynamic.
    container.setAttribute('aria-valuenow', String(donePct));
    return;
  }

  // Durable end state (async-UX rule): 100% + ✓ summary, linger, then hide.
  bar.style.width = '100%';
  container.setAttribute('aria-valuenow', '100');
  text.textContent = folderImportDoneText(
    state.refPointsWritten,
    state.zipFilesTotal
  );
  folderImportProgressHideTimer = setTimeout(() => {
    folderImportProgressHideTimer = null;
    hide();
  }, FOLDER_IMPORT_PROGRESS_LINGER_MS);
}

// --- Help Section (Issue 2 - User Feedback 2026-01-27) ---

/**
 * localStorage keys for the help section.
 * ⚠️ Also defined in playwright-tests/help-section.spec.js — keep in sync!
 */
const HELP_COLLAPSED_KEY = 'gps-recorder-help-collapsed';
/** Set once the help section has been shown to this user at least once. */
const HELP_SEEN_KEY = 'gps-recorder-help-seen';

/**
 * Initialize the collapsible help section.
 *
 * **Show the manual once (2026-06-19 user feedback).** The section explains key
 * concepts (scenario, session, reference points) and is open **only on the very
 * first launch** so a first-time user sees it. On every **subsequent** start it
 * defaults to **collapsed** so the actual task — not a wall of help text — is the
 * first thing a returning user sees. (Previously it was open-until-manually-
 * collapsed, so a user who never closed it got the full help on every start —
 * the reported "always open also on future starts".)
 *
 * Precedence: an explicit collapse preference wins; otherwise first-time → open,
 * returning → collapsed. An explicit user toggle is still persisted via the
 * `toggle` listener.
 */
function initHelpSection(): void {
  const helpSection = document.getElementById(
    'help-section'
  ) as HTMLDetailsElement | null;
  if (!helpSection) {
    // Help section not in DOM - graceful degradation
    return;
  }

  // `localStorage` can throw on ANY access (not just writes) in private-browsing
  // modes, sandboxed iframes without allow-same-origin, or when storage is
  // disabled by policy. `initHelpSection` runs synchronously inside `initUI`,
  // which `main.ts` calls unguarded during bootstrap, so an escaping throw would
  // crash the whole app at startup. Guard every access (mirroring the
  // recording-options load/save/reset helpers): on failure we keep index.html's
  // shipped `open` default and skip the read-once "seen" write.
  let explicitlyCollapsed = false;
  let seenBefore = false;
  try {
    explicitlyCollapsed = localStorage.getItem(HELP_COLLAPSED_KEY) === 'true';
    seenBefore = localStorage.getItem(HELP_SEEN_KEY) === 'true';
  } catch {
    // Storage unavailable — degrade to the first-time-user default (open).
  }

  // Collapse for everyone except a genuine first-time user (no prior visit and
  // no explicit preference). `index.html` ships the section with a static
  // `open` attribute, so we only ever need to remove it.
  if (explicitlyCollapsed || seenBefore) {
    helpSection.removeAttribute('open');
  }

  // Remember that this user has now seen the help, so the next start defaults
  // to collapsed even if they never explicitly close it.
  try {
    localStorage.setItem(HELP_SEEN_KEY, 'true');
  } catch {
    // Persisting the "seen" flag is best-effort; ignore storage failures.
  }

  // Persist an explicit user toggle (so a deliberate expand/collapse is honoured
  // over the returning-user default).
  helpSection.addEventListener('toggle', () => {
    const isNowOpen = helpSection.open;
    try {
      if (isNowOpen) {
        // User expanded - remove the collapsed flag
        localStorage.removeItem(HELP_COLLAPSED_KEY);
      } else {
        // User collapsed - remember this preference
        localStorage.setItem(HELP_COLLAPSED_KEY, 'true');
      }
    } catch {
      // Persisting the toggle preference is best-effort; a storage failure must
      // not propagate out of the DOM event handler.
    }
  });
}
