/**
 * The globe's cloud map in two stages (round-3 plan 2026-10-08-2345 §18,
 * DEC-R3-13..16): a small preview loaded with the first look, then NASA's
 * full 8,192 x 4,096 map, fetched in four pieces in the background and
 * drawn into ONE one-channel texture on the GPU as they arrive, which
 * replaces the preview for every reader at once. A device that cannot
 * hold 8,192 but can hold 4,096 gets the same pieces decoded at half size.
 * Each decoded piece is freed as soon as it is drawn; after a WebGL context loss the preview
 * shows again and the full map is rebuilt from the pieces.
 *
 * @see globe-cloud-map.ts.md
 */
import * as THREE from "three";

import type { GlobeSurfaceLoader } from "./globe-map-loader.js";
import {
  globeMapPieces,
  type GlobeMapPiece,
  type GlobeSource,
} from "./globe-sources.js";

/**
 * How the full map is made on the GPU: a seam, so the staging is
 * unit-tested without a WebGL context (`gpuCloudMapBuilder` is the real
 * one, checked by the browser smoke).
 */
export interface CloudMapBuilder {
  /** A new full map of this size, allocated on the GPU, empty. */
  create(
    renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
  ): THREE.Texture;
  /**
   * Draws one decoded piece into `full` at (`x`, `y`), GL pixels (rows
   * from the bottom, the south); `last` builds the mipmaps after it.
   */
  draw(
    renderer: THREE.WebGLRenderer,
    full: THREE.Texture,
    piece: THREE.Texture,
    x: number,
    y: number,
    last: boolean,
  ): void;
}

