/**
 * The relief mounted under the globe's surface: the two carriers of the
 * ground and the band between them, one implementation for every page that
 * draws both (the globe lab, the Tour Viewer's editor on the globe).
 *
 * - The band's share (`createBandShare`): the relief's share of the pixels
 *   by the camera's altitude, a dithered cross-fade across the band
 *   (`GLOBE_FLIGHT.bandLowM` to `bandHighM`), gated by both carriers'
 *   readiness. Written to the surface's `uCarrierShare` each frame (the
 *   relief's tiles keep only the pixels under it, the globe's the rest).
 * - The release (`createBandRelease`): a carrier out of the band for
 *   `releaseMs` has its tile cache drained, keeping its coarsest tiles and
 *   any its last update used.
 * - The stencil fill (`globe-stencil-fill.ts`), with `fill`: the relief
 *   draws first and marks its pixels, the globe fills every pixel without
 *   a mark, coarse while the relief has them all.
 * - Who is drawn and updated (so fetched): each carrier only where it has
 *   pixels or the altitude wants it to.
 * - The cloud shell's share: the clouds move onto the shell as the relief
 *   takes the pixels (`setCloudShellShare`).
 *
 * The frame is split where a page has work of its own between the parts
 * (the lab's camera clearance and map): `step` (the share, the uniform and
 * the release), then `draw` (visibility, error target, the updates), then
 * `shareClouds` once the clouds' flat share is known.
 *
 * @see globe-relief-mount.ts.md
 */
import type * as THREE from "three";

import {
  createBandRelease,
  createBandShare,
  type BandRelease,
} from "./globe-band-step.js";
import { GLOBE_FLIGHT } from "./globe-flight.js";
import { asStencilFill, asStencilWriter } from "./globe-stencil-fill.js";
import type { TileCache } from "./globe-tile-cache.js";

/** The band's defaults: the globe lab's. */
export const GLOBE_RELIEF_BAND = Object.freeze({
  /** The band's top and bottom (m). */
  highM: GLOBE_FLIGHT.bandHighM,
  lowM: GLOBE_FLIGHT.bandLowM,
  /** The share waits for the carriers to be ready. */
  gate: true,
  /** The relief takes its first pixels only once its view is refined. */
  sharp: true,
  /** How long a carrier stays out of the band before its release (ms). */
  releaseMs: 5_000,
  /** Tiles drained a frame (0: the whole cache at once). */
  drainTiles: 8,
  /** The globe's error target while it only fills the relief's gaps. */
  fillErrorTarget: 1e6,
});

/**
 * A tile set as the mount reads and drives it (3d-tiles-renderer's). What
 * the renderer's typings leave out is read too, and checked when mounted
 * (a TypeError if missing): its `frameCount`, and its cache's
 * `cachedBytes` and `itemList` (`TileCache`).
 */
export interface GlobeReliefTiles {
  readonly root: unknown;
  readonly group: THREE.Object3D;
  readonly lruCache: object;
  errorTarget: number;
  readonly loadProgress: number;
  readonly downloadQueue: { readonly running: boolean };
  readonly parseQueue: { readonly running: boolean };
  readonly processNodeQueue: { readonly running: boolean };
  addEventListener(
    type: string,
    listener: (event: { scene: THREE.Object3D }) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: { scene: THREE.Object3D }) => void,
  ): void;
}

/** What the mount drives of the globe's surface. */
interface GlobeReliefSurface {
  readonly tiles: GlobeReliefTiles;
  readonly surfaceUniforms: { readonly uCarrierShare: { value: number } };
  update(camera: THREE.Camera, renderer: THREE.WebGLRenderer): void;
  setCloudShellShare(share: number, flat?: number): void;
}

type Log = (kind: string, detail: Record<string, unknown>) => void;
type Mark = (kind: string, detail?: Record<string, unknown>) => void;

export interface GlobeReliefMountOptions {
  readonly globe: GlobeReliefSurface;
  readonly relief: { readonly tiles: GlobeReliefTiles };
  /**
   * The stencil fill: the relief's materials write the mark and the
   * globe's draw only where none is, the relief's group drawn first. The
   * page's renderer needs a stencil buffer. Read once.
   */
  readonly fill: boolean;
  /** The band's rare events (hold, go, the share's steps, the drains). */
  readonly log?: Log;
  /** The frame recorder's marks (edges, mixed frames, drains). */
  readonly mark?: Mark;
}

