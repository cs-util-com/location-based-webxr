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

import fc from "fast-check";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { ImageOverlayPlugin, XYZTilesOverlay } from "3d-tiles-renderer/plugins";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GLOBE_OSM,
  GatedOsmOverlay,
  createGlobeOsmOverlay,
  createRequestCeiling,
  osmCredit,
  osmGateLimits,
  osmOverlayActive,
  patchOsmFade,
  rampOsmOn,
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
  // Why (G1 review L2): one threshold for on and off made a camera at
  // about 200 m, or about 50 m/s, switch the map (and its requests) on and
  // off every frame. Off stays at 200 m / 50 m/s; on needs the camera
  // below 180 m and slower than 45 m/s; in between, it stays as it was.
  it("switches on below 180 m and 45 m/s, off above 200 m or 50 m/s, and holds between", () => {
    const on = (aboveGroundM: number, speedMps: number, was: boolean) =>
      osmOverlayActive({ aboveGroundM, speedMps }, was);
    // Low and slow: on, whatever it was.
    expect(on(1.7, 1.5, false)).toBe(true);
    expect(on(180, 45, false)).toBe(true);
    // The band: holds.
    expect(on(190, 10, false)).toBe(false);
    expect(on(190, 10, true)).toBe(true);
    expect(on(10, 48, false)).toBe(false);
    expect(on(10, 48, true)).toBe(true);
    expect(on(200, 50, true)).toBe(true);
    // Beyond: off, whatever it was.
    expect(on(200.1, 0, true)).toBe(false);
    expect(on(10, 50.1, true)).toBe(false);
    // Without the last state, the stricter rule (switching on).
    expect(osmOverlayActive({ aboveGroundM: 190, speedMps: 0 })).toBe(false);
  });

  // Why: a camera crossing the threshold back and forth must not toggle
  // the map: along any path, it switches only on a crossing of the whole
  // band (below 180 m and 45 m/s to switch on, above 200 m or 50 m/s to
  // switch off), never inside it.
  it("never switches inside the band, along any path", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            h: fc.double({ min: 0, max: 400, noNaN: true }),
            v: fc.double({ min: 0, max: 100, noNaN: true }),
          }),
          { minLength: 1, maxLength: 60 },
        ),
        (path) => {
          let was = false;
          for (const { h, v } of path) {
            const now = osmOverlayActive({ aboveGroundM: h, speedMps: v }, was);
            // Switched on only below the band, off only above it.
            expect(!(now && !was) || (h <= 180 && v <= 45)).toBe(true);
            expect(!(!now && was) || h > 200 || v > 50).toBe(true);
            was = now;
          }
        },
      ),
    );
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

  // Why: an editor that looks at the ground from above wants the map
  // much higher than a flight does (it is the map of the place being
  // edited, not a texture under a passing camera), and its camera jumps
  // across the place, so speed is no sign of flying there. The limits are
  // the caller's, with the same band rule; open speed limits never turn
  // the map off, but an unknown speed still does.
  it("takes the caller's limits, open speed limits included", () => {
    const limits = {
      maxAboveGroundM: 1250,
      onBelowAboveGroundM: 1125,
      maxSpeedMps: Number.POSITIVE_INFINITY,
      onBelowSpeedMps: Number.POSITIVE_INFINITY,
    };
    const on = (aboveGroundM: number, speedMps: number, was: boolean) =>
      osmOverlayActive({ aboveGroundM, speedMps }, was, limits);
    expect(on(1100, 5_000, false)).toBe(true);
    expect(on(1200, 0, false)).toBe(false);
    expect(on(1200, 0, true)).toBe(true);
    expect(on(1250.1, 0, true)).toBe(false);
    expect(on(10, Number.NaN, true)).toBe(false);
  });
});

describe("osmGateLimits", () => {
  // Why: the defaults are the flight's limits; a caller replaces any of
  // them, and a set that would switch the map on above where it switches
  // off (a band upside down), or a limit that is no height or speed at
  // all, is refused where it is made rather than silently never drawing.
  it("fills the defaults and keeps the caller's", () => {
    expect(osmGateLimits({}, 19)).toEqual({
      minZoom: 15,
      maxAboveGroundM: 200,
      onBelowAboveGroundM: 180,
      maxSpeedMps: 50,
      onBelowSpeedMps: 45,
    });
    expect(
      osmGateLimits(
        {
          minZoom: 14,
          maxAboveGroundM: 1250,
          onBelowAboveGroundM: 1125,
          maxSpeedMps: Number.POSITIVE_INFINITY,
          onBelowSpeedMps: Number.POSITIVE_INFINITY,
        },
        19,
      ),
    ).toMatchObject({ minZoom: 14, maxAboveGroundM: 1250 });
  });

  it("refuses a band upside down, a limit that is not > 0, or a zoom out of range", () => {
    const bad = [
      { onBelowAboveGroundM: 250 },
      { maxSpeedMps: 40 },
      { maxAboveGroundM: 0 },
      { onBelowSpeedMps: Number.NaN },
      { maxAboveGroundM: "200" as unknown as number },
      { minZoom: 14.5 },
      { minZoom: -1 },
      { minZoom: 20 },
    ];
    for (const limits of bad) {
      expect(() => osmGateLimits(limits, 19), JSON.stringify(limits)).toThrow(
        RangeError,
      );
    }
  });
});

