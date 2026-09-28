/**
 * The creator's troubleshooting recording, end to end below the page: the
 * REAL page store (`createTourViewerStore` with the recording's backend and
 * gate), the framework's real OPFS write functions over the framework's
 * OPFS mock, the real zip export, and the framework's real
 * `loadActionsFromZip` + `replayActions` reading it back.
 *
 * Why these tests matter (authoring recording plan 2026-09-28-0953, M1a;
 * review findings 1, 2 and 16): the Tour Viewer starts a session on every
 * AR entry and ends it (then resets the GPS session data) on every exit.
 * Under the framework's default recording rules a recording spanning two
 * visits would (a) lose the reset, so its replay solves the second visit
 * over both visits' odometry pairs - state the live session never had;
 * (b) lose everything done on the page outside AR, the
 * Finish included; (c) restart its numbering and overwrite its own first
 * visit. And it must land in its OWN folder, never the Recorder's.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordGpsEvent,
  replayActions,
  selectAlignmentMatrix,
  selectGpsPositions,
  setZeroPos,
  startSession,
  teardownArSessionState,
} from "gps-plus-slam-app-framework/state";
import {
  loadActionsFromZip,
  loadSessionMetadataFromZip,
  resetOpfsStorage,
} from "gps-plus-slam-app-framework/storage";
import {
  installOPFSMocks,
  type MockOPFSDirectoryHandle,
} from "gps-plus-slam-app-framework/test-utils/browser-mocks";
import { BlobReader, ZipReader } from "@zip.js/zip.js";

import {
  createAuthoringRecording,
  RECORDING_CONTEXT_TAG,
  recordingFileName,
} from "./authoring-recording.js";
import { authoringFinished } from "./tour-authoring-actions.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
const START = new Date(T0);

/** One odometry position and the GPS fix it was paired with. */
interface Pair {
  odom: [number, number, number];
  lat: number;
  lon: number;
}

/** Visit 1: WebXR -Z is north, +X is east (as the e2e seeds it). */
const VISIT_1: Pair[] = [
  { odom: [0, 0, 0], lat: 47.5, lon: 8.7 },
  { odom: [0, 0, -15], lat: 47.500135, lon: 8.7 },
  { odom: [15, 0, 0], lat: 47.5, lon: 8.7002 },
];
/** Visit 2: a NEW odometry frame, a quarter turn from the first (-Z east,
 *  +X south) - what WebXR hands a re-entered session. */
const VISIT_2: Pair[] = [
  { odom: [0, 0, 0], lat: 47.5, lon: 8.7 },
  { odom: [0, 0, -15], lat: 47.5, lon: 8.7002 },
  { odom: [15, 0, 0], lat: 47.499865, lon: 8.7 },
];

type Store = ReturnType<typeof createTourViewerStore>;

function feed(store: Store, pairs: Pair[], firstId: number): void {
  for (const [i, p] of pairs.entries()) {
    store.dispatch(
      recordGpsEvent({
        odomPosition: p.odom,
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `fix-${String(firstId + i)}`,
          latitude: p.lat,
          longitude: p.lon,
          altitude: 400,
          latLongAccuracy: 5,
          timestamp: T0 + (firstId + i) * 1000,
        },
      }),
    );
  }
}

function enter(store: Store, atMs: number): void {
  store.dispatch(
    startSession({
      contextTag: "tour-viewer",
      sessionName: "live",
      startTime: atMs,
    }),
  );
}

/** Largest element-wise difference of two alignment matrices. */
function maxDiff(
  a: readonly number[] | null,
  b: readonly number[] | null,
): number {
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? Number.NaN))));
}