/** One frame's band step; each field the band's default when left out. */
interface GlobeReliefStepFrame {
  /** The camera's altitude (m); a negative one counts as 0. */
  readonly altitudeM: number;
  readonly highM?: number;
  /** Kept under `highM` (at most `highM - 1`). */
  readonly lowM?: number;
  /** A fixed share in [0, 1] in place of the altitude's, or null. */
  readonly fixedShare?: number | null;
  readonly gate?: boolean;
  readonly sharp?: boolean;
  /** Both carriers' updates and the release held (a smoke's still frame). */
  readonly frozen?: boolean;
  readonly releaseMs?: number;
  readonly drainTiles?: number;
}

/** One frame's drawing and updates of the carriers. */
interface GlobeReliefDrawFrame {
  readonly camera: THREE.Camera;
  readonly renderer: THREE.WebGLRenderer;
  /** The relief's update for this frame (its camera, resolution, tiles). */
  readonly updateRelief: () => void;
  /** The globe's error target while it draws; the one it had at mount. */
  readonly errorTarget?: number;
  readonly fillErrorTarget?: number;
  /** The relief's tiles hidden (a smoke's), its share kept. */
  readonly reliefHidden?: boolean;
}

export interface GlobeReliefMount {
  /** The band's share this frame, written to `uCarrierShare`; the release. */
  step(nowMs: number, frame: GlobeReliefStepFrame): number;
  /** Who is drawn and updated this frame (after `step`). */
  draw(frame: GlobeReliefDrawFrame): void;
  /**
   * The cloud shell's share (the band's share, or 0 with `on` false), given
   * to the surface with the flat layer's `flat`; returns that share.
   */
  shareClouds(on: boolean, flat: number): number;
  /** The relief's drawn share (1 before the first step). */
  share(): number;
  /** The altitude's share before the gate (0 before the first step). */
  target(): number;
  /** The carriers' releases (live, for a page's readers). */
  readonly release: BandRelease;
  /** Whether the relief's view is refined: nothing of it loading or queued. */
  reliefSettled(): boolean;
  /** Takes the stencil fill's listeners off. */
  dispose(): void;
}

/** A carrier's coarsest tiles, which a drain keeps. */
const keepCoarsest = (tile: unknown) =>
  ((tile as { internal?: { depth?: number } } | null)?.internal?.depth ??
    Infinity) <= 1;

/**
 * What a drain keeps of `tiles`: its coarsest tiles, and any tile its last
 * update used (with the stencil fill the globe is updated while it fills,
 * and draining what it draws would only reload it).
 */
/** A tile set with what its typings leave out. */
type CountedTiles = Omit<GlobeReliefTiles, "lruCache"> & {
  readonly frameCount: number;
  readonly lruCache: TileCache;
};

/** `tiles` with what its typings leave out, checked; `name` names it in
 *  the error. */
function counted(tiles: GlobeReliefTiles, name: string): CountedTiles {
  const missing = (what: string) =>
    new TypeError(
      `mountGlobeRelief: the ${name}'s tiles renderer has no ${what}`,
    );
  if (typeof (tiles as { frameCount?: unknown }).frameCount !== "number") {
    throw missing("frameCount");
  }
  const cache = tiles.lruCache as { cachedBytes?: unknown; itemList?: unknown };
  if (typeof cache.cachedBytes !== "number") {
    throw missing("lruCache.cachedBytes");
  }
  if (!Array.isArray(cache.itemList)) throw missing("lruCache.itemList");
  return tiles as CountedTiles;
}

const keepFor = (tiles: CountedTiles) => (tile: unknown) => {
  if (keepCoarsest(tile)) return true;
  const traversal = (
    tile as { traversal?: { used?: boolean; lastFrameVisited?: number } } | null
  )?.traversal;
  return (
    traversal?.used === true && traversal.lastFrameVisited === tiles.frameCount
  );
};

/**
 * The globe's error target with the fill: coarse (`fillErrorTarget`) while
 * the relief has every pixel and is meant to, else the page's.
 */
function fillErrorTarget(
  frame: GlobeReliefDrawFrame,
  share: number,
  target: number,
  mountErrorTarget: number,
): number {
  return share >= 1 && target >= 1
    ? (frame.fillErrorTarget ?? GLOBE_RELIEF_BAND.fillErrorTarget)
    : (frame.errorTarget ?? mountErrorTarget);
}

