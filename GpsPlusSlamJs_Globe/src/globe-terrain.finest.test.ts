/**
 * Why this test matters: a landing's ground read early (round-4 plan
 * 2026-10-11-0122 DEC-R4-1) is revised later by the relief's own height
 * there, but only from the relief's FINEST source level, the same z12 the
 * read used: the plugin's own sampler falls back to coarser levels, whose
 * heights in the Alps are hundreds of metres off, and a revision by them
 * would replan the flight for nothing and then again. `finestElevationAt`
 * reaches into the plugin's private tiling and grid cache, so the library's
 * real plugin is checked for them here: a library bump that renames them
 * fails this file instead of silently never revising.
 */

import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GLOBE_TERRAIN,
  createGlobeTerrain,
  finestElevationAt,
} from "./globe-terrain.js";

/** A stand-in plugin: grids loaded at `levels`, every sample `heightM`. */
function fakePlugin(levels: number[], heightM = 435) {
  const asked: number[][] = [];
  return {
    asked,
    plugin: {
      heightScale: 1,
      sampleCartographicElevation: () => heightM,
      _maxSourceLevel: 12,
      _tiling: {
        projection: {
          isCartographic: true,
          fromCartographicToNormalized: (lon: number, lat: number) => [
            lon / (2 * Math.PI) + 0.5,
            lat / Math.PI + 0.5,
          ],
        },
        getTileAtPoint: (nx: number, ny: number, level: number) => [
          Math.floor(nx * 2 ** level),
          Math.floor(ny * 2 ** level),
        ],
      },
      _gridCache: {
        get: (x: number, y: number, level: number): unknown => {
          asked.push([x, y, level]);
          return levels.includes(level) ? { image: {} } : undefined;
        },
      },
    },
  };
}

describe("finestElevationAt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("answers from the finest source level only", () => {
    const loaded = fakePlugin([12, 10]);
    expect(finestElevationAt(loaded.plugin, 0.82, 0.145)).toBe(435);
    expect(loaded.asked.map((a) => a[2])).toEqual([12]);
    // Only coarser levels loaded: the plugin would answer, this does not.
    expect(finestElevationAt(fakePlugin([10, 8]).plugin, 0.82, 0.145)).toBe(
      null,
    );
  });

  it("is null while the finest grid is still loading", () => {
    const p = fakePlugin([]);
    p.plugin._gridCache.get = () => Promise.resolve({});
    expect(finestElevationAt(p.plugin, 0.82, 0.145)).toBeNull();
  });

  it("is null without the plugin's private state", () => {
    const { plugin } = fakePlugin([12]);
    expect(
      finestElevationAt(
        { ...plugin, _tiling: null } as Parameters<typeof finestElevationAt>[0],
        0.82,
        0.145,
      ),
    ).toBeNull();
    expect(
      finestElevationAt(
        { heightScale: 1, sampleCartographicElevation: () => 1 },
        0.82,
        0.145,
      ),
    ).toBeNull();
  });

  // The guard against a library change: the real plugin carries the state
  // read here, its finest source level is the relief's zoom, and with
  // nothing loaded it answers null.
  it("reads the library's own plugin", () => {
    // The plugin draws height tiles on an OffscreenCanvas; Node has none,
    // and this test never draws one (as globe-terrain.test.ts).
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
    const terrain = createGlobeTerrain({
      url: "/heights/{z}/{x}/{y}.png",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    });
    const internals = terrain.plugin as unknown as {
      _maxSourceLevel: number;
      _gridCache: { get: unknown };
    };
    // Set to 2 x floor(maxZoom / 2) (12, `GLOBE_TERRAIN.maxZoom`) once the
    // plugin is initialised; a number from construction on.
    expect(typeof internals._maxSourceLevel).toBe("number");
    expect("_tiling" in internals).toBe(true);
    expect(GLOBE_TERRAIN.maxZoom % 2).toBe(0);
    expect(typeof internals._gridCache.get).toBe("function");
    expect(finestElevationAt(terrain.plugin, 0.82, 0.145)).toBeNull();
    terrain.dispose();
  });
});
