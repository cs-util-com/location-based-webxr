/**
 * Recorder-app-specific global TypeScript declarations.
 *
 * These extensions are used for E2E testing with Playwright, allowing tests to
 * call real application functions instead of simulating DOM interactions.
 *
 * NOTE: These hooks are only assigned in development mode (import.meta.env.DEV)
 * and are not assigned during unit tests (import.meta.env.VITEST is truthy).
 *
 * File System Access API types and common global declarations are provided by
 * gps-plus-slam-app-framework/types/global.d.ts.
 */

import type { RefPointPickerResult } from './ui/ref-point-picker';
import type { FolderImportProgressState } from './ui/hud';
import type { PermissionCheckResult } from 'gps-plus-slam-app-framework/sensors/permission-checker';
import type { TrackingQualityReport } from 'gps-plus-slam-app-framework';
import type { SessionSummaryData } from './ui/session-summary';
import type { RecordingCoverage } from './ui/recording-index';

declare global {
  var __BUILD_COMMIT__: string | undefined;
  var __BUILD_TIME__: string | undefined;
  var __APP_VERSION__: string | undefined;
  var __LIB_VERSION__: string | undefined;
  var __FW_VERSION__: string | undefined;

  interface Window {
    /**
     * Test hooks exposed for Playwright E2E tests.
     * Only available in dev mode, not in unit tests or production.
     */
    testHooks?: {
      populateScenarios: (scenarios: string[]) => void;
      /** The in-recording settings wheel's values + touched flag, or null without `?debug=1` (2026-09-02). */
      getDebugWheelValues: () => Record<string, unknown> | null;
      /** Hide the setup modal as Enter AR does, so HUD controls behind it are clickable (2026-09-02). */
      hideSetupModal: () => void;
      validateEnterButton: () => void;
      showRecordingControls: () => void;
      hideRecordingControls: () => void;
      showSessionSummary: (data: SessionSummaryData) => void;
      updateGpsInfo: (accuracy: number) => void;
      updateArInfo: (tracking: string) => void;
      updatePermissionStatus: (result: PermissionCheckResult) => void;
      setPermissionsReady: (ready: boolean) => void;
      /**
       * Show a real toast (2026-08-24). Exists so the toast has e2e coverage
       * at all: it is the one UI this app moved onto the framework's shared
       * mechanism, and its behaviour â attach on show, text written one task
       * later, removed on linger â is only fully observable in a browser.
       */
      showToast: (
        message: string,
        options?: { duration?: number; severity?: 'info' | 'warning' | 'error' }
      ) => void;
      // Log panel hooks (Issue #5)
      showLogPanel: () => void;
      hideLogPanel: () => void;
      toggleLogPanel: () => void;
      logInfo: (tag: string, message: string) => void;
      logWarn: (tag: string, message: string) => void;
      logError: (tag: string, message: string) => void;
      // GPS event visualization hooks
      getGpsEventVisualizerCounts: () => { raw: number; fused: number };
      setGpsEventVisualizerZeroRef: (lat: number, lng: number) => void;
      clearGpsEventVisualizer: () => void;
      /**
       * §3c — Replay-mode diagnostic. Adds a GPS event with optional 1σ
       * accuracy to the visualizer. Creates a module-local offline scene +
       * arWorldGroup in e2e-hooks and points the visualizer at it via
       * `gpsEventVisualizer.setSceneSource` (live scene wins when present),
       * so the visualizer can run without an active WebXR session.
       */
      addGpsEventForTest: (
        gpsCoords: [number, number, number],
        odomPosition: [number, number, number],
        accuracy?: { horizontal?: number; vertical?: number }
      ) => void;
      /**
       * §3c — Reads back the world-space bounding-box size of each raw-GPS
       * marker via `THREE.Box3.setFromObject` in insertion order.
       */
      getRawGpsMarkerWorldSizes: () => Array<{
        x: number;
        y: number;
        z: number;
      }>;
      // Tracking quality indicator hook
      updateTrackingQuality: (report: TrackingQualityReport) => void;
      // Mandatory storage selection hooks (Task 1a-fix)
      setFolderImportExpanded: (expanded: boolean, hint?: string) => void;
      /** Folder-import indexing progress bar (D2, 2026-07-05). */
      setFolderImportProgress: (state: FolderImportProgressState) => void;
      setSaveLocationSelected: (selected: boolean) => void;
      /**
       * Step 4B — mount the map-centric recording browser with fixture tours
       * (each `path` of `{lat,lng}` is reduced to H3 coverage cells). Returns
       * `true` on success. See `window.__mapBrowserInstance` /
       * `window.__mapBrowserPlayed` for the e2e assertion surface.
       */
      mountMapBrowser: (
        fixture: Array<{
          filename: string;
          scenario: string;
          path: Array<{ lat: number; lng: number }>;
        }>
      ) => boolean;
      /**
       * Slice A — mount the browser empty and prime the progress pill to
       * `0 / total`, then stream recordings via `streamMapBrowserRecording`.
       */
      mountMapBrowserEmpty: (total: number) => boolean;
      /**
       * Slice A — stream one fixture recording into the mounted browser and
       * advance the progress pill to `done / total`. Returns `false` if no
       * browser is mounted.
       */
      streamMapBrowserRecording: (
        item: {
          filename: string;
          scenario: string;
          path: Array<{ lat: number; lng: number }>;
        },
        done: number,
        total: number
      ) => boolean;
      /**
       * Slice B (B1) — mount the browser with backfillable recordings and a
       * deferred onBackfill returning `outcome` once `window.__releaseBackfill`
       * is called. Drives the "Speed up future loads" CTA e2e.
       */
      mountMapBrowserBackfill: (
        fixture: Array<{
          filename: string;
          scenario: string;
          path: Array<{ lat: number; lng: number }>;
        }>,
        outcome: {
          embedded: number;
          skipped: number;
          failed: number;
          permissionDenied: boolean;
        }
      ) => boolean;
    };

    /**
     * Imperative handle for the mounted map browser (Step 4B), exposed for
     * Playwright tile-selection / rendered-tile assertions. Methods mirror
     * `MapBrowserInstance` in `ui/map-browser.ts`.
     */
    __mapBrowserInstance?: {
      destroy(): void;
      getRes(): number;
      getRenderedTiles(): string[];
      selectTile(tileCell: string | null): void;
      setNameQuery(query: string): void;
      addRecording(recording: RecordingCoverage): void;
      setIndexingProgress(done: number, total: number): void;
    };

    /** Filenames the user "played" via the map browser, in click order (e2e). */
    __mapBrowserPlayed?: string[];

    /** Count of backfill (onBackfill) invocations, for the B1 CTA e2e. */
    __mapBrowserBackfillCalls?: number;

    /** Resolve the deferred backfill mounted by `mountMapBrowserBackfill` (e2e). */
    __releaseBackfill?: () => void;

    /**
     * Reference point picker API exposed for E2E testing.
     * Allows Playwright tests to trigger the real picker modal behavior.
     */
    refPointPickerApi?: {
      showRefPointPicker: () => Promise<RefPointPickerResult | null>;
    };
  }
}

// This export is required to make this file a module
export {};
