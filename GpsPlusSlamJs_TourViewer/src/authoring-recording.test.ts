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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DepthSampler } from "gps-plus-slam-app-framework/ar/depth-sampler";
import {
  clearAllQrMarkers,
  createGpsPositionHandler,
  recordDepthSample,
  recordGpsEvent,
  recordQrDetection,
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
import { Group } from "three";

import {
  createAuthoringRecording,
  LOW_STORAGE_BYTES,
  lowStorageWarning,
  RECORDING_BYTES_PER_SECOND,
  RECORDING_DEPTH,
} from "./authoring-recording.js";
import {
  AUTHORING_CONTEXT_TAG,
  listRecordingFolders,
  openRecordingsDir,
  recordingFileName,
  VIEWING_CONTEXT_TAG,
} from "./recording-folders.js";
import {
  authoringFinished,
  codeMeasured,
  objectPlaced,
} from "./tour-authoring-actions.js";
import { endTourArRuntime, startTourArRuntime } from "./ar-mode.js";
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

const BUILD = {
  commitHash: "abc1234",
  appVersion: "0.1.0",
  libraryVersion: "1.25.0",
  frameworkVersion: "1.24.0",
  buildTime: "2026-09-28T09:00:00.000Z",
};

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
      getBuildInfo: () => BUILD,
    });
  return { recording, store, save };
}

/** The recording's own folder in the OPFS mock. */
async function recordingFolder(): Promise<MockOPFSDirectoryHandle> {
  const app = await root.getDirectoryHandle("gps-plus-slam");
  const own = await app.getDirectoryHandle("tour-viewer");
  return (await own.getDirectoryHandle(
    "recording-2026-09-28_10-00-00utc",
  )) as unknown as MockOPFSDirectoryHandle;
}

/**
 * One depth sample as a phone produces it: the framework's REAL sampler at
 * the recording's config, over a depth buffer of float32 values (what
 * `XRCPUDepthInformation.getDepthInMeters` returns, so each depth prints
 * with float32 noise in its decimals), a pose and a projection matrix of
 * the same float32 kind. What the size depends on is the digit count of
 * these numbers, so round values would under-measure it.
 */
function phoneDepthSample() {
  const f = Math.fround;
  let captured: Parameters<typeof recordDepthSample>[0] | null = null;
  const sampler = new DepthSampler(
    {
      onSampleCaptured: (sample) => {
        captured = sample;
      },
      getCurrentPose: () => ({
        position: { x: f(1.2345678), y: f(1.4567891), z: f(-3.3456789) },
        orientation: {
          x: f(0.0123456),
          y: f(0.7071234),
          z: f(-0.0234567),
          w: f(0.7065432),
        },
      }),
    },
    RECORDING_DEPTH,
  );
  sampler.start();
  sampler.onFrame(1000, () => ({
    width: 160,
    height: 90,
    getDepthInMeters: (x, y) => f(0.5 + 7.5 * ((x * 7.3 + y * 3.1) % 1)),
    projectionMatrix: [
      f(1.7320508),
      0,
      0,
      0,
      0,
      f(3.0792014),
      0,
      0,
      f(0.0123457),
      f(-0.0098765),
      f(-1.0002),
      -1,
      0,
      0,
      f(-0.020002),
      0,
    ],
  }));
  if (captured === null) throw new Error("the sampler produced no sample");
  return captured;
}

