/**
 * The troubleshooting recordings on disk across page lives (authoring
 * recording plan 2026-09-28-0953, M1b), over the framework's OPFS mock.
 *
 * Why these tests matter: a recording that outlives its tab is the only
 * record of a field session that went wrong, and the phone gives it about
 * 125 MB an hour. Two failures are expensive in opposite directions: a
 * folder taken for saved when it is not is deleted by the cleanup and the
 * session is gone; a folder never cleaned fills the page's storage until
 * the next recording fails part-way. These pin the marker's meaning (a
 * killed tab, a save, a save followed by more recording), the orphan's
 * rebuilt `session.json`, and which folders the cleanup may touch.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadActionsFromZip,
  loadSessionMetadataFromZip,
} from "gps-plus-slam-app-framework/storage";
import {
  installOPFSMocks,
  type MockOPFSDirectoryHandle,
} from "gps-plus-slam-app-framework/test-utils/browser-mocks";
import { BlobReader, ZipReader } from "@zip.js/zip.js";

import {
  AUTHORING_CONTEXT_TAG,
  countActionFiles,
  deleteRecordingFolder,
  heldRecordingFolders,
  holdRecordingFolder,
  listRecordingFolders,
  openRecordingsDir,
  packOrphanRecording,
  packRecordingFolder,
  recordingStartOf,
  recordingsToDelete,
  SAVED_RECORDING_MAX_AGE_MS,
  SAVED_RECORDINGS_KEPT,
  tidyRecordings,
  VIEWING_CONTEXT_TAG,
  type RecordingFolder,
} from "./recording-folders.js";

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const ENV = { userAgent: "test-agent", pageUrl: "https://example.test/tour/" };

let root: MockOPFSDirectoryHandle;
let cleanup: () => void;

beforeEach(() => {
  const mocks = installOPFSMocks();
  root = mocks.root;
  cleanup = mocks.cleanup;
});

afterEach(() => {
  cleanup();
});

async function recordingsDir(): Promise<MockOPFSDirectoryHandle> {
  const dir = await openRecordingsDir(root, true);
  return dir as unknown as MockOPFSDirectoryHandle;
}

function gpsAction(i: number, lat: number, lon: number) {
  return {
    type: "gpsData/recordGpsEvent",
    payload: {
      odomPosition: [i, 0, 0],
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: `fix-${String(i)}`,
        latitude: lat,
        longitude: lon,
        altitude: 400,
        latLongAccuracy: 5,
        timestamp: T0 + i * 1000,
      },
    },
  };
}

/** A recording folder as a page leaves it: `actions/NNNNNN.json`,
 *  pretty-printed, and nothing else unless asked. */
async function makeFolder(
  name: string,
  actions: readonly unknown[],
  extra: Record<string, string> = {},
): Promise<MockOPFSDirectoryHandle> {
  const dir = await recordingsDir();
  const folder = (await dir.getDirectoryHandle(name, {
    create: true,
  })) as unknown as MockOPFSDirectoryHandle;
  const actionsDir = (await folder.getDirectoryHandle("actions", {
    create: true,
  })) as unknown as MockOPFSDirectoryHandle;
  for (const [i, action] of actions.entries()) {
    actionsDir.setStoredContent(
      `${String(i + 1).padStart(6, "0")}.json`,
      JSON.stringify(action, null, 2),
    );
  }
  for (const [file, text] of Object.entries(extra)) {
    folder.setStoredContent(file, text);
  }
  return folder;
}

async function addAction(
  folder: MockOPFSDirectoryHandle,
  index: number,
  action: unknown,
): Promise<void> {
  const actionsDir = (await folder.getDirectoryHandle(
    "actions",
  )) as unknown as MockOPFSDirectoryHandle;
  actionsDir.setStoredContent(
    `${String(index).padStart(6, "0")}.json`,
    JSON.stringify(action, null, 2),
  );
}

