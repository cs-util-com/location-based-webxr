/**
 * Why these tests matter: the street map is drawn on the relief's tiles,
 * and a fine relief tile that is drawn before its map arrives shows bare
 * relief where the coarser tile it replaced had the map (or at least the
 * same picture). The patched traversal (`patches/3d-tiles-renderer@0.5.3.patch`)
 * asks the renderer's `isTileReady(tile)` of each CHILD tile, and the map's
 * `mapReady` answers false while that tile's map is wanted and missing, so
 * the parent drawn now stays in its place. A hold with no end would freeze
 * the view on coarse tiles when the tile server is down, so the map gives a
 * tile up after `giveUpRetries` failed retries; a full request ceiling
 * holds the retries back and never counts towards that. These pin the
 * answer, its cache, the give-up path, and the traversal itself, run from
 * the library's own bundled build (what the page runs) on a fake tile tree.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { XYZTilesOverlay } from "3d-tiles-renderer/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GLOBE_OSM,
  GatedOsmOverlay,
  createGlobeOsmOverlay,
  createRequestCeiling,
} from "./globe-osm-overlay.js";

const DEG = Math.PI / 180;
const TEMPLATE = "https://tiles.example.test/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const LAT = 48.137;
const LON = 11.575;

const proto = XYZTilesOverlay.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

const cameraAt = (lat: number, lon: number, aboveM: number) =>
  WGS84_ELLIPSOID.getCartographicToPosition(
    lat * DEG,
    lon * DEG,
    aboveM,
    new THREE.Vector3(),
  );

/** A square region around a place (radians, [w, s, e, n]). */
const regionAround = (lat: number, lon: number, halfDeg: number) => [
  (lon - halfDeg) * DEG,
  (lat - halfDeg) * DEG,
  (lon + halfDeg) * DEG,
  (lat + halfDeg) * DEG,
];

interface Info {
  range: number[] | null;
  target: unknown;
  failed: boolean;
  meshInfo: Map<unknown, unknown>;
}

/** The library's traversal (bundled build, as patched), on a renderer. */
type Traverse = (root: object, renderer: object) => void;

/**
 * The traversal functions of the library's bundled build, the file the
 * page runs: from `function b(e)` (the loading-state helpers) to `te` (the
 * four passes), evaluated on their own. Their one outside name is `y`,
 * the view-error scratch object.
 */
function bundledTraversal(): { traverse: Traverse; source: string } {
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    "../node_modules/3d-tiles-renderer/build/renderer-_7gAivIK.js",
  );
  const text = readFileSync(file, "utf8");
  const from = text.indexOf("function b(e) {");
  const te = text.indexOf("function te(e, t) {");
  const to = text.indexOf("//#endregion", te);
  if (from < 0 || te < from || to < te) {
    throw new Error("the bundled traversal moved: look at the patch again");
  }
  const source = text.slice(from, to);
  // The bundled traversal itself, run as shipped: the point of the test.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function(
    `const y = { inView: false, error: Infinity, distanceFromCamera: Infinity };\n${source}\nreturn te;`,
  ) as () => Traverse;
  return { traverse: make(), source };
}

interface FakeTile {
  refine: "REPLACE";
  geometricError: number;
  parent: FakeTile | null;
  children: FakeTile[];
  internal: {
    hasContent: boolean;
    hasRenderableContent: boolean;
    hasUnrenderableContent: boolean;
    loadingState: number;
    depth: number;
    virtualChildCount: number;
  };
  traversal: Record<string, unknown>;
}

const LOADED = 4;

function fakeTile(geometricError: number, parent: FakeTile | null): FakeTile {
  const tile: FakeTile = {
    refine: "REPLACE",
    geometricError,
    parent,
    children: [],
    internal: {
      hasContent: true,
      hasRenderableContent: true,
      hasUnrenderableContent: false,
      loadingState: LOADED,
      depth: parent ? parent.internal.depth + 1 : 0,
      virtualChildCount: 0,
    },
    traversal: {},
  };
  parent?.children.push(tile);
  return tile;
}

