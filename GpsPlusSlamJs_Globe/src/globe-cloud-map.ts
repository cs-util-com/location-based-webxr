/**
 * The globe's cloud map in two stages (round-3 plan 2026-10-08-2345 §18,
 * DEC-R3-13..16): a small preview loaded with the first look, then NASA's
 * full 8,192 x 4,096 map, fetched in four pieces in the background and
 * drawn into ONE one-channel texture on the GPU, which replaces the
 * preview for every reader at once. The decoded pieces are freed once
 * drawn; after a WebGL context loss the preview shows again and the full
 * map is rebuilt from the pieces.
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

/**
 * The real builder: an empty `RedFormat` texture with storage for every
 * mip level (`dataReady` false: three allocates it and uploads nothing),
 * filled by `copyTextureToTexture` (texSubImage2D of the piece's image, so
 * the piece never becomes a texture of its own on the GPU), the mipmaps
 * generated once, after the last piece.
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
    full.source.dataReady = false;
    full.colorSpace = THREE.NoColorSpace;
    full.wrapS = THREE.RepeatWrapping;
    full.magFilter = THREE.LinearFilter;
    full.minFilter = THREE.LinearMipmapLinearFilter;
    // Storage for every level is allocated only while this is on.
    full.generateMipmaps = true;
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
    // copyTextureToTexture builds the mipmaps after every copy when this
    // is on: once, after the last piece, is enough.
    full.generateMipmaps = last;
    const gl = renderer.getContext();
    // The grey levels are numbers: no colour conversion of an element.
    renderer.state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    renderer.copyTextureToTexture(piece, full, null, new THREE.Vector2(x, y));
    full.generateMipmaps = true;
  },
};

/** Where the full map is. */
type CloudMapFullStatus =
  /** Waiting for the preview to settle and a renderer to be known. */
  | "waiting"
  /** Its pieces are loading. */
  | "loading"
  /** Its pieces are being drawn, one a frame. */
  | "building"
  /** Drawn, and read by every cloud reader. */
  | "in"
  /** A piece failed: the preview stays. */
  | "failed"
  /** The device's largest texture is smaller: the preview stays. */
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
  /** Pieces that failed in the latest round. */
  readonly piecesFailed: number;
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
   * map, and draws it). Loads, builds and swaps; never throws.
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
  /** The page clock, for `fullAtMs`. */
  readonly now?: () => number;
}

/** A grey map as the shaders read it: one channel of numbers, wrapping. */
function configure(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.NoColorSpace;
  texture.format = THREE.RedFormat;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

interface PieceLoad {
  readonly piece: GlobeMapPiece;
  readonly texture: THREE.Texture;
  state: "loading" | "in" | "failed";
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
  let round: PieceLoad[] = [];
  let drawn = 0;
  let piecesFailed = 0;
  let lostOnce = false;
  let rebuilds = 0;
  let fullAtMs: number | null = null;
  let canvas: EventTarget | null = null;

  const dropRound = () => {
    for (const load of round) load.texture.dispose();
    round = [];
  };
  const dropFull = () => {
    full?.dispose();
    full = null;
    drawn = 0;
  };
  const loadRound = () => {
    piecesFailed = 0;
    const loads: PieceLoad[] = [];
    for (const piece of pieces) {
      const load: PieceLoad = {
        piece,
        state: "loading",
        texture: loader.loadTexture(
          { ...source, path: piece.path },
          () => {
            load.state = "in";
            // A late answer from a round already dropped: free it.
            if (disposed || round !== loads) load.texture.dispose();
          },
          () => {
            load.state = "failed";
          },
        ),
      };
      loads.push(load);
    }
    round = loads;
    status = "loading";
  };
  const onLost = () => {
    if (disposed) return;
    dropRound();
    dropFull();
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

  /** Once the preview has settled: the pieces, if the device can hold them. */
  const start = (renderer: THREE.WebGLRenderer) => {
    const max = (renderer as { capabilities?: { maxTextureSize?: number } })
      .capabilities?.maxTextureSize;
    if (previewState === "loading" || typeof max !== "number") return;
    if (max < cut.width || max < cut.height) status = "too-large";
    else loadRound();
  };
  /** Once every piece has answered: build, or keep the preview. */
  const collect = (renderer: THREE.WebGLRenderer) => {
    if (round.some((load) => load.state === "loading")) return;
    piecesFailed = round.filter((load) => load.state === "failed").length;
    if (piecesFailed > 0) {
      dropRound();
      status = "failed";
      return;
    }
    status = "building";
    full = builder.create(renderer, cut.width, cut.height);
    drawn = 0;
  };
  /** One piece a frame (each is a large upload); the swap after the last. */
  const drawNext = (renderer: THREE.WebGLRenderer) => {
    const load = round[drawn];
    if (!full || !load) return;
    const { left, top, height } = load.piece;
    const last = drawn === round.length - 1;
    // GL rows count from the bottom; a piece's top is from the north.
    builder.draw(
      renderer,
      full,
      load.texture,
      left,
      cut.height - top - height,
      last,
    );
    drawn += 1;
    if (!last) return;
    dropRound();
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
      else if (status === "loading") collect(renderer);
      else if (status === "building") drawNext(renderer);
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
        piecesFailed,
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
      full?.dispose();
      preview.dispose();
    },
  };
}
