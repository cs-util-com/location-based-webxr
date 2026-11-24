/**
 * Unit test for the no-AR recording hooks in `e2e-hooks.ts`. The UI modules
 * are mocked: what matters here is the summary input the hook builds.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const { showSessionSummary } = vi.hoisted(() => ({
  showSessionSummary: vi.fn(),
}));
vi.mock('../ui/hud', () => ({
  populateScenarios: vi.fn(),
  showRecordingControls: vi.fn(),
  hideRecordingControls: vi.fn(),
  validateEnterButton: vi.fn(),
  updatePermissionStatus: vi.fn(),
  setPermissionsReady: vi.fn(),
  setSaveLocationSelected: vi.fn(),
  setFolderImportExpanded: vi.fn(),
  setFolderImportProgress: vi.fn(),
}));
vi.mock('../ui/hud-setup-panel', () => ({ hideSetupModal: vi.fn() }));
vi.mock('../ui/session-summary', () => ({ showSessionSummary }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../ui/map-browser', () => ({ createMapBrowser: vi.fn() }));

import { installE2eTestHooks } from './e2e-hooks';
import type { RecorderStore } from '../state/recorder-store';

afterEach(() => {
  vi.restoreAllMocks();
  showSessionSummary.mockReset();
});

describe('stopRecordingWithoutAr', () => {
  // Why: a wall clock stepped backwards between start and stop (NTP, a
  // manual change) made Date.now() at stop earlier than the recorded start,
  // and the summary showed a negative duration. The end is clamped to the
  // start so the summary never reads below zero.
  it('never builds a summary whose end is before its start', () => {
    let store: RecorderStore | null = null;
    installE2eTestHooks({
      ensureMapBrowserRoot: () => document.body,
      getDebugWheel: () => null,
      getStore: () => store!,
      setStore: (s) => {
        store = s;
      },
    });
    const hooks = window.testHooks as unknown as {
      startRecordingWithoutAr: () => void;
      stopRecordingWithoutAr: () => void;
    };

    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
    hooks.startRecordingWithoutAr();
    now.mockReturnValue(4_000_000);
    hooks.stopRecordingWithoutAr();

    expect(showSessionSummary).toHaveBeenCalledOnce();
    const { duration } = showSessionSummary.mock.calls[0][0] as {
      duration: { startTime: number; endTime: number };
    };
    expect(duration.startTime).toBe(5_000_000);
    expect(duration.endTime).toBe(5_000_000);
  });

  // Why: the normal case must keep the real stop time, not the start.
  it('keeps the stop time when the clock moved forward', () => {
    let store: RecorderStore | null = null;
    installE2eTestHooks({
      ensureMapBrowserRoot: () => document.body,
      getDebugWheel: () => null,
      getStore: () => store!,
      setStore: (s) => {
        store = s;
      },
    });
    const hooks = window.testHooks as unknown as {
      startRecordingWithoutAr: () => void;
      stopRecordingWithoutAr: () => void;
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    hooks.startRecordingWithoutAr();
    now.mockReturnValue(1_060_000);
    hooks.stopRecordingWithoutAr();
    const { duration } = showSessionSummary.mock.calls[0][0] as {
      duration: { startTime: number; endTime: number };
    };
    expect(duration.endTime).toBe(1_060_000);
  });
});
