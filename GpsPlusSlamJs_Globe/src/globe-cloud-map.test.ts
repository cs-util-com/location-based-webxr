/**
 * Why this test matters: the sharp cloud map (round-3 plan 2026-10-08-2345
 * §18) arrives in stages, and each stage is a promise the owner was given:
 * - the first look waits only for the small preview (DEC-R3-15), never for
 *   the four pieces of the full map;
 * - the pieces load only after the preview, in the background, are drawn
 *   into ONE texture (no seams, no shader change) as they arrive, and the
 *   globe swaps to it once, after the fourth; every reader sees the swap;
 * - at most two decoded pieces are held at a time (DEC-R3-16 and the M1b
 *   review: four together were about 134 MB of RGBA on a phone, on every
 *   load and every restore), each freed as soon as it is drawn;
 * - a piece that fails is asked for again, twice, with a backoff; one that
 *   still fails keeps the preview, never a hole;
 * - a device that cannot hold 8,192 gets the same pieces at half size
 *   (4,096), and only one under 4,096 keeps the preview;
 * - after a WebGL context loss the map is rebuilt, the preview shown
 *   meanwhile; and the per-frame step never throws.
 * The GPU drawing is a seam (`CloudMapBuilder`); the real one is driven
 * here through a recording renderer, and checked in the browser by
 * `globe-cloud-map-8k.smoke.spec.mjs`.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createGlobeCloudMap,
  type CloudMapBuilder,
} from "./globe-cloud-map.js";
import { globeSource, type GlobeSource } from "./globe-sources.js";

const CLOUDS = globeSource("clouds");

interface Call {
  source: GlobeSource;
  size: { width: number; height: number } | undefined;
  texture: THREE.Texture;
  finish: () => void;
  fail: () => void;
}

/**
 * A loader whose maps finish or fail when a test says so, counting the
 * piece textures alive (requested, not yet disposed; a texture disposed
 * again, as a late answer to a dropped round is, counts once).
 */
function stubLoader({ resizes = true } = {}) {
  const calls: Call[] = [];
  const alive = new Set<THREE.Texture>();
  let mostAlive = 0;
  return {
    calls,
    resizes,
    paths: () => calls.map((c) => c.source.path),
    pieceCalls: () => calls.filter((c) => c.source.path !== CLOUDS.path),
    call: (path: string) => {
      const found = calls.filter((c) => c.source.path === path).at(-1);
      if (!found) throw new Error(`no load of ${path}`);
      return found;
    },
    alive: () => alive.size,
    mostAlive: () => mostAlive,
    loadTexture(
      source: GlobeSource,
      onLoad: () => void,
      onError: () => void,
      size?: { width: number; height: number },
    ): THREE.Texture {
      const texture = new THREE.Texture();
      if (source.path !== CLOUDS.path) {
        alive.add(texture);
        mostAlive = Math.max(mostAlive, alive.size);
        texture.addEventListener("dispose", () => {
          alive.delete(texture);
        });
      }
      calls.push({
        source,
        size,
        texture,
        finish: () => {
          texture.image = size ?? { width: 4096, height: 2048 };
          onLoad();
        },
        fail: onError,
      });
      return texture;
    },
  };
}

/** A builder that records what it was asked to draw, and where. */
function stubBuilder() {
  const draws: { piece: THREE.Texture; x: number; y: number; last: boolean }[] =
    [];
  const created: THREE.Texture[] = [];
  const builder: CloudMapBuilder = {
    create: (_renderer, width, height) => {
      const full = new THREE.Texture();
      full.image = { width, height };
      created.push(full);
      return full;
    },
    draw: (_renderer, _full, piece, x, y, last) => {
      draws.push({ piece, x, y, last });
    },
  };
  return { builder, draws, created };
}

/** A renderer with a largest texture size and a canvas to lose. */
function stubRenderer(maxTextureSize = 16384) {
  const canvas = new EventTarget();
  return {
    canvas,
    renderer: {
      capabilities: { maxTextureSize },
      domElement: canvas,
    } as unknown as THREE.WebGLRenderer,
  };
}

const PIECES = [
  "/globe-assets/equirect/clouds-8192-0-0.webp",
  "/globe-assets/equirect/clouds-8192-1-0.webp",
  "/globe-assets/equirect/clouds-8192-0-1.webp",
  "/globe-assets/equirect/clouds-8192-1-1.webp",
];