async function zipNames(blob: Blob): Promise<string[]> {
  const reader = new ZipReader(new BlobReader(blob));
  const names = (await reader.getEntries())
    .filter((e) => !e.directory)
    .map((e) => e.filename);
  await reader.close();
  return names.sort();
}

function folder(overrides: Partial<RecordingFolder>): RecordingFolder {
  return {
    name: "recording-2026-09-28_10-00-00utc",
    startedAtMs: T0,
    actionFiles: 10,
    savedAtMs: null,
    saved: false,
    ...overrides,
  };
}

describe("recordingStartOf - which folders are this app's recordings", () => {
  it("reads the start time from the name the framework gives a folder, a collision suffix included", () => {
    expect(recordingStartOf("recording-2026-09-28_10-00-00utc")).toBe(T0);
    expect(recordingStartOf("recording-2026-09-28_10-00-00utc-2")).toBe(T0);
  });

  it("refuses anything it did not write, a calendar-impossible date included", () => {
    // Why: the cleanup deletes by this test; a folder another feature put
    // beside the recordings must never be taken for one.
    for (const name of [
      "drafts",
      "recording-",
      "recording-2026-09-28_10-00-00",
      "recording-2026-13-40_10-00-00utc",
      "xrecording-2026-09-28_10-00-00utc",
      "recording-2026-09-28_10-00-00utc-x",
    ]) {
      expect(recordingStartOf(name)).toBeNull();
    }
  });
});

describe("the saved marker", () => {
  it("a folder a killed tab left is unsaved; after a save it is saved; more recording after the save makes it unsaved again", async () => {
    const dir = await recordingsDir();
    const live = await makeFolder("recording-2026-09-28_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
      gpsAction(1, 47.5001, 8.7),
    ]);

    let [listed] = await listRecordingFolders(dir);
    expect(listed).toMatchObject({ saved: false, savedAtMs: null });
    expect(listed?.actionFiles).toBe(2);

    const packed = await packRecordingFolder(live, new Date(T0), () =>
      Promise.resolve(),
    );
    expect(packed.actionCount).toBe(2);
    // Packing alone is not a save: the hand-off may still fail or be
    // cancelled.
    [listed] = await listRecordingFolders(dir);
    expect(listed?.saved).toBe(false);

    expect(await packed.markSaved(T0 + 60_000)).toBe(true);
    [listed] = await listRecordingFolders(dir);
    expect(listed).toMatchObject({ saved: true, savedAtMs: T0 + 60_000 });

    // The recording runs on after a save (it is a snapshot).
    await addAction(live, 3, gpsAction(2, 47.5002, 8.7));
    [listed] = await listRecordingFolders(dir);
    expect(listed?.saved).toBe(false);
  });

  it("an action written while the zip was built is not covered by the marker (the count is taken first)", async () => {
    // Why: the zip reads the folder after the count; an action landing in
    // between must leave the folder UNSAVED - offered once more, never
    // deleted with an action the author did not get.
    const dir = await recordingsDir();
    const live = await makeFolder("recording-2026-09-28_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    const packed = await packRecordingFolder(live, new Date(T0), () =>
      Promise.resolve(),
    );
    await addAction(live, 2, gpsAction(1, 47.5001, 8.7));
    await packed.markSaved(T0 + 1000);
    const [listed] = await listRecordingFolders(dir);
    expect(listed?.saved).toBe(false);
  });

  it("a marker that does not read counts as unsaved", async () => {
    const dir = await recordingsDir();
    await makeFolder(
      "recording-2026-09-28_10-00-00utc",
      [gpsAction(0, 47.5, 8.7)],
      { "saved.blob": "{not json" },
    );
    await makeFolder(
      "recording-2026-09-28_11-00-00utc",
      [gpsAction(0, 47.5, 8.7)],
      { "saved.blob": JSON.stringify({ savedAtMs: T0, actionFiles: -1 }) },
    );
    const listed = await listRecordingFolders(dir);
    expect(listed.map((f) => f.saved)).toEqual([false, false]);
  });
});

