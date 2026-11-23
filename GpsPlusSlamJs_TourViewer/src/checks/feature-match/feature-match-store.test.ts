import { afterEach, describe, expect, it, vi } from "vitest";

import type { Frame } from "./bench-image";
import { featureMatchActions as A, RELOAD_LINE } from "./feature-match-slice";
import {
  createFeatureMatchStore,
  FLAT_PROGRESS_KEY,
  flatHasUnsaved,
  holdTabLock,
  LOG_DELAY_MS,
  LOG_KEY,
  PLAN_KEY,
  photoKey,
  resultDbKey,
  TAB_LOCK,
  type FeatureMatchStore,
  type KeyValueStorage,
} from "./feature-match-store";
import { SURFACE_CLASSES } from "./flat-target";
import { EMPTY_PLAN, planPhotoIds, planText, type PhotoMeta } from "./run-plan";
import type { KeyValueStore } from "../../key-value-db";

const memory = (init: Record<string, string> = {}) => {
  const data = new Map(Object.entries(init));
  const storage: KeyValueStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
  return { data, storage };
};

const blocked: KeyValueStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const make = (storage: KeyValueStorage) => {
  const revokeUrl = vi.fn<(url: string) => void>();
  return {
    ...createFeatureMatchStore({ storage, session: "s1", revokeUrl }),
    revokeUrl,
  };
};

const photo = (id: string): PhotoMeta => ({
  id,
  width: 4,
  height: 3,
  source: { width: 8, height: 6 },
  greyMean: 100,
});
const frame: Frame = { width: 4, height: 3, rgba: new Uint8ClampedArray(48) };
const CLS = SURFACE_CLASSES[0].id;

/** One PNG per photo id, the same object each time, so a test can compare. */
const pngs = new Map<string, Blob>();
const png = (id: string): Blob => {
  let b = pngs.get(id);
  if (!b) {
    b = new Blob([id], { type: "image/png" });
    pngs.set(id, b);
  }
  return b;
};
/** The preview the fake decoder makes of a PNG: one pixel naming its id. */
const previews = new Map<Blob, Frame>();
const previewOf = (b: Blob): Promise<Frame> => {
  let f = previews.get(b);
  if (!f) {
    f = {
      width: 1,
      height: 1,
      rgba: Uint8ClampedArray.of(previews.size, 0, 0, 255),
    };
    previews.set(b, f);
  }
  return Promise.resolve(f);
};

/** Takes a photo as the page does: its preview and PNG beside the action. */
const take = (fm: FeatureMatchStore, shot: string, id: string): boolean => {
  fm.sides.previews.set(id, frame);
  return fm.put(
    fm.sides.photos,
    [[id, Promise.resolve(png(id))]],
    A.planShotTaken({ shot, photo: photo(id) }),
  );
};

/** A key-value store over a Map, as IndexedDB's adapter offers it. */
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

const makeWith = (
  storage: KeyValueStorage,
  photoDb: KeyValueStore | null,
  lock?: () => Promise<boolean>,
) => {
  const revokeUrl = vi.fn<(url: string) => void>();
  const failed = vi.fn<(e: unknown) => void>();
  return {
    ...createFeatureMatchStore({
      storage,
      session: "s1",
      revokeUrl,
      photoDb,
      photoDbFailed: failed,
      previewOf,
      ...(lock ? { lock } : {}),
    }),
    revokeUrl,
    failed,
  };
};

const settle = async (n = 1): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

const L1 = "light-s1/L1";
const L2 = "light-s1/L2";
const L3 = "light-s1/L3";
const L1L2 = "light-s1/L1-L2";

afterEach(() => {
  vi.useRealTimers();
});

