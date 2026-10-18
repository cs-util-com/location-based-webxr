/**
 * Why these tests matter: the OSM raster tiles are someone else's servers
 * under a usage policy (no heavy use, no bulk downloading), and the G0
 * spikes (2026-10-17, Q5) measured how fast a naive overlay asks them:
 * every relief tile in view, at every level, while flying. The 3D editor
 * may draw them only near the camera (z15 and finer, within the fade
 * distance), only when the camera is low and slow, at most about 150 a
 * minute, and must credit them. These tests pin each rule on its own and
 * through the library's overlay class and a fake of its plugin, so a
 * green run means a request the rules forbid is never made, not that a
 * request happened to be cheap.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { XYZTilesOverlay } from "3d-tiles-renderer/plugins";
import { describe, expect, it, vi } from "vitest";

import {
  GLOBE_OSM,
  GatedOsmOverlay,
  createRequestCeiling,
  osmCredit,
  osmOverlayActive,
  patchOsmFade,
  reevaluateGatedTiles,
  regionNearCamera,
} from "./globe-osm-overlay.js";

const DEG = Math.PI / 180;
/** A tile template of a fake server (never the real host in a test). */
const TEMPLATE = "https://tiles.example.test/{z}/{x}/{y}.png";
/** The framework's attribution text, as `osm-tiles.ts` writes it. */
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

describe("GLOBE_OSM", () => {
  // Why: the numbers the 3D editor plan (§13) sets; a change is a decision.
  it("holds the plan's limits", () => {
    expect(GLOBE_OSM).toMatchObject({
      fadeM: 300,
      minZoom: 15,
      requestsPerMinute: 150,
      maxAboveGroundM: 200,
      maxSpeedMps: 50,
    });
  });
});

describe("osmCredit", () => {
  // Why: the OSM tile usage policy asks for a LINK to the copyright page;
  // the globe's credits line renders text and a link, never markup.
  it("turns the framework's attribution into text and its link", () => {
    expect(osmCredit(ATTRIBUTION)).toEqual({
      short: "OpenStreetMap",
      full: "© OpenStreetMap contributors",
      href: "https://www.openstreetmap.org/copyright",
    });
  });

  it("refuses an attribution without an https link", () => {
    expect(() => osmCredit("OpenStreetMap contributors")).toThrow(RangeError);
    expect(() =>
      osmCredit('<a href="http://example.test">OpenStreetMap</a>'),
    ).toThrow(RangeError);
    expect(() => osmCredit(42 as unknown as string)).toThrow(RangeError);
  });
});

describe("osmOverlayActive", () => {
  it("is on low and slow, off above 200 m or faster than 50 m/s", () => {
    expect(osmOverlayActive({ aboveGroundM: 1.7, speedMps: 1.5 })).toBe(true);
    expect(osmOverlayActive({ aboveGroundM: 200, speedMps: 50 })).toBe(true);
    expect(osmOverlayActive({ aboveGroundM: 200.1, speedMps: 0 })).toBe(false);
    expect(osmOverlayActive({ aboveGroundM: 10, speedMps: 50.1 })).toBe(false);
  });

  // Why: an unknown height (no ground loaded) or speed must not open the
  // gate: the default is no requests.
  it("is off for an unknown height or speed", () => {
    expect(osmOverlayActive({ aboveGroundM: Number.NaN, speedMps: 0 })).toBe(
      false,
    );
    expect(osmOverlayActive({ aboveGroundM: 1, speedMps: Number.NaN })).toBe(
      false,
    );
    expect(
      osmOverlayActive({
        aboveGroundM: null as unknown as number,
        speedMps: 0,
      }),
    ).toBe(false);
  });
});

describe("createRequestCeiling", () => {
  // Why: the ceiling is a sliding minute, not a fixed bucket: 150 at the
  // end of one minute and 150 at the start of the next would be 300 in a
  // minute.
  it("allows the ceiling within any minute and waits for the oldest to age out", () => {
    let t = 0;
    const ceiling = createRequestCeiling(3, () => t);
    expect(ceiling.waitMs()).toBe(0);
    ceiling.take();
    t = 10_000;
    ceiling.take();
    ceiling.take();
    expect(ceiling.inLastMinute()).toBe(3);
    t = 30_000;
    expect(ceiling.waitMs()).toBe(30_000);
    t = 60_000;
    expect(ceiling.waitMs()).toBe(0);
    expect(ceiling.inLastMinute()).toBe(2);
    expect(ceiling.total()).toBe(3);
  });

  it("refuses a ceiling that is not a positive integer", () => {
    for (const n of [0, -1, 1.5, Number.NaN]) {
      expect(() => createRequestCeiling(n)).toThrow(RangeError);
    }
  });
});