/**
 * A relief's tiles as the overlay and the traversal see them: one parent
 * with four children near the camera (about z17), the overlay initialised
 * for real (its projection and levels), the plugin's per-tile state filled
 * in by hand, the plugin's reset of failed tiles a fake that marks them
 * failed again a second later (a server failing every request), and the
 * clock the request ceiling reads under the test's control.
 */
async function reliefWithMap({
  giveUpRetries,
}: { giveUpRetries?: number } = {}) {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const { traverse } = bundledTraversal();
  const visibleTiles = new Set<object>();
  const renderer = {
    frameCount: 0,
    errorTarget: 16,
    maxDepth: Infinity,
    loadSiblings: false,
    loadAncestors: false,
    displayActiveTiles: false,
    stats: { used: 0, inFrustum: 0, active: 0, visible: 0 },
    /** The camera close: the parent's error is over the target. */
    close: false,
    ensureChildrenArePreprocessed() {},
    calculateTileViewErrorWithPlugin(
      tile: FakeTile,
      target: { inView: boolean; error: number; distanceFromCamera: number },
    ) {
      target.inView = true;
      target.error = tile.geometricError * (renderer.close ? 10 : 0.1);
      target.distanceFromCamera = 0;
    },
    markTileUsed() {},
    queueTileForDownload() {},
    invokeOnePlugin() {},
    isTileReady: undefined as ((tile: object) => boolean) | undefined,
    group: new THREE.Group(),
    ellipsoid: WGS84_ELLIPSOID,
    registerPlugin: () => {},
    forEachLoadedModel: () => {},
    addEventListener: () => {},
    visibleTiles,
  };
  const osm = createGlobeOsmOverlay({
    url: TEMPLATE,
    attribution: ATTRIBUTION,
    maxZoom: 19,
    renderer: {} as THREE.WebGLRenderer,
    fadeM: 1000,
    ...(giveUpRetries === undefined ? {} : { giveUpRetries }),
  });
  await (osm.overlay as unknown as { init(): Promise<unknown> }).init();
  osm.attach({
    tiles: renderer,
    plugin: { sampleCartographicElevation: () => 0 },
  });
  osm.setEnabled(true);
  const projection = osm.overlay.projection as {
    fromCartographicToNormalizedRange(r: number[]): number[];
  };
  const tileInfo = (
    osm.plugin as unknown as {
      overlayInfo: Map<object, { tileInfo: Map<object, Info> }>;
    }
  ).overlayInfo.get(osm.overlay)!.tileInfo;
  const place = (tile: object, region: number[], target: unknown = null) => {
    const info: Info = {
      range: projection.fromCartographicToNormalizedRange(region),
      target,
      failed: false,
      meshInfo: new Map([[1, 1]]),
    };
    tileInfo.set(tile, info);
    return info;
  };
  const parent = fakeTile(100, null);
  const children = [0, 1, 2, 3].map(() => fakeTile(1, parent));
  // The parent is about z15 and near too, without its map: the hook is
  // asked of children only, so that must not matter.
  place(parent, regionAround(LAT, LON, 0.0008));
  const infos = children.map((c, i) =>
    place(
      c,
      regionAround(
        LAT + (i < 2 ? -0.0002 : 0.0002),
        LON + (i % 2 ? 0.0002 : -0.0002),
        0.0002,
      ),
    ),
  );
  /** Pending server answers: when, and which tile fails again. */
  const pending: { atMs: number; info: Info }[] = [];
  const reset = vi.fn(() => {
    for (const info of infos) {
      if (!info.failed) continue;
      info.failed = false;
      pending.push({ atMs: clock + 1_000, info });
    }
  });
  (
    osm.plugin as unknown as { resetFailedOverlays(): void }
  ).resetFailedOverlays = reset;
  // A re-evaluated tile's lock and texture job: the library's need a live
  // relief; here a lock holds nothing and the job never ends (the server's
  // answers are the fake reset's).
  vi.spyOn(proto, "lockTexture").mockImplementation(() =>
    Promise.resolve(null),
  );
  (
    osm.plugin as unknown as { _fetchTileOverlayTexture(): Promise<unknown> }
  )._fetchTileOverlayTexture = () => new Promise(() => {});
  /** One frame at `nowMs`: the server's answers, the map's update, the
   *  traversal; returns what was drawn. */
  const frame = (nowMs: number, aboveGroundM = 100) => {
    clock = nowMs;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i]!.atMs <= nowMs) {
        pending[i]!.info.failed = true;
        pending.splice(i, 1);
      }
    }
    osm.update({
      position: cameraAt(LAT, LON, aboveGroundM),
      aboveGroundM,
      speedMps: 0,
      nowMs,
    });
    renderer.frameCount++;
    traverse(parent, renderer);
    visibleTiles.clear();
    for (const t of [parent, ...children]) {
      if (t.traversal["visible"]) visibleTiles.add(t);
    }
    return {
      parent: parent.traversal["visible"] === true,
      children: children.filter((c) => c.traversal["visible"] === true).length,
    };
  };
  /** Fills the request ceiling now (the library's fetch answers at once). */
  const fillCeiling = async () => {
    vi.spyOn(proto, "fetch").mockImplementation(() => Promise.resolve("ok"));
    for (let i = 0; i < GLOBE_OSM.requestsPerMinute; i++) {
      await osm.overlay.fetch(`u${i}`);
    }
  };
  return {
    osm,
    renderer,
    place,
    tileInfo,
    parent,
    children,
    infos,
    reset,
    frame,
    fillCeiling,
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the patched traversal (the library's bundled build)", () => {
  // Why: the hook lives in the library's code, in the file the page runs.
  // If an install drops the patch, every test below would test the
  // traversal without it.
  it("asks the renderer's isTileReady of each child, in the child term only", () => {
    const { source } = bundledTraversal();
    expect(source).toContain(
      "!(i.traversal.active && A(i) && t.isTileReady?.(i) !== !1)",
    );
    const sharedA = source.slice(
      source.indexOf("function A(e) {"),
      source.indexOf("function j(e, t) {"),
    );
    expect(sharedA).not.toContain("isTileReady");
  });

  // Why: the control for the tests below: without a hook, loaded children
  // replace their parent the frame the camera comes close (the library's
  // own rule), so a held parent below is the hook's doing.
  it("draws loaded children in place of their parent without a hook", async () => {
    const r = await reliefWithMap();
    r.renderer.isTileReady = undefined;
    expect(r.frame(0)).toEqual({ parent: true, children: 0 });
    r.renderer.close = true;
    expect(r.frame(100)).toEqual({ parent: false, children: 4 });
  });

  // Why: the case the hook exists for: the children are loaded but their
  // map is not there yet, and the request ceiling is full, so it cannot be
  // asked for. The parent stays drawn in their place, every frame, and
  // the children replace it the frame their maps are in.
  it("keeps the parent drawn while its loaded children wait for their map", async () => {
    const r = await reliefWithMap();
    expect(r.frame(0)).toEqual({ parent: true, children: 0 });
    await r.fillCeiling();
    r.renderer.close = true;
    for (let t = 100; t <= 5_000; t += 100) {
      expect(r.frame(t)).toEqual({ parent: true, children: 0 });
    }
    expect(r.osm.mapLoad().givenUp).toBe(0);
    // The traversal's asks show in the stats: what a page checks to know
    // the patched traversal is the one it runs.
    expect(r.osm.stats().readinessAsks).toBeGreaterThan(0);
    for (const info of r.infos) info.target = { texture: 1 };
    expect(r.frame(5_100)).toEqual({ parent: false, children: 4 });
  });

  // Why: the give-up is by failed retries, never by the clock, and a full
  // request ceiling holds the retries back: a retry then is turned away by
  // the gate, not asked, so it says nothing about the server. Children
  // whose requests failed, under a ceiling full for a whole minute, keep
  // their parent drawn the whole minute, with no retry made.
  it("keeps the parent through a full ceiling for 60 s, with no retry counted", async () => {
    const r = await reliefWithMap();
    r.frame(0);
    for (const info of r.infos) info.failed = true;
    await r.fillCeiling();
    r.renderer.close = true;
    for (let t = 100; t < 60_000; t += 100) {
      expect(r.frame(t)).toEqual({ parent: true, children: 0 });
    }
    expect(r.reset).not.toHaveBeenCalled();
    expect(r.osm.mapLoad().givenUp).toBe(0);
  });

  // Why: a server that fails every request must not hold the coarse tile
  // forever. After `giveUpRetries` retries that failed again the children
  // are drawn (bare), the map's loading state says it gave them up, and
  // the retries go on, so a server that recovers still brings the map.
  it("gives the children up after the failed retries, and keeps asking", async () => {
    const r = await reliefWithMap();
    r.frame(0);
    for (const info of r.infos) info.failed = true;
    r.renderer.close = true;
    let t = 100;
    while (r.reset.mock.calls.length < GLOBE_OSM.giveUpRetries) {
      expect(r.frame(t)).toEqual({ parent: true, children: 0 });
      t += 100;
      expect(t).toBeLessThan(120_000);
    }
    // The last retry is still running: held.
    expect(r.frame(t)).toEqual({ parent: true, children: 0 });
    // It failed too: given up.
    t += 1_100;
    expect(r.frame(t)).toEqual({ parent: false, children: 4 });
    // The drawn children carry no map: the loading state names them.
    expect(r.osm.mapLoad()).toMatchObject({
      waiting: 4,
      failed: 4,
      givenUp: 4,
    });
    const calls = r.reset.mock.calls.length;
    for (let end = t + 70_000; t < end; t += 100) r.frame(t);
    expect(r.reset.mock.calls.length).toBeGreaterThan(calls);
  });

  // Why: the number of retries is the knob the sweep below picks; a
  // smaller one must give up sooner, 0 at the first failure.
  it("gives a tile up at the first failure with no retries allowed", async () => {
    const r = await reliefWithMap({ giveUpRetries: 0 });
    r.frame(0);
    for (const info of r.infos) info.failed = true;
    r.renderer.close = true;
    expect(r.frame(100)).toEqual({ parent: false, children: 4 });
  });
});

