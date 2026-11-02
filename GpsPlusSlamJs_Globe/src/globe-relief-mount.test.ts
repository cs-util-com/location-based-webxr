/**
 * Why these tests matter: the relief's mount is the one place the globe
 * lab and the Tour Viewer's editor take the band from, so its order and
 * its rules are the contract both pages draw by. The lab's own smokes and
 * e2e prove the lab looks as before; these pin each rule the lab had
 * inline: the share written to the surface each frame, the cross-fade
 * across the band's edges, the stencil roles and the draw order, who is
 * drawn and updated (never a frozen carrier), the globe's coarse error
 * target while it only fills, the cloud shell's share, and the drain of a
 * carrier out of the band keeping its coarsest tiles.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GLOBE_FLIGHT, carrierShareAt } from "./globe-flight.js";
import { GLOBE_STENCIL } from "./globe-stencil-fill.js";
import {
  GLOBE_RELIEF_BAND,
  mountGlobeRelief,
  type GlobeReliefTiles,
} from "./globe-relief-mount.js";

/** A tile with its depth, and whether the last update used it. */
interface FakeTile {
  internal: { depth: number; loadingState: number };
  traversal: { used: boolean; lastFrameVisited: number; inFrustum: boolean };
}

/** A tile set whose one top-level tile is loaded and in view, its cache
 *  holding `tiles` (each 100 bytes). */
function fakeTiles(tiles: FakeTile[] = []) {
  const listeners = new Map<string, Set<(event: never) => void>>();
  const items = [...tiles];
  const set = {
    root: {
      children: [
        {
          traversal: { lastFrameVisited: 1, inFrustum: true },
          internal: { loadingState: 4 },
        },
      ],
    },
    frameCount: 1,
    group: new THREE.Group(),
    errorTarget: 2,
    loadProgress: 1,
    downloadQueue: { running: false },
    parseQueue: { running: false },
    processNodeQueue: { running: false },
    lruCache: {
      get cachedBytes() {
        return items.length * 100;
      },
      minSize: 0,
      maxSize: 0,
      minBytesSize: 0,
      maxBytesSize: 0,
      markAllUnused() {},
      unloadUnusedContent() {},
      itemList: items,
      remove(item: unknown) {
        const i = items.indexOf(item as FakeTile);
        if (i < 0) return false;
        items.splice(i, 1);
        return true;
      },
    },
    addEventListener(type: string, listener: (event: never) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: (event: never) => void) {
      listeners.get(type)?.delete(listener);
    },
    /** A model loaded: its meshes, as the library dispatches it. */
    load(model: THREE.Object3D) {
      for (const l of listeners.get("load-model") ?? []) {
        (l as (event: { scene: THREE.Object3D }) => void)({ scene: model });
      }
    },
  };
  return set satisfies GlobeReliefTiles & { load(m: THREE.Object3D): void };
}

function tile(depth: number, used = false): FakeTile {
  return {
    internal: { depth, loadingState: 4 },
    traversal: { used, lastFrameVisited: 1, inFrustum: true },
  };
}

function mounted(fill: boolean, reliefTiles: FakeTile[] = []) {
  const updates: string[] = [];
  const clouds: [number, number | undefined][] = [];
  const globeTiles = fakeTiles();
  const reliefSet = fakeTiles(reliefTiles);
  const globe = {
    tiles: globeTiles,
    surfaceUniforms: { uCarrierShare: { value: 0 } },
    update: () => updates.push("globe"),
    setCloudShellShare: (share: number, flat?: number) =>
      clouds.push([share, flat]),
  };
  const mount = mountGlobeRelief({ globe, relief: { tiles: reliefSet }, fill });
  const draw = (extra: Partial<Parameters<typeof mount.draw>[0]> = {}) => {
    mount.draw({
      camera: new THREE.PerspectiveCamera(),
      renderer: {} as THREE.WebGLRenderer,
      updateRelief: () => updates.push("relief"),
      ...extra,
    });
  };
  return { mount, globe, globeTiles, reliefSet, updates, clouds, draw };
}

