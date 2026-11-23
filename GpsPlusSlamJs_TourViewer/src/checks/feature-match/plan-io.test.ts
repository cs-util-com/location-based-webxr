import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Frame } from "./bench-image";
import type { BenchEngine } from "./bench-engine";
import type { DeviceInfo } from "./bench-report";
import type { CameraControl } from "./camera-control";
import { featureMatchActions as A, RELOAD_LINE } from "./feature-match-slice";
import {
  createFeatureMatchStore,
  LOG_KEY,
  photoKey,
  PLAN_KEY,
  type KeyValueStorage,
} from "./feature-match-store";
import { createPlanIo } from "./plan-io";
import { EMPTY_PLAN, planReducer, planText } from "./run-plan";
import type { KeyValueStore } from "../../key-value-db";

const encode = vi.hoisted(() => ({
  png: (): Promise<Blob> => Promise.resolve(new Blob(["png"])),
}));
const saved = vi.hoisted(() => ({ blobs: [] as Blob[] }));

vi.mock("./bench-dom", () => ({
  captureFrame: (): Frame => ({
    width: 4,
    height: 3,
    rgba: new Uint8ClampedArray(48).fill(120),
  }),
  framePng: () => encode.png(),
}));
vi.mock("gps-plus-slam-app-framework/storage", async (original) => ({
  ...(await original<object>()),
  downloadBlob: (blob: Blob) => {
    saved.blobs.push(blob);
    return Promise.resolve(true);
  },
}));

const device = { userAgent: "test", model: null } as unknown as DeviceInfo;

const memory = (init: Record<string, string> = {}) => {
  const data = new Map(Object.entries(init));
  const storage: KeyValueStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
  return storage;
};

const mapDb = (init: Record<string, unknown> = {}) => {
  const data = new Map<string, unknown>(Object.entries(init));
  const db: KeyValueStore = {
    get: (k: string) => Promise.resolve(data.get(k)),
    put: (k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    },
    delete: (k: string) => {
      data.delete(k);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  };
  return { data, db };
};

const settle = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

/** A store and the page's plan io over it, without a DOM. */
const setUp = (storage: KeyValueStorage, db: KeyValueStore) => {
  const fm = createFeatureMatchStore({
    storage,
    session: "s1",
    revokeUrl: () => undefined,
    photoDb: db,
    photoDbFailed: () => undefined,
    previewOf: () =>
      Promise.resolve({ width: 1, height: 1, rgba: new Uint8ClampedArray(4) }),
  });
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
    fm.store.dispatch(A.logged(line));
  };
  const fail = vi.fn<(where: string, e: unknown) => void>();
  const io = createPlanIo({
    fm,
    engine: {
      deviceInfo: () => Promise.resolve(device),
    } as unknown as BenchEngine,
    camera: {} as CameraControl,
    video: { videoWidth: 8, videoHeight: 6 } as HTMLVideoElement,
    flash: { hidden: true } as HTMLElement,
    note: { show: () => undefined, clear: () => undefined },
    log,
    fail,
    moving: () => false,
    deviceKnown: () => undefined,
  });
  return { fm, io, fail, lines };
};

/** The entry names of a zip, and its text entries. */
const zipOf = async (blob: Blob) => {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const texts: Record<string, string> = {};
  for (const e of entries) {
    if (!e.directory && e.filename.endsWith(".txt")) {
      texts[e.filename] = await e.getData(new TextWriter());
    }
  }
  await reader.close();
  return { names: entries.map((e) => e.filename), texts };
};