describe("mapReady", () => {
  // Why: the answer the traversal asks per child per frame: false only
  // for a tile whose map is wanted (on, near, z15 or finer) and missing.
  it("is false only for a near, fine tile without its map while the map is on", async () => {
    const r = await reliefWithMap();
    r.frame(0);
    const [a, b] = r.children;
    expect(r.osm.mapReady(a!)).toBe(false);
    r.infos[1]!.target = { texture: 1 };
    // A map's arrival is seen at once, not at the next look.
    expect(r.osm.mapReady(b!)).toBe(true);
    // Not a tile of the map's: never held.
    expect(r.osm.mapReady({})).toBe(true);
    // The map off (300 m up): nothing held.
    r.frame(100, 300);
    expect(r.osm.mapReady(a!)).toBe(true);
  });

  // Why: the distance and the zoom are worked out once per tile per
  // 500 ms look, not per frame (the traversal asks every child every
  // frame); a camera that moved less than the look's slack keeps the
  // answer until the next look.
  it("looks at a tile's distance once per 500 ms look", async () => {
    const r = await reliefWithMap();
    r.frame(0);
    const [a] = r.children;
    expect(r.osm.mapReady(a!)).toBe(false);
    // 10 m north, under the slack: the cached answer.
    const near = cameraAt(LAT + 0.00009, LON, 100);
    r.osm.update({
      position: near,
      aboveGroundM: 100,
      speedMps: 0,
      nowMs: 100,
    });
    expect(r.osm.mapReady(a!)).toBe(false);
    expect(GLOBE_OSM.lookSlackM).toBeGreaterThan(10);
  });

  // Why: a camera that jumps (a zoom step, a flight to an object) within a
  // look must not keep last look's answer: a tile that came into reach
  // would be drawn bare in place of its mapped parent until the next look.
  // A move past the slack starts a new look at once, both ways.
  it("looks again at once when the camera moved past the slack", async () => {
    const r = await reliefWithMap();
    r.frame(0);
    const [a] = r.children;
    const far = cameraAt(LAT + 0.05, LON, 100);
    r.osm.update({ position: far, aboveGroundM: 100, speedMps: 0, nowMs: 100 });
    expect(r.osm.mapReady(a!)).toBe(true);
    const back = cameraAt(LAT, LON, 100);
    r.osm.update({
      position: back,
      aboveGroundM: 100,
      speedMps: 0,
      nowMs: 200,
    });
    expect(r.osm.mapReady(a!)).toBe(false);
  });

  // Why: the gate asks for maps out to the fade's end (fadeM), and the map
  // is drawn at about 90 % well past the fade's start, so a tile between
  // the two must be held like a nearer one: held only inside the fade's
  // start, children 0.7-1 x fadeM away replaced a mapped parent bare, and
  // the traversal never swapped the parent back. Swept across the band.
  it.each([0.75, 0.85, 0.97])(
    "holds a tile at %s x the fade's reach, and none past it",
    async (share) => {
      const r = await reliefWithMap();
      r.frame(0);
      const mPerDeg = 111_200;
      const at = (m: number) => {
        const tile = {};
        r.place(tile, regionAround(LAT + m / mPerDeg, LON, 0.00005));
        return tile;
      };
      const fadeM = r.osm.uniforms.uOsmFadeM.value;
      expect(r.osm.mapReady(at(share * fadeM))).toBe(false);
      expect(r.osm.mapReady(at(1.2 * fadeM))).toBe(true);
    },
  );

  // Why: the gate and the hold must agree on what is near: a tile held
  // but never asked for would keep its parent drawn for good.
  it("asks for a map wherever it holds a tile for one", async () => {
    const r = await reliefWithMap();
    r.frame(0);
    const fadeM = r.osm.uniforms.uOsmFadeM.value;
    for (const share of [0.5, 0.9, 0.99, 1.01, 1.2]) {
      const tile = {};
      const info = r.place(
        tile,
        regionAround(LAT + (share * fadeM) / 111_200, LON, 0.00005),
      );
      expect(r.osm.overlay.wanted(info.range!)).toBe(!r.osm.mapReady(tile));
    }
  });

  // Why: a tile the map has no content for (the street map ends at about
  // 85 degrees of latitude) is never asked for and never gets a map; held
  // for one, its parent would be drawn there for good.
  it("never holds a tile the map has no content for", async () => {
    const r = await reliefWithMap();
    const polar = cameraAt(86.5, LON, 100);
    r.osm.update({ position: polar, aboveGroundM: 100, speedMps: 0, nowMs: 0 });
    const tile = {};
    r.place(tile, regionAround(86.5, LON, 0.0002));
    expect(r.osm.mapReady(tile)).toBe(true);
  });

  // Why: what the e2e of a zoom-in counts: a drawn tile near the camera
  // without its map under a parent that has one is the hold failing (the
  // parent's map replaced by bare relief). Given-up tiles are not counted.
  it("counts drawn tiles drawn bare under a mapped parent", async () => {
    const r = await reliefWithMap();
    r.frame(0);
    r.tileInfo.get(r.parent)!.target = { texture: 1 };
    r.renderer.visibleTiles.clear();
    for (const c of r.children) r.renderer.visibleTiles.add(c);
    expect(r.osm.coverage().bareUnderMap).toBe(4);
    r.infos[0]!.target = { texture: 1 };
    expect(r.osm.coverage().bareUnderMap).toBe(3);
  });

  it("refuses a give-up count that is not an integer >= 0", () => {
    for (const giveUpRetries of [-1, 1.5, Number.NaN]) {
      expect(() =>
        createGlobeOsmOverlay({
          url: TEMPLATE,
          attribution: ATTRIBUTION,
          maxZoom: 19,
          renderer: {} as THREE.WebGLRenderer,
          giveUpRetries,
        }),
      ).toThrow(RangeError);
    }
  });

  // Why: another hook already on the relief must keep its say.
  it("joins a hook that was there before", () => {
    const tiles = {
      group: new THREE.Group(),
      ellipsoid: WGS84_ELLIPSOID,
      registerPlugin: () => {},
      forEachLoadedModel: () => {},
      addEventListener: () => {},
      isTileReady: (tile: object) => tile !== held,
    };
    const held = {};
    const osm = createGlobeOsmOverlay({
      url: TEMPLATE,
      attribution: ATTRIBUTION,
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
    });
    osm.attach({ tiles, plugin: { sampleCartographicElevation: () => 0 } });
    expect(tiles.isTileReady(held)).toBe(false);
    expect(tiles.isTileReady({})).toBe(true);
    // Every ask is counted, whoever answers it.
    expect(osm.stats().readinessAsks).toBe(2);
  });
});