describe("mountGlobeRelief", () => {
  // Why: the renderer's typings leave out its frame count, which the band
  // reads to know which tiles the last update visited; a renderer without
  // one would leave the band on the globe for ever, silently. The mount
  // refuses it at once, naming what is missing.
  it("refuses a carrier whose tiles have no frame count", () => {
    const { globe, reliefSet } = mounted(true);
    const uncounted = { ...reliefSet, frameCount: undefined };
    expect(() =>
      mountGlobeRelief({ globe, relief: { tiles: uncounted }, fill: true }),
    ).toThrow(/frameCount/);
    const globeUncounted = {
      ...globe,
      tiles: { ...globe.tiles, frameCount: undefined },
    };
    expect(() =>
      mountGlobeRelief({
        globe: globeUncounted,
        relief: { tiles: reliefSet },
        fill: true,
      }),
    ).toThrow(TypeError);
    // Its cache's byte count and item list too: the release drains by them.
    const uncached = {
      ...reliefSet,
      lruCache: { ...reliefSet.lruCache, itemList: undefined },
    };
    expect(() =>
      mountGlobeRelief({ globe, relief: { tiles: uncached }, fill: true }),
    ).toThrow(/itemList/);
  });

  // Why: the relief's tiles keep only the pixels under the carrier share,
  // so the share must reach the surface every frame: at the default 0 the
  // relief draws nothing. Swept over heights above, across and under the
  // band (ungated, the share is the altitude's exactly).
  it.each([
    6_000_000, 2_500_000, 2_000_000, 1_600_000, 1_200_000, 500_000, 80_000,
    10_000, 0,
  ])("gives the surface the altitude's share at %s m", (altitudeM) => {
    const { mount, globe } = mounted(true);
    const share = mount.step(0, { altitudeM, gate: false });
    const want = carrierShareAt(altitudeM, {
      highM: GLOBE_FLIGHT.bandHighM,
      lowM: GLOBE_FLIGHT.bandLowM,
    });
    expect(share).toBe(want);
    expect(globe.surfaceUniforms.uCarrierShare.value).toBe(want);
    expect(mount.share()).toBe(want);
    expect(mount.target()).toBe(want);
  });

  // Why: above the band the globe alone, under it the relief alone, a
  // cross-fade between: the band's edges as the lab sets them.
  it("hands over across the band's edges, the lab's by default", () => {
    expect(GLOBE_RELIEF_BAND.highM).toBe(2_000_000);
    expect(GLOBE_RELIEF_BAND.lowM).toBe(1_200_000);
    const { mount } = mounted(true);
    expect(mount.step(0, { altitudeM: 2_000_001, gate: false })).toBe(0);
    const mid = mount.step(0, { altitudeM: 1_600_000, gate: false });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(mount.step(0, { altitudeM: 1_200_000, gate: false })).toBe(1);
    // A band of the page's own; the bottom kept under the top.
    expect(
      mount.step(0, {
        altitudeM: 50_000,
        highM: 40_000,
        lowM: 60_000,
        gate: false,
      }),
    ).toBe(0);
  });

  // Why: gated, the first frame starts on the globe (it draws from orbit)
  // and the share moves toward the target only as the carriers allow; the
  // relief is never handed every pixel at once.
  it("starts a gated band on the globe and moves toward the relief", () => {
    const { mount } = mounted(true);
    expect(mount.share()).toBe(1);
    expect(mount.step(0, { altitudeM: 10_000 })).toBe(0);
    expect(mount.target()).toBe(1);
    const later = mount.step(100, { altitudeM: 10_000 });
    expect(later).toBeGreaterThan(0);
  });

  // Why: the stencil fill needs the relief drawn first, writing its mark,
  // and the globe drawing only where none is; without the fill neither is
  // touched. Dispose takes the listeners off.
  it("gives each carrier its stencil role with the fill, none without", () => {
    const material = () => new THREE.MeshStandardMaterial();
    const model = (m: THREE.Material) => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
      return group;
    };
    const withFill = mounted(true);
    expect(withFill.reliefSet.group.renderOrder).toBe(-1);
    const reliefMaterial = material();
    const globeMaterial = material();
    withFill.reliefSet.load(model(reliefMaterial));
    withFill.globeTiles.load(model(globeMaterial));
    expect(reliefMaterial.stencilWrite).toBe(true);
    expect(reliefMaterial.stencilFunc).toBe(THREE.AlwaysStencilFunc);
    expect(reliefMaterial.stencilZPass).toBe(THREE.ReplaceStencilOp);
    expect(reliefMaterial.stencilRef).toBe(GLOBE_STENCIL.ref);
    expect(globeMaterial.stencilFunc).toBe(THREE.NotEqualStencilFunc);
    withFill.mount.dispose();
    const after = material();
    withFill.reliefSet.load(model(after));
    expect(after.stencilWrite).toBe(false);

    const without = mounted(false);
    expect(without.reliefSet.group.renderOrder).toBe(0);
    const untouched = material();
    without.reliefSet.load(model(untouched));
    expect(untouched.stencilWrite).toBe(false);
  });

  // Why: each carrier is drawn and updated (so fetched) only where it has
  // pixels or the altitude wants it; with the fill the globe always draws
  // and updates, coarse while the relief has every pixel, at its own
  // target otherwise. Swept over the globe alone, the cross-fade and the
  // relief alone, with and without the fill.
  it.each([
    [
      true,
      6_000_000,
      {
        globeShown: true,
        reliefShown: false,
        updates: ["globe"],
        errorTarget: 2,
      },
    ],
    [
      true,
      1_600_000,
      {
        globeShown: true,
        reliefShown: true,
        updates: ["globe", "relief"],
        errorTarget: 2,
      },
    ],
    [
      true,
      10_000,
      {
        globeShown: true,
        reliefShown: true,
        updates: ["globe", "relief"],
        errorTarget: 1e6,
      },
    ],
    [
      false,
      6_000_000,
      {
        globeShown: true,
        reliefShown: false,
        updates: ["globe"],
        errorTarget: 2,
      },
    ],
    [
      false,
      1_600_000,
      {
        globeShown: true,
        reliefShown: true,
        updates: ["globe", "relief"],
        errorTarget: 2,
      },
    ],
    [
      false,
      10_000,
      {
        globeShown: false,
        reliefShown: true,
        updates: ["relief"],
        errorTarget: 2,
      },
    ],
  ] as const)(
    "draws and updates the carriers (fill %s) at %s m",
    (fill, altitudeM, want) => {
      const { mount, draw, globeTiles, reliefSet, updates } = mounted(fill);
      mount.step(0, { altitudeM, gate: false });
      draw();
      expect(globeTiles.group.visible).toBe(want.globeShown);
      expect(reliefSet.group.visible).toBe(want.reliefShown);
      expect(updates).toEqual(want.updates);
      expect(globeTiles.errorTarget).toBe(want.errorTarget);
    },
  );

  // Why: a page's own error targets (the lab's panel) win over the mount's;
  // a frozen frame updates neither carrier; a hidden relief keeps its share.
  it("takes the page's error targets, holds a frozen frame, hides the relief on request", () => {
    const { mount, draw, globeTiles, reliefSet, updates } = mounted(true);
    mount.step(0, { altitudeM: 10_000, gate: false });
    draw({ fillErrorTarget: 5e5 });
    expect(globeTiles.errorTarget).toBe(5e5);
    mount.step(0, { altitudeM: 1_600_000, gate: false });
    draw({ errorTarget: 7 });
    expect(globeTiles.errorTarget).toBe(7);
    updates.length = 0;
    mount.step(0, { altitudeM: 1_600_000, gate: false, frozen: true });
    draw({ reliefHidden: true });
    expect(updates).toEqual([]);
    expect(reliefSet.group.visible).toBe(false);
    expect(mount.share()).toBeGreaterThan(0);
  });

  // Why: the clouds move onto the shell as the relief takes the pixels, so
  // the orbit keeps the painted look and the relief gets the shell; the
  // flat layer's share goes with it.
  it("gives the cloud shell the relief's share, or none when off", () => {
    const { mount, clouds } = mounted(true);
    mount.step(0, { altitudeM: 1_600_000, gate: false });
    const share = mount.share();
    expect(mount.shareClouds(true, 0.4)).toBe(share);
    expect(mount.shareClouds(false, 1)).toBe(0);
    expect(clouds).toEqual([
      [share, 0.4],
      [0, 1],
    ]);
  });

  // Why: a carrier out of the band is unloaded, not only left undrawn, but
  // only after the wait (a zoom wobbling over an edge never reloads), and
  // its coarsest tiles stay so it can draw again at once.
  it("drains a relief out of the band after the wait, keeping its coarsest tiles", () => {
    const tiles = [tile(0), tile(1), tile(3), tile(5), tile(6)];
    const { mount, reliefSet } = mounted(true, tiles);
    mount.step(0, { altitudeM: 6_000_000, gate: false, releaseMs: 1000 });
    expect(reliefSet.lruCache.itemList).toHaveLength(5);
    expect(mount.release.settled()).toBe(false);
    mount.step(1000, { altitudeM: 6_000_000, gate: false, releaseMs: 1000 });
    expect(reliefSet.lruCache.itemList.map((t) => t.internal.depth)).toEqual([
      0, 1,
    ]);
    expect(mount.release.released.relief).toBe(300);
    expect(mount.release.settled()).toBe(true);
  });

  // Why: a camera whose altitude is not a number (a degenerate pose in a
  // flight) used to reach the band, which throws on it, and a page's frame
  // loop stopped for good on the throw. Such a frame leaves the band and
  // the release as they were and keeps the share.
  it.each([Number.NaN, Infinity, -Infinity])(
    "keeps the band and the release on an altitude of %s",
    (altitudeM) => {
      const tiles = [tile(0), tile(3), tile(5)];
      const { mount, globe, reliefSet } = mounted(true, tiles);
      mount.step(0, { altitudeM: 6_000_000, gate: false, releaseMs: 1000 });
      const share = mount.share();
      const target = mount.target();
      expect(() =>
        mount.step(1000, { altitudeM, gate: false, releaseMs: 1000 }),
      ).not.toThrow();
      expect(
        mount.step(1000, { altitudeM, gate: false, releaseMs: 1000 }),
      ).toBe(share);
      expect(mount.target()).toBe(target);
      expect(globe.surfaceUniforms.uCarrierShare.value).toBe(share);
      // No drain on the bad frame: the release's clock did not run.
      expect(reliefSet.lruCache.itemList).toHaveLength(3);
    },
  );

  // Why: the gate's "refined" is the relief's own loading and queues.
  it("reads the relief settled only with nothing loading or queued", () => {
    const { mount, reliefSet } = mounted(true);
    expect(mount.reliefSettled()).toBe(true);
    reliefSet.downloadQueue.running = true;
    expect(mount.reliefSettled()).toBe(false);
  });
});
