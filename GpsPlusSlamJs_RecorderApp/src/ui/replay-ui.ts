/**
 * replay-ui.ts — DOM manipulation module for the replay mode UI.
 *
 * Manages visibility of recording vs. replay elements in the setup modal,
 * populates scenario/session dropdowns, wires playback controls, and
 * updates progress/status displays.
 *
 * This is a pure presentation layer — no business logic. All actions
 * are delegated to callbacks provided via initReplayUI().
 */

// ─── Types ────────────────────────────────────────────────────

/** Session entry for display in the session list. */
interface ReplaySessionEntry {
  filename: string;
  date: Date | null;
}

/** Callbacks wired by main.ts to connect UI events to replay orchestration. */
export interface ReplayUICallbacks {
  onScenarioChange: (scenarioName: string) => void;
  onSessionSelect: (sessionIndex: number) => void;
  onStartReplay: (speedFactor: number) => void;
  onPlayPause: () => void;
  onSpeedChange: (speedFactor: number) => void;
  onCameraToggle: () => void;
  onMapToggle: () => void;
  onMapZoomIn: () => void;
  onMapZoomOut: () => void;
  onRestart: () => void;
  /** Called when the user releases the scrubber slider at a new position. */
  onSeek: (actionIndex: number) => void;
  /** Called when user presses Right arrow to step forward one action. */
  onStepForward: () => void;
  /** Called when user presses Left arrow to step backward one action. */
  onStepBackward: () => void;
}

// ─── Module state ─────────────────────────────────────────────

let callbacks: ReplayUICallbacks | null = null;
// Track which session entry is selected (used by selectSessionEntry)
let _selectedSessionIndex = -1;
/** True while the user is actively dragging the scrubber thumb — prevents
 *  programmatic updates from fighting with the user's drag. */
let _isUserDraggingScrubber = false;

// ─── Helpers ──────────────────────────────────────────────────

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function hide(id: string): void {
  el(id)?.classList.add('hidden');
}

function show(id: string): void {
  el(id)?.classList.remove('hidden');
}

// ─── Init ─────────────────────────────────────────────────────

/**
 * Wire event listeners on replay UI elements.
 * Must be called once after DOM is ready.
 */
export function initReplayUI(cb: ReplayUICallbacks): void {
  callbacks = cb;

  // Scenario dropdown change
  const scenarioSelect = el(
    'replay-scenario-select'
  ) as HTMLSelectElement | null;
  scenarioSelect?.addEventListener('change', () => {
    callbacks?.onScenarioChange(scenarioSelect.value);
  });

  // Start Replay button — starts at 0.1× by default for better visibility
  el('btn-start-replay')?.addEventListener('click', () => {
    callbacks?.onStartReplay(0.1);
  });

  // Play/Pause button
  el('btn-replay-play-pause')?.addEventListener('click', () => {
    callbacks?.onPlayPause();
  });

  // Camera toggle button
  el('btn-camera-toggle')?.addEventListener('click', () => {
    callbacks?.onCameraToggle();
  });

  // Map toggle button (replay mode)
  el('btn-map-toggle-replay')?.addEventListener('click', () => {
    callbacks?.onMapToggle();
  });

  // Map zoom buttons (replay mode)
  el('btn-map-zoom-in-replay')?.addEventListener('click', () => {
    callbacks?.onMapZoomIn();
  });
  el('btn-map-zoom-out-replay')?.addEventListener('click', () => {
    callbacks?.onMapZoomOut();
  });

  // Restart button (shown after replay completes)
  el('btn-replay-restart')?.addEventListener('click', () => {
    callbacks?.onRestart();
  });

  // Scrubber / timeline slider
  const scrubber = el('replay-scrubber') as HTMLInputElement | null;
  if (scrubber) {
    // Track drag state to suppress programmatic updates while user is dragging
    scrubber.addEventListener('pointerdown', () => {
      _isUserDraggingScrubber = true;
    });
    // On release: fire seek and clear drag state
    scrubber.addEventListener('pointerup', () => {
      _isUserDraggingScrubber = false;
    });
    // change fires when the user commits a new value (mouseup / touchend)
    scrubber.addEventListener('change', () => {
      _isUserDraggingScrubber = false;
      const targetIndex = parseInt(scrubber.value, 10);
      callbacks?.onSeek(targetIndex);
    });
  }

  // Live speed presets (in the playback controls overlay)
  for (const btn of document.querySelectorAll('.replay-live-speed')) {
    btn.addEventListener('click', () => {
      const speed = parseFloat((btn as HTMLElement).dataset.replaySpeed ?? '1');
      callbacks?.onSpeedChange(speed);
    });
  }

  // Session list click delegation (entries are dynamically created)
  el('replay-session-list')?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-session-index]'
    );
    if (!target) {
      return;
    }
    const index = parseInt(target.dataset.sessionIndex ?? '-1', 10);
    if (index < 0) {
      return;
    }

    // Update selection visuals
    selectSessionEntry(index);

    callbacks?.onSessionSelect(index);
  });

  // Keyboard stepping: Left/Right arrows for single-action stepping
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      callbacks?.onStepForward();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      callbacks?.onStepBackward();
    }
  });
}