describe("rampOsmOn", () => {
  // Why (G1 review L2): the map's switch was a hard 0/1 on the shader's
  // `uOsmOn`, so the map popped in and out. It now moves toward its
  // target by the frame's share of `rampMs` (0.3 s), and lands exactly.
  it("moves toward the target by the frame's share of the ramp, and lands", () => {
    expect(GLOBE_OSM.rampMs).toBe(300);
    expect(rampOsmOn(0, 1, 30)).toBeCloseTo(0.1, 10);
    expect(rampOsmOn(0.5, 0, 75)).toBeCloseTo(0.25, 10);
    expect(rampOsmOn(0.95, 1, 30)).toBe(1);
    expect(rampOsmOn(0.05, 0, 30)).toBe(0);
    expect(rampOsmOn(1, 1, 16)).toBe(1);
    // A stall (a tab in the background) lands at once; a clock that went
    // back, or no time, does not move it.
    expect(rampOsmOn(0, 1, 10_000)).toBe(1);
    expect(rampOsmOn(0.4, 1, -5)).toBe(0.4);
    expect(rampOsmOn(0.4, 1, Number.NaN)).toBe(0.4);
  });

  it("stays in [0, 1] and never passes its target", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(0, 1),
        fc.double({ min: 0, max: 2_000, noNaN: true }),
        (from, to, dt) => {
          const next = rampOsmOn(from, to, dt);
          expect(next).toBeGreaterThanOrEqual(Math.min(from, to));
          expect(next).toBeLessThanOrEqual(Math.max(from, to));
        },
      ),
    );
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

/** An overlay whose library half is spied on (no image source in Node),
 *  without a keep: a release goes to the library at once (the keep has
 *  its own tests). */
function gatedOverlay(gate: (range: number[], level: number) => boolean) {
  const overlay = new GatedOsmOverlay({
    url: TEMPLATE,
    maxZoom: 19,
    gate,
    ceiling: createRequestCeiling(150),
    keep: 0,
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
  // As after the library's own init (which needs a network in Node).
  (overlay as unknown as { isReady: boolean }).isReady = true;
  return { overlay, lock, release, has };
}

describe("GatedOsmOverlay", () => {
  const R = [0.5, 0.5, 0.50001, 0.50001];

  // Why: the library's plugin, registered on a relief that has tiles
  // already, processes those tiles BEFORE it initialises its overlays
  // (0.5.3, `init`), and a tile's processing awaits `whenReady()`, which is
  // still null then, so it goes on to lock the region at once. The lock
  // asks the library for the region's level, which reads the image source
  // the overlay sets up only in its own init: an uncaught TypeError the
  // moment the map was attached to a relief already on screen. Until the
  // overlay is ready a lock is turned away like a gated one (the
  // re-evaluation picks the tile up once it is), and nothing reaches the
  // library.
  it("turns a lock away, and never reaches the library, until the overlay is ready", async () => {
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(150),
    });
    expect(() => overlay.lockTexture(R)).not.toThrow();
    expect(await overlay.lockTexture(R)).toBeNull();
    expect(overlay.hasContent(R)).toBe(false);
    expect(overlay.wanted(R)).toBe(false);
    expect(() => overlay.releaseTexture(R)).not.toThrow();
    expect(overlay.stats()).toMatchObject({
      locks: 0,
      gatedLocks: 2,
      lockedRegions: 0,
      finestLevel: null,
    });
  });

  // Why: the order the readiness guard above exists for, read from the
  // library's own source: a version that initialises its overlays first
  // would make the guard dead code, and one that moved the processing
  // elsewhere must be looked at again.
  it("finds the plugin processing loaded tiles before it initialises its overlays", () => {
    const src = readFileSync(join(LIBRARY, "ImageOverlayPlugin.js"), "utf8");
    const init = src.slice(src.indexOf("\tinit( tiles ) {"));
    const processed = init.indexOf(
      "this._processTileModel( scene, tile, true );",
    );
    const initialised = init.indexOf("this._initOverlay( overlay );");
    expect(processed).toBeGreaterThan(0);
    expect(initialised).toBeGreaterThan(processed);
    expect(src).toContain("if ( ! overlay.isReady ) {");
  });

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

  // Why (G1 review L6): a fetch waiting for the ceiling with a signal that
  // was aborted before the wait began must give up at once (the abort
  // event had already fired, so a listener added then never ran and the
  // wait ran its full minute), and a finished wait must not leave its
  // listener on the tile's signal.
  it("gives up a ceiling wait at once for an aborted signal, and cleans up its listener", async () => {
    let t = 0;
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(1, () => t),
    });
    const fetched = vi
      .spyOn(proto, "fetch")
      .mockImplementation(() => Promise.resolve("ok"));
    await overlay.fetch("a");
    const aborted = AbortSignal.abort();
    const outcome = await Promise.race([
      overlay.fetch("b", { signal: aborted }).then(
        () => "fetched",
        (e: Error) => e.name,
      ),
      new Promise((r) => setTimeout(() => r("still waiting"), 50)),
    ]);
    expect(outcome).toBe("AbortError");
    expect(fetched).toHaveBeenCalledTimes(1);

    // A wait that ends on its own removes its listener.
    vi.useFakeTimers();
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const signal = {
      aborted: false,
      addEventListener: (_type: string, fn: unknown, opts: unknown) =>
        added.push([fn, opts]),
      removeEventListener: (_type: string, fn: unknown) => removed.push(fn),
    } as unknown as AbortSignal;
    const waiting = overlay.fetch("c", { signal });
    t = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await waiting;
    vi.useRealTimers();
    expect(added).toHaveLength(1);
    expect((added[0] as unknown[])[1]).toEqual({ once: true });
    expect(removed).toEqual([(added[0] as unknown[])[0]]);
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
    expect(reevaluateGatedTiles(plugin, overlay, { limit: 10 })).toEqual({
      started: 1,
      left: 0,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(lock).toHaveBeenCalledTimes(1);
    expect(plugin.fetched.map((t) => (t as { range: number[] }).range)).toEqual(
      [near],
    );
    expect(plugin.updated).toHaveLength(1);
    // Locked now: a second pass starts nothing.
    expect(reevaluateGatedTiles(plugin, overlay, { limit: 10 })).toEqual({
      started: 0,
      left: 0,
    });
    vi.restoreAllMocks();
  });

  // Why: the tiles left for the next look are the throttle a creator
  // waits on; the diagnostics count them.
  it("stops at its limit, counts what it left, and skips failed or unprocessed tiles", () => {
    const ranges = [0, 1, 2, 3].map((i) => [i / 10, 0, i / 10 + 1e-5, 1e-5]);
    const { overlay } = gatedOverlay(() => true);
    const plugin = fakePlugin(overlay, ranges);
    const infos = [...plugin.tileInfo.values()];
    infos[0]!.failed = true;
    infos[1]!.meshInfo = new Map();
    expect(reevaluateGatedTiles(plugin, overlay, { limit: 1 })).toEqual({
      started: 1,
      left: 1,
    });
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

describe("createGlobeOsmOverlay's update", () => {
  // Why (G1 review L2): the hysteresis and the ramp must be what the
  // frame loop runs, not only what the helpers compute: a camera hovering
  // at 190 m keeps the state it had, and the shader switch ramps over
  // 0.3 s instead of jumping. Driven through the factory with a fake of
  // the relief's tiles (the plugin is never initialised in Node).
  it("holds its state in the band and ramps the shader switch", () => {
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
    });
    osm.attach({
      tiles: {
        group: new THREE.Group(),
        ellipsoid: WGS84_ELLIPSOID,
        registerPlugin: () => {},
        forEachLoadedModel: () => {},
        addEventListener: () => {},
      },
      plugin: { sampleCartographicElevation: () => null },
    });
    osm.setEnabled(true);
    const position = new THREE.Vector3();
    const at = (aboveGroundM: number, nowMs: number) => {
      osm.update({ position, aboveGroundM, speedMps: 0, nowMs });
      return { active: osm.stats().active, on: osm.uniforms.uOsmOn.value };
    };
    // Hovering in the band from above: stays off.
    expect(at(190, 0)).toEqual({ active: false, on: 0 });
    // Below 180 m: on, and the switch ramps.
    expect(at(170, 100).active).toBe(true);
    expect(osm.uniforms.uOsmOn.value).toBeCloseTo(1 / 3, 6);
    expect(at(190, 400).active).toBe(true); // the band: holds
    expect(osm.uniforms.uOsmOn.value).toBe(1);
    // Above 200 m: off, and the switch ramps down.
    expect(at(210, 550).active).toBe(false);
    expect(osm.uniforms.uOsmOn.value).toBeCloseTo(0.5, 6);
    expect(at(190, 1_000)).toEqual({ active: false, on: 0 });
  });

  // Why: the caller's limits must be what the frame loop and the gate
  // use, not only what the helpers accept: a camera 1100 m over the
  // ground, moving fast, has the map with an editor's limits, and the
  // coarsest level asked for is the caller's. The overlay is initialised
  // for real here (an XYZ source needs no network to init), so the gate
  // sees the library's own projection and levels.
  it("runs the caller's limits in the frame loop and the gate", async () => {
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
      fadeM: 1600,
      limits: {
        minZoom: 14,
        maxAboveGroundM: 1250,
        onBelowAboveGroundM: 1125,
        maxSpeedMps: Number.POSITIVE_INFINITY,
        onBelowSpeedMps: Number.POSITIVE_INFINITY,
      },
    });
    expect(osm.limits).toMatchObject({ minZoom: 14, maxAboveGroundM: 1250 });
    await (osm.overlay as unknown as { init(): Promise<unknown> }).init();
    osm.attach({
      tiles: {
        group: new THREE.Group(),
        ellipsoid: WGS84_ELLIPSOID,
        registerPlugin: () => {},
        forEachLoadedModel: () => {},
        addEventListener: () => {},
      },
      plugin: { sampleCartographicElevation: () => null },
    });
    osm.setEnabled(true);
    const lat = 48.137 * DEG;
    const lon = 11.575 * DEG;
    const position = WGS84_ELLIPSOID.getCartographicToPosition(
      lat,
      lon,
      1100,
      new THREE.Vector3(),
    );
    osm.update({ position, aboveGroundM: 1100, speedMps: 900, nowMs: 0 });
    expect(osm.stats().active).toBe(true);
    const range = (
      osm.overlay.projection as {
        fromCartographicToNormalizedRange(r: number[]): number[];
      }
    ).fromCartographicToNormalizedRange([lon, lat, lon + 1e-5, lat + 1e-5]);
    expect(osm.overlay.wanted(range, 14)).toBe(true);
    expect(osm.overlay.wanted(range, 13)).toBe(false);
  });
});

/** A fake of the relief's tiles: the plugin is never initialised in Node. */
function fakeTerrain(visibleTiles: Set<object> = new Set()) {
  return {
    tiles: {
      group: new THREE.Group(),
      ellipsoid: WGS84_ELLIPSOID,
      registerPlugin: () => {},
      forEachLoadedModel: () => {},
      addEventListener: () => {},
      visibleTiles,
    },
    plugin: { sampleCartographicElevation: () => 0 },
  };
}

describe("the map's diagnostics", () => {
  // Why: map tiles can vanish, flicker or show bare relief for six
  // different reasons, and which one dominates is decided by counting, on
  // the real page, what each one does: a region's texture dropped (a
  // re-visit fetches it again), the map switched off, a frame whose
  // height over the ground was unknown, the time the request ceiling was
  // full, and tiles the re-evaluation had to leave for its next look.
  // These pin that each counter counts its own event and nothing else.
  it("counts a region's texture dropped only with its last lock", async () => {
    const { overlay, release } = gatedOverlay(() => true);
    const R = [0.5, 0.5, 0.50001, 0.50001];
    await overlay.lockTexture(R, 16);
    await overlay.lockTexture(R, 16);
    overlay.releaseTexture(R, 16);
    expect(overlay.stats().releases).toBe(0);
    overlay.releaseTexture(R, 16);
    expect(overlay.stats().releases).toBe(1);
    // A release of what was never locked drops nothing.
    overlay.releaseTexture(R, 16);
    expect(overlay.stats().releases).toBe(1);
    expect(release).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("counts the map switched off and the frames with an unknown height", () => {
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
    });
    osm.attach(fakeTerrain());
    osm.setEnabled(true);
    const position = new THREE.Vector3();
    let now = 0;
    const at = (aboveGroundM: number) => {
      now += 100;
      osm.update({ position, aboveGroundM, speedMps: 0, nowMs: now });
    };
    at(100); // on
    at(300); // off: 1
    at(Number.NaN); // unknown, already off
    at(100); // on
    at(Number.NaN); // unknown, off: 2
    at(Number.NaN); // unknown
    expect(osm.stats()).toMatchObject({
      switchedOff: 2,
      unknownHeightFrames: 3,
    });
  });

  it("adds the time the request ceiling was full while the map was on", async () => {
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
    });
    osm.attach(fakeTerrain());
    osm.setEnabled(true);
    const position = new THREE.Vector3();
    osm.update({ position, aboveGroundM: 100, speedMps: 0, nowMs: 0 });
    osm.update({ position, aboveGroundM: 100, speedMps: 0, nowMs: 250 });
    expect(osm.stats().ceilingFullMs).toBe(0);
    vi.spyOn(proto, "fetch").mockImplementation(() => Promise.resolve("ok"));
    for (let i = 0; i < GLOBE_OSM.requestsPerMinute; i++) {
      await osm.overlay.fetch(`u${i}`);
    }
    osm.update({ position, aboveGroundM: 100, speedMps: 0, nowMs: 500 });
    osm.update({ position, aboveGroundM: 100, speedMps: 0, nowMs: 900 });
    expect(osm.stats().ceilingFullMs).toBe(650);
    // Off, the full ceiling holds nothing back.
    osm.update({ position, aboveGroundM: 300, speedMps: 0, nowMs: 1_400 });
    expect(osm.stats().ceilingFullMs).toBe(650);
    vi.restoreAllMocks();
  });

  // Why: the drawn picture is what the creator sees, so a measurement
  // needs it per tile: of the relief tiles drawn where the map is at full strength,
  // how many carry it, how many are too coarse for it (under the coarsest
  // zoom: bare relief by design), and how many wait for it (gated,
  // throttled or loading). Far tiles and tiles of another place are not
  // counted.
  it("sorts the drawn tiles near the camera by their map", async () => {
    const visible = new Set<object>();
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
      fadeM: 1000,
    });
    await (osm.overlay as unknown as { init(): Promise<unknown> }).init();
    osm.attach(fakeTerrain(visible));
    osm.setEnabled(true);
    const lat = 48.137;
    const lon = 11.575;
    osm.update({
      position: cameraAt(lat, lon, 100),
      aboveGroundM: 100,
      speedMps: 0,
      nowMs: 0,
    });
    const projection = osm.overlay.projection as {
      fromCartographicToNormalizedRange(r: number[]): number[];
    };
    const tileInfo = (
      osm.plugin as unknown as {
        overlayInfo: Map<object, { tileInfo: Map<object, unknown> }>;
      }
    ).overlayInfo.get(osm.overlay)!.tileInfo;
    const add = (
      region: number[] | null,
      target: unknown,
      drawn = true,
    ): void => {
      const tile = {};
      tileInfo.set(tile, {
        range:
          region === null
            ? null
            : projection.fromCartographicToNormalizedRange(region),
        target,
        failed: false,
        meshInfo: new Map([[1, 1]]),
      });
      if (drawn) visible.add(tile);
    };
    // About 50 m across: z17 or finer.
    const small = (dLat: number) => regionAround(lat + dLat, lon, 0.0002);
    add(small(0), "texture"); // near, with its map
    add(small(0.001), null); // near, waiting
    add(small(0.002), null, false); // near, not drawn
    add(small(0.05), null); // about 5.6 km away
    add(regionAround(lat, lon, 0.05), null); // near, about z12
    add(null, null); // drawn, not processed yet
    expect(osm.coverage()).toEqual({
      near: 3,
      withMap: 1,
      coarse: 1,
      waiting: 1,
      unprocessed: 1,
    });
  });

  // Why: `coverage` sorts the drawn tiles by their distance from the
  // camera of the last update. The camera was taken only while the map was
  // on, so after a frame with the map off (an unknown height, a switch-off)
  // it counted the tiles near where the camera had last been with the map
  // on, not near where it is.
  it("measures from the camera of the last update, the map on or off", async () => {
    const visible = new Set<object>();
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
      fadeM: 1000,
    });
    await (osm.overlay as unknown as { init(): Promise<unknown> }).init();
    osm.attach(fakeTerrain(visible));
    osm.setEnabled(true);
    const lat = 48.137;
    const lon = 11.575;
    const at = (dLat: number, aboveGroundM: number, nowMs: number) => {
      osm.update({
        position: cameraAt(lat + dLat, lon, 100),
        aboveGroundM,
        speedMps: 0,
        nowMs,
      });
    };
    const tile = {};
    (
      osm.plugin as unknown as {
        overlayInfo: Map<object, { tileInfo: Map<object, unknown> }>;
      }
    ).overlayInfo
      .get(osm.overlay)!
      .tileInfo.set(tile, {
        range: (
          osm.overlay.projection as {
            fromCartographicToNormalizedRange(r: number[]): number[];
          }
        ).fromCartographicToNormalizedRange(regionAround(lat, lon, 0.0002)),
        target: "texture",
        failed: false,
        meshInfo: new Map([[1, 1]]),
      });
    visible.add(tile);
    at(0, 100, 0);
    expect(osm.coverage()).toMatchObject({ near: 1, withMap: 1 });
    // About 5.6 km away, its height unknown: the map is off.
    at(0.05, Number.NaN, 16);
    expect(osm.stats().active).toBe(false);
    expect(osm.coverage()).toMatchObject({ near: 0, withMap: 0 });
  });

  it("reads nothing before it is attached or while the overlay is not ready", () => {
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
    });
    const none = {
      near: 0,
      withMap: 0,
      coarse: 0,
      waiting: 0,
      unprocessed: 0,
    };
    expect(osm.coverage()).toEqual(none);
    osm.attach(fakeTerrain(new Set([{}])));
    expect(osm.coverage()).toEqual(none);
  });
});