describe("stored progress", () => {
  // Why: a plan of the pair-slot version cannot be read as shots; it is
  // dropped (no migration) and the page says so in its log.
  it("discards a stored plan of the old version and says so", () => {
    const old = make(memory({ [PLAN_KEY]: JSON.stringify({ v: 1 }) }).storage);
    expect(old.oldPlanDiscarded).toBe(true);
    expect(old.store.getState().plan.shots).toEqual({});
    expect(make(memory().storage).oldPlanDiscarded).toBe(false);
  });

  // Why: the discard is said once. Until the tester takes a photo nothing
  // rewrites the stored plan, so without a write of its own the old plan
  // would be found, dropped and logged again on every reload.
  it("replaces the discarded plan at once, so the next start reads none", () => {
    const { data, storage } = memory({ [PLAN_KEY]: JSON.stringify({ v: 1 }) });
    expect(make(storage).oldPlanDiscarded).toBe(true);
    expect(data.get(PLAN_KEY)).toBe(planText(EMPTY_PLAN));
    expect(make(storage).oldPlanDiscarded).toBe(false);
  });

  // Why: the flat progress outlives the page so a reload keeps the surfaces.
  it("writes the flat progress when it changes", () => {
    const { data, storage } = memory();
    const { store } = make(storage);
    store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: false }));
    expect(data.get(FLAT_PROGRESS_KEY)).toContain(CLS);
  });

  // Why: private mode blocks storage; the page must still work, starting over.
  it("starts over and keeps working when storage is blocked", () => {
    const { store } = make(blocked);
    expect(store.getState().plan.shots).toEqual({});
    expect(() => {
      store.dispatch(A.planShotTaken({ shot: L1, photo: photo("p1") }));
      store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: false }));
    }).not.toThrow();
    expect(Object.keys(store.getState().plan.shots)).toEqual([L1]);
  });
});

describe("side tables", () => {
  // Why: a PNG or preview the state no longer names is a memory leak.
  it("drops photos and previews the state no longer names", () => {
    const fm = make(memory().storage);
    take(fm, L1, "p1");
    take(fm, L2, "p2");
    // An entry nobody names goes at the next action.
    fm.sides.previews.set("stray", frame);
    fm.sides.photos.set("stray", Promise.resolve(png("stray")));
    fm.store.dispatch(A.logged("x"));
    expect(fm.sides.previews.has("stray")).toBe(false);
    expect(fm.sides.photos.has("stray")).toBe(false);
    // A retake of L1 replaces its photo; the old one goes.
    take(fm, L1, "p3");
    expect([...fm.sides.previews.keys()].sort()).toEqual(["p2", "p3"]);
    expect([...fm.sides.photos.keys()].sort()).toEqual(["p2", "p3"]);
  });

  // Why: a stale prepared zip's URL must go with it.
  it("revokes a prepared flat zip's URL once it is dropped", () => {
    const { store, sides, revokeUrl } = make(memory().storage);
    store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: false }));
    sides.urls.set("z1", "blob:z");
    store.dispatch(A.flatOverview());
    expect(revokeUrl).toHaveBeenCalledWith("blob:z");
  });

  // Why: a long session must not keep every surface's frames, but an
  // attached original exists only in this page and must survive.
  it("frees other surfaces' photos unless something is not downloaded", () => {
    const { store, sides, photosOf } = make(memory().storage);
    store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: false }));
    photosOf(1).camera = { width: 8, height: 6 };
    store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: true }));
    photosOf(2).original = new File(["x"], "orig.jpg");
    expect(sides.flatPhotos.has(1)).toBe(false);
    expect(flatHasUnsaved(store.getState(), sides)).toBe(true);
    store.dispatch(A.flatSurfaceSelected(1));
    expect(sides.flatPhotos.has(2)).toBe(true);
  });

  it("revokes every URL on dispose", () => {
    const { sides, dispose, revokeUrl } = make(memory().storage);
    sides.urls.set("u", "blob:u");
    dispose();
    expect(revokeUrl).toHaveBeenCalledWith("blob:u");
    expect(sides.urls.size).toBe(0);
  });
});

describe("accepted and put", () => {
  // Why: a second tap while a run goes must not start a second run, and
  // the view learns that only from `accepted`.
  it("tells a taken action from a refused one", () => {
    const { accepted } = make(memory().storage);
    expect(accepted(A.runStarted("synthetic"))).toBe(true);
    expect(accepted(A.runStarted("synthetic"))).toBe(false);
  });

  // Why: an entry its action does not name must not stay behind, and the
  // URL of a refused zip must be revoked.
  it("keeps an entry its action names and drops a refused one's", () => {
    const { put, sides, revokeUrl } = make(memory().storage);
    const held = Promise.resolve(png("p1"));
    expect(
      put(
        sides.photos,
        [["p1", held]],
        A.planShotTaken({ shot: L1, photo: photo("p1") }),
      ),
    ).toBe(true);
    expect(sides.photos.has("p1")).toBe(true);
    expect(
      put(
        sides.photos,
        [["p2", held]],
        A.planShotTaken({ shot: L2, photo: { ...photo("p2"), width: 0 } }),
      ),
    ).toBe(false);
    expect(sides.photos.has("p2")).toBe(false);
    expect(
      put(
        sides.urls,
        [["u1", "blob:1"]],
        A.flatSavingEnded({ prepared: null, status: "x" }),
      ),
    ).toBe(false);
    expect(revokeUrl).toHaveBeenCalledWith("blob:1");
  });
});

