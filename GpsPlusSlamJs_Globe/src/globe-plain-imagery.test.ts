/**
 * Why these tests matter: an app that builds the relief without the
 * globe's whole-Earth imagery (about 13 MB of files only the globe's own
 * pages serve) needs an imagery the terrain accepts that asks for nothing.
 * These pin that the terrain takes it (the projection check, the level)
 * and that no tile ever locks or reads a texture from it.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainImagery } from "./globe-plain-imagery.js";
import { createGlobeTerrain, geographicOverlay } from "./globe-terrain.js";

describe("plainImagery", () => {
  // Why: the terrain plugin asks the imagery whether a tile has content
  // before it locks one; "never" keeps every tile on its template colour.
  it("has no content anywhere and locks nothing", async () => {
    const imagery = plainImagery();
    await expect(imagery.init()).resolves.toBeUndefined();
    expect(imagery.hasContent([0, 0, 1, 1], 0)).toBe(false);
    expect(imagery.hasContent([0.5, 0.5, 0.50001, 0.50001], 17)).toBe(false);
    await expect(imagery.lockTexture([0, 0, 1, 1], 0)).resolves.toBeNull();
    expect(() => imagery.releaseTexture([0, 0, 1, 1], 0)).not.toThrow();
    expect(() => imagery.getTexture([0, 0, 1, 1], 0)).toThrow(Error);
  });

  // Why: the terrain refuses an imagery that is not plate carree when it
  // initialises; the plain one must pass that check and answer every
  // converted range at its one level.
  it("passes the terrain's projection check", async () => {
    const wrapped = geographicOverlay(plainImagery());
    await expect(wrapped.init()).resolves.toBeUndefined();
    expect(wrapped.hasContent([0.5, 0.3, 0.50001, 0.30001], 14)).toBe(false);
  });
});

describe("createGlobeTerrain with the plain imagery", () => {
  // The plugin draws height tiles on an OffscreenCanvas; Node has none, and
  // these tests never draw one. The library resolves its tileset against
  // the page.
  beforeEach(() => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1/" } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Why: the relief initialises its imagery (the projection check) and
  // deepens its tree to the mesh level through the imagery's tiling; with
  // the plain imagery both must hold, or the map near the camera (z15 and
  // finer) is never asked for.
  it("initialises and builds a relief whose tree reaches the mesh level", async () => {
    const terrain = createGlobeTerrain({
      url: "/heights/{z}/{x}/{y}.webp",
      imagery: plainImagery(),
      template: new THREE.MeshStandardMaterial({ color: 0xbfb8a8 }),
      heightScale: 1,
      device: "desktop",
      maxZoom: 14,
      tileDimension: 512,
      meshMaxLevel: 17,
    });
    type Rooted = {
      loadRootTileset(): Promise<unknown>;
      _tiling: { maxLevel: number };
    };
    await (terrain.plugin as unknown as Rooted).loadRootTileset();
    expect((terrain.plugin as unknown as Rooted)._tiling.maxLevel).toBe(17);
    terrain.dispose();
  });
});