describe("a map request's time limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** An overlay whose library fetch never answers, but honours its signal. */
  function hangingOverlay(timeoutMs?: number) {
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(150),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    const signals: AbortSignal[] = [];
    vi.spyOn(proto, "fetch").mockImplementation(
      (_url: unknown, options: unknown) =>
        new Promise((_resolve, reject) => {
          const { signal } = options as { signal: AbortSignal };
          signals.push(signal);
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    return { overlay, signals };
  }

  // Why: a server that never answers held its download slot and left the
  // tile neither failed nor drawn, so it was never retried and never given
  // up. The request fails as a TimeoutError (the plugin then marks the
  // tile failed; an AbortError it would leave as it was), and the library's
  // request is aborted, freeing its slot.
  it("fails a request that never answers with a TimeoutError, aborting it", async () => {
    const { overlay, signals } = hangingOverlay();
    const outcome = overlay.fetch("a").then(
      () => "answered",
      (e: Error) => e.name,
    );
    await vi.advanceTimersByTimeAsync(GLOBE_OSM.requestTimeoutMs - 1);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("TimeoutError");
    expect(signals[0]!.aborted).toBe(true);
  });

  // Why: the library aborts a request for a tile it no longer needs; that
  // stays an AbortError (not a failure to retry).
  it("leaves the caller's own abort an AbortError", async () => {
    const { overlay } = hangingOverlay(1_000);
    const caller = new AbortController();
    const outcome = overlay.fetch("a", { signal: caller.signal }).then(
      () => "answered",
      (e: Error) => e.name,
    );
    caller.abort();
    expect(await outcome).toBe("AbortError");
  });

  it("lets an answer before the limit through, and stops the limit", async () => {
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(150),
      timeoutMs: 1_000,
    });
    let signal: AbortSignal | null = null;
    vi.spyOn(proto, "fetch").mockImplementation(
      (_url: unknown, options: unknown) => {
        signal = (options as { signal: AbortSignal }).signal;
        return Promise.resolve("ok");
      },
    );
    expect(await overlay.fetch("a")).toBe("ok");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signal!.aborted).toBe(false);
  });

  // Why: the library reads a tile's body after the answer's headers; a
  // server that sends the headers and then stalls held the download slot
  // with the time limit already cleared. The body is read inside the
  // limit, so a stalled body fails as a TimeoutError like no answer.
  it("fails an answer whose body stalls after its headers", async () => {
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(150),
      timeoutMs: 1_000,
    });
    vi.spyOn(proto, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(new ReadableStream({ start() {} }), { status: 200 }),
      ),
    );
    const outcome = overlay.fetch("a").then(
      () => "answered",
      (e: Error) => e.name,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBe("TimeoutError");
  });

  // Why: the body read inside the limit is handed on whole, with the
  // answer's status, so the library decodes the same tile.
  it("hands on an answer's body and status, read inside the limit", async () => {
    const overlay = new GatedOsmOverlay({
      url: TEMPLATE,
      maxZoom: 19,
      gate: () => true,
      ceiling: createRequestCeiling(150),
      timeoutMs: 1_000,
    });
    vi.spyOn(proto, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    const res = (await overlay.fetch("a")) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("refuses a time limit that is not finite and > 0", () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () =>
          new GatedOsmOverlay({
            url: TEMPLATE,
            maxZoom: 19,
            gate: () => true,
            ceiling: createRequestCeiling(1),
            timeoutMs,
          }),
      ).toThrow(RangeError);
    }
  });
});

