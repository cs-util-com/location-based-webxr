/**
 * Replay launch — load a recording file and start a desktop replay session.
 *
 * This is the demo's use of the framework's `startReplaySession` composer (Part A
 * of the 2026-07-15 replay-as-dev-harness). It is factored out of `main.ts` as a
 * pure orchestration around a status sink so the async feedback contract (an
 * in-progress state, then a durable ready/error state) is unit-testable without
 * a DOM or a WebGL context.
 */

import { loadActionsFromZip } from "gps-plus-slam-app-framework/storage/zip-reader";
import type { RecordedAction } from "gps-plus-slam-app-framework/storage/zip-reader";
import {
  startReplaySession,
  type ReplaySessionController,
} from "gps-plus-slam-app-framework/state/replay-session";

/** Load a current-era recording zip into its recorded action list. */
export async function loadRecordingActions(
  file: File,
): Promise<RecordedAction[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await loadActionsFromZip(bytes);
  return entries.map((entry) => entry.action);
}

/** Injectable seams so the launch flow can be driven without WebGL in tests. */
export interface ReplayLaunchDeps {
  readonly loadActions: (file: File) => Promise<RecordedAction[]>;
  readonly startSession: (
    actions: RecordedAction[],
    container: HTMLElement,
  ) => ReplaySessionController;
}

/** UI feedback hooks — one in-progress signal, then a durable ready/error one. */
export interface ReplayLaunchSink {
  /** The load has begun (show the in-progress state). */
  onLoading(): void;
  /** The session is ready and replaying (durable success state). */
  onReady(controller: ReplaySessionController, actionCount: number): void;
  /** The load failed (durable error state); the in-progress state must revert. */
  onError(message: string): void;
}

const defaultDeps: ReplayLaunchDeps = {
  loadActions: loadRecordingActions,
  // Disable the composer's built-in occupancy: the demo builds its OWN occupancy
  // view (one occluder used for occlusion AND physics, with a live mesh-mode +
  // shader) so both modes share the same building block.
  startSession: (actions, container) =>
    startReplaySession({ actions, container, occupancy: { enabled: false } }),
};

/**
 * Load `file` and start replaying it into `container`, driving `sink` through
 * loading → ready/error. Resolves to the controller (or `null` on empty/failed
 * load) so the caller can wire replay controls to it.
 */
export async function loadAndStartReplay(
  file: File,
  container: HTMLElement,
  sink: ReplayLaunchSink,
  deps: ReplayLaunchDeps = defaultDeps,
): Promise<ReplaySessionController | null> {
  sink.onLoading();
  try {
    const actions = await deps.loadActions(file);
    if (actions.length === 0) {
      sink.onError("That recording contained no actions to replay.");
      return null;
    }
    const controller = deps.startSession(actions, container);
    sink.onReady(controller, actions.length);
    return controller;
  } catch (err) {
    sink.onError(
      err instanceof Error ? err.message : "Failed to load the recording.",
    );
    return null;
  }
}
