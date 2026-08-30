/**
 * Recording Replayer
 *
 * Replays a recorded session from a zip file into a fresh store,
 * producing the fully-computed CombinedRootState without any persistence
 * side effects.
 *
 * This is the primary entry point for loading recordings for
 * visualization, comparison, validation, or offline analysis.
 *
 * Uses NullStorageBackend to ensure no OPFS writes occur during replay.
 *
 * See also: Finding F5 in docs/2026-02-15-replay-integration-test-review.md
 */

import {
  loadActionsFromZip,
  type RecordedAction,
  type ZipSource,
} from '../storage/zip-reader';
import { NullStorageBackend } from '../storage/null-storage-backend';
import { createSlamAppStore } from './create-slam-app-store';
import type { CombinedRootState } from './combined-root-state';

export type { CombinedRootState };

/**
 * Options for replaying a recording.
 */
export interface ReplayRecordingOptions {
  /**
   * Optional migration function to transform raw actions from the ZIP before
   * dispatching. Use this to handle older recording formats (e.g., era 1–3
   * recordings that use `gpsPoint` instead of `rawGpsPoint`).
   *
   * When not provided, actions are dispatched as-is from the ZIP.
   */
  readonly migrateActions?: (actions: RecordedAction[]) => RecordedAction[];

  /**
   * Called after each dispatched chunk, AFTER the loop yielded to the event
   * loop — a progress hook for callers replaying inside a live UI (the
   * TourViewer's geo join runs this in an XR session's detection path).
   */
  readonly onChunk?: (dispatched: number, total: number) => void;

  /**
   * Asked before each chunk; returning `false` stops the replay and returns
   * the state built so far.
   *
   * Exists because `onChunk` gave a caller a place to NOTICE it no longer
   * wants the result but no way to act on it (PR #378 review). The
   * TourViewer already checks a generation token inside `onChunk` — and
   * could only use it to skip a status label, so a replay whose AR session
   * had ended kept dispatching to a store nobody would read. Same shape as
   * the abort seam added to `decodeJoinedPoses`, whose own comment names it.
   *
   * The returned state is PARTIAL by construction; a caller that aborts is
   * expected to discard it, which is why this is a separate hook rather than
   * an error.
   */
  readonly shouldContinue?: () => boolean;
}

/**
 * Dispatch this many actions between event-loop yields. Honest sizing
 * (milestone review, finding 9): a single alignment re-solve costs
 * ~10–18 ms, so a chunk that lands several is NOT sub-frame — the yields
 * bound how long the loop can monopolize the thread between frames, they
 * do not guarantee per-frame smoothness. Measured on the repo's sample
 * recording (85 actions, 46 GPS events): the whole chunked replay
 * completes in ~0.25 s; the number for a long walk goes in the geo-join
 * results doc.
 */
const REPLAY_CHUNK_SIZE = 25;

/**
 * Replay a recording session from zip data, returning the final state.
 *
 * Loads all actions from the zip, creates a store with no persistence,
 * optionally migrates old-format actions, dispatches in order, and returns
 * the resulting state.
 *
 * @param zipData - The zip content: whole bytes, or any zip.js Reader —
 *   the same `ZipSource` `loadActionsFromZip` accepts. The Reader form
 *   lets a range-streaming caller replay without holding the archive in
 *   memory. NOTE: a caller that must SCAN the stream before replaying
 *   (the TourViewer's geo join) uses `loadActionsFromZip` +
 *   `replayActions` instead — this convenience wrapper is the
 *   no-gates path, exercised today by tests.
 * @param options - Optional replay configuration (e.g., action migration)
 * @returns The fully-replayed combined state (library + recorder)
 * @throws If the zip cannot be parsed or contains invalid data
 */
export async function replayRecording(
  zipData: ZipSource,
  options?: ReplayRecordingOptions
): Promise<CombinedRootState> {
  const actionEntries = await loadActionsFromZip(zipData);
  return replayActions(
    actionEntries.map((e) => e.action),
    options
  );
}

/**
 * Replay ALREADY-LOADED actions into a fresh store — the dispatch half of
 * {@link replayRecording}, separated so a caller that must SCAN the stream
 * before deciding to replay (the TourViewer's era/segment gates) does not
 * read the zip twice through a range-streaming source.
 */
export async function replayActions(
  loadedActions: readonly RecordedAction[],
  options?: ReplayRecordingOptions
): Promise<CombinedRootState> {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });

  const actions = options?.migrateActions
    ? options.migrateActions([...loadedActions])
    : loadedActions;

  // CHUNKED, not one synchronous burst: a long recording's dispatches cost
  // whole seconds (each GPS event can re-solve the alignment), and callers
  // replay inside live sessions. Yield between chunks so frames render.
  for (let i = 0; i < actions.length; i += REPLAY_CHUNK_SIZE) {
    // Asked BEFORE dispatching, so an aborting caller pays at most the chunk
    // already in flight rather than the rest of the recording.
    if (options?.shouldContinue?.() === false) break;
    for (const action of actions.slice(i, i + REPLAY_CHUNK_SIZE)) {
      store.dispatch(action);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    options?.onChunk?.(
      Math.min(i + REPLAY_CHUNK_SIZE, actions.length),
      actions.length
    );
  }

  return store.getState();
}
