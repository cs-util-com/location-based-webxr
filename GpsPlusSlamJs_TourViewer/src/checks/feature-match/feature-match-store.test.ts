import { describe, expect, it, vi } from "vitest";

import {
  featureMatchActions as A,
  type PhotoMeta,
} from "./feature-match-slice";
import {
  createFeatureMatchStore,
  FLAT_PROGRESS_KEY,
  flatHasUnsaved,
  PROGRESS_KEY,
  type KeyValueStorage,
} from "./feature-match-store";
import { SURFACE_CLASSES } from "./flat-target";

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
