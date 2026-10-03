/**
 * The relief's height exaggeration E changes in 0.1 steps during a dive
 * (about 20 steps between 1,300 km and 20 km). On every step the library's
 * terrain plugin rebuilt the bounding volume of every node it ever made
 * (`TerrainRGBMeshPlugin._updateHeightScale`, a new EllipsoidRegion and OBB
 * per node), and the tree is never pruned: the frame-hitch recorder counted
 * 6,614 nodes at the first step and 19,926 by the last of one descent
 * (perf plan 2026-10-03-2017, H1; SwiftShader count baseline 2026-10-04).
 * At 5-14 us a node that is 30-280 ms in one frame, the likeliest source
 * of the owner's phone hitches while zooming into the relief.
 *
 * Why these tests matter: the fix refreshes at once only the volumes the
 * last update visited (the ones a raycast or the next traversal reads
 * first) and every other one just before the library next reads it. Each
 * test pins one half of that contract: no volume is ever read at a stale
 * scale, and a step costs the visited count, not the tree size. The last
 * block guards the library members the fix relies on, so an upgrade that
 * renames one fails here instead of silently restoring the hitch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import * as plugins from "3d-tiles-renderer/plugins";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { installLazyHeightScale } from "./globe-lazy-height-scale.js";

interface FakeTile {
  id: number;
  traversal: { lastFrameVisited: number };
  children: FakeTile[];
  /** The scale the last bounding-volume refresh used. */
  volumeScale: number | null;
}

/** The library's tile tree, update clock and loaded models, reduced to what the fix touches. */
function fakeTiles(nodeCount: number, branching = 4) {
  const all: FakeTile[] = [];
  for (let id = 0; id < nodeCount; id++) {
    const tile: FakeTile = {
      id,
      traversal: { lastFrameVisited: -1 },
      children: [],
      volumeScale: null,
    };
    all.push(tile);
    if (id > 0) all[Math.floor((id - 1) / branching)]!.children.push(tile);
  }
  const materials = [
    new THREE.MeshStandardMaterial(),
    new THREE.MeshStandardMaterial(),
  ];
  const scene = new THREE.Group();
  for (const m of materials) scene.add(new THREE.Mesh(undefined, m));
  /** The scale each view-error read saw, per call. */
  const reads: Array<{ tile: FakeTile; scale: number | null }> = [];
  const tiles = {
    frameCount: 0,
    root: all[0]!,
    traverse(before: (t: FakeTile) => boolean | void) {
      const stack = [all[0]!];
      while (stack.length > 0) {
        const t = stack.pop()!;
        if (before(t) === true) continue;
        stack.push(...t.children);
      }
    },
    forEachLoadedModel(cb: (scene: THREE.Object3D) => void) {
      cb(scene);
    },
    calculateTileViewError(tile: FakeTile) {
      reads.push({ tile, scale: tile.volumeScale });
    },
    /** One update that visits exactly `visit`. */
    visit(visit: FakeTile[]) {
      tiles.frameCount++;
      for (const t of visit) {
        t.traversal.lastFrameVisited = tiles.frameCount;
        tiles.calculateTileViewError(t);
      }
    },
  };
  return { tiles, all, materials, reads };
}

/** The plugin's height-scale members as the library has them (see the guard below). */
function fakePlugin(initial: number) {
  const plugin = {
    _heightScale: initial,
    refreshes: 0,
    tiles: null as unknown,
    get heightScale(): number {
      return plugin._heightScale;
    },
    set heightScale(value: number) {
      if (value !== plugin._heightScale) {
        plugin._heightScale = value;
        plugin._updateHeightScale();
      }
    },
    _updateBoundingVolume(tile: FakeTile) {
      plugin.refreshes++;
      tile.volumeScale = plugin._heightScale;
    },
    _updateHeightScale(): void {
      throw new Error("the library's whole-tree refresh must not run");
    },
  };
  return plugin;
}

function setup(nodeCount: number) {
  const fake = fakeTiles(nodeCount);
  const plugin = fakePlugin(1);
  plugin.tiles = fake.tiles;
  // Installed before any tile exists, as createGlobeTerrain does; every node
  // then gets its volume through the plugin, as when the library
  // preprocesses it.
  const lazy = installLazyHeightScale(fake.tiles, plugin);
  for (const t of fake.all) plugin._updateBoundingVolume(t);
  plugin.refreshes = 0;
  return { ...fake, plugin, lazy };
}

