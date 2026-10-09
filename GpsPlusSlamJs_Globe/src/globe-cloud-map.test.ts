/**
 * Why this test matters: the sharp cloud map (round-3 plan 2026-10-08-2345
 * §18) arrives in stages, and each stage is a promise the owner was given:
 * - the first look waits only for the small preview (DEC-R3-15), never for
 *   the four pieces of the full map;
 * - the pieces load only after the preview, in the background, and the
 *   globe swaps to the full map once, when all four are drawn into ONE
 *   texture (no seams, no shader change); every reader sees the swap;
 * - a piece that fails keeps the preview and is reported, never a hole;
 * - a device whose largest texture is under the full map's size keeps the
 *   preview, and says so;
 * - the decoded pieces are freed once drawn (DEC-R3-16, about 128 MB of
 *   RGBA on a phone otherwise), and after a WebGL context loss the map is
 *   rebuilt from the pieces, the preview shown meanwhile.
 * The GPU drawing itself is a seam (`CloudMapBuilder`); the browser smoke
 * `globe-cloud-map-8k.smoke.spec.mjs` checks the real one.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createGlobeCloudMap,
  type CloudMapBuilder,
} from "./globe-cloud-map.js";
import { globeSource, type GlobeSource } from "./globe-sources.js";

const CLOUDS = globeSource("clouds");

/** A loader whose maps finish or fail when a test says so. */
function stubLoader() {
  const calls: {
    source: GlobeSource;
    texture: THREE.Texture;
    finish: () => void;
    fail: () => void;
  }[] = [];
  return {
    calls,
    paths: () => calls.map((c) => c.source.path),
    call: (path: string) => {
      const found = calls.filter((c) => c.source.path === path).at(-1);
      if (!found) throw new Error(`no load of ${path}`);
      return found;
    },
    loadTexture(
      source: GlobeSource,
      onLoad: () => void,
      onError: () => void,
    ): THREE.Texture {
      const texture = new THREE.Texture();
      calls.push({
        source,
        texture,
        finish: () => {
          texture.image = { width: 4096, height: 2048 };
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

/** Steps the map through `n` frames. */
function frames(
  map: ReturnType<typeof createGlobeCloudMap>,
  renderer: THREE.WebGLRenderer,
  n: number,
) {
  for (let i = 0; i < n; i++) map.update(renderer);
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
  it("loads the pieces only once the preview has settled and a renderer is known", () => {
    for (const ending of ["finish", "fail"] as const) {
      const loader = stubLoader();
      const map = createGlobeCloudMap({ source: CLOUDS, loader });
      const { renderer } = stubRenderer();
      map.update(renderer);
      expect(loader.paths(), ending).toEqual([CLOUDS.path]);
      loader.call(CLOUDS.path)[ending]();
      expect(map.previewSettled, ending).toBe(true);
      map.update(renderer);
      expect(loader.paths().slice(1), ending).toEqual(PIECES);
      expect(map.state().full, ending).toBe("loading");
      map.dispose();
    }
  });

  it("swaps to ONE full-size texture once every piece is in and drawn, each piece at its place", () => {
    const loader = stubLoader();
    const { builder, draws, created } = stubBuilder();
    const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
    const { renderer } = stubRenderer();
    map.update(renderer);
    loader.call(CLOUDS.path).finish();
    map.update(renderer);
    const preview = map.texture;
    for (const path of PIECES.slice(0, 3)) loader.call(path).finish();
    frames(map, renderer, 5);
    // Three of four: still the preview, nothing drawn.
    expect(map.texture).toBe(preview);
    expect(draws).toHaveLength(0);
    loader.call(PIECES[3]!).finish();
    // One piece a frame (each is a 4,096 x 2,048 upload), then the swap.
    map.update(renderer);
    expect(created).toHaveLength(1);
    frames(map, renderer, 3);
    expect(map.texture).toBe(preview);
    map.update(renderer);
    expect(map.texture).toBe(created[0]);
    expect(map.state()).toMatchObject({
      stage: "full",
      full: "in",
      width: 8192,
      height: 4096,
    });
    // GL rows count from the bottom: row 0 (the north) is the upper half.
    expect(draws.map(({ x, y, last }) => [x, y, last])).toEqual([
      [0, 2048, false],
      [4096, 2048, false],
      [0, 0, false],
      [4096, 0, true],
    ]);
    expect(draws.map((d) => d.piece)).toEqual(
      PIECES.map((p) => loader.call(p).texture),
    );
    map.dispose();
  });

  // DEC-R3-16: about 128 MB of decoded RGBA on a phone otherwise. The
  // loader closes a piece's bitmap when its texture is disposed.
  it("frees every piece once the full map is built, and keeps the preview for later", () => {
    const loader = stubLoader();
    const { builder } = stubBuilder();
    const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
    const { renderer } = stubRenderer();
    loader.call(CLOUDS.path).finish();
    map.update(renderer);
    const disposed: string[] = [];
    for (const path of [CLOUDS.path, ...PIECES]) {
      loader
        .call(path)
        .texture.addEventListener("dispose", () => disposed.push(path));
    }
    for (const path of PIECES) loader.call(path).finish();
    frames(map, renderer, 5);
    expect(map.state().stage).toBe("full");
    expect(disposed.sort()).toEqual([...PIECES].sort());
    map.dispose();
    expect(disposed).toContain(CLOUDS.path);
  });

  it("keeps the preview when a piece fails, frees the others, and reports it", () => {
    const loader = stubLoader();
    const { builder, draws } = stubBuilder();
    const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
    const { renderer } = stubRenderer();
    loader.call(CLOUDS.path).finish();
    map.update(renderer);
    const preview = map.texture;
    const disposed: string[] = [];
    for (const path of PIECES) {
      loader
        .call(path)
        .texture.addEventListener("dispose", () => disposed.push(path));
    }
    loader.call(PIECES[0]!).finish();
    loader.call(PIECES[1]!).fail();
    loader.call(PIECES[2]!).finish();
    loader.call(PIECES[3]!).finish();
    frames(map, renderer, 6);
    expect(map.texture).toBe(preview);
    expect(draws).toHaveLength(0);
    expect(map.state()).toMatchObject({
      stage: "preview",
      full: "failed",
      piecesFailed: 1,
    });
    expect(disposed.sort()).toEqual([...PIECES].sort());
    expect(map.settled()).toEqual({ done: true, failed: false });
    map.dispose();
  });

  // The device keeps the preview: no 4,096 map is shipped (§18), and an
  // 8,192 texture the GPU cannot hold would be scaled down by three on the
  // CPU (a long stall) or fail.
  it("keeps the preview on a device whose largest texture is under the full map, and says so", () => {
    const loader = stubLoader();
    const map = createGlobeCloudMap({ source: CLOUDS, loader });
    const { renderer } = stubRenderer(4096);
    loader.call(CLOUDS.path).finish();
    frames(map, renderer, 3);
    expect(loader.paths()).toEqual([CLOUDS.path]);
    expect(map.state()).toMatchObject({ stage: "preview", full: "too-large" });
    expect(map.settled()).toEqual({ done: true, failed: false });
    map.dispose();
  });

  // The loading label and the smokes wait on this: the clouds count as
  // loaded once nothing more will come, and as failed only when nothing
  // is drawn at all.
  it("settles once the preview and the full map have, failing only when neither drew", () => {
    const run = (preview: "finish" | "fail", pieces: "finish" | "fail") => {
      const loader = stubLoader();
      const { builder } = stubBuilder();
      const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
      const { renderer } = stubRenderer();
      expect(map.settled()).toEqual({ done: false, failed: false });
      loader.call(CLOUDS.path)[preview]();
      map.update(renderer);
      expect(map.settled().done).toBe(false);
      for (const path of PIECES) loader.call(path)[pieces]();
      frames(map, renderer, 5);
      const settled = map.settled();
      map.dispose();
      return settled;
    };
    expect(run("finish", "finish")).toEqual({ done: true, failed: false });
    expect(run("fail", "finish")).toEqual({ done: true, failed: false });
    expect(run("finish", "fail")).toEqual({ done: true, failed: false });
    expect(run("fail", "fail")).toEqual({ done: true, failed: true });
  });

  // DEC-R3-16: three re-uploads a texture from its image after a context
  // loss, but the full map has no image (it was drawn from the pieces,
  // since freed): left alone it would come back empty, a cloudless Earth.
  // The preview shows at once, and the pieces load again once restored.
  it("shows the preview on a context loss and rebuilds the full map once restored", () => {
    const loader = stubLoader();
    const { builder, created } = stubBuilder();
    const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
    const { renderer, canvas } = stubRenderer();
    loader.call(CLOUDS.path).finish();
    map.update(renderer);
    for (const path of PIECES) loader.call(path).finish();
    frames(map, renderer, 5);
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
    // Nothing is loaded or drawn while the context is lost.
    frames(map, renderer, 3);
    expect(loader.paths()).toHaveLength(5);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    map.update(renderer);
    expect(loader.paths().slice(5)).toEqual(PIECES);
    for (const path of PIECES) loader.call(path).finish();
    frames(map, renderer, 5);
    expect(created).toHaveLength(2);
    expect(map.texture).toBe(created[1]);
    expect(map.state()).toMatchObject({ stage: "full", rebuilds: 1 });
    map.dispose();
  });

  // A loss in the middle of the build: the pieces already decoded are
  // dropped (the half-drawn texture is gone with the context), and late
  // answers from the first round are ignored.
  it("drops a build in progress on a context loss, and ignores the old round's late pieces", () => {
    const loader = stubLoader();
    const { builder, created } = stubBuilder();
    const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
    const { renderer, canvas } = stubRenderer();
    loader.call(CLOUDS.path).finish();
    map.update(renderer);
    const first = PIECES.map((p) => loader.call(p));
    const freed = new Set<THREE.Texture>();
    for (const call of first) {
      call.texture.addEventListener("dispose", () => freed.add(call.texture));
    }
    for (const call of first.slice(0, 3)) call.finish();
    canvas.dispatchEvent(new Event("webglcontextlost"));
    // The decoded pieces of the dropped round are freed at once.
    expect(freed.size).toBe(4);
    freed.clear();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    map.update(renderer);
    // The old round's late piece is freed as it arrives.
    first[3]!.finish();
    expect(freed).toEqual(new Set([first[3]!.texture]));
    frames(map, renderer, 5);
    expect(created).toHaveLength(0);
    for (const path of PIECES) loader.call(path).finish();
    frames(map, renderer, 5);
    expect(created).toHaveLength(1);
    expect(map.state()).toMatchObject({ stage: "full", rebuilds: 1 });
    map.dispose();
  });

  it("frees the preview, the full map and any piece on dispose, and stops listening", () => {
    const loader = stubLoader();
    const { builder, created } = stubBuilder();
    const map = createGlobeCloudMap({ source: CLOUDS, loader, builder });
    const { renderer, canvas } = stubRenderer();
    loader.call(CLOUDS.path).finish();
    map.update(renderer);
    for (const path of PIECES) loader.call(path).finish();
    frames(map, renderer, 5);
    const disposed: THREE.Texture[] = [];
    for (const t of [loader.call(CLOUDS.path).texture, created[0]!]) {
      t.addEventListener("dispose", () => disposed.push(t));
    }
    map.dispose();
    expect(disposed).toHaveLength(2);
    // A loss after dispose changes nothing.
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(map.state().full).toBe("in");
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