/** Let the store's async listener effects and the write queue run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function zipNames(blob: Blob): Promise<string[]> {
  const reader = new ZipReader(new BlobReader(blob));
  const names = (await reader.getEntries())
    .filter((e) => !e.directory)
    .map((e) => e.filename);
  await reader.close();
  return names.sort();
}

let root: MockOPFSDirectoryHandle;
let cleanup: () => void;

beforeEach(() => {
  const mocks = installOPFSMocks();
  root = mocks.root;
  cleanup = mocks.cleanup;
});

afterEach(() => {
  cleanup();
  resetOpfsStorage();
});

function recordingAndStore() {
  const recording = createAuthoringRecording({
    openRoot: () => navigator.storage.getDirectory(),
  });
  const store = createTourViewerStore(recording);
  const save = () =>
    recording.save({
      flush: () => store.flushPendingActionWrites(),
      nowMs: T0 + 60_000,
      userAgent: "test-agent",
      pageUrl: "https://example.test/tour/",
    });
  return { recording, store, save };
}

describe("the creator's troubleshooting recording", () => {
  it("writes nothing, anywhere, before the creator opts in", async () => {
    const { recording, store, save } = recordingAndStore();

    enter(store, T0);
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    feed(store, VISIT_1, 0);
    await settle();

    expect(recording.persistWhile()).toBe(false);
    expect(recording.status()).toEqual({ kind: "off" });
    await expect(root.getDirectoryHandle("gps-plus-slam")).rejects.toThrow();
    await expect(save()).rejects.toThrow(/nothing is being recorded/);
  });

  it("two AR visits replay with a separate alignment per visit, and the page-side Finish between them is in the stream", async () => {
    const { recording, store, save } = recordingAndStore();
    recording.start(START);

    // Visit 1, as the AR entry and its teardown dispatch it.
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    await settle(); // the compass opt-in effect lands after setZeroPos
    enter(store, T0);
    feed(store, VISIT_1, 0);
    const liveVisit1 = selectAlignmentMatrix(store.getState());
    teardownArSessionState(store);
    // On the page, outside AR.
    store.dispatch(
      authoringFinished({
        levelId: "lvl",
        manifest: { version: 1, objects: [] },
        atMs: T0 + 5000,
      }),
    );
    // Visit 2, in a new odometry frame.
    enter(store, T0 + 10_000);
    feed(store, VISIT_2, 10);
    const liveVisit2 = selectAlignmentMatrix(store.getState());
    const livePairsVisit2 = selectGpsPositions(store.getState()).length;
    teardownArSessionState(store);
    const liveAfterExit = selectAlignmentMatrix(store.getState());

    const saved = await save();
    const bytes = new Uint8Array(await saved.blob.arrayBuffer());
    const entries = await loadActionsFromZip(bytes);
    const actions = entries.map((e) => e.action);
    const types = actions.map((a) => a.type);

    // (c) One numbering for the whole recording: 1..N, nothing overwritten.
    expect(entries.map((e) => e.index)).toEqual(entries.map((_, i) => i + 1));
    expect(types.filter((t) => t === startSession.type)).toHaveLength(2);
    // (b) The page-side Finish, between the visits.
    expect(types).toContain(authoringFinished.type);
    // (a) Each visit's reset, after its endSession.
    expect(
      types.filter((t) => t === "gpsData/resetGpsSessionData"),
    ).toHaveLength(2);

    // The two visits really do solve to different alignments, so the
    // comparisons below can tell them apart.
    expect(maxDiff(liveVisit1, liveVisit2)).toBeGreaterThan(0.5);

    // Replayed up to each visit's exit, the alignment is that visit's own;
    // replayed to the end, it is reset exactly as the live one was.
    const firstExit = types.indexOf("recording/endSession");
    const secondExit = types.lastIndexOf("recording/endSession");
    const replayedVisit1 = await replayActions(actions.slice(0, firstExit));
    const replayedVisit2 = await replayActions(actions.slice(0, secondExit));
    const replayedAll = await replayActions(actions);
    expect(
      maxDiff(selectAlignmentMatrix(replayedVisit1), liveVisit1),
    ).toBeLessThan(1e-9);
    expect(
      maxDiff(selectAlignmentMatrix(replayedVisit2), liveVisit2),
    ).toBeLessThan(1e-9);
    expect(
      maxDiff(selectAlignmentMatrix(replayedAll), liveAfterExit),
    ).toBeLessThan(1e-9);

    // And it IS the recorded reset that keeps the visits apart: live, visit
    // 2 solved from its own three pairs; the same stream without the reset
    // replays visit 2 over BOTH visits' pairs - two odometry frames in one
    // solve's input. (How far that moves the solved alignment depends on the
    // solver's recency weighting, not on this recording: swept over visit
    // gaps of 2, 10, 60 and 600 s and 1-3 visit-2 fixes, this geometry moved
    // it by at most 0.02 in any matrix element - so the pair count, not the
    // matrix, is what tells the two replays apart.)
    const withoutReset = await replayActions(
      actions
        .slice(0, secondExit)
        .filter((a) => a.type !== "gpsData/resetGpsSessionData"),
    );
    expect(livePairsVisit2).toBe(VISIT_2.length);
    expect(
      selectGpsPositions(await replayActions(actions.slice(0, secondExit)))
        .length,
    ).toBe(livePairsVisit2);
    expect(selectGpsPositions(withoutReset).length).toBe(
      VISIT_1.length + VISIT_2.length,
    );
  });

  it("saves the Recorder's layout in its own folder: session.json (era 5, its tag, coverage from the recorded fixes) and actions/, nothing else", async () => {
    const { recording, store, save } = recordingAndStore();
    recording.start(START);
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    enter(store, T0);
    feed(store, VISIT_1, 0);
    // The store's own GPS data is wiped at every AR exit - the coverage
    // must not depend on it.
    teardownArSessionState(store);

    const saved = await save();

    expect(saved.filename).toBe(recordingFileName(START));
    expect(saved.filename).toBe("tour-recording-2026-09-28_10-00-00utc.zip");
    const names = await zipNames(saved.blob);
    expect(names.filter((n) => !n.startsWith("actions/"))).toEqual([
      "session.json",
    ]);
    expect(
      names.every(
        (n) => n === "session.json" || /^actions\/\d{6}\.json$/.test(n),
      ),
    ).toBe(true);
    expect(names.length - 1).toBe(saved.actionCount);

    const meta = await loadSessionMetadataFromZip(
      new Uint8Array(await saved.blob.arrayBuffer()),
    );
    expect(meta).toMatchObject({
      odomCoordVersion: 5,
      contextTag: RECORDING_CONTEXT_TAG,
      startedAt: "2026-09-28T10:00:00.000Z",
      actionCount: VISIT_1.length,
      frameCount: 0,
      pageUrl: "https://example.test/tour/",
    });
    expect((meta?.["h3Cells"] as unknown[]).length).toBeGreaterThan(0);

    // Its own folder - the Recorder's `sessions/` is never created.
    const app = await root.getDirectoryHandle("gps-plus-slam");
    const own = await app.getDirectoryHandle("tour-viewer");
    await expect(
      own.getDirectoryHandle("recording-2026-09-28_10-00-00utc"),
    ).resolves.toBeDefined();
    await expect(app.getDirectoryHandle("sessions")).rejects.toThrow();
  });

  it("a folder that cannot be made switches the recording off and says why", async () => {
    const recording = createAuthoringRecording({
      openRoot: () => Promise.reject(new Error("no OPFS here")),
    });
    recording.start(START);
    await settle();

    expect(recording.status()).toEqual({
      kind: "failed",
      error: "no OPFS here",
    });
    expect(recording.persistWhile()).toBe(false);
  });
});
