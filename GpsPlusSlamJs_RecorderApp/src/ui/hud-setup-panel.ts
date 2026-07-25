/**
 * Setup-screen panel — the setup modal's visibility, the scenario picker
 * (dropdown population + new-scenario section transitions), and the optional
 * folder-import section (expand/collapse hint + determinate progress bar).
 *
 * Extracted from the monolithic hud.ts (simplify-loop Area 5 stage C3,
 * 2026-07-24). hud.ts re-exports the public surface so all HUD consumers
 * keep one import seam; shared state lives on hudState (hud-state.ts).
 */

import { hudState } from './hud-state';
import { validateEnterButton } from './hud-enter-ar-gate';

/**
 * Show the new-scenario section with its fade-in transition and focus the
 * name input. Shared helper (quality-review D-5 — the show/hide pair used to
 * be copied across the scenario change handler and `populateScenarios` and
 * had already drifted: the `populateScenarios` hide copy lost the transition
 * handling).
 */
export function showNewScenarioSection(): void {
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
export function hideNewScenarioSection(
  scenarioSelect: HTMLSelectElement
): void {
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
 * Hide the setup modal
 */
export function hideSetupModal(): void {
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