describe("reconcile of the flat side tables", () => {
  const taps = [
    { x: 10, y: 10 },
    { x: 300, y: 12 },
    { x: 298, y: 200 },
    { x: 12, y: 198 },
  ];

  // Why: a reference retaken leaves the old frame and preview unnamed.
  it("drops the marked reference and its preview once dropped", () => {
    const { store, sides, put } = make(memory().storage);
    store.dispatch(A.flatOpened());
    store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: false }));
    put(
      sides.flatFrames,
      [["f1", frame]],
      A.flatReferenceTaken({ id: "f1", width: 4, height: 3 }),
    );
    for (const t of taps) {
      store.dispatch(A.flatTapped(t));
    }
    put(
      sides.flatFrames,
      [["f2", frame]],
      A.flatPreviewMade({ id: "f2", width: 4, height: 3 }),
    );
    expect([...sides.flatFrames.keys()]).toEqual(["f1", "f2"]);
    store.dispatch(A.flatReferenceDropped());
    expect(sides.flatFrames.size).toBe(0);
  });

  // Why: Retake last removes a shot from the progress; its photo must go.
  it("drops the photo of a removed shot", () => {
    const { store, sides, photosOf, put } = make(memory().storage);
    store.dispatch(A.flatOpened());
    store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: false }));
    put(
      sides.flatFrames,
      [["f1", frame]],
      A.flatReferenceTaken({ id: "f1", width: 320, height: 240 }),
    );
    for (const t of taps) {
      store.dispatch(A.flatTapped(t));
    }
    put(
      sides.flatFrames,
      [["f2", frame]],
      A.flatPreviewMade({ id: "f2", width: 200, height: 150 }),
    );
    store.dispatch(A.flatReferenceAccepted());
    store.dispatch(A.flatShotTaken(200));
    const surface = store.getState().flat.progress.surfaces[0]!;
    const shot = surface.shots[0]!;
    photosOf(surface.id).shots.set(`${shot.pose}#${String(shot.q)}`, frame);
    store.dispatch(A.logged("x"));
    expect(photosOf(surface.id).shots.size).toBe(1);
    store.dispatch(A.flatShotRemoved());
    expect(photosOf(surface.id).shots.size).toBe(0);
  });
});

