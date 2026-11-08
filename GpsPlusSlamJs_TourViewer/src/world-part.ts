/**
 * A kind's part in the world: the one three.js object a station shows for
 * an item, and what the page may ask of it (a tap, a frame, going). Each
 * hook has its driver: `tap` the visitor's tap, `update` the camera frame
 * (`tickWorldParts`). Leaving and coming back are added with a driver of
 * their own when a kind needs them. The renderer places it (`content-placement.ts`);
 * the part itself never touches the scene, the camera, the renderer or the
 * frame loop.
 *
 * Every mounted part sits in one set (`mountWorldPart`), so the page finds
 * a tapped part, or one to tick, the same way for every kind. A part may
 * show nothing (an empty `Object3D`, a sound zone): it is still mounted,
 * placed and freed, and takes no tap.
 *
 * Its world is metres, Y up, origin at the item's foot on the ground.
 * Front is local +Z, right local +X. The part takes its block's pose
 * rotation as it stands, tilt included, so where front points is that
 * rotation's: the editor's `facingRotation` turns +Z to the facing, the QR
 * poster rule `rotationFromHeading` turns +X to the heading (sidecar).
 *
 * @see world-part.ts.md
 */

import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { CanvasTexture, SRGBColorSpace, Vector3, type Object3D } from "three";

import { shownIn } from "./model-visitor.js";
import {
  SILENT_SOUND,
  SILENT_WORLD_SOUND,
  type SoundChannel,
  type SoundHandle,
  type WorldSound,
} from "./world-sound.js";

/** A part is built for a visitor (`play`) or for the editor (`edit`: the
 *  same object, still and silent). */
export type WorldMode = "play" | "edit";

/** One rendered frame, as a part's `update` reads it. */
interface WorldFrame {
  /** The page clock, in seconds. */
  readonly seconds: number;
  /** The viewer's position in the part's parent frame (metres). */
  readonly viewer: readonly [number, number, number];
}

/** The page's screen beside the world, where a part may open one panel
 *  of its own (a narration's player card). */
export interface WorldScreen {
  /** Opens what `build` puts into the host; returns the close, which runs
   *  `build`'s returned clean-up and empties the host. */
  show(build: (host: HTMLElement) => () => void): () => void;
}

/** A screen in `host` (the page's panel root): one panel at a time, a
 *  newer one closing the older. */
export function screenIn(host: HTMLElement): WorldScreen {
  let close: (() => void) | null = null;
  return {
    show(build) {
      close?.();
      const panel = host.ownerDocument.createElement("div");
      host.append(panel);
      const cleanUp = build(panel);
      const mine = (): void => {
        if (close !== mine) return;
        close = null;
        cleanUp();
        panel.remove();
      };
      close = mine;
      return mine;
    },
  };
}

/** What a kind's world part is given to build itself. */
export interface WorldEnv {
  readonly mode: WorldMode;
  /** A tour file by its asset id; rejects for an id the tour lacks. */
  loadAsset(id: string): Promise<Blob>;
  /** `canvas` as a texture (`canvasTexture`). */
  canvasTexture(canvas: HTMLCanvasElement): CanvasTexture;
  /** A sound of the tour by its asset id, heard by `channel`'s rule
   *  (`world-sound.ts`); in `edit` always the silent handle. */
  sound(id: string, channel: SoundChannel): SoundHandle;
  /** The page's screen, in `play` only (none: a part opens no panel). */
  readonly screen?: WorldScreen;
}

/** A kind's object in the world. */
export interface WorldPart {
  /** What stands: placed and turned by the renderer, never by the part. */
  readonly object: Object3D;
  /** What a tap is cast against (a stand's page, not its legs); none: the
   *  part takes no tap. */
  readonly tapTarget?: Object3D;
  /** One camera frame while the part's station shows (`tickWorldParts`). */
  update?(frame: WorldFrame): void;
  /** The visitor tapped `tapTarget`. */
  tap?(): void;
  /** Frees every geometry, material and texture the part made. */
  dispose(): void;
}

/**
 * A canvas as a texture, as every part shows one (painted words, a
 * figure, a shadow blob): sRGB, and `anisotropy` for a page seen at a
 * slant (three clamps it to the renderer's largest).
 */