/** A fake tile server: when a request started at `startS` (s) answers,
 *  after how long (s), and whether with the tile. */
type Server = (startS: number) => { afterS: number; ok: boolean };

const SERVERS: Record<string, Server> = {
  "one dropped request": (s) => ({ afterS: 0.3, ok: s > 0 }),
  "429 for 60 s": (s) => ({ afterS: 0.3, ok: s >= 60 }),
  "429 for 180 s": (s) => ({ afterS: 0.3, ok: s >= 180 }),
  "answers after 45 s": () => ({ afterS: 45, ok: true }),
  "answers after 90 s": () => ({ afterS: 90, ok: true }),
  "never answers": () => ({ afterS: Infinity, ok: false }),
};

const HORIZON_S = 600;

/**
 * One near tile without its map over `HORIZON_S`, its requests answered by
 * `server` and cut at `timeoutS` (as the overlay's time limit does), the
 * map's real retry clock and give-up rule deciding when it is held:
 * how long it was held (its parent drawn), how long drawn bare, and when
 * its map came (s, or null).
 */
async function simulate(
  server: Server,
  giveUpRetries: number,
  timeoutS: number,
) {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(proto, "lockTexture").mockImplementation(() =>
    Promise.resolve(null),
  );
  const osm = createGlobeOsmOverlay({
    url: TEMPLATE,
    attribution: ATTRIBUTION,
    maxZoom: 19,
    renderer: {} as THREE.WebGLRenderer,
    fadeM: 1000,
    giveUpRetries,
    timeoutMs: timeoutS * 1000,
  });
  await (osm.overlay as unknown as { init(): Promise<unknown> }).init();
  osm.attach({
    tiles: {
      group: new THREE.Group(),
      ellipsoid: WGS84_ELLIPSOID,
      registerPlugin: () => {},
      forEachLoadedModel: () => {},
      addEventListener: () => {},
    },
    plugin: { sampleCartographicElevation: () => 0 },
  });
  osm.setEnabled(true);
  const plugin = osm.plugin as unknown as {
    overlayInfo: Map<object, { tileInfo: Map<object, Info> }>;
    resetFailedOverlays(): void;
    _fetchTileOverlayTexture(): Promise<unknown>;
  };
  plugin._fetchTileOverlayTexture = () => new Promise(() => {});
  const tile = {};
  const info: Info = {
    range: (
      osm.overlay.projection as {
        fromCartographicToNormalizedRange(r: number[]): number[];
      }
    ).fromCartographicToNormalizedRange(regionAround(LAT, LON, 0.0002)),
    target: null,
    failed: false,
    meshInfo: new Map([[1, 1]]),
  };
  plugin.overlayInfo.get(osm.overlay)!.tileInfo.set(tile, info);
  let answer: { atS: number; ok: boolean } | null = null;
  const ask = (startS: number) => {
    const { afterS, ok } = server(startS);
    answer =
      afterS > timeoutS
        ? { atS: startS + timeoutS, ok: false }
        : { atS: startS + afterS, ok };
  };
  plugin.resetFailedOverlays = () => {
    info.failed = false;
    ask(clock / 1000);
  };
  ask(0);
  // The other requests a creator's view makes meanwhile (the tiles it
  // comes to): one every 2 s, answered at once by a server that answers
  // quickly, 200 or 429 as it would answer the tile.
  let backgroundOk = false;
  vi.spyOn(proto, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(new Uint8Array(1), { status: backgroundOk ? 200 : 429 }),
    ),
  );
  let heldS = 0;
  let bareS = 0;
  let mapAtS: number | null = null;
  const stepS = 0.1;
  for (let i = 0; i * stepS < HORIZON_S; i++) {
    const t = i * stepS;
    clock = t * 1000;
    if (i % 20 === 0 && server(t).afterS < 1) {
      backgroundOk = server(t).ok;
      await osm.overlay.fetch("background");
    }
    const a = answer as { atS: number; ok: boolean } | null;
    if (a && a.atS <= t) {
      answer = null;
      if (a.ok) {
        info.target = { texture: 1 };
        mapAtS ??= Math.round(a.atS * 10) / 10;
      } else {
        info.failed = true;
      }
    }
    osm.update({
      position: cameraAt(LAT, LON, 100),
      aboveGroundM: 100,
      speedMps: 0,
      nowMs: clock,
    });
    if (info.target !== null) continue;
    if (osm.mapReady(tile)) bareS += stepS;
    else heldS += stepS;
  }
  vi.restoreAllMocks();
  return {
    heldS: Math.round(heldS),
    bareS: Math.round(bareS),
    mapAtS,
  };
}