beforeEach(() => {
  saved.blobs = [];
  encode.png = () => Promise.resolve(new Blob(["png"]));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the photo and the run zip", () => {
  // Why: a PNG that could not be encoded used to stay in the plan as a
  // photo nobody can read, so every zip failed with "try again" forever.
  // The shot must ask to be taken again, and the zip go on without it.
  it("records the photo's grey mean and spread at capture", () => {
    // Why: the frames JSON carries both for the PC's light and contrast
    // reading; the capture is the one place the full frame is at hand.
    const { fm, io } = setUp(memory(), mapDb().db);
    expect(io.shoot()).toBe(true);
    const photo = fm.store.getState().plan.shots["light-s1/L1"]?.photo;
    expect(photo?.greyMean).toBeCloseTo(120, 5);
    expect(photo?.greySd).toBeCloseTo(0, 5);
  });

  it("names the methods the phone measures in the summary", () => {
    // Why: the PC reads the summary to know which methods it must still
    // run; without the methods line it cannot tell an unticked method
    // from one the phone measured.
    const { fm, io } = setUp(memory(), mapDb().db);
    expect(io.summaryOf(fm.store.getState())).toContain(
      "Methods on this phone: SIFT, ALIKED + LightGlue",
    );
  });

  it("asks again for a shot whose PNG could not be encoded", async () => {
    const { fm, io, fail } = setUp(memory(), mapDb().db);
    await fm.restore();
    expect(io.shoot()).toBe(true);
    expect(io.shoot()).toBe(true);
    await settle();
    const broken = new Error("toBlob gave null");
    encode.png = () => Promise.reject(broken);
    expect(io.shoot()).toBe(true);
    await settle();
    const s = fm.store.getState();
    expect(fail).toHaveBeenCalledWith("capture", broken);
    expect(s.plan.shots["light-s1/L3"]).toBeUndefined();
    expect(fm.sides.photos.size).toBe(0);
    expect(s.photoStoreFailing).toBe(false);

    await io.downloadAll();
    expect(fm.store.getState().runZip.phase).toBe("saved");
    const { names } = await zipOf(saved.blobs[0]!);
    expect(names.filter((n) => n.startsWith("shots/"))).toEqual([
      "shots/light-s1/L1-t1.png",
      "shots/light-s1/L2-t1.png",
    ]);
  });

  // Why: Download all right after a reload must wait for the stored log
  // (and results) to come back, or the zip misses the earlier load's log.
  it("packs the earlier load's log even while the restore still reads it", async () => {
    const plan = ["light-s1/L1", "light-s1/L2"].reduce(
      (p, shot, i) =>
        planReducer(p, {
          type: "photo",
          shot,
          photo: {
            id: `p${String(i)}`,
            width: 4,
            height: 3,
            source: { width: 8, height: 6 },
            greyMean: 120,
          },
        }),
      EMPTY_PLAN,
    );
    const { db } = mapDb({
      [photoKey("p0")]: new Blob(["a"]),
      [photoKey("p1")]: new Blob(["b"]),
      [LOG_KEY]: "earlier load\n",
    });
    let release: () => void = () => undefined;
    const held: KeyValueStore = {
      ...db,
      get: (k: string) =>
        k === LOG_KEY
          ? new Promise((r) => {
              release = () => {
                r(db.get(k));
              };
            })
          : db.get(k),
    };
    const { fm, io } = setUp(memory({ [PLAN_KEY]: planText(plan) }), held);
    const restoring = fm.restore();
    await settle();
    const zipping = io.downloadAll();
    await settle();
    expect(saved.blobs).toHaveLength(0);
    release();
    await Promise.all([restoring, zipping]);
    const { texts } = await zipOf(saved.blobs[0]!);
    const log = texts["feature-match-log.txt"] ?? "";
    expect(log.indexOf("earlier load")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(RELOAD_LINE)).toBeGreaterThan(
      log.indexOf("earlier load"),
    );
  });
});

describe("copyText", () => {
  // Why this test matters: the clipboard write is awaited, and a tap that
  // shows nothing until it settles reads as a dead button; a refused write
  // must replace the in-progress word, never leave "copying..." behind.
  it("says copying while the write runs, then copied", async () => {
    let done = (): void => undefined;
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () =>
          new Promise<void>((r) => {
            done = r;
          }),
      },
    });
    const { io } = setUp(memory(), mapDb().db);
    const out = { textContent: "" } as HTMLElement;
    const copying = io.copyText("log", out);
    expect(out.textContent).toBe("copying...");
    done();
    await copying;
    expect(out.textContent).toBe("copied");
    vi.unstubAllGlobals();
  });

  it("says the copy was refused when the write fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    const { io } = setUp(memory(), mapDb().db);
    const out = { textContent: "" } as HTMLElement;
    await io.copyText("log", out);
    expect(out.textContent).toBe("copy refused by the browser");
    vi.unstubAllGlobals();
  });
});
