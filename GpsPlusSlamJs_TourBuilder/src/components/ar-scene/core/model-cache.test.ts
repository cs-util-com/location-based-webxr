import { describe, expect, it } from "vitest";

import { createModelCache, type ModelCache } from "./model-cache.js";

/** A cache of plain strings + the eviction log — no THREE, no GPU. */
function makeCache(capacity: number): {
  cache: ModelCache<string>;
  evicted: string[];
} {
  const evicted: string[] = [];
  const cache = createModelCache<string>({
    capacity,
    onEvict: (key) => evicted.push(key),
  });
  return { cache, evicted };
}

/** Put a template and immediately drop the caller's reference (the IDLE path). */
function putAndRelease(cache: ModelCache<string>, key: string): void {
  cache.put(key, `parsed:${key}`);
  cache.release(key);
}

describe("hits and misses", () => {
  it("misses on an unknown key", () => {
    const { cache } = makeCache(3);
    expect(cache.acquire("a")).toBeUndefined();
  });

  it("hits after a put — the walk-back case that justifies the whole cache", () => {
    const { cache, evicted } = makeCache(3);
    putAndRelease(cache, "knight");
    expect(cache.acquire("knight")).toBe("parsed:knight");
    expect(evicted).toEqual([]);
  });
});

describe("eviction", () => {
  it("frees the least recently used entry once over capacity", () => {
    const { cache, evicted } = makeCache(2);
    putAndRelease(cache, "a");
    putAndRelease(cache, "b");
    putAndRelease(cache, "c");
    expect(evicted).toEqual(["a"]);
    expect(cache.keys()).toEqual(["b", "c"]);
  });

  it("counts a hit as a use, so the re-used entry survives", () => {
    const { cache, evicted } = makeCache(2);
    putAndRelease(cache, "a");
    putAndRelease(cache, "b");
    cache.acquire("a");
    cache.release("a");
    putAndRelease(cache, "c");
    expect(evicted).toEqual(["b"]);
  });

  it("NEVER evicts a template that is still referenced, even over capacity", () => {
    // A knight currently on screen outranks the capacity budget: freeing its
    // geometry would leave a hole in the scene. The cache exceeds `capacity`
    // for as long as that lasts, and shrinks again when the refs drop.
    const { cache, evicted } = makeCache(1);
    cache.put("onscreen", "parsed:onscreen");
    cache.put("also-onscreen", "parsed:also-onscreen");
    expect(evicted).toEqual([]);
    expect(cache.keys()).toHaveLength(2);

    cache.release("also-onscreen");
    expect(evicted).toEqual(["also-onscreen"]);
    expect(cache.keys()).toEqual(["onscreen"]);
  });

  it("evicts as soon as the last reference is dropped", () => {
    // Capacity 0 = keep nothing warm, so the drop is immediately observable.
    const { cache, evicted } = makeCache(0);
    cache.put("a", "parsed:a");
    expect(evicted).toEqual([]); // still referenced by its presenter
    cache.release("a");
    expect(evicted).toEqual(["a"]);
  });
});

describe("ref-counting (the same asset id on two waypoints)", () => {
  it("parses once and frees once", () => {
    const { cache, evicted } = makeCache(0);
    cache.put("shared", "parsed:shared"); // waypoint 1
    expect(cache.acquire("shared")).toBe("parsed:shared"); // waypoint 2
    expect(cache.refCount("shared")).toBe(2);

    cache.release("shared");
    expect(evicted).toEqual([]); // still in use by waypoint 2
    cache.release("shared");
    expect(evicted).toEqual(["shared"]);
  });

  it("frees a duplicate template if two loads raced for the same asset", () => {
    const { cache, evicted } = makeCache(3);
    cache.put("a", "first");
    cache.put("a", "second");
    expect(evicted).toEqual(["a"]); // the loser is freed immediately
    expect(cache.acquire("a")).toBe("first"); // clones already point at this one
    expect(cache.refCount("a")).toBe(3);
  });

  it("ignores a release for an unknown key", () => {
    const { cache, evicted } = makeCache(1);
    expect(() => cache.release("ghost")).not.toThrow();
    expect(evicted).toEqual([]);
  });

  it("never drops below zero references", () => {
    const { cache } = makeCache(1);
    putAndRelease(cache, "a");
    cache.release("a");
    expect(cache.refCount("a")).toBe(0);
  });
});

describe("clear (teardown)", () => {
  it("frees everything regardless of live references", () => {
    const { cache, evicted } = makeCache(3);
    cache.put("a", "parsed:a");
    putAndRelease(cache, "b");
    cache.clear();
    expect(evicted.sort()).toEqual(["a", "b"]);
    expect(cache.keys()).toEqual([]);
  });
});