describe("the keep of released map textures", () => {
  const A = [0.5, 0.5, 0.50001, 0.50001];
  const B = [0.6, 0.6, 0.60001, 0.60001];
  const C = [0.7, 0.7, 0.70001, 0.70001];

  /** A ready overlay with `keep`, its library half spied on; `loaded`
   *  says what the library holds for a region (a texture, or a promise
   *  while it loads or after it failed). */
  function keptOverlay(
    keep: number,
    gate: (range: number[]) => boolean = () => true,
    loaded: () => unknown = () => "texture",
  ) {
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate,
      ceiling: createRequestCeiling(150),
      keep,
    });
    const lock = vi
      .spyOn(proto, "lockTexture")
      .mockImplementation(() => Promise.resolve("texture"));
    const release = vi
      .spyOn(proto, "releaseTexture")
      .mockImplementation(() => {});
    vi.spyOn(proto, "getTexture").mockImplementation(loaded);
    vi.spyOn(proto, "hasContent").mockImplementation(() => true);
    vi.spyOn(proto, "calculateLevel").mockImplementation(() => 16);
    (overlay as unknown as { isReady: boolean }).isReady = true;
    return { overlay, lock, release };
  }

  // Why (a measurement, 2026-10-25: the editor at 390 px wide, its map
  // from a fake tile server answering in 300 ms): the relief unloads tiles
  // it no longer uses, and each unload released its map region, which the
  // library drops at once. 63 % of all map requests were re-fetches of
  // tiles it had had a minute before, and they filled the 150-a-minute
  // ceiling: a tile under the camera then had no map for seconds. A released texture now stays in memory, a re-visit takes it
  // back without a request, and the gate is not asked (it has nothing to
  // protect: no request is made).
  it("keeps a released texture and serves a re-lock from memory, past the gate", async () => {
    let open = true;
    const { overlay, lock, release } = keptOverlay(4, () => open);
    expect(await overlay.lockTexture(A)).toBe("texture");
    overlay.releaseTexture(A);
    expect(release).not.toHaveBeenCalled();
    expect(overlay.isLocked(A)).toBe(false);
    expect(overlay.hasContent(A)).toBe(false);
    expect(overlay.stats()).toMatchObject({ keptRegions: 1, releases: 0 });

    open = false;
    expect(await overlay.lockTexture(A)).toBe("texture");
    expect(lock).toHaveBeenCalledTimes(1);
    expect(overlay.isLocked(A)).toBe(true);
    expect(overlay.hasContent(A)).toBe(true);
    expect(overlay.stats()).toMatchObject({
      keptRegions: 0,
      keptHits: 1,
      locks: 2,
      gatedLocks: 0,
    });
    vi.restoreAllMocks();
  });

  // Why: the keep is a bound on memory (each region about 512 KiB), so
  // past it the region released longest ago goes to the library, and its
  // next lock is an ordinary one: through the gate, fetched.
  it("lets the region released longest ago go past the keep", async () => {
    const { overlay, lock, release } = keptOverlay(2);
    for (const r of [A, B, C]) {
      await overlay.lockTexture(r);
      overlay.releaseTexture(r);
    }
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]![0]).toEqual(A);
    expect(overlay.stats()).toMatchObject({ keptRegions: 2, releases: 1 });
    await overlay.lockTexture(A);
    expect(lock).toHaveBeenCalledTimes(4);
    // A re-lock takes B out of the keep; it is the newest again when
    // released, so C goes first.
    await overlay.lockTexture(B);
    overlay.releaseTexture(B);
    overlay.releaseTexture(A);
    expect(release.mock.calls[1]![0]).toEqual(C);
    vi.restoreAllMocks();
  });

  // Why: what the library holds for a region still loading is its fetch,
  // and for one that failed a rejected promise. Keeping either would hand
  // a re-visit the failure forever (or hold a request the view no longer
  // wants): only a loaded texture is kept.
  it("never keeps a region still loading or failed", async () => {
    const { overlay, release } = keptOverlay(4, undefined, () =>
      Promise.resolve("later"),
    );
    await overlay.lockTexture(A);
    overlay.releaseTexture(A);
    expect(release).toHaveBeenCalledTimes(1);
    expect(overlay.stats()).toMatchObject({ keptRegions: 0, releases: 1 });
    vi.restoreAllMocks();
  });

  // Why: a keep of 0 is the library's own behaviour, and setting it lower
  // (to 0 as the map is disposed) lets every kept texture go at once:
  // the plugin's dispose releases its regions but never disposes the
  // overlay, so a texture still kept then would outlive the view.
  it("keeps nothing at 0, and lets the kept go when the keep shrinks", async () => {
    const { overlay, release } = keptOverlay(4);
    for (const r of [A, B]) {
      await overlay.lockTexture(r);
      overlay.releaseTexture(r);
    }
    overlay.setKeep(1);
    expect(release).toHaveBeenCalledTimes(1);
    overlay.setKeep(0);
    expect(release).toHaveBeenCalledTimes(2);
    await overlay.lockTexture(C);
    overlay.releaseTexture(C);
    expect(release).toHaveBeenCalledTimes(3);
    expect(overlay.stats()).toMatchObject({ keptRegions: 0, releases: 3 });
    expect(() => overlay.setKeep(-1)).toThrow(RangeError);
    expect(() => overlay.setKeep(1.5)).toThrow(RangeError);
    expect(
      () =>
        new GatedOsmOverlay({
          url: TEMPLATE,
          maxZoom: 19,
          gate: () => true,
          ceiling: createRequestCeiling(1),
          keep: Number.NaN,
        }),
    ).toThrow(RangeError);
    vi.restoreAllMocks();
  });

  // Why: the map is disposed with the relief (its tiles dispose their
  // plugins); the overlay's keep must be emptied then, by the plugin's own
  // dispose, or the kept textures outlive the 3D view.
  it("empties the keep when the map's plugin is disposed", () => {
    // (0.5.3's typings omit `dispose`.)
    const dispose = vi
      .spyOn(
        ImageOverlayPlugin.prototype as unknown as { dispose(): void },
        "dispose",
      )
      .mockImplementation(() => {});
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
    });
    expect(osm.overlay.stats().keep).toBe(GLOBE_OSM.keepRegions);
    const setKeep = vi.spyOn(osm.overlay, "setKeep");
    (osm.plugin as unknown as { dispose(): void }).dispose();
    expect(setKeep).toHaveBeenCalledWith(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(setKeep.mock.invocationCallOrder[0]!).toBeLessThan(
      dispose.mock.invocationCallOrder[0]!,
    );
    expect(osm.overlay.stats().keep).toBe(0);
    vi.restoreAllMocks();
  });

  // Why: the keep is memory outside the relief's budget, so how much of it
  // a view may hold is the caller's (the editor keeps fewer on a phone);
  // a bad size is refused when the map is made, not at its first release.
  it("takes the caller's keep, and refuses a bad one", () => {
    const make = (keep?: number) =>
      createGlobeOsmOverlay({
        url: TEMPLATE,
        attribution: ATTRIBUTION,
        maxZoom: 19,
        renderer: {} as THREE.WebGLRenderer,
        ...(keep === undefined ? {} : { keep }),
      });
    expect(make().overlay.stats().keep).toBe(GLOBE_OSM.keepRegions);
    expect(make(8).overlay.stats().keep).toBe(8);
    expect(make(0).overlay.stats().keep).toBe(0);
    for (const bad of [-1, 2.5, Number.NaN]) {
      expect(() => make(bad)).toThrow(RangeError);
    }
  });

  // Why: a kept region is held in the library under the level it was
  // locked at. A lock that asks for another level (the overlay's
  // resolution changed) must not be served from the keep: the library
  // holds nothing under the new level, so the lock would read null, and
  // the kept lock would never be given back. The kept one goes back and
  // the lock is an ordinary one.
  it("gives a kept region back, and locks it anew, when its level has changed", async () => {
    const { overlay, lock, release } = keptOverlay(4);
    await overlay.lockTexture(A);
    overlay.releaseTexture(A);
    expect(overlay.stats().keptRegions).toBe(1);
    vi.spyOn(proto, "calculateLevel").mockImplementation(() => 17);
    expect(await overlay.lockTexture(A)).toBe("texture");
    expect(release.mock.calls).toEqual([[A, 16]]);
    expect(lock.mock.calls).toEqual([
      [A, 16],
      [A, 17],
    ]);
    expect(overlay.stats()).toMatchObject({
      keptRegions: 0,
      keptHits: 0,
      releases: 1,
      locks: 2,
    });
    vi.restoreAllMocks();
  });
});