/** A camera `aboveM` over the ellipsoid at a place (tiles frame). */
const cameraAt = (lat: number, lon: number, aboveM: number) =>
  WGS84_ELLIPSOID.getCartographicToPosition(
    lat * DEG,
    lon * DEG,
    aboveM,
    new THREE.Vector3(),
  );

/** A z-level square region around a place (radians, [w, s, e, n]). */
function regionAround(lat: number, lon: number, halfDeg: number) {
  return [
    (lon - halfDeg) * DEG,
    (lat - halfDeg) * DEG,
    (lon + halfDeg) * DEG,
    (lat + halfDeg) * DEG,
  ];
}

describe("regionNearCamera", () => {
  const flat = () => 0;

  it("takes a region under the camera and refuses one beyond the distance", () => {
    const camera = cameraAt(48.137, 11.575, 1.7);
    // About 120 m across, under the camera.
    expect(
      regionNearCamera(regionAround(48.137, 11.575, 0.0005), camera, {
        ellipsoid: WGS84_ELLIPSOID,
        groundAtM: flat,
        withinM: 300,
      }),
    ).toBe(true);
    // The same size about 1.1 km north.
    expect(
      regionNearCamera(regionAround(48.147, 11.575, 0.0005), camera, {
        ellipsoid: WGS84_ELLIPSOID,
        groundAtM: flat,
        withinM: 300,
      }),
    ).toBe(false);
  });

  // Why: the test is against the region's nearest part, not its centre: a
  // big region whose centre is far but whose edge is under the camera is
  // in reach.
  it("counts a large region by its extent, not its centre", () => {
    const camera = cameraAt(48.137, 11.575, 1.7);
    const big = regionAround(48.142, 11.575, 0.006); // edge 0.001 deg south of the camera's
    expect(
      regionNearCamera(big, camera, {
        ellipsoid: WGS84_ELLIPSOID,
        groundAtM: flat,
        withinM: 300,
      }),
    ).toBe(true);
  });

  // Why: the region sits on the drawn ground; a camera 1.7 m over a
  // plateau at 2,000 m is near it, not 2 km above it.
  it("puts the region on the ground the sampler reads", () => {
    const camera = cameraAt(46.5, 9, 2_001.7);
    const opts = { ellipsoid: WGS84_ELLIPSOID, withinM: 300 };
    const r = regionAround(46.5, 9, 0.0005);
    expect(
      regionNearCamera(r, camera, { ...opts, groundAtM: () => 2_000 }),
    ).toBe(true);
    expect(
      regionNearCamera(r, camera, { ...opts, groundAtM: () => null }),
    ).toBe(false);
  });

  it("refuses a malformed region or distance", () => {
    const camera = cameraAt(0, 0, 1);
    const opts = { ellipsoid: WGS84_ELLIPSOID, groundAtM: () => 0 };
    expect(() =>
      regionNearCamera([0, 0, 1], camera, { ...opts, withinM: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      regionNearCamera([0, 0.1, 0.1, 0], camera, { ...opts, withinM: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      regionNearCamera([0, 0, 0.1, 0.1], camera, { ...opts, withinM: -1 }),
    ).toThrow(RangeError);
  });
});

/** The library's overlay blend line (0.5.3), read from its own source. */
const LIBRARY = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/3d-tiles-renderer/src/three/plugins/images",
);

describe("patchOsmFade", () => {
  // Why: the fade is patched into the library's layer blend; if the
  // library changes that line the patch must say so, not draw OSM at
  // every distance.
  it("patches the library's own layer blend and declares its uniforms", () => {
    const chunk = readFileSync(
      join(LIBRARY, "overlays/wrapOverlaysMaterial.js"),
      "utf8",
    );
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: `#include <common>\nvoid main() {\n${chunk}\n}`,
    };
    const uniforms = {
      uOsmFadeM: { value: 300 },
      uOsmOn: { value: 1 },
      uOsmFadeStart: { value: 0.7 },
    };
    expect(patchOsmFade(shader, uniforms)).toBe(true);
    expect(shader.fragmentShader).toContain("uniform float uOsmFadeM;");
    expect(shader.fragmentShader).toContain("length( vViewPosition )");
    expect(shader.fragmentShader).not.toContain(
      "tint.rgba *= layerInfo[ i ].opacity * wOpacity;",
    );
    expect(shader.uniforms.uOsmFadeM).toBe(uniforms.uOsmFadeM);
  });

  it("reports a shader without the blend line, untouched", () => {
    const shader = { uniforms: {}, fragmentShader: "void main() {}" };
    expect(
      patchOsmFade(shader, {
        uOsmFadeM: { value: 1 },
        uOsmOn: { value: 1 },
        uOsmFadeStart: { value: 0.7 },
      }),
    ).toBe(false);
    expect(shader.fragmentShader).toBe("void main() {}");
  });
});

/** The library overlay's prototype, its untyped methods spied on. */
const proto = XYZTilesOverlay.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

/** An overlay whose library half is spied on (no image source in Node). */
function gatedOverlay(gate: (range: number[], level: number) => boolean) {
  const overlay = new GatedOsmOverlay({
    url: TEMPLATE,
    maxZoom: 19,
    gate,
    ceiling: createRequestCeiling(150),
  });
  const lock = vi
    .spyOn(proto, "lockTexture")
    .mockImplementation(() => Promise.resolve("texture"));
  const release = vi
    .spyOn(proto, "releaseTexture")
    .mockImplementation(() => {});
  const has = vi.spyOn(proto, "hasContent").mockImplementation(() => true);
  // The level the library picks needs its initialised image source.
  vi.spyOn(proto, "calculateLevel").mockImplementation(() => 16);
  return { overlay, lock, release, has };
}

describe("GatedOsmOverlay", () => {
  const R = [0.5, 0.5, 0.50001, 0.50001];

  // Why: the plugin locks every relief tile's region as it starts to load,
  // and a lock FETCHES. A region the gate refuses must not reach the
  // library, must not count as content, and its release must not unlock
  // what was never locked.
  it("passes a lock to the library only through the gate, and releases only what it locked", async () => {
    let open = false;
    const { overlay, lock, release } = gatedOverlay(() => open);
    expect(await overlay.lockTexture(R, 16)).toBeNull();
    expect(lock).not.toHaveBeenCalled();
    expect(overlay.hasContent(R, 16)).toBe(false);
    overlay.releaseTexture(R, 16);
    expect(release).not.toHaveBeenCalled();
    expect(overlay.stats()).toMatchObject({ gatedLocks: 1, locks: 0 });

    open = true;
    expect(await overlay.lockTexture(R, 16)).toBe("texture");
    expect(lock).toHaveBeenCalledTimes(1);
    expect(overlay.isLocked(R)).toBe(true);
    expect(overlay.hasContent(R, 16)).toBe(true);
    overlay.releaseTexture(R, 16);
    expect(release).toHaveBeenCalledTimes(1);
    expect(overlay.isLocked(R)).toBe(false);
    vi.restoreAllMocks();
  });

  // Why (G1 smoke, 2026-10-18): the map is asked for only at z15 and
  // finer, and the plugin picks a region's level from its relief tile's
  // size. The globe's default relief tree stops at z13 near the camera, so
  // with the setting on nothing at all was asked for, and nothing on the
  // page said why. The finest level a lock asked for says it.
  it("reports the finest level a lock asked for, gated or not", async () => {
    const { overlay } = gatedOverlay(() => false);
    expect(overlay.stats().finestLevel).toBeNull();
    await overlay.lockTexture(R, 13);
    await overlay.lockTexture(R, 11);
    expect(overlay.stats()).toMatchObject({ finestLevel: 13, locks: 0 });
    vi.restoreAllMocks();
  });

  // Why: the request ceiling holds at the network edge too: a fetch over
  // the ceiling waits until the oldest request of the minute ages out.
  it("holds each fetch to the ceiling", async () => {
    let t = 0;
    const waits: number[] = [];
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(2, () => t),
      sleep: (ms) => {
        waits.push(ms);
        t += ms;
        return Promise.resolve();
      },
    });
    const fetched = vi
      .spyOn(proto, "fetch")
      .mockImplementation(() => Promise.resolve("ok"));
    await overlay.fetch("a");
    await overlay.fetch("b");
    await overlay.fetch("c");
    expect(fetched).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([60_000]);
    vi.restoreAllMocks();
  });

  it("refuses a missing gate or template", () => {
    expect(
      () =>
        new GatedOsmOverlay({
          url: "https://x.test/tile.png",
          maxZoom: 19,
          gate: () => true,
          ceiling: createRequestCeiling(1),
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new GatedOsmOverlay({
          url: TEMPLATE,
          maxZoom: 19,
          gate: undefined as never,
          ceiling: createRequestCeiling(1),
        }),
    ).toThrow(TypeError);
  });
});

describe("reevaluateGatedTiles", () => {
  /** A fake of the plugin's private state (0.5.3), one tile per range. */
  function fakePlugin(overlay: object, ranges: number[][]) {
    type Info = {
      range: number[] | null;
      target: unknown;
      failed: boolean;
      meshInfo: Map<unknown, unknown>;
    };
    const tileInfo = new Map<object, Info>();
    for (const range of ranges) {
      tileInfo.set(
        { range },
        { range, target: null, failed: false, meshInfo: new Map([[1, 1]]) },
      );
    }
    const fetched: object[] = [];
    const updated: object[] = [];
    return {
      overlayInfo: new Map([[overlay, { tileInfo }]]),
      _fetchTileOverlayTexture: (tile: object) => {
        fetched.push(tile);
        return Promise.resolve();
      },
      _updateLayers: (tile: object) => {
        updated.push(tile);
      },
      fetched,
      updated,
      tileInfo,
    };
  }

  // Why: the plugin decides a tile's overlay once, when the tile loads; a
  // tile gated then (the camera was far) would never get its map when the
  // camera walks up to it. The re-evaluation locks and fetches exactly the
  // tiles now in reach that have nothing yet, and no others.
  it("fetches the tiles now in reach that have no texture, and only those", async () => {
    const near = [0.5, 0.5, 0.50001, 0.50001];
    const far = [0.6, 0.6, 0.60001, 0.60001];
    const { overlay, lock } = gatedOverlay((r) => r[0] === 0.5);
    const plugin = fakePlugin(overlay, [near, far]);
    const started = reevaluateGatedTiles(plugin, overlay, { limit: 10 });
    expect(started).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(lock).toHaveBeenCalledTimes(1);
    expect(plugin.fetched.map((t) => (t as { range: number[] }).range)).toEqual(
      [near],
    );
    expect(plugin.updated).toHaveLength(1);
    // Locked now: a second pass starts nothing.
    expect(reevaluateGatedTiles(plugin, overlay, { limit: 10 })).toBe(0);
    vi.restoreAllMocks();
  });

  it("stops at its limit and skips failed or unprocessed tiles", () => {
    const ranges = [0, 1, 2, 3].map((i) => [i / 10, 0, i / 10 + 1e-5, 1e-5]);
    const { overlay } = gatedOverlay(() => true);
    const plugin = fakePlugin(overlay, ranges);
    const infos = [...plugin.tileInfo.values()];
    infos[0]!.failed = true;
    infos[1]!.meshInfo = new Map();
    expect(reevaluateGatedTiles(plugin, overlay, { limit: 1 })).toBe(1);
    vi.restoreAllMocks();
  });

  // Why: the re-evaluation calls two private methods of the library's
  // plugin; a library change must fail here, not silently stop maps.
  it("finds the plugin's private methods in the library source", () => {
    const src = readFileSync(join(LIBRARY, "ImageOverlayPlugin.js"), "utf8");
    expect(src).toContain(
      "async _fetchTileOverlayTexture( tile, overlay, info )",
    );
    expect(src).toContain("_updateLayers( tile ) {");
    expect(src).toMatch(/overlayInfo\s*\.get\( overlay \)\s*\.tileInfo/);
  });
});
