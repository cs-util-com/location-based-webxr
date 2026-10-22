/**
 * Keeping the relief's decoded heights past their tiles (owner decision
 * 2026-10-04, DEC-N1 in 2026-10-04-2023-globe-next-steps-and-framework-
 * release-plan.md).
 *
 * Why this test matters: the owner zoomed out and back in and saw the
 * elevation load again. Leaving the band drains the relief's tiles, and the
 * library frees a decoded height grid as soon as its last tile is gone, so
 * a return fetched and decoded every height tile anew. The keeper holds one
 * extra lock on each released grid, newest first, within a byte budget, so
 * a return finds the grid in the library's own cache. These tests pin the
 * locks it takes and gives back (a leak would hold memory forever; a missed
 * lock would change nothing) and the library members it relies on.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { installHeightKeeper, librarySourceOf } from "./globe-height-keeper.js";

const SOURCE = Symbol("source tile");

/** The library's grid cache and plugin, reduced to what the keeper touches. */
function fakePlugin(gridBytes = 1000) {
  const counts = new Map<string, number>();
  const key = (...k: number[]) => k.join("/");
  let fetches = 0;
  const gridCache = {
    lock(...k: number[]) {
      const kk = key(...k);
      if (!counts.has(kk)) fetches++;
      counts.set(kk, (counts.get(kk) ?? 0) + 1);
      return { image: { data: new Float32Array(gridBytes / 4) } };
    },
    release(...k: number[]) {
      const kk = key(...k);
      const n = (counts.get(kk) ?? 0) - 1;
      if (n < 0) throw new Error(`released ${kk} below zero`);
      if (n === 0) counts.delete(kk);
      else counts.set(kk, n);
    },
    get(...k: number[]) {
      return counts.has(key(...k))
        ? { image: { data: new Float32Array(gridBytes / 4) } }
        : null;
    },
  };
  const plugin = {
    _gridCache: gridCache,
    /** A tile loads: the library locks its source grid. */
    load(tile: Record<symbol, unknown>, ...k: number[]) {
      gridCache.lock(...k);
      tile[SOURCE] = k;
    },
    _releaseGrid(tile: Record<symbol, unknown>) {
      const k = tile[SOURCE] as number[] | undefined;
      if (k) {
        gridCache.release(...k);
        delete tile[SOURCE];
      }
    },
  };
  return {
    plugin,
    counts,
    fetches: () => fetches,
    sourceOf: (tile: object) =>
      (tile as Record<symbol, unknown>)[SOURCE] as number[] | undefined,
  };
}