describe("the run plan's storage", () => {
  // Why: the run is an hour of photos; a reload must bring the plan back,
  // and the plan is written only when it changed.
  it("writes the plan when it changes and reads it back at start", () => {
    const { data, storage } = memory();
    const fm = makeWith(storage, null);
    take(fm, L1, "p1");
    expect(data.get(PLAN_KEY)).toContain(`"${L1}"`);
    const plan = makeWith(storage, null).store.getState().plan;
    expect(plan.shots[L1]?.photo.id).toBe("p1");
    expect(plan.shots[L1]?.take).toBe(1);
  });

  // Why: each photo goes to the database as its PNG at once; its copy in
  // memory goes once the write succeeded (the shot then reads "stored"),
  // and a photo retaken or reset goes from the database too.
  it("writes each photo as its PNG, then drops the copy in memory", async () => {
    const { data, db } = mapDb();
    const fm = makeWith(memory().storage, db);
    take(fm, L1, "p1");
    expect(fm.store.getState().storedIds).toEqual([]);
    await settle();
    expect(data.get(photoKey("p1"))).toBe(png("p1"));
    expect(fm.store.getState().storedIds).toEqual(["p1"]);
    expect(fm.sides.photos.has("p1")).toBe(false);
    expect(fm.sides.previews.has("p1")).toBe(true);
    fm.store.dispatch(A.planMoved(0));
    take(fm, L1, "p2");
    await settle();
    expect([...data.keys()]).toEqual([photoKey("p2")]);
    fm.store.dispatch(A.planReset());
    await settle();
    expect(data.size).toBe(0);
  });

  // Why: a zip, the speed test and later the queue read a photo from
  // storage, and from memory while storage does not hold it, so a
  // refusing database never loses a photo the page still shows.
  it("reads a photo from storage, else from memory, else says it is gone", async () => {
    const { data, db } = mapDb();
    let refuse = true;
    const flaky: KeyValueStore = {
      ...db,
      put: (k, v) =>
        refuse ? Promise.reject(new Error("quota")) : db.put(k, v),
    };
    const fm = makeWith(memory().storage, flaky);
    take(fm, L1, "p1");
    await settle();
    expect(data.size).toBe(0);
    expect(fm.sides.photos.has("p1")).toBe(true);
    await expect(fm.readPhoto("p1")).resolves.toBe(png("p1"));
    refuse = false;
    take(fm, L2, "p2");
    await settle(3);
    expect([...data.keys()].sort()).toEqual([photoKey("p1"), photoKey("p2")]);
    expect(fm.sides.photos.size).toBe(0);
    await expect(fm.readPhoto("p1")).resolves.toBe(png("p1"));
    await expect(fm.readPhoto("nope")).rejects.toThrow(/not stored/);
  });

  // Why: after a reload every kind of record comes back from storage: the
  // photos as previews (stored), the results of the ready pairs, and the
  // log, which goes on after a reload line. A photo the browser lost is
  // said as missing.
  it("restores photos, results and the log after a reload", async () => {
    const { storage } = memory();
    const first = makeWith(storage, null);
    take(first, L1, "p1");
    take(first, L2, "p2");
    take(first, L3, "p3");
    const key = `${L1L2}@p1+p2`;
    const entry = { status: "done", text: "ok", persisted: true } as const;
    const { db } = mapDb({
      [photoKey("p1")]: png("p1"),
      [photoKey("p2")]: png("p2"),
      [resultDbKey(key)]: { entry, matches: "{}\n" },
      [LOG_KEY]: "old 1\nold 2\n",
    });
    const next = makeWith(storage, db);
    next.store.dispatch(A.logged("this load"));
    await next.restore();
    const s = next.store.getState();
    expect(s.restored).toBe(true);
    expect(next.sides.previews.get("p1")).toBe(await previewOf(png("p1")));
    expect(s.plan.shots[L3]).toBeUndefined();
    expect([...s.storedIds].sort()).toEqual(["p1", "p2"]);
    expect(s.results).toEqual({ [key]: entry });
    expect(s.log).toEqual(["old 1", "old 2", RELOAD_LINE, "this load"]);
    await expect(next.readMatches(key)).resolves.toBe("{}\n");
  });

  // Why: the sweep deletes what the plan does not name (orphans, an old
  // version's photos under bare ids, stale results), but only when a plan
  // was read or an old one discarded: a blocked or cleared localStorage
  // must not delete stored photos.
  it("sweeps only after a plan was read or an old one discarded", async () => {
    const stray = {
      orphan: png("o"),
      [photoKey("gone")]: png("g"),
      [resultDbKey("x@a+b")]: {
        entry: { status: "done", text: "", persisted: true },
      },
      [LOG_KEY]: "old\n",
    };
    const none = mapDb(stray);
    await makeWith(memory().storage, none.db).restore();
    expect(none.data.size).toBe(4);

    const v1 = mapDb(stray);
    const old = memory({ [PLAN_KEY]: JSON.stringify({ v: 1 }) });
    await makeWith(old.storage, v1.db).restore();
    expect([...v1.data.keys()]).toEqual([LOG_KEY]);

    const v2 = mapDb(stray);
    const plan = memory({ [PLAN_KEY]: planText(EMPTY_PLAN) });
    await makeWith(plan.storage, v2.db).restore();
    expect([...v2.data.keys()]).toEqual([LOG_KEY]);
  });

  // Why: with no database (blocked, private window) a reload cannot bring
  // photos back; the shots say so instead of showing photos that are gone.
  it("marks every photo lost without a database, and survives a failing one", async () => {
    const { storage } = memory();
    take(makeWith(storage, null), L1, "p1");
    const none = makeWith(storage, null);
    await none.restore();
    expect(none.store.getState().plan.shots[L1]).toBeUndefined();
    expect(none.store.getState().restored).toBe(true);

    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error("gone")),
      put: () => Promise.reject(new Error("quota")),
      delete: () => Promise.reject(new Error("gone")),
      keys: () => Promise.reject(new Error("gone")),
    };
    const failing = makeWith(storage, broken);
    await failing.restore();
    expect(failing.failed).toHaveBeenCalled();
    expect(failing.store.getState().restored).toBe(true);
    take(failing, "flat-s1/F1", "p9");
    await settle();
    expect(failing.sides.photos.has("p9")).toBe(true);
  });

  // Why: a read that fails once is not a lost photo. Marking it lost
  // drops it from the plan, and the next start's sweep would then delete
  // a good PNG; the shot stays, the page says storage is failing.
  it("keeps a shot whose stored photo could not be read this time", async () => {
    const { storage } = memory();
    take(makeWith(storage, null), L1, "p1");
    const { data, db } = mapDb({ [photoKey("p1")]: png("p1") });
    let fails = 1;
    const flaky: KeyValueStore = {
      ...db,
      get: (k: string) =>
        k === photoKey("p1") && fails-- > 0
          ? Promise.reject(new Error("busy"))
          : db.get(k),
    };
    const first = makeWith(storage, flaky);
    await first.restore();
    const s = first.store.getState();
    expect(s.plan.shots[L1]?.photo.id).toBe("p1");
    expect(s.storedIds).toEqual([]);
    expect(s.photoStoreFailing).toBe(true);
    expect(first.failed).toHaveBeenCalled();
    first.dispose();
    const next = makeWith(storage, flaky);
    await next.restore();
    expect(data.has(photoKey("p1"))).toBe(true);
    expect(next.store.getState().storedIds).toEqual(["p1"]);
    expect(next.store.getState().photoStoreFailing).toBe(false);
  });

  // Why: the plan and its photos outlive a reload, but the side table key
  // counter did not: a new photo after a reload got a stored photo's id,
  // overwrote that shot's frame and was never written to the database.
  it("never gives a new photo the id of a photo the stored plan names", () => {
    const { storage } = memory();
    const first = make(storage);
    const id = first.newId("photo");
    take(first, L1, id);
    const again = createFeatureMatchStore({
      storage,
      session: "s2",
      revokeUrl: () => undefined,
    });
    const named = planPhotoIds(again.store.getState().plan);
    expect(named).toEqual([id]);
    for (let i = 0; i < 5; i++) {
      expect(named).not.toContain(again.newId("photo"));
    }
  });

  // Why: a failed database write (quota, a closing tab) used to count as
  // written, so the photo was never retried and came back missing after a
  // reload with no word; it must be retried and the page must say so.
  it("retries a photo whose write failed, and says while one is unstored", async () => {
    const { data, db } = mapDb();
    let refuse = true;
    const flaky: KeyValueStore = {
      ...db,
      put: (k, v) =>
        refuse ? Promise.reject(new Error("quota")) : db.put(k, v),
    };
    const fm = makeWith(memory().storage, flaky);
    take(fm, L1, "p1");
    await settle();
    expect(fm.failed).toHaveBeenCalledTimes(1);
    expect(fm.store.getState().photoStoreFailing).toBe(true);
    expect(data.size).toBe(0);
    // A failure's own log line or any other action is no plan change, so
    // a refusing database is not hammered in a loop.
    fm.store.dispatch(A.logged("x"));
    await settle();
    expect(fm.failed).toHaveBeenCalledTimes(1);
    refuse = false;
    take(fm, L2, "p2");
    await settle(3);
    expect([...data.keys()].sort()).toEqual([photoKey("p1"), photoKey("p2")]);
    expect(fm.store.getState().photoStoreFailing).toBe(false);
  });

  // Why: a refusing database (quota) was retried for every unstored photo
  // at every plan change, each try a full copy of a photo and an ERROR
  // line: quadratic in the photos taken. Now only a new photo retries, and
  // only the oldest unstored one; each id is reported once; once a write
  // succeeds the rest follow one after another.
  it("retries a refusing database sparingly and reports each photo once", async () => {
    const { data, db } = mapDb();
    let refuse = true;
    const tried: string[] = [];
    const quota: KeyValueStore = {
      ...db,
      put: (k, v) => {
        tried.push(k);
        return refuse
          ? Promise.reject(new DOMException("full", "QuotaExceededError"))
          : db.put(k, v);
      },
    };
    const fm = makeWith(memory().storage, quota);
    const shoot = async (id: string, shot: string) => {
      take(fm, shot, id);
      await settle(2);
    };
    await shoot("p1", L1);
    await shoot("p2", L2);
    await shoot("p3", L3);
    const k = photoKey;
    expect(tried).toEqual([k("p1"), k("p2"), k("p1"), k("p3"), k("p1")]);
    // Plan changes that name no new photo write nothing.
    fm.store.dispatch(A.planMoved(2));
    fm.store.dispatch(A.planSettingsChanged({ countdown: 5 }));
    await settle(2);
    expect(tried).toHaveLength(5);
    expect(fm.failed).toHaveBeenCalledTimes(3);
    expect(fm.store.getState().photoStoreFailing).toBe(true);

    refuse = false;
    await shoot("p4", "flat-s1/F1");
    await settle(8);
    expect([...data.keys()].sort()).toEqual(["p1", "p2", "p3", "p4"].map(k));
    expect(fm.store.getState().photoStoreFailing).toBe(false);
    expect(fm.failed).toHaveBeenCalledTimes(3);
  });

  // Why: the retry rule was described as "at most two photo copies are
  // written at once". This pins what really happens with a slow database:
  // one retry at a time, but every new photo's own write starts at once
  // beside it, so the writes in flight are the new photos not yet written
  // plus at most one retry.
  it("runs one retry at a time beside every new photo's own write", async () => {
    const { db } = mapDb();
    const pending = new Map<string, { ok: () => void; no: () => void }>();
    let most = 0;
    const trace: string[] = [];
    const slow: KeyValueStore = {
      ...db,
      put: (k) =>
        new Promise<void>((ok, no) => {
          trace.push(k);
          pending.set(k, { ok, no: () => no(new Error("quota")) });
          most = Math.max(most, pending.size);
        }),
    };
    const fm = makeWith(memory().storage, slow);
    const settleOne = async (id: string, fine: boolean) => {
      const p = pending.get(photoKey(id))!;
      pending.delete(photoKey(id));
      (fine ? p.ok : p.no)();
      await settle(2);
    };
    take(fm, L1, "p1");
    await settle();
    await settleOne("p1", false);
    take(fm, L2, "p2");
    await settle();
    // p2's own write and the retry of p1 run together.
    expect([...pending.keys()].sort()).toEqual([
      photoKey("p1"),
      photoKey("p2"),
    ]);
    take(fm, L3, "p3");
    take(fm, "flat-s1/F1", "p4");
    await settle();
    // No second retry of p1 while one is in flight; p3 and p4 start anyway.
    expect(trace).toEqual(["p1", "p2", "p1", "p3", "p4"].map(photoKey));
    expect(most).toBe(4);
    for (const id of ["p1", "p2", "p3", "p4"]) {
      await settleOne(id, true);
    }
    expect([...fm.store.getState().storedIds].sort()).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
  });

  // Why: a photo retaken while it was written is deleted again after the
  // write; when only that delete failed, the photo was still counted as
  // not stored, though no shot names it, and the page said "not stored".
  it("does not count a photo as unstored when only its cleanup delete failed", async () => {
    const { data, db } = mapDb();
    const pending: (() => void)[] = [];
    const slow: KeyValueStore = {
      ...db,
      put: (k, v) =>
        new Promise<void>((r) => {
          pending.push(() => {
            data.set(k, v);
            r();
          });
        }),
      delete: () => Promise.reject(new Error("gone")),
    };
    const fm = makeWith(memory().storage, slow);
    take(fm, L1, "p1");
    take(fm, L1, "p2");
    await settle();
    for (const release of pending.splice(0)) {
      release();
    }
    await settle(4);
    expect(fm.failed).toHaveBeenCalled();
    expect(fm.store.getState().photoStoreFailing).toBe(false);
  });

  // Why: with no database at all (none in this browser, or blocked) no
  // photo outlives a reload, so the page must say so as soon as the plan
  // holds one, as it does for a database that refuses.
  it("says photos are not stored when there is no database", () => {
    const fm = makeWith(memory().storage, null);
    expect(fm.store.getState().photoStoreFailing).toBe(false);
    take(fm, L1, "p1");
    expect(fm.store.getState().photoStoreFailing).toBe(true);
    fm.store.dispatch(A.planReset());
    expect(fm.store.getState().photoStoreFailing).toBe(false);
  });

  // Why: the orphan sweep after a reload must never delete a photo taken
  // while it waited for the database's key list.
  it("keeps a photo taken while the orphan sweep reads the keys", async () => {
    const { data, db } = mapDb({ orphan: png("o") });
    let listKeys: () => void = () => undefined;
    const slow: KeyValueStore = {
      ...db,
      keys: () =>
        new Promise<string[]>((r) => {
          listKeys = () => {
            r([...data.keys()]);
          };
        }),
    };
    const plan = memory({ [PLAN_KEY]: planText(EMPTY_PLAN) });
    const fm = makeWith(plan.storage, slow);
    const restoring = fm.restore();
    await settle();
    take(fm, L1, "p1");
    await settle();
    expect(data.has(photoKey("p1"))).toBe(true);
    listKeys();
    await restoring;
    expect([...data.keys()]).toEqual([photoKey("p1")]);
    expect(fm.sides.previews.has("p1")).toBe(true);
  });

  // Why: Download all waits for the restore by calling it again; a second
  // call must share the first one (no second sweep or read) and settle only
  // once the stored log is merged, or a zip built just after a reload
  // misses the earlier load's log.
  it("shares one restore between calls, settled once the log is back", async () => {
    const { data, db } = mapDb({ [LOG_KEY]: "[1.0s] before\n" });
    let listKeys: () => void = () => undefined;
    let lists = 0;
    const slow: KeyValueStore = {
      ...db,
      keys: () =>
        new Promise<string[]>((r) => {
          lists += 1;
          listKeys = () => {
            r([...data.keys()]);
          };
        }),
    };
    const plan = memory({ [PLAN_KEY]: planText(EMPTY_PLAN) });
    const fm = makeWith(plan.storage, slow);
    const first = fm.restore();
    await settle();
    let waited = false;
    const again = fm.restore().then(() => {
      waited = true;
    });
    await settle();
    expect(waited).toBe(false);
    listKeys();
    await Promise.all([first, again]);
    expect(lists).toBe(1);
    expect(fm.store.getState().restored).toBe(true);
    expect(fm.store.getState().log[0]).toBe("[1.0s] before");
  });
});

