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
import { XYZTilesOverlay } from "3d-tiles-renderer/plugins";
import { describe, expect, it, vi } from "vitest";

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