export function canvasTexture(
  canvas: HTMLCanvasElement,
  options: { readonly anisotropy?: number } = {},
): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (options.anisotropy !== undefined) {
    texture.anisotropy = options.anisotropy;
  }
  return texture;
}

/** A part's environment on a page: `mode`, its files read through
 *  `load` by the path the tour's `assets` name for an id, and its sounds
 *  through the page's `sound` seam (none: silence); `screen` is
 *  handed on in `play` only. */
export function worldEnv(
  mode: WorldMode,
  assets: readonly TourAsset[],
  load: (path: string) => Promise<Blob>,
  sound: WorldSound = SILENT_WORLD_SOUND,
  screen?: WorldScreen,
): WorldEnv {
  const paths = new Map(assets.map((a) => [a.id, a.path]));
  const loadAsset = (id: string): Promise<Blob> => {
    const path = paths.get(id);
    return path === undefined
      ? Promise.reject(new Error(`no file "${id}" in the tour`))
      : load(path);
  };
  return {
    mode,
    loadAsset,
    canvasTexture: (canvas) => canvasTexture(canvas),
    sound: (id, channel) =>
      mode === "edit"
        ? SILENT_SOUND
        : sound.sound(() => loadAsset(id), channel),
    ...(mode === "play" && screen !== undefined ? { screen } : {}),
  };
}

const mounted = new Set<WorldPart>();

/** Adds `part` to the one mounted set (again: no change). */
export function mountWorldPart(part: WorldPart): void {
  mounted.add(part);
}

/** Takes `part` out of the set: false when it was not in it, so a second
 *  `dispose` can tell it already went. */
export function unmountWorldPart(part: WorldPart): boolean {
  return mounted.delete(part);
}

/** The parts mounted and not yet unmounted, oldest first. */
export function mountedWorldParts(): WorldPart[] {
  return [...mounted];
}

const viewerLocal = new Vector3();

/**
 * Every camera frame (`main.ts`): each of `parts` shown under a
 * station's content group of `scene` (`shownIn`) and having an
 * `update` is given the page clock (`nowMs`, as seconds) and the world
 * position of `viewer` (the camera) in its object's parent frame. No
 * scene or no camera: nothing is ticked.
 */
export function tickWorldParts(
  scene: Object3D | null,
  viewer: Object3D | null,
  nowMs: number,
  parts: readonly WorldPart[] = mountedWorldParts(),
): void {
  if (scene === null || viewer === null) return;
  const seconds = nowMs / 1000;
  for (const part of parts) {
    if (part.update === undefined || !shownIn(part.object, scene)) continue;
    const parent = part.object.parent;
    viewer.getWorldPosition(viewerLocal);
    if (parent !== null) parent.worldToLocal(viewerLocal);
    part.update({
      seconds,
      viewer: [viewerLocal.x, viewerLocal.y, viewerLocal.z],
    });
  }
}

/**
 * The visitor's tap on the world parts (`main.ts`): among `parts` shown
 * under a station's content group of `scene` (`shownIn`) and taking a tap,
 * the one whose `tapTarget` is under the tap (`pick`, the page's
 * `pickObjectInView`) is tapped. True when one was; no scene or no
 * candidate asks no pick.
 */
export function tapShownWorldPart<T>(
  scene: Object3D | null,
  pick: (targets: ReadonlyMap<string, Object3D>, tap: T) => string | null,
  tap: T,
  parts: readonly WorldPart[] = mountedWorldParts(),
): boolean {
  if (scene === null) return false;
  const byKey = new Map<string, WorldPart>();
  const targets = new Map<string, Object3D>();
  parts.forEach((part, i) => {
    if (part.tap === undefined || part.tapTarget === undefined) return;
    if (!shownIn(part.object, scene)) return;
    const key = `part-${String(i)}`;
    byKey.set(key, part);
    targets.set(key, part.tapTarget);
  });
  if (targets.size === 0) return false;
  const hit = pick(targets, tap);
  const part = hit === null ? undefined : byKey.get(hit);
  if (part === undefined) return false;
  part.tap?.();
  return true;
}