describe("listRecordingFolders", () => {
  it("lists only this app's recording folders, oldest first, without the ones a live page holds", async () => {
    const dir = await recordingsDir();
    await makeFolder("recording-2026-09-28_12-00-00utc", []);
    await makeFolder("recording-2026-09-28_10-00-00utc", []);
    await makeFolder("recording-2026-09-28_11-00-00utc", []);
    await dir.getDirectoryHandle("drafts", { create: true });
    dir.setStoredContent("recording-2026-09-28_09-00-00utc", "a file");

    const listed = await listRecordingFolders(
      dir,
      new Set(["recording-2026-09-28_11-00-00utc"]),
    );
    expect(listed.map((f) => f.name)).toEqual([
      "recording-2026-09-28_10-00-00utc",
      "recording-2026-09-28_12-00-00utc",
    ]);
  });

  it("openRecordingsDir without create finds nothing on a fresh device", async () => {
    expect(
      await openRecordingsDir(
        root as unknown as FileSystemDirectoryHandle,
        false,
      ),
    ).toBeNull();
    // ... and creates nothing while looking.
    await expect(root.getDirectoryHandle("gps-plus-slam")).rejects.toThrow();
  });
});

describe("recordingsToDelete - the cleanup bound", () => {
  const saved = (name: string, savedAtMs: number) =>
    folder({ name, saved: true, savedAtMs });

  it("never deletes an unsaved recording that holds actions, however old", () => {
    const old = folder({ startedAtMs: T0 - 365 * DAY });
    expect(recordingsToDelete([old], T0)).toEqual([]);
  });

  it("deletes a folder with no action file: there is nothing to save", () => {
    const empty = folder({ actionFiles: 0 });
    expect(recordingsToDelete([empty], T0)).toEqual([empty.name]);
  });

  it(`deletes a saved recording ${String(SAVED_RECORDING_MAX_AGE_MS / DAY)} days after its save, not before`, () => {
    const a = saved("a", T0 - SAVED_RECORDING_MAX_AGE_MS);
    const b = saved("b", T0 - SAVED_RECORDING_MAX_AGE_MS - 1);
    expect(recordingsToDelete([a, b], T0)).toEqual(["b"]);
  });

  it(`keeps the ${String(SAVED_RECORDINGS_KEPT)} most recently saved, whatever their start`, () => {
    const folders = [
      saved("started-first-saved-last", T0 - 1000),
      saved("s2", T0 - 2000),
      saved("s3", T0 - 3000),
      saved("s4", T0 - 4000),
      saved("s5", T0 - 5000),
    ];
    expect(recordingsToDelete(folders, T0).sort()).toEqual(["s4", "s5"]);
  });

  it("an unsaved recording does not use up a kept place", () => {
    const folders = [
      folder({ name: "unsaved-1" }),
      folder({ name: "unsaved-2" }),
      saved("s1", T0 - 1000),
      saved("s2", T0 - 2000),
      saved("s3", T0 - 3000),
    ];
    expect(recordingsToDelete(folders, T0)).toEqual([]);
  });
});