/** Every mip level's size, the full size first, down to 1 x 1. */
function mipLevels(width: number, height: number) {
  const levels: { data: null; width: number; height: number }[] = [];
  let w = width;
  let h = height;
  for (;;) {
    levels.push({ data: null, width: w, height: h });
    if (w === 1 && h === 1) return levels;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
}

/**
 * The real builder: an empty `RedFormat` texture whose storage holds every
 * mip level, sized by empty `mipmaps` descriptors with `dataReady` false
 * (three then allocates the levels and uploads nothing; with
 * `generateMipmaps` on instead, three r185 also builds the mipmaps of the
 * empty map, a wasted pass over 44.7 MB: M1b review, item 3), filled by
 * `copyTextureToTexture` (texSubImage2D of the piece's own image, so a
 * piece never becomes a texture of its own on the GPU), the mipmaps built
 * once, on the last piece's copy.
 */
const gpuCloudMapBuilder: CloudMapBuilder = {
  create(renderer, width, height) {
    const full = new THREE.DataTexture(
      null,
      width,
      height,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    // The descriptors' data is never read: dataReady is false.
    full.mipmaps = mipLevels(width, height) as unknown as typeof full.mipmaps;
    full.source.dataReady = false;
    full.generateMipmaps = false;
    full.colorSpace = THREE.NoColorSpace;
    full.wrapS = THREE.RepeatWrapping;
    full.magFilter = THREE.LinearFilter;
    full.minFilter = THREE.LinearMipmapLinearFilter;
    full.needsUpdate = true;
    renderer.initTexture(full);
    return full;
  },
  draw(renderer, full, piece, x, y, last) {
    const image = piece.image as { width: number } | null;
    // WebGL never flips an ImageBitmap (the loader decoded it flipped); an
    // image element is flipped by the unpack state, which three takes
    // from the DESTINATION's flipY.
    full.flipY = !(
      typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap
    );
    // copyTextureToTexture builds the mipmaps after a copy while this is
    // on: once, on the last piece.
    full.generateMipmaps = last;
    const gl = renderer.getContext();
    // The grey levels are numbers: no colour conversion of an element.
    renderer.state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    try {
      renderer.copyTextureToTexture(piece, full, null, new THREE.Vector2(x, y));
    } finally {
      full.generateMipmaps = false;
    }
  },
};

/** Where the full map is. */
type CloudMapFullStatus =
  /** Waiting for the preview to settle and a renderer to be known. */
  | "waiting"
  /** Allocated; its pieces load and are drawn as they arrive. */
  | "loading"
  /** Drawn, and read by every cloud reader. */
  | "in"
  /** A piece failed after its retries: the preview stays. */
  | "failed"
  /**
   * The device's largest texture is under half the map (or under the map
   * where the loader cannot decode at half size): the preview stays.
   */
  | "too-large"
  /** The WebGL context is lost: the preview shows until it is restored. */
  | "lost";

interface GlobeCloudMapState {
  /** Which map the readers sample now. */
  readonly stage: "preview" | "full";
  /** That map's size (0 before the preview is in). */
  readonly width: number;
  readonly height: number;
  readonly preview: "loading" | "in" | "failed";
  readonly full: CloudMapFullStatus;
  /** 1 for the full map, 0.5 on a device that holds only half of it. */
  readonly scale: number;
  /** The full map's texture exists (allocated, being filled or in). */
  readonly allocated: boolean;
  /** Pieces drawn into it in the current round. */
  readonly piecesDrawn: number;
  /** Decoded pieces held now (loading, or in and not yet drawn). */
  readonly piecesHeld: number;
  /** Pieces that failed for good in the latest round (after retries). */
  readonly piecesFailed: number;
  /** Retries made in the latest round. */
  readonly retries: number;
  /** Full maps built again after a WebGL context loss. */
  readonly rebuilds: number;
  /** The page time (ms) the full map was first swapped in, or null. */
  readonly fullAtMs: number | null;
  /** Whether the images were decoded off the main thread (the preview's). */
  readonly bitmap: boolean;
}

export interface GlobeCloudMap {
  /** The map every cloud reader samples now: the preview, then the full. */
  readonly texture: THREE.Texture;
  /** The preview is in or has failed: the first look waits for this. */
  readonly previewSettled: boolean;
  /**
   * Per frame, with the renderer (it decides the device can hold the full
   * map, and draws it). Loads, draws and swaps.
   */
  update(renderer: THREE.WebGLRenderer): void;
  /**
   * For the global maps' counter: `done` once nothing more will come,
   * `failed` when nothing is drawn at all (no preview and no full map).
   */
  settled(): { done: boolean; failed: boolean };
  state(): GlobeCloudMapState;
  dispose(): void;
}

export interface GlobeCloudMapOptions {
  /** A registry source with `pieces` (the clouds). */
  readonly source: GlobeSource;
  readonly loader: GlobeSurfaceLoader;
  readonly builder?: CloudMapBuilder;
  /** The page clock (ms), for the retries' backoff and `fullAtMs`. */
  readonly now?: () => number;
}

/** A grey map as the shaders read it: one channel of numbers, wrapping. */
function configure(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.NoColorSpace;
  texture.format = THREE.RedFormat;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/**
 * Pieces held at once, loading or decoded and waiting to be drawn (M1b
 * review): two keeps the next one coming while one is drawn, and bounds
 * the decoded RGBA in memory to two pieces (about 64 MiB) instead of four
 * (about 134 MB, on every load and every restore).
 */
const MAX_HELD = 2;
/**
 * The waits before a failed piece is asked for again, ms (M1b review,
 * item 4): a dropped connection on a phone should not cost the sharp
 * clouds for the whole session. Two retries, then the preview stays.
 */
const RETRY_BACKOFF_MS = [1_000, 4_000] as const;

interface PieceLoad {
  readonly piece: GlobeMapPiece;
  texture: THREE.Texture | null;
  state: "loading" | "in" | "retry";
  /** Requests made for it so far. */
  attempts: number;
  /** When to ask again, page ms (state "retry"). */
  retryAt: number;
}

/**
 * The cloud map. @throws RangeError for a source without pieces.
 */
export function createGlobeCloudMap(
  options: GlobeCloudMapOptions,
): GlobeCloudMap {
  const { source, loader } = options;
  const builder = options.builder ?? gpuCloudMapBuilder;
  const now = options.now ?? (() => performance.now());
  const pieces = globeMapPieces(source);
  const cut = source.pieces;
  if (!cut || pieces.length === 0) {
    throw new RangeError(`${source.id} is not cut into pieces`);
  }
  let disposed = false;
  let previewState: GlobeCloudMapState["preview"] = "loading";
  const preview = configure(
    loader.loadTexture(
      source,
      () => {
        previewState = "in";
      },
      () => {
        previewState = "failed";
      },
    ),
  );
  let full: THREE.Texture | null = null;
  let status: CloudMapFullStatus = "waiting";
  let scale = 1;
  /** Pieces held now: requested, not yet drawn. */
  let held: PieceLoad[] = [];
  let nextPiece = 0;
  let drawn = 0;
  let piecesFailed = 0;
  let retries = 0;
  /** Bumped on every drop, so answers to a dropped round are freed. */
  let round = 0;
  let lostOnce = false;
  let rebuilds = 0;
  let fullAtMs: number | null = null;
  let canvas: EventTarget | null = null;

  const dropRound = () => {
    round += 1;
    for (const load of held) load.texture?.dispose();
    held = [];
    full?.dispose();
    full = null;
  };
  /** Asks for a piece (again); a failure waits for a retry or ends it. */
  const request = (load: PieceLoad) => {
    const mine = round;
    let texture: THREE.Texture | null = null;
    load.state = "loading";
    load.attempts += 1;
    const size =
      scale === 1
        ? undefined
        : {
            width: load.piece.width * scale,
            height: load.piece.height * scale,
          };
    texture = loader.loadTexture(
      { ...source, path: load.piece.path },
      () => {
        // An answer to a dropped round, or after dispose: free it.
        if (disposed || mine !== round) texture?.dispose();
        else load.state = "in";
      },
      () => {
        texture?.dispose();
        if (disposed || mine !== round) return;
        load.texture = null;
        const wait = RETRY_BACKOFF_MS[load.attempts - 1];
        if (wait === undefined) {
          piecesFailed += 1;
          dropRound();
          status = "failed";
          return;
        }
        load.state = "retry";
        load.retryAt = now() + wait;
      },
      size,
    );
    load.texture = texture;
  };
  /** Tops the held pieces up to `MAX_HELD`. */
  const topUp = () => {
    while (held.length < MAX_HELD && nextPiece < pieces.length) {
      const load: PieceLoad = {
        piece: pieces[nextPiece]!,
        texture: null,
        state: "loading",
        attempts: 0,
        retryAt: 0,
      };
      nextPiece += 1;
      held.push(load);
      request(load);
    }
  };
  /** Asks again for each failed piece whose wait is over. */
  const retryDue = () => {
    const time = now();
    for (const load of held) {
      if (load.state === "retry" && time >= load.retryAt) {
        retries += 1;
        request(load);
      }
    }
  };
  const onLost = () => {
    if (disposed) return;
    dropRound();
    status = "lost";
    lostOnce = true;
  };
  const onRestored = () => {
    if (disposed) return;
    status = "waiting";
  };
  const listen = (renderer: THREE.WebGLRenderer) => {
    const target = (renderer as { domElement?: unknown }).domElement;
    if (canvas || !(target instanceof EventTarget)) return;
    canvas = target;
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
  };

  /**
   * Once the preview has settled and the device is known: the full size if
   * it holds it; half (the same pieces decoded at half size, zero extra
   * bytes: M1b review, item 5) if it holds that and the loader can resize;
   * else the preview stays.
   */
  const start = (renderer: THREE.WebGLRenderer) => {
    const max = (renderer as { capabilities?: { maxTextureSize?: number } })
      .capabilities?.maxTextureSize;
    if (previewState === "loading" || typeof max !== "number") return;
    const fits = (s: number) => max >= cut.width * s && max >= cut.height * s;
    if (fits(1)) scale = 1;
    else if (loader.resizes === true && fits(0.5)) scale = 0.5;
    else {
      status = "too-large";
      return;
    }
    status = "loading";
    nextPiece = 0;
    drawn = 0;
    piecesFailed = 0;
    retries = 0;
    topUp();
  };
  /**
   * The first frame allocates; then one piece a frame, drawn as soon as it
   * is in and freed at once; the swap after the last.
   */
  const step = (renderer: THREE.WebGLRenderer) => {
    if (!full) {
      full = builder.create(renderer, cut.width * scale, cut.height * scale);
      return;
    }
    retryDue();
    const load = held.find((l) => l.state === "in");
    if (!load?.texture) return;
    const { left, top, height } = load.piece;
    const last = drawn === pieces.length - 1;
    // GL rows count from the bottom; a piece's top is from the north.
    builder.draw(
      renderer,
      full,
      load.texture,
      left * scale,
      (cut.height - top - height) * scale,
      last,
    );
    load.texture.dispose();
    held = held.filter((l) => l !== load);
    drawn += 1;
    if (!last) {
      topUp();
      return;
    }
    status = "in";
    if (lostOnce) rebuilds += 1;
    fullAtMs ??= now();
  };

  return {
    get texture() {
      return status === "in" && full ? full : preview;
    },
    get previewSettled() {
      return previewState !== "loading";
    },
    update(renderer) {
      if (disposed) return;
      listen(renderer);
      if (status === "waiting") start(renderer);
      else if (status === "loading") step(renderer);
    },
    settled() {
      const fullDone =
        status === "in" || status === "failed" || status === "too-large";
      const done = previewState !== "loading" && fullDone;
      return {
        done,
        failed: done && previewState === "failed" && status !== "in",
      };
    },
    state() {
      const current = status === "in" && full ? full : preview;
      const image = current.image as { width?: number; height?: number } | null;
      return {
        stage: current === preview ? "preview" : "full",
        width: image?.width ?? 0,
        height: image?.height ?? 0,
        preview: previewState,
        full: status,
        scale,
        allocated: full !== null,
        piecesDrawn: drawn,
        piecesHeld: held.length,
        piecesFailed,
        retries,
        rebuilds,
        fullAtMs,
        bitmap:
          typeof ImageBitmap !== "undefined" &&
          preview.image instanceof ImageBitmap,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas?.removeEventListener("webglcontextlost", onLost);
      canvas?.removeEventListener("webglcontextrestored", onRestored);
      dropRound();
      preview.dispose();
    },
  };
}
