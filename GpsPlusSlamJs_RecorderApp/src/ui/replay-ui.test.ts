// @vitest-environment jsdom
/**
 * Tests for replay-ui.ts — DOM manipulation module for the replay mode UI.
 *
 * Why these tests matter:
 * The replay UI module bridges HTML elements from index.html and the replay-mode
 * orchestrator. These tests verify that element visibility toggling, dropdown
 * population, progress updates, and event wiring work correctly — ensuring the
 * replay UX functions as designed (2026-02-19 replay-mode design doc, Issue 1).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initReplayUI,
  switchToReplayMode,
  populateReplayScenarios,
  populateReplaySessions,
  updateReplayProgress,
  showReplayControls,
  hideReplayControls,
  updatePlayPauseButton,
  updateCameraModeButton,
  enableStartReplay,
  disableStartReplay,
  type ReplayUICallbacks,
} from './replay-ui';

/**
 * Minimal HTML fixture matching the replay-related element IDs from index.html.
 * Includes both recording-specific elements (to test hiding) and replay elements.
 */
function createReplayHtmlFixture(): string {
  return `
    <!-- Setup modal elements -->
    <div id="setup-modal">
      <h1 id="setup-title">GPS + SLAM Recorder</h1>
      <button id="btn-settings">⚙️</button>
      <details id="help-section"><summary>Help</summary><div id="help-section-content">Recording help</div></details>
      <div id="storage-setup">
        <button id="btn-open-folder">📂 Open Folder</button>
        <p id="folder-status">No folder</p>
        <button id="btn-choose-save">💾 Save Location</button>
        <p id="save-status">No save</p>
      </div>
      <select id="scenario-select"><option value="">--</option></select>
      <div id="new-scenario-section">New scenario</div>
      <textarea id="session-notes"></textarea>
      <div id="permission-section">Permissions</div>

      <!-- Replay setup section -->
      <div id="replay-setup" class="hidden space-y-4">
        <select id="replay-scenario-select" disabled>
          <option value="">-- Open a folder first --</option>
        </select>
        <div id="replay-session-list">
          <p>Select a scenario</p>
        </div>
      </div>

      <!-- Pinned CTA footer (D4): record + replay CTAs share one footer. The
           replay CTA + hint are hidden by default for the record path and
           revealed by switchToReplayMode(); mirrors the production index.html. -->
      <div id="setup-cta-footer">
        <p id="webxr-warning" class="hidden">WebXR not supported</p>
        <p id="enter-ar-hint">Select a folder</p>
        <button id="btn-enter-ar" disabled>Enter AR</button>
        <p id="replay-hint" class="hidden">Open a folder and select a session</p>
        <button id="btn-start-replay" class="hidden" disabled>▶ Start Replay</button>
      </div>
    </div>

    <!-- Recording controls -->
    <div id="controls">
      <button id="btn-start">Start Recording</button>
      <button id="btn-stop" class="hidden">Stop</button>
    </div>

    <!-- Replay controls overlay -->
    <div id="replay-controls" class="hidden">
      <button id="btn-replay-play-pause">▶ Play</button>
      <span id="replay-progress">Action 0/0</span>
      <button data-replay-speed="0.1" class="replay-live-speed">0.1×</button>
      <button data-replay-speed="0.2" class="replay-live-speed">0.2×</button>
      <button data-replay-speed="0.5" class="replay-live-speed">0.5×</button>
      <button data-replay-speed="1" class="replay-live-speed">1×</button>
      <button data-replay-speed="2" class="replay-live-speed">2×</button>
      <button data-replay-speed="5" class="replay-live-speed">5×</button>
      <button data-replay-speed="10" class="replay-live-speed">10×</button>
      <button id="btn-camera-toggle">🔄 Orbit</button>
      <button id="btn-map-toggle-replay">🗺️</button>
    </div>

    <!-- Color legend for replay 3D view -->
    <div id="replay-legend" class="hidden">
      <span data-legend-entry class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-yellow-400 inline-block"></span> GPS</span>
      <span data-legend-entry class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-cyan-400 inline-block"></span> Fused VIO</span>
      <span data-legend-entry class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-red-500 inline-block"></span> Alignment Snapshot</span>
    </div>
  `;
}