describe("the keep, over the library's own region cache", () => {
  // A spy an earlier test left (one that failed before restoring) would
  // stand in for the library these tests read.
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  /** The library's region cache, as far as these tests read it (0.5.3). */
  interface RegionCache {
    cache: Record<string, { count: number; result: unknown } | undefined>;
    count: number;
    fetchItem(args: unknown[], signal?: AbortSignal): unknown;
    disposeItem(item: unknown, args: unknown[]): void;
  }
  /** About z16 at 256 px, near the middle of the map. */
  const SIDE = 2 ** -16;
  const A = [0.5, 0.5, 0.5 + SIDE, 0.5 + SIDE];
  const B = [0.6, 0.6, 0.6 + SIDE, 0.6 + SIDE];
  /** Lets the library's queued disposals and settled fetches run. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  /** A ready overlay over the library's real region cache (its init runs
   *  in Node), a region's fetch stubbed by `fetched`: what the keep holds
   *  is read from the library's own lock counts and disposals. */
  async function libraryOverlay(
    keep: number,
    fetched: (args: unknown[]) => Promise<unknown>,
  ) {
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(150),
      keep,
    });
    await (overlay as unknown as { init(): Promise<unknown> }).init();
    const source = (overlay as unknown as { regionImageSource: RegionCache })
      .regionImageSource;
    const fetchItem = vi
      .spyOn(source, "fetchItem")
      .mockImplementation((args) => fetched(args));
    // The real one unlocks the source tiles the stubbed fetch never locked.
    const disposeItem = vi
      .spyOn(source, "disposeItem")
      .mockImplementation(() => {});
    const levelOf = (range: number[]) =>
      (
        overlay as unknown as { calculateLevel(r: number[]): number }
      ).calculateLevel(range);
    const held = (range: number[]) =>
      source.cache[[...range, levelOf(range)].join("_")];
    return { overlay, source, fetchItem, disposeItem, held, levelOf };
  }

  // Why: the keep's whole contract is a lock the library never sees given
  // up. Spies on the library's methods cannot show that its own reference
  // count says the same: one library lock through a release, a re-lock
  // that neither fetches nor locks twice, and the texture disposed only
  // when the keep lets the region go (past its size, or at 0).
  it("holds the library's lock through a release and a re-lock, and gives it back past the keep", async () => {
    const textures = new Map<string, object>();
    const { overlay, source, fetchItem, disposeItem, held, levelOf } =
      await libraryOverlay(1, (args) => {
        const texture = { region: String(args[0]) };
        textures.set(String(args[0]), texture);
        return Promise.resolve(texture);
      });
    const texA = await overlay.lockTexture(A);
    expect(texA).toBe(textures.get(String(A[0])));
    expect(held(A)?.count).toBe(1);

    overlay.releaseTexture(A);
    await settle();
    expect(held(A)?.count).toBe(1);
    expect(disposeItem).not.toHaveBeenCalled();

    expect(await overlay.lockTexture(A)).toBe(texA);
    expect(fetchItem).toHaveBeenCalledTimes(1);
    expect(held(A)?.count).toBe(1);
    overlay.releaseTexture(A);

    // A second region past a keep of 1: A goes back to the library.
    await overlay.lockTexture(B);
    overlay.releaseTexture(B);
    await settle();
    expect(held(A)).toBeUndefined();
    expect(disposeItem).toHaveBeenCalledTimes(1);
    expect(disposeItem.mock.calls[0]).toEqual([texA, [...A, levelOf(A)]]);
    expect(held(B)?.count).toBe(1);

    overlay.setKeep(0);
    await settle();
    expect(held(B)).toBeUndefined();
    expect(disposeItem).toHaveBeenCalledTimes(2);
    expect(source.count).toBe(0);
    expect(overlay.stats()).toMatchObject({
      keptRegions: 0,
      keptHits: 1,
      releases: 2,
    });
    vi.restoreAllMocks();
  });

  // Why: for a fetch that failed the library holds a REJECTED promise, and
  // for one still loading a pending one; neither is a texture. Kept, a
  // failed region would hand every re-visit the same failure and never be
  // asked for again. Both go back to the library at once, and it disposes
  // them (with null: nothing was loaded).
  it("gives back at once a region whose fetch failed, or that is still loading", async () => {
    let finish: (v: unknown) => void = () => {};
    const { overlay, source, disposeItem, held } = await libraryOverlay(
      4,
      (args) =>
        args[0] === A[0]
          ? Promise.reject(new Error("tile failed"))
          : new Promise((resolve) => {
              finish = resolve;
            }),
    );
    await expect(overlay.lockTexture(A)).rejects.toThrow("tile failed");
    expect(held(A)?.result).toBeInstanceOf(Promise);
    overlay.releaseTexture(A);
    expect(overlay.stats()).toMatchObject({ keptRegions: 0, releases: 1 });
    await settle();
    expect(held(A)).toBeUndefined();
    expect(disposeItem.mock.calls[0]?.[0]).toBeNull();

    const loading = overlay.lockTexture(B);
    loading.catch(() => {}); // the library aborts it on the release
    overlay.releaseTexture(B);
    expect(overlay.stats()).toMatchObject({ keptRegions: 0, releases: 2 });
    await settle();
    expect(held(B)).toBeUndefined();
    finish({ late: true });
    await settle();
    expect(disposeItem).toHaveBeenCalledTimes(2);
    expect(disposeItem.mock.calls[1]?.[0]).toBeNull();
    expect(source.count).toBe(0);
    vi.restoreAllMocks();
  });
});
