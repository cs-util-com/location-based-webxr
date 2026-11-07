/**
 * A kind's part in the world: the one three.js object a station shows for
 * an item, and what the page may ask of it (a tap, a frame, leaving and
 * coming back, going). The renderer places it (`content-placement.ts`);
 * the part itself never touches the scene, the camera, the renderer or the
 * frame loop.
 *
 * Every mounted part sits in one set (`mountWorldPart`), so the page finds
 * a tapped part, or one to tick, the same way for every kind. A part may
 * show nothing (an empty `Object3D`, a sound zone): it is still mounted,
 * placed and freed, and takes no tap.
 *
 * Its world is metres, Y up, origin at the item's foot on the ground.
 * Front is local +Z, right local +X: a station block's pose turns local +X
 * to its heading and local +Z to heading + 90 degrees (the QR poster rule,
 * `rotationFromHeading`).
 *
 * @see world-part.ts.md
 */

import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { CanvasTexture, SRGBColorSpace, type Object3D } from "three";

import { shownIn } from "./model-visitor.js";

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

/** What a kind's world part is given to build itself. */
export interface WorldEnv {
  readonly mode: WorldMode;
  /** A tour file by its asset id; rejects for an id the tour lacks. */
  loadAsset(id: string): Promise<Blob>;
  /** Words painted on `canvas` as a texture (`paintText`). */
  paintText(canvas: HTMLCanvasElement): CanvasTexture;
}

/** A kind's object in the world. */
export interface WorldPart {
  /** What stands: placed and turned by the renderer, never by the part. */
  readonly object: Object3D;
  /** What a tap is cast against (a stand's page, not its legs); none: the
   *  part takes no tap. */
  readonly tapTarget?: Object3D;
  update?(frame: WorldFrame): void;
  /** The visitor tapped `tapTarget`. */
  tap?(): void;
  /** The station's content stopped showing; `back` when it shows again. */
  leave?(): void;
  back?(): void;
  /** Frees every geometry, material and texture the part made. */
  dispose(): void;
}

/**
 * Words painted on a canvas, as the texture every part shows them with:
 * sRGB, and `anisotropy` for a page seen at a slant (three clamps it to
 * the renderer's largest).
 */
export function paintText(
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

/** A part's environment on a page: `mode`, and its files read through
 *  `load` by the path the tour's `assets` name for an id. */
export function worldEnv(
  mode: WorldMode,
  assets: readonly TourAsset[],
  load: (path: string) => Promise<Blob>,
): WorldEnv {
  const paths = new Map(assets.map((a) => [a.id, a.path]));
  return {
    mode,
    loadAsset(id) {
      const path = paths.get(id);
      return path === undefined
        ? Promise.reject(new Error(`no file "${id}" in the tour`))
        : load(path);
    },
    paintText: (canvas) => paintText(canvas),
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