describe("results in storage", () => {
  const pairOf = async (db: KeyValueStore) => {
    const fm = makeWith(memory().storage, db);
    take(fm, L1, "p1");
    take(fm, L2, "p2");
    await settle(2);
    return { fm, key: `${L1L2}@p1+p2` };
  };

  // Why: only a measured outcome is kept (a result, or a failure the
  // method reported); a crash is measured again after a reload; a result
  // made stale by a retake goes from storage.
  it("writes a result and a reported failure at once, never a crash", async () => {
    const { data, db } = mapDb();
    const { fm, key } = await pairOf(db);
    fm.put(
      fm.sides.results,
      [[key, '{"m":1}\n']],
      A.resultStored({ key, text: "ok" }),
    );
    await settle(2);
    expect(data.get(resultDbKey(key))).toEqual({
      entry: { status: "done", text: "ok", persisted: true },
      matches: '{"m":1}\n',
    });
    expect(fm.sides.results.has(key)).toBe(false);
    await expect(fm.readMatches(key)).resolves.toBe('{"m":1}\n');

    fm.store.dispatch(A.resultFailed({ key, text: "crash", persisted: false }));
    await settle(2);
    expect(data.has(resultDbKey(key))).toBe(false);
    fm.store.dispatch(
      A.resultFailed({ key, text: "bad pair", persisted: true }),
    );
    await settle(2);
    expect(data.get(resultDbKey(key))).toEqual({
      entry: { status: "failed", text: "bad pair", persisted: true },
    });
    take(fm, L2, "p3");
    await settle(2);
    expect(data.has(resultDbKey(key))).toBe(false);
  });

  // Why: a reload brings back a measured result and a reported failure,
  // so the pair is not measured again; a crash was never stored.
  it("restores a persisted failure, never a crash", async () => {
    const { storage } = memory();
    const first = makeWith(storage, null);
    take(first, L1, "p1");
    take(first, L2, "p2");
    take(first, L3, "p3");
    const k2 = `${L1L2}@p1+p2`;
    const k3 = "light-s1/L1-L3@p1+p3";
    const { db } = mapDb({
      [photoKey("p1")]: png("p1"),
      [photoKey("p2")]: png("p2"),
      [photoKey("p3")]: png("p3"),
      [resultDbKey(k2)]: {
        entry: { status: "failed", text: "e", persisted: true },
      },
      [resultDbKey(k3)]: {
        entry: { status: "failed", text: "e", persisted: false },
      },
    });
    const next = makeWith(storage, db);
    await next.restore();
    expect(Object.keys(next.store.getState().results)).toEqual([k2]);
  });
});

