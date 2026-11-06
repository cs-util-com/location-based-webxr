/**
 * Playwright e2e hooks — the `window.testHooks` surface plus the map-browser
 * fixture builders. Extracted from main.ts (2026-07-11 lifecycle-scope plan
 * step 3) so the production entry file stays free of fixture scaffolding.
 *
 * main.ts calls `installE2eTestHooks` via a dynamic import guarded by
 * `import.meta.env.DEV && !VITEST`, so none of this reaches a production
 * bundle or unit-test module graph.
 *
 * CONTRACT: `window.testHooks` is assigned as ONE object literal and its key
 * set is pinned bidirectionally against `REQUIRED_TEST_HOOKS` in
 * `playwright-tests/test-helpers.js` (the coverage-guard spec fails within
 * seconds naming any hook that drifts — see the guard-hardening note in the
 * 2026-07-10 quality-review follow-ups doc §4). Add/remove keys in BOTH
 * places in the same commit.
 */

import {
  populateScenarios,
  showRecordingControls,
  validateEnterButton,
  updatePermissionStatus,
  setPermissionsReady,
  setSaveLocationSelected,
  setFolderImportExpanded,
  setFolderImportProgress,
} from '../ui/hud';
import { hideSetupModal } from '../ui/hud-setup-panel';
import { showSessionSummary } from '../ui/session-summary';
import { showToast } from '../ui/toast';
import type { DebugWheel } from '../ui/hud-debug-wheel';
import { createMapBrowser } from '../ui/map-browser';
import { type RecordingCoverage } from '../ui/recording-index';
import { gpsPathToCoverageCells } from 'gps-plus-slam-app-framework/geo';

/** A fixture tour: a named GPS path Playwright hands in as plain JSON. */
interface FixtureTour {
  filename: string;
  scenario: string;
  path: Array<{ lat: number; lng: number }>;
}

/**
 * Reduce a fixture tour (GPS path of `{lat,lng}`) to a `RecordingCoverage` so
 * Playwright can mount/stream the browser without a real recordings folder.
 */
function fixtureToRecordingCoverage(
  f: FixtureTour,
  index: number
): RecordingCoverage {
  const cells = gpsPathToCoverageCells(f.path);
  return {
    entry: {
      filename: f.filename,
      fileHandle: {} as FileSystemFileHandle,
      date: new Date(Date.UTC(2026, 0, 1 + index)),
      h3Cells: cells,
    },
    scenario: f.scenario,
    cells,
    backfilled: false,
  };
}

/** The few main.ts internals the hooks need, injected to avoid a cycle. */
export interface E2eHookDeps {
  /** main.ts's shared full-bleed map-browser root (also used by the real replay path). */
  ensureMapBrowserRoot: () => HTMLElement;
  /** The in-recording settings wheel, or null without `?debug=1` (2026-09-02). */
  getDebugWheel: () => DebugWheel | null;
}

/**
 * Expose test hooks on window for e2e testing. Playwright tests call real
 * functions instead of simulating DOM changes.
 */
