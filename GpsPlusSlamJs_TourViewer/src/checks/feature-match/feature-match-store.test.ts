import { describe, expect, it, vi } from "vitest";

import { featureMatchActions as A } from "./feature-match-slice";
import {
  createFeatureMatchStore,
  FLAT_PROGRESS_KEY,
  flatHasUnsaved,
  PLAN_KEY,
  PROGRESS_KEY,
  type KeyValueStorage,
} from "./feature-match-store";
import { SURFACE_CLASSES } from "./flat-target";
import { planPhotoIds, type PhotoMeta } from "./run-plan";

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
const frame = { width: 4, height: 3, rgba: new Uint8ClampedArray(48) };
const CLS = SURFACE_CLASSES[0].id;

describe("stored progress", () => {
  // Why: a reload or a discarded tab must continue the numbering.
  it("starts from the stored progress, and writes it when it changes", () => {
    const { data, storage } = memory({
      [PROGRESS_KEY]: JSON.stringify({ sequence: 4, pair: "2a", spot: 2 }),
    });
    const setItem = vi.spyOn(storage, "setItem");
    const { store } = make(storage);
    expect(store.getState().progress).toMatchObject({
      sequence: 4,
      pair: "2a",
      spot: 2,
    });
    // An action that changes no progress writes nothing.
    store.dispatch(A.logged("x"));
    expect(setItem).not.toHaveBeenCalled();
    store.dispatch(A.photoTaken({ which: "a", photo: photo("p1") }));
    expect(JSON.parse(data.get(PROGRESS_KEY)!)).toMatchObject({ sequence: 5 });
    expect(setItem).toHaveBeenCalledTimes(1);
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
    expect(store.getState().progress.sequence).toBe(0);
    expect(() => {
      store.dispatch(A.photoTaken({ which: "a", photo: photo("p1") }));
      store.dispatch(A.flatSurfaceAdded({ cls: CLS, original: false }));
    }).not.toThrow();
    expect(store.getState().progress.sequence).toBe(1);
  });
});