describe("the give-up knobs over a throttling fake server", () => {
  // Why: the two knobs trade a coarse tile held (the parent drawn, with
  // its own map where it has one) against a fine tile drawn bare, and one
  // value of each is a guess (the 2026-09-13 rule: sweep the plausible
  // range and report the verdict across it). Swept over 2, 3 and 4
  // retries and 30, 60 and 120 s limits against six servers, through the
  // map's real retry clock and give-up rule; the table is printed, and
  // what holds across the whole range is asserted.
  it("reports held and bare time across the range, and gives up on a dead server", async () => {
    const runs: Array<{
      name: string;
      n: number;
      timeoutS: number;
      r: Awaited<ReturnType<typeof simulate>>;
    }> = [];
    const waits = GLOBE_OSM.retryBackoffMs;
    for (const [name, server] of Object.entries(SERVERS)) {
      for (const n of [2, 3, 4]) {
        for (const timeoutS of [30, 60, 120]) {
          runs.push({
            name,
            n,
            timeoutS,
            r: await simulate(server, n, timeoutS),
          });
        }
      }
    }
    const rows = runs.map(
      ({ name, n, timeoutS, r }) =>
        `${name.padEnd(20)} N=${n} T=${String(timeoutS).padStart(3)}s  held ${String(r.heldS).padStart(3)} s  bare ${String(r.bareS).padStart(3)} s  map at ${r.mapAtS ?? "-"}`,
    );
    process.stderr.write(`\n${rows.join("\n")}\n`);
    // One drop: the map within the first wait, never drawn bare.
    for (const { r } of runs.filter((x) => x.name === "one dropped request")) {
      expect(r.mapAtS).toBeLessThan(waits[0]! / 1000 + 2);
      expect(r.bareS).toBe(0);
    }
    // A dead server: given up within the limits' sum and the waits, and
    // drawn bare from then on (unless that is past the horizon).
    for (const { n, timeoutS, r } of runs.filter(
      (x) => x.name === "never answers",
    )) {
      let bound = (n + 1) * timeoutS + 2 * (n + 1);
      for (let k = 0; k < n; k++) {
        bound += waits[Math.min(k, waits.length - 1)]! / 1000;
      }
      expect(r.heldS).toBeLessThanOrEqual(bound);
      expect(r.bareS > 0).toBe(bound < HORIZON_S);
      expect(r.mapAtS).toBeNull();
    }
    // The defaults wait out a slow server rather than cutting it off.
    const defaults = runs.find(
      (x) =>
        x.name === "answers after 45 s" &&
        x.n === GLOBE_OSM.giveUpRetries &&
        x.timeoutS * 1000 === GLOBE_OSM.requestTimeoutMs,
    );
    expect(defaults?.r).toEqual({ heldS: 45, bareS: 0, mapAtS: 45 });
    // A server refusing for a while, then answering: as soon as any
    // request is answered the failed tiles are asked for again (within the
    // first wait), not after the back-off's 60 s step. The bare time while
    // the server still refuses is the give-up's (held about 37 s, then
    // bare until it answers); what is pinned is the map within 10 s of the
    // server's return, at every give-up count and time limit. Before: the
    // map 37 s after a 60 s refusal ended (at 97 s), 38 s after a 180 s one.
    for (const [name, backS] of [
      ["429 for 60 s", 60],
      ["429 for 180 s", 180],
    ] as const) {
      for (const { r } of runs.filter((x) => x.name === name)) {
        expect(r.mapAtS).not.toBeNull();
        expect(r.mapAtS!).toBeLessThan(backS + 10);
      }
    }
  }, 120_000);
});
