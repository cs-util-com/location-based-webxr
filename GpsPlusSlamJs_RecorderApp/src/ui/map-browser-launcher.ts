/**
 * Map-centric recording browser launcher (Step 4C)
 *
 * Owns the app-lifetime lifecycle of the map-centric recording browser
 * (`ui/map-browser.ts`): mounting its full-bleed root container, streaming the
 * recording coverage index onto it, accumulating legacy backfill candidates
 * (B1), and tearing everything down again. Extracted verbatim from `main.ts`
 * (which previously held this as module-level state); `main.ts` now only wires
 * `launchMapBrowser` into the folder-manager's `onReplayFolderScanned` dep and
 * injects `ensureMapBrowserRoot` into the Playwright e2e hooks.
 *
 * NOT AR-session-scoped: the browser lives on the replay/setup screen, so its
 * teardown is driven by its own UI (close button, tour pick, empty folder,
 * relaunch) — it is intentionally NOT registered in `arSessionScope`.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md
 */

import { createMapBrowser, type MapBrowserInstance } from './map-browser';
import { streamRecordingIndex } from './recording-index';
import {
  backfillCoverageIntoZips,
  type BackfillCandidate,
} from '../storage/coverage-backfill';
import type { SessionEntry } from '../storage/recording-discovery';
import { showError } from './hud';
import { showToast } from './toast';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('MapBrowserLauncher');

/**
 * The one dependency that must come from the composition root (`main.ts`):
 * starting a single-tour replay is owned by the replay handlers, which hold
 * app-wide state (store swap, replay mode) the launcher must not know about.
 * Everything else (map browser, index stream, backfill, toasts/errors) is a
 * self-contained sibling module and is imported directly.
 */
export interface MapBrowserLauncherDeps {
  /** Start a single-tour replay for the tour picked on the map (D3). */
  startReplayForEntry: (entry: SessionEntry) => Promise<void>;
}

let mapBrowser: MapBrowserInstance | null = null;
/** Aborts the in-flight coverage stream when the browser is torn down. */
let mapBrowserAbort: AbortController | null = null;

/** Remove the map browser, abort any in-flight stream, and drop its container. */
export function teardownMapBrowser(): void {
  mapBrowserAbort?.abort();
  mapBrowserAbort = null;
  mapBrowser?.destroy();
  mapBrowser = null;
  document.getElementById('map-browser-root')?.remove();
}

/**
 * Present the map-centric browser as the primary replay selector (D3a) for an
 * opened replay folder. The map is mounted **immediately** (empty) and
 * recordings are **streamed** onto it as each is indexed — metadata-present
 * ones first/instantly, legacy ones as their GPS path is read — so the user
 * sees and can use the map right away instead of blocking on the full index
 * (Slice A). A progress pill counts up and then hides on completion.
 *
 * Picking a tour starts a single-tour replay (D3) and tears the browser down.
 * The owned `AbortController` cancels the stream if the browser is closed or
 * another folder is opened mid-index, so a torn-down map never receives tiles.
 */
export async function launchMapBrowser(
  folderHandle: FileSystemDirectoryHandle,
  deps: MapBrowserLauncherDeps
): Promise<void> {
  teardownMapBrowser();

  const container = ensureMapBrowserRoot();
  const abort = new AbortController();
  mapBrowserAbort = abort;

  // Legacy recordings that carry coverage worth embedding into their zips — the
  // one-time backfill candidates (B1), accumulated as the index streams in.
  const backfillCandidates: BackfillCandidate[] = [];

  const browser = createMapBrowser(container, {
    onPlayTour: (recording) => {
      teardownMapBrowser();
      void deps.startReplayForEntry(recording.entry);
    },
    onClose: teardownMapBrowser,
    onBackfill: async () => {
      const result = await backfillCoverageIntoZips(
        folderHandle,
        backfillCandidates,
        { signal: abort.signal }
      );
      if (result.permissionDenied) {
        showError(
          "Couldn't get write access — recordings will be re-indexed each open."
        );
      } else if (result.failed > 0) {
        showToast(
          `Embedded coverage into ${result.embedded} recordings (${result.failed} failed)`,
          { severity: 'warning' }
        );
      } else if (result.embedded > 0) {
        showToast(
          `Embedded coverage into ${result.embedded} recordings — future loads will be instant`
        );
      }
      return result;
    },
  });
  if (!browser) {
    teardownMapBrowser();
    return;
  }
  mapBrowser = browser;

  try {
    await streamRecordingIndex(folderHandle, {
      onTotal: (total) => {
        if (total === 0) {
          // Nothing to browse spatially — leave the modal list as the fallback
          // (don't show an empty map).
          teardownMapBrowser();
          return;
        }
        browser.setIndexingProgress(0, total);
      },
      onRecording: (rec) => {
        browser.addRecording(rec);
        if (rec.backfilled && rec.cells.length > 0) {
          backfillCandidates.push({
            fileHandle: rec.entry.fileHandle,
            filename: rec.entry.filename,
            cells: rec.cells,
          });
        }
      },
      onProgress: ({ done, total }) => browser.setIndexingProgress(done, total),
      signal: abort.signal,
    });
  } catch (err) {
    // An aborted stream (browser closed / folder switched) is expected — only
    // surface genuine failures.
    if (!abort.signal.aborted) {
      log.error('Map browser coverage stream failed', err);
      showError('Failed to index recordings for the map — see logs.');
    }
  }
}

/** Create (or reuse) the full-bleed root container for the map browser. */
export function ensureMapBrowserRoot(): HTMLElement {
  let container = document.getElementById('map-browser-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'map-browser-root';
    container.className = 'fixed inset-0 z-[80]';
    document.body.appendChild(container);
  }
  return container;
}
