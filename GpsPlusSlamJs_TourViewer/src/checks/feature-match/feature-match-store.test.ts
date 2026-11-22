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
    const { store } = make(storage);
    expect(store.getState().progress).toMatchObject({
      sequence: 4,
      pair: "2a",
      spot: 2,
    });
    store.dispatch(A.logged("x"));
    expect(data.get(PROGRESS_KEY)).toBe(
      JSON.stringify({ sequence: 4, pair: "2a", spot: 2 }),
    );
    store.dispatch(A.photoTaken({ which: "a", photo: photo("p1") }));
    expect(JSON.parse(data.get(PROGRESS_KEY)!)).toMatchObject({ sequence: 5 });
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