describe("tidyRecordings - what a page open does", () => {
  it("deletes the old saved and the empty folders, keeps a live page's, and hands back the unsaved ones to offer", async () => {
    const dir = await recordingsDir();
    const oldSaved = await makeFolder("recording-2026-09-01_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    const packed = await packRecordingFolder(oldSaved, new Date(T0), () =>
      Promise.resolve(),
    );
    await packed.markSaved(T0 - 30 * DAY);
    await makeFolder("recording-2026-09-02_10-00-00utc", []);
    await makeFolder("recording-2026-09-03_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    // Another tab records into this one right now: its lock is held.
    await makeFolder("recording-2026-09-04_10-00-00utc", []);

    const orphans = await tidyRecordings(
      dir,
      new Set(["recording-2026-09-04_10-00-00utc"]),
      T0,
    );

    expect(orphans.map((f) => f.name)).toEqual([
      "recording-2026-09-03_10-00-00utc",
    ]);
    const left = [];
    for await (const name of dir.keys()) left.push(name);
    expect(left.sort()).toEqual([
      "recording-2026-09-03_10-00-00utc",
      "recording-2026-09-04_10-00-00utc",
    ]);
  });

  it("a delete OPFS refuses is skipped, not fatal", async () => {
    const dir = await recordingsDir();
    await makeFolder("recording-2026-09-02_10-00-00utc", []);
    await makeFolder("recording-2026-09-03_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    dir.removeEntry = () => Promise.reject(new Error("NoModificationAllowed"));
    const orphans = await tidyRecordings(dir, new Set(), T0);
    expect(orphans.map((f) => f.name)).toEqual([
      "recording-2026-09-03_10-00-00utc",
    ]);
  });
});

describe("the live page's lock on its folder", () => {
  /** Web Locks as the browser keeps them: a request holds until its
   *  callback's promise settles. */
  function fakeLocks() {
    const held: { name: string }[] = [
      { name: "some-other-feature" },
      { name: "gps-plus-slam/tour-viewer/" },
    ];
    return {
      request: (name: string) => {
        held.push({ name });
        return new Promise(() => {});
      },
      query: () => Promise.resolve({ held, pending: [] }),
    } as unknown as LockManager;
  }

  it("a held folder is reported by name, and nothing else is", async () => {
    // Why: the offer and the cleanup skip exactly these - a folder another
    // open tab records into must not be offered for deletion.
    const locks = fakeLocks();
    holdRecordingFolder(locks, "recording-2026-09-28_10-00-00utc");
    expect(await heldRecordingFolders(locks)).toEqual(
      new Set(["", "recording-2026-09-28_10-00-00utc"]),
    );
  });

  it("without Web Locks, or when the query fails, nothing is held and nothing throws", async () => {
    holdRecordingFolder(undefined, "recording-2026-09-28_10-00-00utc");
    expect(await heldRecordingFolders(undefined)).toEqual(new Set());
    const failing = {
      request: () => Promise.reject(new Error("SecurityError")),
      query: () => Promise.reject(new Error("SecurityError")),
    } as unknown as LockManager;
    holdRecordingFolder(failing, "recording-2026-09-28_10-00-00utc");
    expect(await heldRecordingFolders(failing)).toEqual(new Set());
  });
});

describe("deleteRecordingFolder", () => {
  it("removes the folder with everything in it", async () => {
    const dir = await recordingsDir();
    await makeFolder("recording-2026-09-28_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    await deleteRecordingFolder(dir, "recording-2026-09-28_10-00-00utc");
    expect(await listRecordingFolders(dir)).toEqual([]);
  });
});

describe("packing a folder", () => {
  it("a session.json the disk refuses still yields the zip of the actions, without the empty file", async () => {
    const dir = await recordingsDir();
    const live = await makeFolder("recording-2026-09-28_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    const packed = await packRecordingFolder(live, new Date(T0), async () => {
      // The file is created, then the write is refused.
      await live.getFileHandle("session.json", { create: true });
      throw new Error("QuotaExceededError");
    });
    expect(packed.metadataError).toBe("QuotaExceededError");
    expect(await zipNames(packed.blob)).toEqual(["actions/000001.json"]);
    expect(packed.filename).toBe("tour-recording-2026-09-28_10-00-00utc.zip");
    expect(await countActionFiles(live as never)).toBe(1);
    expect(dir).toBeDefined();
  });
});

describe("saving an orphan - a folder whose page was killed", () => {
  it("rebuilds session.json from the folder's own actions: era 5, the start from the name, the coverage from its fixes, the tag from its log actions", async () => {
    const dir = await recordingsDir();
    await makeFolder("recording-2026-09-28_10-00-00utc", [
      { type: "recording/startSession", payload: { startTime: T0 } },
      gpsAction(0, 47.5, 8.7),
      gpsAction(1, 47.5001, 8.7),
      { type: "tourViewing/codeLocked", payload: { text: "x" } },
    ]);

    // The mock stamps each file with the real clock when it is read, which
    // is long after T0: an end taken from the files lands in this window,
    // one taken from the start would not.
    const before = Date.now();
    const packed = await packOrphanRecording(
      dir,
      "recording-2026-09-28_10-00-00utc",
      ENV,
      AUTHORING_CONTEXT_TAG,
    );
    const after = Date.now();
    expect(packed.metadataError).toBeUndefined();
    expect(packed.filename).toBe("tour-recording-2026-09-28_10-00-00utc.zip");
    const bytes = new Uint8Array(await packed.blob.arrayBuffer());
    const meta = await loadSessionMetadataFromZip(bytes);
    expect(meta).toMatchObject({
      odomCoordVersion: 5,
      contextTag: VIEWING_CONTEXT_TAG,
      startedAt: new Date(T0).toISOString(),
      actionCount: 2,
      userAgent: "test-agent",
      pageUrl: "https://example.test/tour/",
    });
    const endedAt = Date.parse((meta as { endedAt: string }).endedAt);
    expect(endedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(endedAt).toBeLessThanOrEqual(after);
    expect((meta as { h3Cells: string[] }).h3Cells.length).toBeGreaterThan(0);
    expect((await loadActionsFromZip(bytes)).map((e) => e.action.type)).toEqual(
      [
        "recording/startSession",
        "gpsData/recordGpsEvent",
        "gpsData/recordGpsEvent",
        "tourViewing/codeLocked",
      ],
    );
  });

  it("keeps the tag an earlier save wrote, and falls back to the saving page's own when nothing says", async () => {
    const dir = await recordingsDir();
    await makeFolder(
      "recording-2026-09-28_10-00-00utc",
      [gpsAction(0, 47.5, 8.7)],
      { "session.json": JSON.stringify({ contextTag: VIEWING_CONTEXT_TAG }) },
    );
    await makeFolder("recording-2026-09-28_11-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    const tagOf = async (name: string) => {
      const packed = await packOrphanRecording(
        dir,
        name,
        ENV,
        AUTHORING_CONTEXT_TAG,
      );
      const meta = await loadSessionMetadataFromZip(
        new Uint8Array(await packed.blob.arrayBuffer()),
      );
      return (meta as { contextTag: string }).contextTag;
    };
    expect(await tagOf("recording-2026-09-28_10-00-00utc")).toBe(
      VIEWING_CONTEXT_TAG,
    );
    expect(await tagOf("recording-2026-09-28_11-00-00utc")).toBe(
      AUTHORING_CONTEXT_TAG,
    );
  });

  it("skips a truncated last action (what a killed write leaves) instead of failing", async () => {
    const dir = await recordingsDir();
    const orphan = await makeFolder("recording-2026-09-28_10-00-00utc", [
      gpsAction(0, 47.5, 8.7),
    ]);
    const actionsDir = (await orphan.getDirectoryHandle(
      "actions",
    )) as unknown as MockOPFSDirectoryHandle;
    actionsDir.setStoredContent("000002.json", '{ "type": "gpsData/rec');
    const packed = await packOrphanRecording(
      dir,
      "recording-2026-09-28_10-00-00utc",
      ENV,
      AUTHORING_CONTEXT_TAG,
    );
    expect(packed.metadataError).toBeUndefined();
    const meta = await loadSessionMetadataFromZip(
      new Uint8Array(await packed.blob.arrayBuffer()),
    );
    expect(meta).toMatchObject({ actionCount: 1 });
    expect(packed.actionCount).toBe(2);
  });

  it("refuses a name that is not a recording folder", async () => {
    const dir = await recordingsDir();
    await expect(
      packOrphanRecording(
        dir as unknown as FileSystemDirectoryHandle,
        "drafts",
        ENV,
        AUTHORING_CONTEXT_TAG,
      ),
    ).rejects.toThrow(/not a recording folder/);
  });
});
