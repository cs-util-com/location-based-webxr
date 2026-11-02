/**
 * Why these tests matter: "Keep as typed" is remembered in the browser,
 * not in the tour, so the store must survive a reload, keep texts apart,
 * and never break the editor when storage is missing, full or holds
 * something unexpected.
 */
import { describe, expect, it } from "vitest";

import {
  createKeptStore,
  KEPT_PER_TEXT_MAX,
  KEPT_STORAGE_KEY,
  type KeptStorage,
} from "./kept-store.js";

function memory(initial?: string): KeptStorage & { value: string | null } {
  const s = {
    value: initial ?? null,
    getItem: (k: string) => (k === KEPT_STORAGE_KEY ? s.value : null),
    setItem: (_k: string, v: string) => {
      s.value = v;
    },
  };
  return s;
}

describe("createKeptStore", () => {
  it("keeps and forgets parts per text, across a reload", () => {
    const storage = memory();
    const store = createKeptStore(storage);
    store.set("a", "icode:`x`", true);
    store.set("b", "rule:---", true);
    expect([...createKeptStore(storage).get("a")]).toEqual(["icode:`x`"]);
    store.set("a", "icode:`x`", false);
    expect(createKeptStore(storage).get("a").size).toBe(0);
    expect([...createKeptStore(storage).get("b")]).toEqual(["rule:---"]);
  });

  it("returns a copy the caller cannot change the store through", () => {
    const store = createKeptStore(memory());
    store.set("a", "k", true);
    (store.get("a") as Set<string>).add("other");
    expect([...store.get("a")]).toEqual(["k"]);
  });

  it("ignores stored data of the wrong shape", () => {
    for (const raw of ["not json", "[1]", "null", '{"a":"x","b":[1,"k"]}']) {
      const store = createKeptStore(memory(raw));
      expect(store.get("a").size).toBe(0);
      expect([...store.get("b")]).toEqual(raw.includes('"k"') ? ["k"] : []);
    }
  });

  it("works in memory when storage throws or is missing", () => {
    const throwing: KeptStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    for (const storage of [throwing, null]) {
      const store = createKeptStore(storage);
      store.set("a", "k", true);
      expect(store.get("a").has("k")).toBe(true);
    }
  });

  it("holds at most the newest keys of one text", () => {
    const store = createKeptStore(memory());
    for (let i = 0; i <= KEPT_PER_TEXT_MAX; i++) store.set("a", `k${i}`, true);
    const kept = store.get("a");
    expect(kept.size).toBe(KEPT_PER_TEXT_MAX);
    expect(kept.has("k0")).toBe(false);
  });
});