// ─── Setup modal mode switching ───────────────────────────────

/**
 * Switch the setup modal from recording mode to replay mode.
 * Hides recording-specific elements and shows replay setup section.
 */
export function switchToReplayMode(): void {
  // Hide recording-specific elements
  hide('btn-choose-save');
  hide('save-status');
  hide('permission-section');
  hide('btn-enter-ar');
  hide('enter-ar-hint');
  hide('webxr-warning');
  hide('btn-settings');
  hide('session-notes');
  hide('new-scenario-section');
  hide('scenario-select');

  // Show replay setup
  show('replay-setup');
  // The Start Replay CTA + its hint now live in the pinned footer (D4), outside
  // #replay-setup, and are hidden by default for the record path — reveal them
  // for the replay path. enableStartReplay() hides the hint once a session is
  // picked.
  show('btn-start-replay');
  show('replay-hint');

  // Update title
  const title = el('setup-title');
  if (title) {
    title.textContent = 'GPS + SLAM Replay';
  }

  // Update folder button text for replay context
  const folderBtn = el('btn-open-folder');
  if (folderBtn) {
    folderBtn.textContent = '📂 Open Recordings Folder...';
  }
}

// ─── Scenario dropdown ────────────────────────────────────────

/**
 * Populate the replay scenario dropdown with folder names.
 */
export function populateReplayScenarios(scenarios: string[]): void {
  const select = el('replay-scenario-select') as HTMLSelectElement | null;
  if (!select) {
    return;
  }

  select.innerHTML = '';

  if (scenarios.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No scenarios found --';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  // Add placeholder
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select scenario --';
  select.appendChild(placeholder);

  for (const name of scenarios) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  select.disabled = false;

  // Auto-select when only one scenario exists (UX feedback 2026-03-23 Issue 2)
  if (scenarios.length === 1) {
    select.value = scenarios[0]!;
    callbacks?.onScenarioChange(scenarios[0]!);
  }
}

// ─── Session list ─────────────────────────────────────────────

/**
 * Populate the session list with session entries.
 */
export function populateReplaySessions(sessions: ReplaySessionEntry[]): void {
  const list = el('replay-session-list');
  if (!list) {
    return;
  }

  _selectedSessionIndex = -1;
  while (list.firstChild) list.firstChild.remove();

  if (sessions.length === 0) {
    const p = document.createElement('p');
    p.className = 'text-xs text-gray-500 text-center py-2';
    p.textContent = 'No sessions found';
    list.appendChild(p);
    disableStartReplay();
    return;
  }

  for (const [index, session] of sessions.entries()) {
    const entry = document.createElement('div');
    entry.dataset.sessionIndex = String(index);
    entry.className =
      'px-3 py-2 rounded cursor-pointer text-sm hover:bg-gray-600 transition-colors';

    const dateStr = session.date
      ? session.date.toISOString().slice(0, 16).replace('T', ' ')
      : 'Unknown date';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'font-medium text-white truncate';
    nameDiv.textContent = session.filename;

    const dateDiv = document.createElement('div');
    dateDiv.className = 'text-xs text-gray-400';
    dateDiv.textContent = dateStr;

    entry.appendChild(nameDiv);
    entry.appendChild(dateDiv);

    list.appendChild(entry);
  }

  disableStartReplay();
}

/** Highlight a session entry and deselect others. */
function selectSessionEntry(index: number): void {
  const list = el('replay-session-list');
  if (!list) {
    return;
  }

  _selectedSessionIndex = index;

  for (const entry of list.querySelectorAll('[data-session-index]')) {
    const i = parseInt((entry as HTMLElement).dataset.sessionIndex ?? '-1', 10);
    if (i === index) {
      entry.classList.add('bg-blue-600');
      entry.classList.remove('hover:bg-gray-600');
    } else {
      entry.classList.remove('bg-blue-600');
      entry.classList.add('hover:bg-gray-600');
    }
  }

  enableStartReplay();
}

// ─── Start replay button ─────────────────────────────────────

/** Enable the "Start Replay" button. */
export function enableStartReplay(): void {
  const btn = el('btn-start-replay') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = false;
  }
  hide('replay-hint');
}