/** The bytes of each written action file, by action type. */
async function writtenBytesByType(): Promise<Map<string, number[]>> {
  const folder = await recordingFolder();
  const actions = (await folder.getDirectoryHandle(
    "actions",
  )) as unknown as MockOPFSDirectoryHandle;
  const byType = new Map<string, number[]>();
  for await (const [name] of actions.entries()) {
    const bytes = actions.getStoredContent(name);
    const text = actions.getStoredContentAsString(name);
    if (bytes === undefined || text === undefined) continue;
    const { type } = JSON.parse(text) as { type: string };
    byType.set(type, [...(byType.get(type) ?? []), bytes.byteLength]);
  }
  return byType;
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
    // solve's input. The pair count, not the matrix, is what this asserts:
    // measured 2026-09-28 for THIS geometry only (two visits of three
    // fixes, their odometry frames a quarter turn apart), dropping the reset
    // moved the solved alignment by at most 0.019 in any matrix element over
    // visit gaps of 2, 10, 60 and 600 s and 1-3 visit-2 fixes (0.020 at
    // 3600 s; it grows with the gap). Why it moves so little was not
    // established, and a longer walk or another frame offset may move it
    // much more - so no claim about the size of the effect is made here.
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
      contextTag: AUTHORING_CONTEXT_TAG,
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

  it("a save leaves the folder unsaved until the hand-off delivered and the caller marks it; recording on after that makes it unsaved again (M1b)", async () => {
    // Why: the next page's orphan offer and cleanup read this marker. A
    // save whose share sheet was cancelled handed nothing over, so only the
    // caller - who knows the hand-off's outcome - may mark it.
    const { recording, store, save } = recordingAndStore();
    recording.start(START);
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    enter(store, T0);
    feed(store, VISIT_1, 0);
    const saved = await save();
    const dir = await openRecordingsDir(root, false);
    if (dir === null) throw new Error("no recordings folder");
    expect((await listRecordingFolders(dir))[0]?.saved).toBe(false);

    expect(await saved.markSaved(T0 + 61_000)).toBe(true);
    expect((await listRecordingFolders(dir))[0]).toMatchObject({
      saved: true,
      savedAtMs: T0 + 61_000,
    });

    feed(store, VISIT_1, 3);
    await store.flushPendingActionWrites();
    expect((await listRecordingFolders(dir))[0]?.saved).toBe(false);
  });

  it("a visitor's debug recording is tagged tour-viewing, and the folder's lock is taken for the page's life (M1b)", async () => {
    const held: string[] = [];
    const recording = createAuthoringRecording({
      openRoot: () => navigator.storage.getDirectory(),
      contextTag: VIEWING_CONTEXT_TAG,
      holdFolder: (name) => held.push(name),
    });
    const store = createTourViewerStore(recording);
    recording.start(START);
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    enter(store, T0);
    feed(store, VISIT_1, 0);
    const saved = await recording.save({
      flush: () => store.flushPendingActionWrites(),
      nowMs: T0 + 60_000,
      userAgent: "test-agent",
      pageUrl: undefined,
    });
    expect(held).toEqual(["recording-2026-09-28_10-00-00utc"]);
    const meta = await loadSessionMetadataFromZip(
      new Uint8Array(await saved.blob.arrayBuffer()),
    );
    expect(meta).toMatchObject({
      odomCoordVersion: 5,
      contextTag: VIEWING_CONTEXT_TAG,
    });
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

  it("stamps session.json with the build that made the recording", async () => {
    // Why this test matters (M1a review finding 2): a recording that cannot
    // say which build wrote it cannot be reproduced - the first question
    // of any troubleshooting is "which code was this?".
    const { recording, store, save } = recordingAndStore();
    recording.start(START);
    enter(store, T0);

    const saved = await save();

    const meta = await loadSessionMetadataFromZip(
      new Uint8Array(await saved.blob.arrayBuffer()),
    );
    expect(meta?.["build"]).toEqual(BUILD);
  });

  it("a session.json that cannot be written still hands over the actions on disk, and says what is missing", async () => {
    // Why this test matters (M1a review finding 3): the actions are the
    // recording; the metadata only describes it. A full disk that refuses
    // the last small file must not cost the creator everything recorded
    // before it - but the loss must be reported, because without
    // session.json the Recorder migrates the coordinates as for an old
    // recording.
    const { recording, store, save } = recordingAndStore();
    recording.start(START);
    enter(store, T0);
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    feed(store, VISIT_1, 0);
    await settle();
    // As OPFS fails on a full disk: the file is CREATED (empty), and the
    // write into it is refused.
    const folder = await recordingFolder();
    const realGetFileHandle = folder.getFileHandle.bind(folder);
    vi.spyOn(folder, "getFileHandle").mockImplementation(
      async (name, options) => {
        const handle = await realGetFileHandle(name, options);
        if (name === "session.json" && options?.create === true) {
          vi.spyOn(handle, "createWritable").mockRejectedValue(
            new DOMException("disk full", "QuotaExceededError"),
          );
        }
        return handle;
      },
    );

    const saved = await save();

    expect(saved.metadataError).toBe("disk full");
    const names = await zipNames(saved.blob);
    // Not even the empty file the failed write left: the Recorder's loader
    // parses any session.json it finds, and an empty one would stop it
    // loading the recording at all.
    expect(names).not.toContain("session.json");
    expect(names.filter((n) => n.startsWith("actions/"))).toHaveLength(
      saved.actionCount,
    );
    expect(saved.actionCount).toBeGreaterThanOrEqual(VISIT_1.length + 2);
  });

  it("a written session.json leaves no metadata error", async () => {
    const { recording, store, save } = recordingAndStore();
    recording.start(START);
    enter(store, T0);

    const saved = await save();

    expect(saved.metadataError).toBeUndefined();
  });
});

describe("the order the page writes", () => {
  it("opens with startSession, then the zero, the cold-start flag and the fixes; each visit ends with the markers cleared, endSession and the reset", async () => {
    // Why this test matters (M1a review finding 7): the Recorder's loader
    // test builds a Tour Viewer zip by hand, because no app imports
    // another. Its fixture must follow the order the page REALLY writes,
    // or it proves the loader against a stream that never exists. This
    // drives that order the way the page does - the recording started at
    // the entry BEFORE the session (`beginOnArEntry` runs before
    // `enable`), the session's `startSession`, fixes through the
    // framework's real GPS handler (which sets the zero on the first one),
    // a QR lock, a depth sample, the creator's log actions, the exit's
    // teardown, and a second entry - and pins the sequence the Recorder's
    // fixture copies (`RecorderApp/src/storage/recording-loader.test.ts`,
    // "a Tour Viewer authoring recording").
    const { recording, store, save } = recordingAndStore();
    let arPose = {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const gps = createGpsPositionHandler({ store, getArPose: () => arPose });
    const fix = (i: number, x: number, z: number) => {
      arPose = { ...arPose, position: { x, y: 0, z } };
      gps({
        lat: 47.5 + i * 1e-5,
        lon: 8.7,
        altitude: 400,
        accuracy: 5,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: T0 + i * 1000,
      });
    };

    // The AR entry and exit exactly as `ar-entry.ts` sequences them: the
    // runtime start dispatches `startSession`; the exit clears the QR
    // markers, then the runtime end tears the session state down.
    const runtime = {
      getArWorldGroup: () => new Group(),
      enableArWorldGroupAlignment: () => undefined,
      startCameraFrameCapture: () => undefined,
    };
    const pageEnters = (atMs: number) =>
      startTourArRuntime(store, { ...runtime, now: () => atMs });
    const pageExits = () => {
      store.dispatch(clearAllQrMarkers());
      endTourArRuntime(store, { stopCameraFrameCapture: () => undefined });
    };

    recording.start(START); // beginOnArEntry, before the session starts
    pageEnters(T0);
    // The first fix sets the zero; the cold-start flag is a listener effect
    // of the zero and lands BEFORE the fix that brought it: the handler
    // dispatches the zero, then the fix, and the effect runs as soon as the
    // zero's dispatch unwinds.
    fix(0, 0, 0);
    fix(1, 0, -15);
    store.dispatch(
      recordQrDetection({
        text: "https://example.test/t?c=1",
        timestamp: T0 + 1500,
        qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
        qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
        reprojectionErrorPx: 0.4,
      }),
    );
    store.dispatch(recordDepthSample(phoneDepthSample()));
    store.dispatch(
      codeMeasured({
        levelId: "lvl",
        text: "https://example.test/t?c=1",
        fusedOdomPose: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
        sizeM: 0.16,
        alignmentMatrix: selectAlignmentMatrix(store.getState()),
        alignment: {} as never,
        levelJson: "{}",
        arVisitIndex: 0,
        atMs: T0 + 2000,
      }),
    );
    fix(2, 15, 0);
    store.dispatch(
      objectPlaced({
        object: {
          id: "p1",
          kind: "pin",
          label: "Gate",
          createdAtIso: "2026-09-28T10:00:03.000Z",
          geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
        },
        arVisitIndex: 0,
        atMs: T0 + 3000,
        reticleOdomNue: [0, 0, -2],
        cameraOdomPose: null,
        alignmentMatrix: selectAlignmentMatrix(store.getState()),
        arWorldGroupMatrix: null,
        code: null,
        codeSizeM: 0.16,
      }),
    );
    store.dispatch(
      authoringFinished({
        levelId: "lvl",
        manifest: { version: 1, objects: [] },
        atMs: T0 + 4000,
      }),
    );
    pageExits(); // the Finish ends AR
    pageEnters(T0 + 10_000); // the second visit keeps the zero
    fix(10, 0, 0);
    pageExits();
    await settle();

    const saved = await save();
    const entries = await loadActionsFromZip(
      new Uint8Array(await saved.blob.arrayBuffer()),
    );

    expect(entries.map((e) => e.action.type)).toEqual([
      "recording/startSession",
      "gpsData/setZeroPos",
      "gpsData/setColdStartOverrideEnabled",
      "gpsData/recordGpsEvent",
      "gpsData/recordGpsEvent",
      "qrDetected/recordQrDetection",
      "recording/recordDepthSample",
      "tourAuthoring/codeMeasured",
      "gpsData/recordGpsEvent",
      "tourAuthoring/objectPlaced",
      "tourAuthoring/finished",
      "qrDetected/clearAllQrMarkers",
      "recording/endSession",
      "gpsData/resetGpsSessionData",
      "recording/startSession",
      "gpsData/recordGpsEvent",
      "qrDetected/clearAllQrMarkers",
      "recording/endSession",
      "gpsData/resetGpsSessionData",
    ]);
  });
});

describe("what a recording costs on disk", () => {
  it("measures a depth sample and a GPS fix as the recording writes them, and the per-second budget holds them", async () => {
    // Why this test matters (M1a review finding 3): the low-storage
    // warning's threshold is derived from `RECORDING_BYTES_PER_SECOND`,
    // and the review's figure for depth (about 30 KB a sample, about
    // 110 MB an hour) was arithmetic, not a measurement. This writes one
    // real sample and one GPS fix through the real store into the OPFS
    // mock and reads the bytes back - the files are pretty-printed JSON,
    // which is where the arithmetic went short. The budget must cover
    // what one second writes (a depth sample and a GPS fix, both at
    // 1 Hz) without overstating it by more than a quarter, so a change to
    // the sampler's grid or the file format cannot drift past it unseen.
    const { recording, store } = recordingAndStore();
    recording.start(START);
    enter(store, T0);
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    feed(store, VISIT_1.slice(0, 1), 0);
    store.dispatch(recordDepthSample(phoneDepthSample()));
    await settle();
    await store.flushPendingActionWrites();

    const bytes = await writtenBytesByType();
    const depth = bytes.get(recordDepthSample.type)?.[0] ?? 0;
    const gps = bytes.get(recordGpsEvent.type)?.[0] ?? 0;
    // Measured 2026-09-28: a depth sample 34 285 bytes, a GPS fix 357 bytes
    // (sidecar "Storage cost"). The band below keeps the budget honest.
    expect(depth).toBeGreaterThan(30_000);
    expect(depth + gps).toBeLessThanOrEqual(RECORDING_BYTES_PER_SECOND);
    expect(depth + gps).toBeGreaterThan(0.75 * RECORDING_BYTES_PER_SECOND);
  });
});

describe("the low-storage warning", () => {
  // Why these tests matter (M1a review finding 3): the warning is the
  // creator's only notice that a recording may not fit, and a wrong unit or
  // an inverted comparison would silence it exactly when it is needed.
  it("warns below the threshold with the space left and the minutes it holds", () => {
    const free = 50 * 1024 * 1024;

    expect(lowStorageWarning({ quota: free + 1000, usage: 1000 })).toBe(
      `Only 50 MB of storage is left for this page - about ${String(
        Math.floor(free / RECORDING_BYTES_PER_SECOND / 60),
      )} minutes of recording.`,
    );
  });

  it("stays silent at and above the threshold, and without an estimate", () => {
    expect(lowStorageWarning({ quota: LOW_STORAGE_BYTES, usage: 0 })).toBe(
      null,
    );
    expect(lowStorageWarning({ quota: 64 * 1024 ** 3, usage: 1 })).toBe(null);
    expect(lowStorageWarning(undefined)).toBe(null);
    expect(lowStorageWarning({ quota: 1000 })).toBe(null);
    expect(lowStorageWarning({ usage: 1000 })).toBe(null);
    expect(lowStorageWarning({ quota: Number.NaN, usage: 0 })).toBe(null);
  });

  it("warns one byte under the threshold, and counts a full store as none left", () => {
    expect(
      lowStorageWarning({ quota: LOW_STORAGE_BYTES - 1, usage: 0 }),
    ).not.toBe(null);
    expect(lowStorageWarning({ quota: 1000, usage: 5000 })).toBe(
      "Only 0 MB of storage is left for this page - about 0 minutes of recording.",
    );
  });
});