describe("the log in storage", () => {
  // Why: the log was lost on a page close; now it is written a second
  // after a change and at once when the page hides, but only after the
  // restore, so the stored log is never overwritten before it was read.
  it("writes the log after a delay, at once on a flush, never before the restore", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { data, db } = mapDb({ [LOG_KEY]: "old\n" });
    const fm = makeWith(
      memory({ [PLAN_KEY]: planText(EMPTY_PLAN) }).storage,
      db,
    );
    fm.store.dispatch(A.logged("early"));
    fm.flushLog();
    await vi.advanceTimersByTimeAsync(LOG_DELAY_MS * 2);
    expect(data.get(LOG_KEY)).toBe("old\n");
    const restoring = fm.restore();
    await vi.advanceTimersByTimeAsync(0);
    await restoring;
    fm.store.dispatch(A.logged("later"));
    await vi.advanceTimersByTimeAsync(LOG_DELAY_MS - 10);
    expect(data.get(LOG_KEY)).toBe("old\n");
    await vi.advanceTimersByTimeAsync(20);
    expect(data.get(LOG_KEY)).toBe(`old\n${RELOAD_LINE}\nearly\nlater\n`);
    fm.store.dispatch(A.logged("last"));
    fm.flushLog();
    await vi.advanceTimersByTimeAsync(0);
    expect(data.get(LOG_KEY)).toContain("last\n");
    fm.dispose();
  });
});