/**
 * Which carrier a frame draws and updates. With the fill the globe always
 * draws (only where the relief left a pixel) and is always updated; a
 * carrier is updated (so loads) where it draws or where the altitude
 * wants it to: the gate waits for it to be ready.
 */
function carriersWanted(fill: boolean, share: number, target: number) {
  return {
    globeDrawn: fill || share < 1,
    globeUpdated: fill || share < 1 || target < 1,
    reliefUpdated: share > 0 || target > 0,
  };
}

/** Mounts the band between the globe's surface and `relief`. */
export function mountGlobeRelief(
  options: GlobeReliefMountOptions,
): GlobeReliefMount {
  const { globe, fill } = options;
  const globeTiles = counted(globe.tiles, "globe");
  const reliefTiles = counted(options.relief.tiles, "relief");
  const log: Log = options.log ?? (() => undefined);
  const mark: Mark = options.mark ?? (() => undefined);
  const mountErrorTarget = globeTiles.errorTarget;
  const reliefSettled = () =>
    reliefTiles.loadProgress === 1 &&
    !reliefTiles.downloadQueue.running &&
    !reliefTiles.parseQueue.running &&
    !reliefTiles.processNodeQueue.running;
  const band = createBandShare({
    globeTiles,
    reliefTiles,
    reliefSettled,
    log,
    mark,
  });
  const release = createBandRelease({
    globe: { cache: globeTiles.lruCache, keep: () => keepFor(globeTiles) },
    relief: {
      cache: reliefTiles.lruCache,
      keep: () => keepFor(reliefTiles),
    },
    log,
    mark,
  });

  // The stencil fill: every mesh a carrier loads gets its role.
  const unlisten: (() => void)[] = [];
  if (fill) {
    reliefTiles.group.renderOrder = -1;
    const roles = (
      tiles: CountedTiles,
      role: (m: THREE.Material) => THREE.Material,
    ) => {
      const listener = ({ scene }: { scene: THREE.Object3D }) => {
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) role(mesh.material as THREE.Material);
        });
      };
      tiles.addEventListener("load-model", listener);
      unlisten.push(() => {
        tiles.removeEventListener("load-model", listener);
      });
    };
    roles(reliefTiles, asStencilWriter);
    roles(globeTiles, asStencilFill);
  }

  let frozen = false;
  return {
    release,
    reliefSettled,
    share: () => band.share(),
    target: () => band.target(),
    step(nowMs, frame) {
      const altitudeM = Math.max(0, frame.altitudeM);
      const highM = frame.highM ?? GLOBE_RELIEF_BAND.highM;
      band.step(nowMs, {
        altitudeM,
        fixedShare: frame.fixedShare ?? null,
        highM,
        lowM: Math.min(frame.lowM ?? GLOBE_RELIEF_BAND.lowM, highM - 1),
        gate: frame.gate ?? GLOBE_RELIEF_BAND.gate,
        sharp: frame.sharp ?? GLOBE_RELIEF_BAND.sharp,
      });
      const share = band.share();
      globe.surfaceUniforms.uCarrierShare.value = share;
      frozen = frame.frozen === true;
      release.step(nowMs, {
        share,
        altitudeM,
        frozen,
        releaseMs: frame.releaseMs ?? GLOBE_RELIEF_BAND.releaseMs,
        drainTiles: frame.drainTiles ?? GLOBE_RELIEF_BAND.drainTiles,
      });
      return share;
    },
    draw(frame) {
      const share = band.share();
      const target = band.target();
      const wanted = carriersWanted(fill, share, target);
      globeTiles.group.visible = wanted.globeDrawn;
      // With the fill the globe is coarse while the relief has every
      // pixel, so it keeps to its top tiles.
      if (fill) {
        globeTiles.errorTarget = fillErrorTarget(
          frame,
          share,
          target,
          mountErrorTarget,
        );
      }
      if (wanted.globeUpdated && !frozen) {
        globe.update(frame.camera, frame.renderer);
      }
      reliefTiles.group.visible = share > 0 && frame.reliefHidden !== true;
      if (wanted.reliefUpdated && !frozen) frame.updateRelief();
    },
    shareClouds(on, flat) {
      const shellShare = on ? band.share() : 0;
      globe.setCloudShellShare(shellShare, flat);
      return shellShare;
    },
    dispose() {
      for (const off of unlisten.splice(0)) off();
    },
  };
}