export function installE2eTestHooks(deps: E2eHookDeps): void {
  const { ensureMapBrowserRoot, getDebugWheel } = deps;
  window.testHooks = {
    populateScenarios,
    // The in-recording settings wheel (2026-09-02): lets a spec read what the
    // wheel holds after a tap, and prove the gear is absent without the flag
    // (null) - dispatch itself is unit-tested, e2e proves gating + wiring.
    // Hide the setup modal the way Enter AR does, so a spec can reach the HUD
    // controls the modal covers (the debug wheel's gear) without a real AR
    // session.
    hideSetupModal,
    getDebugWheelValues: () => {
      const wheel = getDebugWheel();
      return wheel ? { ...wheel.values(), touched: wheel.touched() } : null;
    },
    validateEnterButton,
    showRecordingControls,
    showSessionSummary,
    updatePermissionStatus,
    setPermissionsReady,
    // Toast (2026-08-24). The toast is the ONLY UI in this app rewritten onto
    // the framework's shared mechanism, and it had no e2e coverage at all â
    // the suite mentioned the word once, in a comment. Its two new behaviours
    // (attach-on-show, and a text write deferred by one task) are exactly the
    // kind that a jsdom suite can assert and a real browser can still get
    // wrong, so the hook exists to let a spec watch the real element.
    showToast,
    // Mandatory storage selection hooks (Task 1a-fix)
    setSaveLocationSelected,
    setFolderImportExpanded,
    // Folder-import indexing progress bar (D2, 2026-07-05)
    setFolderImportProgress,
    /**
     * Map-centric recording browser (Step 4B). Mounts the full-bleed browser
     * with fixture tours (GPS paths → H3 coverage), so Playwright can exercise
     * the layout, tiles, name search, and single-tour playback without a real
     * recordings folder. `onPlayTour` records the picked filename to
     * `window.__mapBrowserPlayed`; the instance is exposed for tile-selection
     * assertions on `window.__mapBrowserInstance`.
     */
    mountMapBrowser: (fixture: FixtureTour[]) => {
      const container = ensureMapBrowserRoot();
      const recordings: RecordingCoverage[] = fixture.map((f, i) =>
        fixtureToRecordingCoverage(f, i)
      );
      window.__mapBrowserPlayed = [];
      const instance = createMapBrowser(container, {
        recordings,
        onPlayTour: (r) => window.__mapBrowserPlayed?.push(r.entry.filename),
        onClose: () => {
          instance?.destroy();
          container.remove();
          window.__mapBrowserInstance = undefined;
        },
      });
      window.__mapBrowserInstance = instance ?? undefined;
      return instance !== null;
    },
    /**
     * Slice A — mount the browser EMPTY and prime the progress pill to
     * `0 / total`, so the e2e test can then stream recordings in via
     * {@link streamMapBrowserRecording} and assert progressive behaviour
     * (map interactive before indexing, pill counts up then hides).
     */
    mountMapBrowserEmpty: (total: number) => {
      const container = ensureMapBrowserRoot();
      window.__mapBrowserPlayed = [];
      const instance = createMapBrowser(container, {
        onPlayTour: (r) => window.__mapBrowserPlayed?.push(r.entry.filename),
        onClose: () => {
          instance?.destroy();
          container.remove();
          window.__mapBrowserInstance = undefined;
        },
      });
      instance?.setIndexingProgress(0, total);
      window.__mapBrowserInstance = instance ?? undefined;
      return instance !== null;
    },
    /**
     * Slice A — stream one fixture recording into the already-mounted browser
     * and advance the progress pill to `done / total`. Mirrors what the real
     * `streamRecordingIndex` → `addRecording`/`setIndexingProgress` wiring does.
     */
    streamMapBrowserRecording: (
      item: FixtureTour,
      done: number,
      total: number
    ) => {
      const instance = window.__mapBrowserInstance;
      if (!instance) {
        return false;
      }
      instance.addRecording(fixtureToRecordingCoverage(item, done));
      instance.setIndexingProgress(done, total);
      return true;
    },
    /**
     * Slice B (B1) — mount the browser with backfillable (legacy) recordings and
     * a **deferred** `onBackfill` so Playwright can observe the transitional
     * "Embedding…" state, then release the promise with `outcome` to assert the
     * final state. Marks indexing complete so the CTA appears immediately.
     * `window.__mapBrowserBackfillCalls` counts invocations;
     * `window.__releaseBackfill()` resolves the in-flight backfill.
     */
    mountMapBrowserBackfill: (
      fixture: FixtureTour[],
      outcome: {
        embedded: number;
        skipped: number;
        failed: number;
        permissionDenied: boolean;
      }
    ) => {
      const container = ensureMapBrowserRoot();
      window.__mapBrowserPlayed = [];
      window.__mapBrowserBackfillCalls = 0;
      let release: (() => void) | undefined;
      window.__releaseBackfill = () => release?.();
      const instance = createMapBrowser(container, {
        onPlayTour: (r) => window.__mapBrowserPlayed?.push(r.entry.filename),
        onClose: () => {
          instance?.destroy();
          container.remove();
          window.__mapBrowserInstance = undefined;
        },
        onBackfill: () => {
          window.__mapBrowserBackfillCalls =
            (window.__mapBrowserBackfillCalls ?? 0) + 1;
          return new Promise((resolve) => {
            release = () => resolve(outcome);
          });
        },
      });
      window.__mapBrowserInstance = instance ?? undefined;
      if (instance) {
        fixture.forEach((f, i) => {
          // Mark as legacy/backfilled so it counts toward the CTA.
          instance.addRecording({
            ...fixtureToRecordingCoverage(f, i),
            backfilled: true,
          });
        });
        // Mark indexing complete so the CTA appears.
        instance.setIndexingProgress(fixture.length, fixture.length);
      }
      return instance !== null;
    },
  };
}