describe("installLazyHeightScale", () => {
  it("sets the new scale on the loaded materials at once", () => {
    const { plugin, materials } = setup(50);
    plugin.heightScale = 2.4;
    for (const m of materials) {
      expect(m.displacementScale).toBe(2.4);
      expect(m.bumpScale).toBe(2.4);
    }
  });

  it("refreshes at once only the volumes the last update visited", () => {
    const { tiles, all, plugin, lazy } = setup(20_000);
    const visited = all.slice(0, 37);
    tiles.visit(visited);
    plugin.heightScale = 1.1;
    expect(plugin.refreshes).toBe(37);
    expect(lazy.stats().lastStepRefreshes).toBe(37);
    for (const t of visited) expect(t.volumeScale).toBe(1.1);
    // The rest wait for their next read.
    expect(all[19_999]!.volumeScale).toBe(1);
  });

  it("refreshes a stale volume before the library reads its view error", () => {
    const { tiles, all, plugin, reads } = setup(500);
    tiles.visit(all.slice(0, 5));
    plugin.heightScale = 2;
    reads.length = 0;
    tiles.visit([all[400]!, all[1]!]);
    expect(reads.map((r) => r.scale)).toEqual([2, 2]);
  });

  it("refreshes each volume once per scale, however often it is read", () => {
    const { tiles, all, plugin } = setup(200);
    tiles.visit(all.slice(0, 3));
    plugin.heightScale = 1.5;
    const afterStep = plugin.refreshes;
    tiles.visit([all[150]!]);
    tiles.visit([all[150]!]);
    tiles.visit([all[150]!]);
    expect(plugin.refreshes).toBe(afterStep + 1);
  });

  it("does nothing when the scale is set to its current value", () => {
    const { tiles, all, plugin } = setup(100);
    tiles.visit(all.slice(0, 10));
    plugin.heightScale = 1;
    expect(plugin.refreshes).toBe(0);
  });

  it("never lets a read see a stale scale, and a step costs at most the visited count", () => {
    const op = fc.oneof(
      fc.record({
        kind: fc.constant("scale" as const),
        // E's range in the dive, quantised to 0.1 like the lab.
        value: fc.integer({ min: 10, max: 50 }).map((n) => n / 10),
      }),
      fc.record({
        kind: fc.constant("visit" as const),
        ids: fc.uniqueArray(fc.integer({ min: 0, max: 299 }), {
          maxLength: 40,
        }),
      }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        const { tiles, all, plugin, reads } = setup(300);
        /** Reads that saw a scale other than the current one. */
        const staleReads: number[] = [];
        /** Steps that refreshed more volumes than the last update visited. */
        const overCost: number[] = [];
        for (const o of ops) {
          if (o.kind === "visit") {
            reads.length = 0;
            tiles.visit(o.ids.map((id) => all[id]!));
            for (const r of reads) {
              if (r.scale !== plugin._heightScale) staleReads.push(r.tile.id);
            }
          } else {
            const visitedLast = all.filter(
              (t) => t.traversal.lastFrameVisited === tiles.frameCount,
            ).length;
            const before = plugin.refreshes;
            plugin.heightScale = o.value;
            const cost = plugin.refreshes - before;
            if (cost > visitedLast) overCost.push(cost - visitedLast);
          }
        }
        expect(staleReads).toEqual([]);
        expect(overCost).toEqual([]);
      }),
    );
  });

  it("refuses a plugin or renderer without the members it relies on", () => {
    const { tiles } = fakeTiles(3);
    expect(() => installLazyHeightScale(tiles, {})).toThrow(TypeError);
    expect(() =>
      installLazyHeightScale({}, fakePlugin(1) as unknown as object),
    ).toThrow(TypeError);
  });
});

describe("the library's height-scale path (a guard)", () => {
  const Terrarium = (plugins as Record<string, unknown>)[
    "TerrariumMeshPlugin"
  ] as { prototype: Record<string, unknown> };

  it("still refreshes volumes through the two members the fix replaces", () => {
    const proto = Object.getPrototypeOf(Terrarium.prototype) as Record<
      string,
      unknown
    >;
    expect(typeof proto["_updateHeightScale"]).toBe("function");
    expect(typeof proto["_updateBoundingVolume"]).toBe("function");
    // The setter calls the method through `this`, so an own override wins.
    const setter = Object.getOwnPropertyDescriptor(proto, "heightScale")?.set;
    expect(String(setter)).toMatch(/this\._updateHeightScale\(\)/);
  });

  it("still reads view errors through the renderer's own method", () => {
    // Untyped in 0.5.3's declarations, so read off the prototype as a record.
    const proto = TilesRenderer.prototype as unknown as Record<string, unknown>;
    expect(typeof proto["calculateTileViewError"]).toBe("function");
    const body = String(proto["calculateTileViewErrorWithPlugin"]);
    expect(body).toMatch(/this\.calculateTileViewError\(/);
  });

  it("still marks a visited tile with the frame of the update that visited it", () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "node_modules",
        "3d-tiles-renderer",
        "src",
        "core",
        "renderer",
        "tiles",
        "traverseFunctions.js",
      ),
      "utf8",
    );
    expect(source).toContain(
      "tile.traversal.lastFrameVisited = renderer.frameCount;",
    );
  });
});