describe("the tab lock", () => {
  // Why: a second tab's orphan sweep would delete the first tab's new
  // photos, and its plan writes would overwrite the first tab's plan.
  it("leaves storage alone and takes no photo when another tab holds the run", async () => {
    const { data, db } = mapDb({ orphan: png("o") });
    const plan = memory({ [PLAN_KEY]: planText(EMPTY_PLAN) });
    const fm = makeWith(plan.storage, db, () => Promise.resolve(false));
    await fm.restore();
    expect(fm.store.getState().otherTab).toBe(true);
    expect(fm.store.getState().restored).toBe(false);
    expect(take(fm, L1, "p1")).toBe(false);
    await settle(2);
    expect([...data.keys()]).toEqual(["orphan"]);
  });

  // Why: the lock is held for the page's life; a second request gets
  // none, and a browser without the API counts as the only tab.
  it("holds the lock for the page's life, and counts no API as held", async () => {
    let held = false;
    let kept: Promise<unknown> | undefined;
    const locks = {
      request: (
        name: string,
        opts: { ifAvailable: boolean },
        cb: (lock: object | null) => Promise<unknown> | undefined,
      ) => {
        expect(name).toBe(TAB_LOCK);
        expect(opts.ifAvailable).toBe(true);
        const free = !held;
        held = true;
        const back = cb(free ? {} : null);
        kept ??= back;
        return Promise.resolve(back === undefined ? undefined : "kept");
      },
    };
    await expect(holdTabLock(locks)).resolves.toBe(true);
    // The browser frees the lock once the callback's promise settles.
    let settled = false;
    expect(kept).toBeInstanceOf(Promise);
    void kept?.finally(() => {
      settled = true;
    });
    await settle(2);
    expect(settled).toBe(false);
    await expect(holdTabLock(locks)).resolves.toBe(false);
    await expect(holdTabLock(undefined)).resolves.toBe(true);
    const throwing = {
      request: () => Promise.reject(new Error("SecurityError")),
    };
    await expect(holdTabLock(throwing)).resolves.toBe(true);
  });
});