describe("installHeightKeeper", () => {
  it("keeps a released grid alive, so the tile's return fetches nothing", () => {
    const f = fakePlugin();
    installHeightKeeper(f.plugin, { maxBytes: 10_000, sourceOf: f.sourceOf });
    const tile = {};
    f.plugin.load(tile, 1, 2, 8);
    f.plugin._releaseGrid(tile);
    // The library's lock is gone; the keeper's holds the grid.
    expect(f.counts.get("1/2/8")).toBe(1);
    f.plugin.load(tile, 1, 2, 8);
    expect(f.fetches()).toBe(1);
  });

  it("keeps each grid once, however many of its tiles are released", () => {
    const f = fakePlugin();
    const keeper = installHeightKeeper(f.plugin, {
      maxBytes: 10_000,
      sourceOf: f.sourceOf,
    });
    const a = {};
    const b = {};
    f.plugin.load(a, 1, 2, 8);
    f.plugin.load(b, 1, 2, 8);
    f.plugin._releaseGrid(a);
    f.plugin._releaseGrid(b);
    expect(f.counts.get("1/2/8")).toBe(1);
    expect(keeper.stats()).toMatchObject({ kept: 1, keptBytes: 1000 });
  });

  it("gives back the oldest kept grids beyond the budget", () => {
    const f = fakePlugin(1000);
    const keeper = installHeightKeeper(f.plugin, {
      maxBytes: 2500,
      sourceOf: f.sourceOf,
    });
    for (let i = 0; i < 5; i++) {
      const t = {};
      f.plugin.load(t, i, 0, 8);
      f.plugin._releaseGrid(t);
    }
    expect([...f.counts.keys()].sort()).toEqual(["3/0/8", "4/0/8"]);
    expect(keeper.stats()).toMatchObject({
      kept: 2,
      keptBytes: 2000,
      evicted: 3,
    });
  });

  it("refreshes a grid's place when it is used and released again", () => {
    const f = fakePlugin(1000);
    installHeightKeeper(f.plugin, { maxBytes: 2500, sourceOf: f.sourceOf });
    const t = {};
    f.plugin.load(t, 0, 0, 8);
    f.plugin._releaseGrid(t);
    f.plugin.load(t, 1, 0, 8);
    f.plugin._releaseGrid(t);
    // 0/0/8 comes back and is released again: it is now the newest.
    f.plugin.load(t, 0, 0, 8);
    f.plugin._releaseGrid(t);
    f.plugin.load(t, 2, 0, 8);
    f.plugin._releaseGrid(t);
    expect([...f.counts.keys()].sort()).toEqual(["0/0/8", "2/0/8"]);
  });

  it("keeps nothing with a zero budget, and gives every grid back on dispose", () => {
    const f = fakePlugin();
    installHeightKeeper(f.plugin, { maxBytes: 0, sourceOf: f.sourceOf });
    const t = {};
    f.plugin.load(t, 1, 1, 8);
    f.plugin._releaseGrid(t);
    expect(f.counts.size).toBe(0);
    const g = fakePlugin();
    const keeper = installHeightKeeper(g.plugin, {
      maxBytes: 10_000,
      sourceOf: g.sourceOf,
    });
    const u = {};
    g.plugin.load(u, 1, 1, 8);
    g.plugin._releaseGrid(u);
    keeper.dispose();
    expect(g.counts.size).toBe(0);
  });

  it("refuses a plugin without the members it relies on, and a bad budget", () => {
    const f = fakePlugin();
    expect(() =>
      installHeightKeeper({}, { maxBytes: 1, sourceOf: f.sourceOf }),
    ).toThrow(TypeError);
    for (const maxBytes of [-1, Number.NaN, Infinity]) {
      expect(() =>
        installHeightKeeper(f.plugin, { maxBytes, sourceOf: f.sourceOf }),
      ).toThrow(RangeError);
    }
  });
});

describe("librarySourceOf", () => {
  it("reads the key under the library's SOURCE_TILE symbol, and nothing else", () => {
    const tile = { [Symbol("SOURCE_TILE")]: [3, 4, 9], [Symbol("OTHER")]: [1] };
    expect(librarySourceOf(tile)).toEqual([3, 4, 9]);
    expect(librarySourceOf({ [Symbol("OTHER")]: [1] })).toBeUndefined();
    expect(librarySourceOf({ [Symbol("SOURCE_TILE")]: "x" })).toBeUndefined();
  });
});

describe("the library's grid locks (a guard)", () => {
  it("still locks a tile's source grid and releases it through _releaseGrid", () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "node_modules",
        "3d-tiles-renderer",
        "src",
        "three",
        "plugins",
        "images",
        "terrain-rgb",
        "TerrainRGBMeshPlugin.js",
      ),
      "utf8",
    );
    expect(source).toContain("const SOURCE_TILE = Symbol( 'SOURCE_TILE' );");
    expect(source).toContain(
      "grid = await this._gridCache.lock( sx, sy, sourceLevel );",
    );
    expect(source).toContain("tile[ SOURCE_TILE ] = [ sx, sy, sourceLevel ];");
    expect(source).toContain("this._gridCache.release( ...sourceTile );");
    expect(source).toMatch(
      /disposeTile\( tile \) \{[\s\S]*?this\._releaseGrid\( tile \);/,
    );
  });
});