type Map = ReturnType<typeof createGlobeCloudMap>;

/** Steps the map through `n` frames. */
function frames(map: Map, renderer: THREE.WebGLRenderer, n: number) {
  for (let i = 0; i < n; i++) map.update(renderer);
}

/**
 * Finishes every requested piece as it is asked for, a frame apart, until
 * the map settles or `limit` frames pass.
 */
function streamAll(
  map: Map,
  loader: ReturnType<typeof stubLoader>,
  renderer: THREE.WebGLRenderer,
  limit = 40,
) {
  const done = new Set<Call>();
  for (let i = 0; i < limit && map.state().full === "loading"; i++) {
    for (const c of loader.pieceCalls()) {
      if (!done.has(c)) {
        done.add(c);
        c.finish();
      }
    }
    map.update(renderer);
  }
}

/** A map with its preview in, and a first frame run. */
function started(
  opts: { maxTextureSize?: number; resizes?: boolean; now?: () => number } = {},
) {
  const loader = stubLoader({ resizes: opts.resizes ?? true });
  const { builder, draws, created } = stubBuilder();
  const map = createGlobeCloudMap({
    source: CLOUDS,
    loader,
    builder,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const { renderer, canvas } = stubRenderer(opts.maxTextureSize);
  loader.call(CLOUDS.path).finish();
  map.update(renderer);
  return { loader, builder, draws, created, map, renderer, canvas };
}

describe("createGlobeCloudMap", () => {
  it("reads the preview first, as one channel of numbers wrapping in longitude", () => {
    const loader = stubLoader();
    const map = createGlobeCloudMap({ source: CLOUDS, loader });
    expect(loader.paths()).toEqual([CLOUDS.path]);
    expect(map.texture).toBe(loader.call(CLOUDS.path).texture);
    expect(map.texture.format).toBe(THREE.RedFormat);
    expect(map.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(map.texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(map.previewSettled).toBe(false);
    expect(map.state()).toMatchObject({
      stage: "preview",
      preview: "loading",
      full: "waiting",
      rebuilds: 0,
    });
    map.dispose();
  });

  // DEC-R3-15: the first look waits for the preview only; the pieces come
  // after it, in the background, not beside it (they would compete with
  // the first look's own images).
  it("asks for the pieces only once the preview has settled and a renderer is known", () => {
    for (const ending of ["finish", "fail"] as const) {
      const loader = stubLoader();
      const map = createGlobeCloudMap({ source: CLOUDS, loader });
      const { renderer } = stubRenderer();
      map.update(renderer);
      expect(loader.paths(), ending).toEqual([CLOUDS.path]);
      loader.call(CLOUDS.path)[ending]();
      expect(map.previewSettled, ending).toBe(true);
      map.update(renderer);
      expect(loader.pieceCalls().length, ending).toBeGreaterThan(0);
      expect(map.state().full, ending).toBe("loading");
      map.dispose();
    }
  });

  // The M1b review: the four pieces held together were about 134 MB of
  // decoded RGBA on every load and every restore. Each piece is drawn as
  // it arrives (one a frame) and freed at once; no more than two are ever
  // alive, whatever the order they arrive in.
  it("draws each piece as it arrives and frees it at once, never holding more than two", () => {
    const { loader, draws, created, map, renderer } = started();
    // The texture is allocated on the first frame, before any piece is in.
    map.update(renderer);
    expect(created).toHaveLength(1);
    expect(loader.alive()).toBeLessThanOrEqual(2);
    // Answer the requests in reverse order of asking, one a frame.
    for (let i = 0; i < 20 && map.state().full === "loading"; i++) {
      const open = loader
        .pieceCalls()
        .filter((c) => c.texture.image === null)
        .reverse();
      open[0]?.finish();
      const before = draws.length;
      map.update(renderer);
      // At most one piece is drawn a frame.
      expect(draws.length - before).toBeLessThanOrEqual(1);
      expect(loader.alive()).toBeLessThanOrEqual(2);
    }
    expect(loader.mostAlive()).toBe(2);
    expect(loader.alive()).toBe(0);
    expect(draws).toHaveLength(4);
    expect(draws.filter((d) => d.last)).toHaveLength(1);
    expect(draws.at(-1)?.last).toBe(true);
    // Each piece at its place: GL rows count from the bottom, so row 0
    // (the north) is the upper half.
    const place = (path: string) => {
      const d = draws.find((x) => x.piece === loader.call(path).texture)!;
      return [d.x, d.y];
    };
    expect(PIECES.map(place)).toEqual([
      [0, 2048],
      [4096, 2048],
      [0, 0],
      [4096, 0],
    ]);
    expect(map.texture).toBe(created[0]);
    expect(map.state()).toMatchObject({
      stage: "full",
      full: "in",
      width: 8192,
      height: 4096,
      piecesDrawn: 4,
      piecesHeld: 0,
    });
    map.dispose();
  });

  it("keeps the preview until the fourth piece is drawn, then swaps once", () => {
    const { loader, created, map, renderer } = started();
    const preview = map.texture;
    map.update(renderer);
    const seen: [number, THREE.Texture][] = [];
    for (let i = 0; i < 20 && map.state().full === "loading"; i++) {
      for (const c of loader.pieceCalls()) {
        if (c.texture.image === null) c.finish();
      }
      map.update(renderer);
      seen.push([map.state().piecesDrawn, map.texture]);
    }
    // The preview while fewer than four are drawn, the full map after.
    for (const [drawnSoFar, texture] of seen) {
      expect(texture).toBe(drawnSoFar < 4 ? preview : created[0]);
    }
    expect(seen.at(-1)?.[0]).toBe(4);
  });

  // DEC-R3-16: three re-uploads a texture from its image after a context
  // loss, but the full map has no image (it was drawn from the pieces,
  // since freed): left alone it would come back empty, a cloudless Earth.
  it("shows the preview on a context loss and rebuilds the full map once restored", () => {
    const { loader, created, map, renderer, canvas } = started();
    streamAll(map, loader, renderer);
    const preview = loader.call(CLOUDS.path).texture;
    expect(map.texture).toBe(created[0]);
    let freed = false;
    created[0]!.addEventListener("dispose", () => {
      freed = true;
    });
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(map.texture).toBe(preview);
    expect(freed).toBe(true);
    expect(map.state()).toMatchObject({ stage: "preview", full: "lost" });
    const asked = loader.pieceCalls().length;
    frames(map, renderer, 3);
    expect(loader.pieceCalls()).toHaveLength(asked);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    map.update(renderer);
    expect(loader.pieceCalls().length).toBeGreaterThan(asked);
    streamAll(map, loader, renderer);
    expect(created).toHaveLength(2);
    expect(map.texture).toBe(created[1]);
    expect(map.state()).toMatchObject({ stage: "full", rebuilds: 1 });
    map.dispose();
  });

  it("drops a build in progress on a context loss, and frees the old round's late pieces", () => {
    const { loader, map, renderer, canvas } = started();
    map.update(renderer);
    const first = loader.pieceCalls();
    expect(first.length).toBe(2);
    first[0]!.finish();
    map.update(renderer);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    // Every piece of the dropped round is freed at once.
    expect(loader.alive()).toBe(0);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    map.update(renderer);
    const freed: THREE.Texture[] = [];
    first[1]!.texture.addEventListener("dispose", () =>
      freed.push(first[1]!.texture),
    );
    // The old round's late piece is freed as it arrives, and not drawn.
    first[1]!.finish();
    expect(freed).toEqual([first[1]!.texture]);
    streamAll(map, loader, renderer);
    expect(map.state()).toMatchObject({ stage: "full", rebuilds: 1 });
    map.dispose();
  });

  // The real GPU step, driven through a recording renderer: the empty map
  // is allocated with every mip level by empty descriptors (14 for 8,192 x
  // 4,096), nothing uploaded and no mipmaps built for it; each piece is a
  // copy at its place, flipped by the unpack state only for an image
  // element; the mipmaps are built on the last copy alone.
  it("allocates every mip level without building them, and builds them once on the last copy", () => {
    const loader = stubLoader();
    const map = createGlobeCloudMap({ source: CLOUDS, loader });
    const inits: { generate: boolean; levels: unknown[]; ready: boolean }[] =
      [];
    const copies: {
      x: number;
      y: number;
      generate: boolean;
      flipY: boolean;
    }[] = [];
    const canvas = new EventTarget();
    const renderer = {
      capabilities: { maxTextureSize: 16384 },
      domElement: canvas,
      initTexture: (t: THREE.DataTexture) =>
        inits.push({
          generate: t.generateMipmaps,
          levels: t.mipmaps,
          ready: t.source.dataReady,
        }),
      getContext: () => ({ UNPACK_COLORSPACE_CONVERSION_WEBGL: 1, NONE: 0 }),
      state: { pixelStorei: () => {} },
      copyTextureToTexture: (
        _src: THREE.Texture,
        dst: THREE.Texture,
        _region: unknown,
        at: THREE.Vector2,
      ) =>
        copies.push({
          x: at.x,
          y: at.y,
          generate: dst.generateMipmaps,
          flipY: dst.flipY,
        }),
    } as unknown as THREE.WebGLRenderer;
    loader.call(CLOUDS.path).finish();
    map.update(renderer);
    streamAll(map, loader, renderer);
    expect(inits).toHaveLength(1);
    expect(inits[0]!.generate).toBe(false);
    expect(inits[0]!.ready).toBe(false);
    const levels = inits[0]!.levels as { width: number; height: number }[];
    expect(levels).toHaveLength(14);
    expect(levels[0]).toMatchObject({ width: 8192, height: 4096 });
    expect(levels[12]).toMatchObject({ width: 2, height: 1 });
    expect(levels[13]).toMatchObject({ width: 1, height: 1 });
    expect(copies.map((c) => c.generate)).toEqual([false, false, false, true]);
    // The stub's images are plain objects (not ImageBitmaps): flipped.
    expect(copies.every((c) => c.flipY)).toBe(true);
    expect(map.texture.generateMipmaps).toBe(false);
    expect(map.state().full).toBe("in");
    map.dispose();
  });

  it("frees the preview, the full map and any piece on dispose, and stops listening", () => {
    const { loader, created, map, renderer, canvas } = started();
    streamAll(map, loader, renderer);
    const disposed: THREE.Texture[] = [];
    for (const t of [loader.call(CLOUDS.path).texture, created[0]!]) {
      t.addEventListener("dispose", () => disposed.push(t));
    }
    map.dispose();
    expect(disposed).toHaveLength(2);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(map.state().full).toBe("in");
  });

  it("keeps the preview when a piece fails, and frees every piece", () => {
    const { loader, map, renderer, draws } = started();
    map.update(renderer);
    loader.call(PIECES[0]!).fail();
    frames(map, renderer, 4);
    expect(map.texture).toBe(loader.call(CLOUDS.path).texture);
    expect(draws).toHaveLength(0);
    expect(map.state()).toMatchObject({
      stage: "preview",
      full: "failed",
      piecesFailed: 1,
      allocated: false,
      piecesHeld: 0,
    });
    expect(loader.alive()).toBe(0);
    map.dispose();
  });

  it("keeps the preview on a device whose largest texture is under the full map", () => {
    const s = started({ maxTextureSize: 4096 });
    frames(s.map, s.renderer, 3);
    expect(s.loader.pieceCalls()).toHaveLength(0);
    expect(s.map.state()).toMatchObject({
      stage: "preview",
      full: "too-large",
    });
    s.map.dispose();
  });

  it("settles once the preview and the full map have, failing only when neither drew", () => {
    const run = (preview: "finish" | "fail", pieces: "finish" | "fail") => {
      const loader = stubLoader();
      const { builder } = stubBuilder();
      const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
      const { renderer } = stubRenderer();
      loader.call(CLOUDS.path)[preview]();
      map.update(renderer);
      expect(map.settled().done).toBe(false);
      if (pieces === "fail") {
        map.update(renderer);
        loader.pieceCalls()[0]!.fail();
      } else {
        streamAll(map, loader, renderer);
      }
      const settled = map.settled();
      map.dispose();
      return settled;
    };
    expect(run("finish", "finish")).toEqual({ done: true, failed: false });
    expect(run("fail", "finish")).toEqual({ done: true, failed: false });
    expect(run("finish", "fail")).toEqual({ done: true, failed: false });
    expect(run("fail", "fail")).toEqual({ done: true, failed: true });
  });

  it("refuses a source that is not cut into pieces", () => {
    expect(() =>
      createGlobeCloudMap({
        source: globeSource("black-marble"),
        loader: stubLoader(),
      }),
    ).toThrow(RangeError);
  });
});