function createCallbacks(): ReplayUICallbacks {
  return {
    onScenarioChange: vi.fn(),
    onSessionSelect: vi.fn(),
    onStartReplay: vi.fn(),
    onPlayPause: vi.fn(),
    onSpeedChange: vi.fn(),
    onCameraToggle: vi.fn(),
    onMapToggle: vi.fn(),
    onMapZoomIn: vi.fn(),
    onMapZoomOut: vi.fn(),
    onRestart: vi.fn(),
    onSeek: vi.fn(),
    onStepForward: vi.fn(),
    onStepBackward: vi.fn(),
  };
}

describe('replay-ui', () => {
  let callbacks: ReplayUICallbacks;

  beforeEach(() => {
    document.body.innerHTML = createReplayHtmlFixture();
    callbacks = createCallbacks();
  });

  describe('switchToReplayMode', () => {
    it('hides recording-specific elements and shows replay setup', () => {
      // Recording elements should be visible initially
      expect(
        document.getElementById('btn-choose-save')!.classList.contains('hidden')
      ).toBe(false);

      switchToReplayMode();

      // Recording-specific elements should be hidden
      expect(
        document.getElementById('btn-choose-save')!.classList.contains('hidden')
      ).toBe(true);
      expect(
        document.getElementById('save-status')!.classList.contains('hidden')
      ).toBe(true);
      expect(
        document
          .getElementById('permission-section')!
          .classList.contains('hidden')
      ).toBe(true);
      expect(
        document.getElementById('btn-enter-ar')!.classList.contains('hidden')
      ).toBe(true);
      expect(
        document.getElementById('enter-ar-hint')!.classList.contains('hidden')
      ).toBe(true);
      expect(
        document.getElementById('btn-settings')!.classList.contains('hidden')
      ).toBe(true);
      expect(
        document.getElementById('session-notes')!.classList.contains('hidden')
      ).toBe(true);
      expect(
        document
          .getElementById('new-scenario-section')!
          .classList.contains('hidden')
      ).toBe(true);
      expect(
        document.getElementById('scenario-select')!.classList.contains('hidden')
      ).toBe(true);

      // Replay setup should be visible
      expect(
        document.getElementById('replay-setup')!.classList.contains('hidden')
      ).toBe(false);
    });

    it('changes the modal title to Replay', () => {
      switchToReplayMode();
      expect(document.getElementById('setup-title')!.textContent).toContain(
        'Replay'
      );
    });

    it('hides the webxr warning', () => {
      // Show it first to verify it gets hidden
      document.getElementById('webxr-warning')!.classList.remove('hidden');
      switchToReplayMode();
      expect(
        document.getElementById('webxr-warning')!.classList.contains('hidden')
      ).toBe(true);
    });

    it('updates the folder button text for replay context', () => {
      switchToReplayMode();
      expect(document.getElementById('btn-open-folder')!.textContent).toContain(
        'Recordings'
      );
    });

    // Why: D4 (2026-06-19) moved the Start Replay CTA + hint into the shared
    // pinned footer, OUTSIDE #replay-setup, hidden by default for the record
    // path. switchToReplayMode() must now explicitly reveal them — otherwise the
    // replay path would have no visible action (regression guard).
    it('reveals the footer Start Replay button and hint for the replay path', () => {
      expect(
        document
          .getElementById('btn-start-replay')!
          .classList.contains('hidden')
      ).toBe(true);
      expect(
        document.getElementById('replay-hint')!.classList.contains('hidden')
      ).toBe(true);

      switchToReplayMode();

      expect(
        document
          .getElementById('btn-start-replay')!
          .classList.contains('hidden')
      ).toBe(false);
      expect(
        document.getElementById('replay-hint')!.classList.contains('hidden')
      ).toBe(false);
    });
  });

  describe('populateReplayScenarios', () => {
    it('populates the scenario dropdown with folder names', () => {
      populateReplayScenarios(['Paris Eiffeltower', 'Munich Olympiapark']);

      const select = document.getElementById(
        'replay-scenario-select'
      ) as HTMLSelectElement;
      // First option is placeholder + 2 scenarios
      expect(select.options.length).toBe(3);
      expect(select.options[1].value).toBe('Paris Eiffeltower');
      expect(select.options[1].textContent).toBe('Paris Eiffeltower');
      expect(select.options[2].value).toBe('Munich Olympiapark');
    });

    it('enables the dropdown when scenarios are available', () => {
      const select = document.getElementById(
        'replay-scenario-select'
      ) as HTMLSelectElement;
      expect(select.disabled).toBe(true);

      populateReplayScenarios(['Scenario1']);
      expect(select.disabled).toBe(false);
    });

    it('shows placeholder when no scenarios found', () => {
      populateReplayScenarios([]);

      const select = document.getElementById(
        'replay-scenario-select'
      ) as HTMLSelectElement;
      expect(select.options.length).toBe(1);
      expect(select.options[0].textContent).toContain('No scenarios');
      expect(select.disabled).toBe(true);
    });

    it('auto-selects and fires onScenarioChange when only one scenario exists', () => {
      // Why: UX feedback 2026-03-23 Issue 2 — when there is exactly one scenario
      // in the folder, it should be auto-selected and the session list shown
      // immediately without requiring an extra click.
      initReplayUI(callbacks);

      populateReplayScenarios(['Default Scenario']);

      const select = document.getElementById(
        'replay-scenario-select'
      ) as HTMLSelectElement;
      // Should be auto-selected (no placeholder shown)
      expect(select.value).toBe('Default Scenario');
      // Should have fired onScenarioChange
      expect(callbacks.onScenarioChange).toHaveBeenCalledWith(
        'Default Scenario'
      );
    });

    it('does not auto-select when multiple scenarios exist', () => {
      // Why: With multiple scenarios, the user must choose which one to view.
      initReplayUI(callbacks);

      populateReplayScenarios(['Scenario A', 'Scenario B']);

      const select = document.getElementById(
        'replay-scenario-select'
      ) as HTMLSelectElement;
      // Placeholder should still be selected
      expect(select.value).toBe('');
      expect(callbacks.onScenarioChange).not.toHaveBeenCalled();
    });
  });

  describe('populateReplaySessions', () => {
    it('renders session entries with filenames and dates', () => {
      populateReplaySessions([
        {
          filename: 'recording-2026-01-27_14-30-11utc.zip',
          date: new Date('2026-01-27T14:30:11Z'),
        },
        {
          filename: 'recording-2026-02-06_03-52-13utc.zip',
          date: new Date('2026-02-06T03:52:13Z'),
        },
      ]);

      const list = document.getElementById('replay-session-list')!;
      const entries = list.querySelectorAll('[data-session-index]');
      expect(entries.length).toBe(2);
      expect(entries[0].textContent).toContain('2026-01-27');
    });

    it('shows placeholder when no sessions are available', () => {
      populateReplaySessions([]);

      const list = document.getElementById('replay-session-list')!;
      expect(list.textContent).toContain('No sessions');
    });

    it('highlights selected session', () => {
      // Needs initReplayUI for click delegation
      initReplayUI(callbacks);

      populateReplaySessions([
        { filename: 'rec1.zip', date: null },
        { filename: 'rec2.zip', date: null },
      ]);

      const list = document.getElementById('replay-session-list')!;
      const entries = list.querySelectorAll('[data-session-index]');

      // Click second entry
      (entries[1] as HTMLElement).click();
      expect(entries[1].classList.contains('bg-blue-600')).toBe(true);
      expect(entries[0].classList.contains('bg-blue-600')).toBe(false);
    });
  });

  describe('initReplayUI - event wiring', () => {
    beforeEach(() => {
      initReplayUI(callbacks);
    });

    it('fires onScenarioChange when scenario dropdown changes', () => {
      populateReplayScenarios(['Scenario1', 'Scenario2']);
      const select = document.getElementById(
        'replay-scenario-select'
      ) as HTMLSelectElement;
      select.value = 'Scenario2';
      select.dispatchEvent(new Event('change'));

      expect(callbacks.onScenarioChange).toHaveBeenCalledWith('Scenario2');
    });

    it('fires onSessionSelect when a session entry is clicked', () => {
      populateReplaySessions([
        { filename: 'rec1.zip', date: null },
        { filename: 'rec2.zip', date: null },
      ]);

      const list = document.getElementById('replay-session-list')!;
      const entries = list.querySelectorAll('[data-session-index]');
      (entries[1] as HTMLElement).click();

      expect(callbacks.onSessionSelect).toHaveBeenCalledWith(1);
    });

    // Why: With setup speed control removed (Issue 1), replay always starts at 0.1× default.
    // Speed is adjustable at runtime via live overlay presets.
    it('fires onStartReplay with default speed 0.1 (no setup speed control)', () => {
      const startBtn = document.getElementById('btn-start-replay')!;
      startBtn.removeAttribute('disabled');
      startBtn.click();

      expect(callbacks.onStartReplay).toHaveBeenCalledWith(0.1);
    });

    // Why: Confirms the setup speed input and preset buttons were removed (Issue 1).
    it('does not have setup speed input or preset buttons', () => {
      expect(document.getElementById('replay-speed-input')).toBeNull();
      expect(document.querySelectorAll('.replay-speed-preset').length).toBe(0);
    });

    it('fires onPlayPause when play/pause button clicked', () => {
      const btn = document.getElementById('btn-replay-play-pause')!;
      btn.click();

      expect(callbacks.onPlayPause).toHaveBeenCalled();
    });

    it('fires onSpeedChange when live speed button clicked', () => {
      const btn = document.querySelector(
        '[data-replay-speed="5"]'
      ) as HTMLElement;
      btn.click();

      expect(callbacks.onSpeedChange).toHaveBeenCalledWith(5);
    });

    // Why: Slow-motion presets (Issue 2) must fire onSpeedChange with sub-1× values.
    it('fires onSpeedChange with slow-motion value 0.1', () => {
      const btn = document.querySelector(
        '[data-replay-speed="0.1"]'
      ) as HTMLElement;
      btn.click();

      expect(callbacks.onSpeedChange).toHaveBeenCalledWith(0.1);
    });

    // Why: Verify all 7 speed presets from Issue 2 are present in the live overlay.
    it('has all 7 speed presets (0.1, 0.2, 0.5, 1, 2, 5, 10)', () => {
      const buttons = document.querySelectorAll('.replay-live-speed');
      const speeds = Array.from(buttons).map(
        (btn) => (btn as HTMLElement).dataset.replaySpeed
      );
      expect(speeds).toEqual(['0.1', '0.2', '0.5', '1', '2', '5', '10']);
    });

    it('fires onCameraToggle when camera button clicked', () => {
      const btn = document.getElementById('btn-camera-toggle')!;
      btn.click();

      expect(callbacks.onCameraToggle).toHaveBeenCalled();
    });

    // Why: The map toggle button in the replay controls overlay must fire
    // the onMapToggle callback to lazily create and toggle the map overlay.
    it('fires onMapToggle when replay map button clicked', () => {
      initReplayUI(callbacks);
      const btn = document.getElementById('btn-map-toggle-replay')!;
      btn.click();

      expect(callbacks.onMapToggle).toHaveBeenCalled();
    });
  });

  describe('updateReplayProgress', () => {
    it('updates progress text with current/total format', () => {
      updateReplayProgress(45, 111);

      const progress = document.getElementById('replay-progress')!;
      expect(progress.textContent).toBe('Action 45/111');
    });
  });

  describe('showReplayControls / hideReplayControls', () => {
    it('shows replay controls and hides recording controls', () => {
      showReplayControls();

      expect(
        document.getElementById('replay-controls')!.classList.contains('hidden')
      ).toBe(false);
      expect(
        document.getElementById('controls')!.classList.contains('hidden')
      ).toBe(true);
    });

    it('hides replay controls', () => {
      showReplayControls(); // Show first
      hideReplayControls();

      expect(
        document.getElementById('replay-controls')!.classList.contains('hidden')
      ).toBe(true);
    });

    // Why: The color legend must appear alongside the replay controls
    // so users know what each sphere color means in the 3D view (Issue 2, 2026-03-21).
    it('shows the replay legend when showing replay controls', () => {
      showReplayControls();

      const legend = document.getElementById('replay-legend')!;
      expect(legend).not.toBeNull();
      expect(legend.classList.contains('hidden')).toBe(false);
    });

    // Why: The legend must be hidden when replay controls are hidden
    // to keep the UI clean outside of replay playback.
    it('hides the replay legend when hiding replay controls', () => {
      showReplayControls();
      hideReplayControls();

      const legend = document.getElementById('replay-legend')!;
      expect(legend.classList.contains('hidden')).toBe(true);
    });
  });

  // Why: The color legend (Issue 2, 2026-03-21 feedback) provides an on-screen
  // reference for the 3 sphere types rendered in the 3D replay view.
  describe('replay color legend', () => {
    it('contains exactly 3 legend entries', () => {
      const legend = document.getElementById('replay-legend')!;
      expect(legend).not.toBeNull();

      const entries = legend.querySelectorAll('[data-legend-entry]');
      expect(entries.length).toBe(3);
    });

    it('has GPS entry with yellow dot', () => {
      const legend = document.getElementById('replay-legend')!;
      const entries = legend.querySelectorAll('[data-legend-entry]');
      const gpsEntry = entries[0] as HTMLElement;

      expect(gpsEntry.textContent).toContain('GPS');
      const dot = gpsEntry.querySelector('.rounded-full') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.classList.contains('bg-yellow-400')).toBe(true);
    });

    it('has Fused VIO entry with cyan dot', () => {
      const legend = document.getElementById('replay-legend')!;
      const entries = legend.querySelectorAll('[data-legend-entry]');
      const fusedEntry = entries[1] as HTMLElement;

      expect(fusedEntry.textContent).toContain('Fused VIO');
      const dot = fusedEntry.querySelector('.rounded-full') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.classList.contains('bg-cyan-400')).toBe(true);
    });

    it('has Alignment Snapshot entry with red dot', () => {
      const legend = document.getElementById('replay-legend')!;
      const entries = legend.querySelectorAll('[data-legend-entry]');
      const snapEntry = entries[2] as HTMLElement;

      expect(snapEntry.textContent).toContain('Alignment Snapshot');
      const dot = snapEntry.querySelector('.rounded-full') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.classList.contains('bg-red-500')).toBe(true);
    });
  });

  describe('updatePlayPauseButton', () => {
    it('shows pause icon when playing', () => {
      updatePlayPauseButton('playing');
      const btn = document.getElementById('btn-replay-play-pause')!;
      expect(btn.textContent).toContain('⏸');
      expect(btn.textContent).toContain('Pause');
    });

    it('shows play icon when paused', () => {
      updatePlayPauseButton('paused');
      const btn = document.getElementById('btn-replay-play-pause')!;
      expect(btn.textContent).toContain('▶');
      expect(btn.textContent).toContain('Resume');
    });

    it('shows replay icon when completed', () => {
      updatePlayPauseButton('completed');
      const btn = document.getElementById('btn-replay-play-pause')!;
      expect(btn.textContent).toContain('Complete');
    });
  });

  describe('updateCameraModeButton', () => {
    it('shows orbit label when in orbit mode', () => {
      updateCameraModeButton('orbit');
      const btn = document.getElementById('btn-camera-toggle')!;
      expect(btn.textContent).toContain('Orbit');
    });

    it('shows FPS label when in fps mode', () => {
      updateCameraModeButton('fps');
      const btn = document.getElementById('btn-camera-toggle')!;
      expect(btn.textContent).toContain('Free Fly');
    });
  });

  describe('enableStartReplay / disableStartReplay', () => {
    it('enables the start replay button', () => {
      enableStartReplay();
      const btn = document.getElementById(
        'btn-start-replay'
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('disables the start replay button', () => {
      enableStartReplay();
      disableStartReplay();
      const btn = document.getElementById(
        'btn-start-replay'
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('hides hint when start is enabled', () => {
      enableStartReplay();
      const hint = document.getElementById('replay-hint')!;
      expect(hint.classList.contains('hidden')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Replay zoom button wiring
  // ---------------------------------------------------------------------------

  describe('replay zoom buttons', () => {
    /**
     * Why this test matters:
     * Zoom buttons enable zoom control for the 3D map in replay mode, where
     * native Leaflet pinch-to-zoom is blocked by pointer-events: none on
     * the CSS3DRenderer wrapper.
     */
    it('fires onMapZoomIn when replay zoom-in button clicked', () => {
      // Add zoom buttons to the fixture
      const replayControls = document.getElementById('replay-controls')!;
      const zoomIn = document.createElement('button');
      zoomIn.id = 'btn-map-zoom-in-replay';
      replayControls.appendChild(zoomIn);

      initReplayUI(callbacks);
      zoomIn.click();

      expect(callbacks.onMapZoomIn).toHaveBeenCalledOnce();
    });

    it('fires onMapZoomOut when replay zoom-out button clicked', () => {
      const replayControls = document.getElementById('replay-controls')!;
      const zoomOut = document.createElement('button');
      zoomOut.id = 'btn-map-zoom-out-replay';
      replayControls.appendChild(zoomOut);

      initReplayUI(callbacks);
      zoomOut.click();

      expect(callbacks.onMapZoomOut).toHaveBeenCalledOnce();
    });

    /**
     * Why this test matters:
     * Zoom buttons are optional — replay must work without them in the DOM.
     */
    it('does not throw when zoom buttons are missing', () => {
      expect(() => initReplayUI(callbacks)).not.toThrow();
    });
  });

  // Bug 6 (SPA audit): populateReplaySessions should use DOM API not innerHTML
  describe('safe DOM rendering', () => {
    // Why: innerHTML creates an XSS-prone pattern. The "No sessions" message
    // must be rendered via safe DOM APIs (createElement + textContent).
    it('renders "No sessions found" via DOM API for empty sessions', () => {
      populateReplaySessions([]);

      const list = document.getElementById('replay-session-list')!;
      const p = list.querySelector('p');
      expect(p).not.toBeNull();
      expect(p!.textContent).toBe('No sessions found');
    });

    // Why: initReplayUI attaches a delegated click handler on the session list
    // container. Re-populating sessions clears child nodes — the container's
    // own listener must survive so session clicks keep working after the list
    // is rebuilt (e.g., switching scenarios). A naive outerHTML or parent
    // innerHTML replacement would break this.
    it('preserves delegated click handler after re-populating sessions', () => {
      initReplayUI(callbacks);

      // First population
      populateReplaySessions([
        { filename: 'rec1.zip', date: null },
        { filename: 'rec2.zip', date: null },
      ]);

      // Click first entry — sanity check
      const list = document.getElementById('replay-session-list')!;
      (list.querySelector('[data-session-index="0"]') as HTMLElement).click();
      expect(callbacks.onSessionSelect).toHaveBeenCalledWith(0);
      (callbacks.onSessionSelect as ReturnType<typeof vi.fn>).mockClear();

      // Re-populate (simulates switching scenario) — clears and rebuilds children
      populateReplaySessions([
        { filename: 'rec3.zip', date: null },
        { filename: 'rec4.zip', date: null },
        { filename: 'rec5.zip', date: null },
      ]);

      // Delegated click handler on the container must still fire
      (list.querySelector('[data-session-index="1"]') as HTMLElement).click();
      expect(callbacks.onSessionSelect).toHaveBeenCalledWith(1);
    });
  });
});