/** Disable the "Start Replay" button. */
export function disableStartReplay(): void {
  const btn = el('btn-start-replay') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
  }
}

// ─── Playback controls ───────────────────────────────────────

/** Show replay playback controls, color legend, and hide recording controls. */
export function showReplayControls(): void {
  show('replay-controls');
  show('replay-legend');
  hide('controls');
  hide('btn-replay-restart');
}

/** Hide replay playback controls and color legend. */
export function hideReplayControls(): void {
  hide('replay-controls');
  hide('replay-legend');
}

/** Update progress display and scrubber position. */
export function updateReplayProgress(current: number, total: number): void {
  const progress = el('replay-progress');
  if (progress) {
    progress.textContent = `Action ${current}/${total}`;
  }
  // Update scrubber thumb position (unless user is actively dragging)
  if (!_isUserDraggingScrubber) {
    const scrubber = el('replay-scrubber') as HTMLInputElement | null;
    if (scrubber) {
      scrubber.max = String(total);
      scrubber.value = String(current);
    }
  }
}

/**
 * Initialize the scrubber range for a new replay session.
 * Sets the max value and resets the thumb to 0.
 */
export function initScrubber(totalActions: number): void {
  const scrubber = el('replay-scrubber') as HTMLInputElement | null;
  if (scrubber) {
    scrubber.min = '0';
    scrubber.max = String(totalActions);
    scrubber.value = '0';
  }
}

/** Mark the scrubber as seeking (visual feedback). */
export function setScrubberSeeking(seeking: boolean): void {
  const scrubber = el('replay-scrubber');
  if (scrubber) {
    scrubber.classList.toggle('seeking', seeking);
  }
}

/** Update play/pause button appearance based on replay state. */
export function updatePlayPauseButton(
  state: 'playing' | 'paused' | 'completed'
): void {
  const btn = el('btn-replay-play-pause');
  if (!btn) {
    return;
  }

  switch (state) {
    case 'playing':
      btn.textContent = '⏸ Pause';
      hide('btn-replay-restart');
      break;
    case 'paused':
      btn.textContent = '▶ Resume';
      break;
    case 'completed':
      btn.textContent = '✅ Complete';
      show('btn-replay-restart');
      break;
  }
}

/** Update camera mode button label. */
export function updateCameraModeButton(mode: 'orbit' | 'fps'): void {
  const btn = el('btn-camera-toggle');
  if (!btn) {
    return;
  }

  btn.textContent = mode === 'orbit' ? '🔄 Orbit' : '🎮 Free Fly';
}

/** Highlight the selected speed button. */
export function updateSpeedButtonSelection(speed: number): void {
  for (const btn of document.querySelectorAll('.replay-live-speed')) {
    const btnSpeed = parseFloat((btn as HTMLElement).dataset.replaySpeed ?? '1');
    if (btnSpeed === speed) {
      btn.classList.add('bg-blue-600');
      btn.classList.remove('hover:bg-gray-600');
    } else {
      btn.classList.remove('bg-blue-600');
      btn.classList.add('hover:bg-gray-600');
    }
  }
}
