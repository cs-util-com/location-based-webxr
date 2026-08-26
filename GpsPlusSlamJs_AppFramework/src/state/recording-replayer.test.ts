/**
 * Recording Replayer — Unit Tests
 *
 * Why these tests matter: They verify the replayRecording() convenience
 * function that takes a zip Uint8Array and produces the fully-replayed
 * CombinedRootState. This is the primary API for loading recordings
 * for visualization, comparison, or validation.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { replayActions, replayRecording } from './recording-replayer';
import type { CombinedRootState } from './combined-root-state';
import type { RecordedAction } from '../storage/zip-reader';
import { isIdentityMatrix4 } from 'gps-plus-slam-js';
import {
  produceTestZip,
  type TestZipResult,
} from '../test-utils/zip-round-trip-helpers';

describe('replayRecording', () => {
  let testZip: TestZipResult;
  let state: CombinedRootState;

  beforeAll(async () => {
    testZip = await produceTestZip();
    state = await replayRecording(testZip.zipData);
  });

  it('returns a CombinedRootState with gpsData populated', () => {
    // Why: after replaying a recording with GPS events, gpsData must be non-null
    expect(state.gpsData).not.toBeNull();
  });

  it('returns recorder metadata from startSession action', () => {
    // Why: the startSession action payload must be stored in recorder state
    expect(state.recording.sessionMetadata).not.toBeNull();
    // The helper emits a pre-rename `scenarioName` startSession action; the
    // reducer maps it onto `contextTag` (backward-compat), so the replayed
    // state exposes the label as `contextTag`.
    expect(state.recording.sessionMetadata!.contextTag).toBe(
      testZip.scenarioName
    );
    expect(state.recording.sessionMetadata!.sessionName).toBe(
      testZip.sessionName
    );
  });

  it('replays all GPS events correctly', () => {
    // Why: every recordGpsEvent action should produce one GPS+odometry entry
    expect(state.gpsData!.gpsEvents.gpsPositions.length).toBe(
      testZip.gpsEventCount
    );
    expect(state.gpsData!.gpsEvents.odometryPositions.length).toBe(
      testZip.gpsEventCount
    );
  });

  it('produces a non-identity alignment matrix', () => {
    // Why: the test data has GPS and odom positions tracing different paths,
    // so the alignment matrix should be a non-trivial transformation
    const matrix = state.gpsData!.gpsEvents.alignmentMatrix;
    expect(isIdentityMatrix4(matrix)).toBe(false);
  });

  it('populates odometryPath.points from add2dImage actions', () => {
    // Why: only add2dImage actions after setZeroPos should produce points
    const points = state.gpsData!.odometryPath.points;
    expect(points.length).toBe(testZip.imageActions.afterSetZero);
    for (const pt of points) {
      expect(pt.imageFile).toBeDefined();
      expect(pt.position).toBeDefined();
      expect(pt.rotation).toBeDefined();
    }
  });

  it('does not persist any actions during replay', () => {
    // Why: replay uses NullStorageBackend, so no writes should occur;
    // failedWriteCount should remain 0
    expect(state.gpsData).not.toBeNull();
    expect(state.recording.failedWriteCount).toBe(0);
  });

  it('throws on invalid zip data', async () => {
    // Why: garbage bytes should not silently produce bad state
    const garbage = new Uint8Array([0, 1, 2, 3, 4]);
    await expect(replayRecording(garbage)).rejects.toThrow();
  });

  it('returns empty-ish state for a zip with no actions', async () => {
    // Why: a valid zip with no action files should produce initial state
    // without throwing — graceful degradation
    const { ZipWriter, Uint8ArrayWriter } = await import('@zip.js/zip.js');
    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    const emptyZipBytes = await zipWriter.close();
    const emptyState = await replayRecording(new Uint8Array(emptyZipBytes));
    expect(emptyState.gpsData).toBeNull();
    expect(emptyState.recording.isRecording).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // migrateActions callback (Issue 4: era-2 replay support)
  // ---------------------------------------------------------------------------

  it('applies migrateActions callback when provided', async () => {
    // Why: Old recordings (era 1–3) have different action formats that crash
    // the reducer. The caller must be able to inject a migration function to
    // transform actions before dispatch.
    const migrateFn = vi.fn((actions: RecordedAction[]) => actions);

    await replayRecording(testZip.zipData, { migrateActions: migrateFn });

    expect(migrateFn).toHaveBeenCalledTimes(1);
    // The function receives the raw action array from the ZIP
    const receivedActions = migrateFn.mock.calls[0][0];
    expect(receivedActions.length).toBeGreaterThan(0);
  });

  it('dispatches migrated actions (not originals) when migrateActions is provided', async () => {
    // Why: The migration function may rewrite action payloads (e.g., renaming
    // gpsPoint → rawGpsPoint). The replayer must dispatch the migrated actions.
    const migrateFn = vi.fn((actions: RecordedAction[]) => {
      // Drop all GPS events — the resulting state should have no GPS data
      return actions.filter((a) => a.type !== 'gpsData/recordGpsEvent');
    });

    const migratedState = await replayRecording(testZip.zipData, {
      migrateActions: migrateFn,
    });

    // GPS events were filtered out — no GPS positions in state
    expect(migratedState.gpsData?.gpsEvents?.gpsPositions?.length ?? 0).toBe(0);
  });

  it('replays normally when migrateActions is not provided', async () => {
    // Why: Backward compatibility — existing callers that don't pass options
    // should continue to work unchanged.
    const normalState = await replayRecording(testZip.zipData);
    expect(normalState.gpsData!.gpsEvents.gpsPositions.length).toBe(
      testZip.gpsEventCount
    );
  });
});

describe('replayRecording — ZipSource widening + chunked dispatch (geo-join M-A)', () => {
  // Why these tests matter (geo-join plan Revision 2): the TourViewer holds
  // only a range-reading ByteSource, never whole-zip bytes — the join needs
  // replayRecording to accept the same ZipSource (Uint8Array | Reader) its
  // own loadActionsFromZip already takes. And the dispatch loop runs inside
  // a live XR session's detection path, so it must YIELD to the event loop
  // instead of blocking for the whole recording.
  it('accepts a zip.js Reader (the range-streaming path), not only bytes', async () => {
    const { Uint8ArrayReader } = await import('@zip.js/zip.js');
    const zip = await produceTestZip();
    const state = await replayRecording(new Uint8ArrayReader(zip.zipData));
    expect(state.gpsData).not.toBeNull();
    expect(state.gpsData!.gpsEvents.gpsPositions.length).toBeGreaterThan(0);
  });

  it('yields to the event loop during dispatch (chunked replay)', async () => {
    // A macrotask scheduled BEFORE the replay must run BEFORE the replay
    // finishes — impossible if the dispatch loop is one synchronous burst
    // after the zip read.
    const zip = await produceTestZip();
    let macrotaskRan = false;
    const timer = setTimeout(() => {
      macrotaskRan = true;
    }, 0);
    const seen: boolean[] = [];
    const state = await replayRecording(zip.zipData, {
      onChunk: () => {
        seen.push(macrotaskRan);
      },
    });
    clearTimeout(timer);
    expect(state.gpsData).not.toBeNull();
    // At least one chunk boundary observed the macrotask having run — the
    // loop genuinely yielded rather than merely calling the hook inline.
    expect(seen.some(Boolean)).toBe(true);
  });
});

describe('replayActions — the pre-loaded half (geo-join M-B)', () => {
  // Why this test matters: the TourViewer must scan the action stream
  // (era/segment gates) BEFORE deciding to replay — loading the zip twice
  // through a range-streaming source would double the transfer, so the
  // load and the dispatch are separate entry points and replayRecording is
  // their composition. The two paths must agree on the resulting state.
  it('produces the same state as replayRecording over the same zip', async () => {
    const zip = await produceTestZip();
    const { loadActionsFromZip } = await import('../storage/zip-reader');
    const entries = await loadActionsFromZip(zip.zipData);
    const viaActions = await replayActions(entries.map((e) => e.action));
    const viaZip = await replayRecording(zip.zipData);
    expect(viaActions.gpsData?.gpsEvents.alignmentMatrix).toEqual(
      viaZip.gpsData?.gpsEvents.alignmentMatrix
    );
    expect(viaActions.gpsData?.odometryPath.points.length).toBe(
      viaZip.gpsData?.odometryPath.points.length
    );
  });
});