describe("side tables", () => {
  // Why: frames and URLs the state no longer names are memory leaks, and
  // a URL left alive keeps its Blob.
  it("drops frames and revokes URLs the state no longer names", () => {
    const { store, sides, revokeUrl } = make(memory().storage);
    sides.frames.set("p1", {
      name: "A",
      frame,
      source: { width: 8, height: 6 },
    });
    store.dispatch(A.photoTaken({ which: "a", photo: photo("p1") }));
    expect(sides.frames.has("p1")).toBe(true);
    sides.frames.set("p2", {
      name: "B",
      frame,
      source: { width: 8, height: 6 },
    });
    store.dispatch(A.photoTaken({ which: "b", photo: photo("p2") }));
    store.dispatch(A.runStarted("camera"));
    sides.results.set("r1", []);
    store.dispatch(A.runFinished({ text: "ok", resultsId: "r1" }));
    expect(sides.results.has("r1")).toBe(true);
    store.dispatch(A.saveStarted());
    sides.urls.set("u1", "blob:1");
    store.dispatch(A.saveFinished([{ id: "u1", file: "a.zip", text: "zip" }]));
    expect(revokeUrl).not.toHaveBeenCalled();

    sides.frames.set("p3", {
      name: "A",
      frame,
      source: { width: 8, height: 6 },
    });
    store.dispatch(A.photoTaken({ which: "a", photo: photo("p3") }));
    expect(revokeUrl).toHaveBeenCalledWith("blob:1");
    expect(sides.urls.size).toBe(0);
    expect([...sides.frames.keys()]).toEqual(["p3"]);
    expect(sides.results.size).toBe(0);
  });

  // Why: the guided view's run keeps its results under the plan run, not
  // the camera pair's id; they must live exactly as long as that take.
  it("keeps a plan run's results until a new photo of its pair", () => {
    const { store, sides } = make(memory().storage);
    for (const which of ["a", "b"] as const) {
      store.dispatch(
        A.planPhotoTaken({ slot: "1a-s1", which, photo: photo(`q${which}`) }),
      );
    }
    store.dispatch(A.runStarted("plan"));
    sides.results.set("r2", []);
    store.dispatch(A.runFinished({ text: "ok", resultsId: "r2" }));
    store.dispatch(A.planMoved(2));
    expect(sides.results.has("r2")).toBe(true);
    store.dispatch(
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("q3") }),
    );
    expect(sides.results.size).toBe(0);
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
  const saved = {
    name: "A" as const,
    frame,
    source: { width: 8, height: 6 },
  };

  // Why: a second tap while a run goes must not start a second run, and
  // the view learns that only from `accepted`.
  it("tells a taken action from a refused one", () => {
    const { accepted } = make(memory().storage);
    expect(accepted(A.runStarted("synthetic"))).toBe(true);
    expect(accepted(A.runStarted("synthetic"))).toBe(false);
  });

  // Why: an entry its action does not name must not stay behind, and an
  // offered URL of a refused save must be revoked.
  it("keeps an entry its action names and drops a refused one's", () => {
    const { put, sides, revokeUrl } = make(memory().storage);
    expect(
      put(
        sides.frames,
        [["p1", saved]],
        A.photoTaken({ which: "a", photo: photo("p1") }),
      ),
    ).toBe(true);
    expect(sides.frames.has("p1")).toBe(true);
    expect(
      put(
        sides.frames,
        [["p2", saved]],
        A.photoTaken({ which: "b", photo: { ...photo("p2"), width: 0 } }),
      ),
    ).toBe(false);
    expect(sides.frames.has("p2")).toBe(false);
    expect(
      put(
        sides.urls,
        [["u1", "blob:1"]],
        A.saveFinished([{ id: "u1", file: "a", text: "a" }]),
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
  const saved = (name: "A" | "B") => ({
    name,
    frame,
    source: { width: 8, height: 6 },
  });

  /** A key-value store over a Map, as IndexedDB's adapter offers it. */
  const mapDb = (init: Record<string, unknown> = {}) => {
    const data = new Map<string, unknown>(Object.entries(init));
    return {
      data,
      db: {
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
      },
    };
  };

  const makeWith = (
    storage: KeyValueStorage,
    photoDb: ReturnType<typeof mapDb>["db"] | null,
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
      }),
      revokeUrl,
      failed,
    };
  };

  const settle = () => new Promise((r) => setTimeout(r, 0));

  // Why: the run is an hour of photos; a reload must bring the plan back,
  // and the plan is written only when it changed.
  it("writes the plan when it changes and reads it back at start", () => {
    const { data, storage } = memory();
    const { put, sides } = makeWith(storage, null);
    put(
      sides.frames,
      [["p1", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    );
    const text = data.get(PLAN_KEY);
    expect(text).toContain('"1a-s1"');
    const again = makeWith(storage, null);
    expect(again.store.getState().plan.slots["1a-s1"]?.a?.id).toBe("p1");
    expect(again.store.getState().progress.sequence).toBe(1);
  });

  // Why: the photos of the plan's slots live in the browser's database so
  // a reload keeps them; one retaken or reset must go from there too.
  it("mirrors the plan's photos into the database and prunes them", async () => {
    const { data, db } = mapDb();
    const { put, sides, store } = makeWith(memory().storage, db);
    put(
      sides.frames,
      [["p1", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    );
    await settle();
    expect([...data.keys()]).toEqual(["p1"]);
    put(
      sides.frames,
      [["p2", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p2") }),
    );
    await settle();
    expect([...data.keys()]).toEqual(["p2"]);
    expect(sides.frames.has("p1")).toBe(false);
    store.dispatch(A.planReset());
    await settle();
    expect(data.size).toBe(0);
  });

  // Why: after a reload the photos come back from the database; one the
  // browser lost is said as missing, and an orphan from a crash goes.
  it("restores the named photos, marks lost ones and drops orphans", async () => {
    const { storage } = memory();
    const first = makeWith(storage, null);
    for (const [id, which] of [
      ["p1", "a"],
      ["p2", "b"],
    ] as const) {
      first.put(
        first.sides.frames,
        [[id, saved(which === "a" ? "A" : "B")]],
        A.planPhotoTaken({ slot: "1a-s1", which, photo: photo(id) }),
      );
    }
    const { data, db } = mapDb({ p1: saved("A"), orphan: saved("B") });
    const next = makeWith(storage, db);
    await next.restorePhotos();
    expect(next.sides.frames.get("p1")).toEqual(saved("A"));
    expect(next.store.getState().plan.slots["1a-s1"]).toMatchObject({
      a: { id: "p1" },
      b: null,
    });
    expect([...data.keys()]).toEqual(["p1"]);
  });

  // Why: with no database (blocked, private window) a reload cannot bring
  // photos back; the slots say so instead of showing photos that are gone.
  it("marks every photo lost without a database, and survives a failing one", async () => {
    const { storage } = memory();
    const first = makeWith(storage, null);
    first.put(
      first.sides.frames,
      [["p1", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    );
    const none = makeWith(storage, null);
    await none.restorePhotos();
    expect(none.store.getState().plan.slots["1a-s1"]?.a).toBeNull();

    const broken = {
      get: () => Promise.reject(new Error("gone")),
      put: () => Promise.reject(new Error("quota")),
      delete: () => Promise.reject(new Error("gone")),
      keys: () => Promise.reject(new Error("gone")),
    };
    const failing = makeWith(storage, broken);
    await failing.restorePhotos();
    expect(failing.failed).toHaveBeenCalled();
    failing.put(
      failing.sides.frames,
      [["p9", saved("A")]],
      A.planPhotoTaken({ slot: "2a-s1", which: "a", photo: photo("p9") }),
    );
    await settle();
    expect(failing.sides.frames.has("p9")).toBe(true);
  });

  // Why: a kept pair zip lives beside the state until it is downloaded
  // and dropped; its Blob must go with it, and none survives a reset.
  it("keeps a kept file's Blob while the plan names it", () => {
    const { put, sides, store } = makeWith(memory().storage, null);
    put(
      sides.frames,
      [["p1", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    );
    put(
      sides.frames,
      [["p2", saved("B")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "b", photo: photo("p2") }),
    );
    const blob = new Blob(["zip"]);
    expect(
      put(
        sides.blobs,
        [["k1", blob]],
        A.planFileKept({ id: "k1", name: "a.zip", slot: "1a-s1" }),
      ),
    ).toBe(true);
    expect(sides.blobs.get("k1")).toBe(blob);
    expect(
      put(
        sides.blobs,
        [["k2", blob]],
        A.planFileKept({ id: "k2", name: "", slot: "1a-s1" }),
      ),
    ).toBe(false);
    expect(sides.blobs.has("k2")).toBe(false);
    store.dispatch(A.planFilesDownloaded(["k1"]));
    store.dispatch(A.planKeptDropped());
    expect(sides.blobs.size).toBe(0);
  });

  // Why: the plan and its photos outlive a reload, but the side table key
  // counter did not: a new photo after a reload got a stored photo's id,
  // overwrote that slot's frame and was never written to the database.
  it("never gives a new photo the id of a photo the stored plan names", () => {
    const { storage } = memory();
    const first = createFeatureMatchStore({
      storage,
      session: "s1",
      revokeUrl: () => undefined,
    });
    const id = first.newId("photo");
    first.put(
      first.sides.frames,
      [[id, saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo(id) }),
    );
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
    const flaky = {
      ...db,
      put: (k: string, v: unknown) =>
        refuse ? Promise.reject(new Error("quota")) : db.put(k, v),
    };
    const { put, sides, store, failed } = makeWith(memory().storage, flaky);
    put(
      sides.frames,
      [["p1", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    );
    await settle();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(store.getState().photoStoreFailing).toBe(true);
    expect(data.size).toBe(0);
    // A failure's own log line or any other action is no plan change, so
    // a refusing database is not hammered in a loop.
    store.dispatch(A.logged("x"));
    await settle();
    expect(failed).toHaveBeenCalledTimes(1);
    refuse = false;
    put(
      sides.frames,
      [["p2", saved("B")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "b", photo: photo("p2") }),
    );
    await settle();
    expect([...data.keys()].sort()).toEqual(["p1", "p2"]);
    expect(store.getState().photoStoreFailing).toBe(false);
  });

  // Why: a refusing database (quota) was retried for every unstored photo
  // at every plan change, each try a full structured clone of a photo and
  // an ERROR line: quadratic in the photos taken. Now only a new photo
  // retries, and only the oldest unstored one; each id is reported once;
  // once a write succeeds the rest follow one after another.
  it("retries a refusing database sparingly and reports each photo once", async () => {
    const { data, db } = mapDb();
    let refuse = true;
    const tried: string[] = [];
    const quota = {
      ...db,
      put: (k: string, v: unknown) => {
        tried.push(k);
        return refuse
          ? Promise.reject(new DOMException("full", "QuotaExceededError"))
          : db.put(k, v);
      },
    };
    const { put, sides, store, failed } = makeWith(memory().storage, quota);
    const take = async (id: string, slot: string) => {
      put(
        sides.frames,
        [[id, saved("A")]],
        A.planPhotoTaken({ slot, which: "a", photo: photo(id) }),
      );
      await settle();
    };
    await take("p1", "1a-s1");
    await take("p2", "1b-s1");
    await take("p3", "1c-s1");
    expect(tried).toEqual(["p1", "p2", "p1", "p3", "p1"]);
    // Plan changes that name no new photo write nothing.
    store.dispatch(A.planMoved(2));
    store.dispatch(A.planSettingsChanged({ countdown: 5 }));
    await settle();
    expect(tried).toHaveLength(5);
    expect(failed).toHaveBeenCalledTimes(3);
    expect(store.getState().photoStoreFailing).toBe(true);

    refuse = false;
    await take("p4", "2a-s1");
    for (let i = 0; i < 8; i++) {
      await settle();
    }
    expect([...data.keys()].sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(store.getState().photoStoreFailing).toBe(false);
    expect(failed).toHaveBeenCalledTimes(3);
  });

  // Why: a photo retaken while it was written is deleted again after the
  // write; when only that delete failed, the photo was still counted as
  // not stored, though no slot names it, and the page said "not stored".
  it("does not count a photo as unstored when only its cleanup delete failed", async () => {
    const { data, db } = mapDb();
    const pending: (() => void)[] = [];
    const slow = {
      ...db,
      put: (k: string, v: unknown) =>
        new Promise<void>((r) => {
          pending.push(() => {
            data.set(k, v);
            r();
          });
        }),
      delete: () => Promise.reject(new Error("gone")),
    };
    const { put, sides, store, failed } = makeWith(memory().storage, slow);
    for (const id of ["p1", "p2"]) {
      put(
        sides.frames,
        [[id, saved("A")]],
        A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo(id) }),
      );
    }
    for (const release of pending.splice(0)) {
      release();
    }
    for (let i = 0; i < 4; i++) {
      await settle();
    }
    expect(failed).toHaveBeenCalled();
    expect(store.getState().photoStoreFailing).toBe(false);
  });

  // Why: with no database at all (none in this browser, or blocked) no
  // photo outlives a reload, so the page must say so as soon as the plan
  // holds one, as it does for a database that refuses.
  it("says photos are not stored when there is no database", () => {
    const { put, sides, store } = makeWith(memory().storage, null);
    expect(store.getState().photoStoreFailing).toBe(false);
    put(
      sides.frames,
      [["p1", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    );
    expect(store.getState().photoStoreFailing).toBe(true);
    store.dispatch(A.planReset());
    expect(store.getState().photoStoreFailing).toBe(false);
  });

  // Why: the orphan sweep after a reload must never delete a photo taken
  // while it waited for the database's key list.
  it("keeps a photo taken while the orphan sweep reads the keys", async () => {
    const { data, db } = mapDb({ orphan: saved("B") });
    let listKeys: () => void = () => undefined;
    const slow = {
      ...db,
      keys: () =>
        new Promise<string[]>((r) => {
          listKeys = () => {
            r([...data.keys()]);
          };
        }),
    };
    const { put, sides, restorePhotos } = makeWith(memory().storage, slow);
    const restoring = restorePhotos();
    put(
      sides.frames,
      [["p1", saved("A")]],
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    );
    await settle();
    expect(data.has("p1")).toBe(true);
    listKeys();
    await restoring;
    expect([...data.keys()]).toEqual(["p1"]);
    expect(sides.frames.has("p1")).toBe(true);
  });
});
