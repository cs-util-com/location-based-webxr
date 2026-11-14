/**
 * A kind's part in the world: the one three.js object a station shows for
 * an item, and what the page may ask of it (a tap, a frame, going). Each
 * hook has its driver: `tap` the visitor's tap, `update` the camera frame
 * (`tickWorldParts`; in the editor its stations layer, which hands the
 * camera too). Leaving and coming back are added with a driver of
 * their own when a kind needs them. The renderer places it (`content-placement.ts`);
 * the part itself never touches the scene, the camera, the renderer or the
 * frame loop (it may read the camera a frame hands it).
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
import {
  CanvasTexture,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type Object3D,
} from "three";

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
  /** Where the viewer looks: a unit direction in the part's parent
   *  frame (a video that starts when looked at); absent where the page
   *  gives none. */
  readonly facing?: readonly [number, number, number];
  /** The camera drawing the frame, for a part that turns toward it or
   *  keeps a size on the screen (the editor's marks, a character's
   *  card, a hint's tag); absent where the page gives none. Read, never
   *  moved. */
  readonly camera?: Camera;
  /** How many metres one CSS px covers 1 m from `camera` (its lens over
   *  the view's height): a size on the screen at a distance `d` is
   *  `px * d * metresPerPxAtOneM` metres. Absent without `camera`. */
  readonly metresPerPxAtOneM?: number;
  /** The editor's selection (an item's id, `station:<id>` for a
   *  station), for a part that shows more of itself while selected (a
   *  character's bubble); absent where nothing is selected or the page
   *  has no selection (the visitor's). */
  readonly selected?: string | null;
}

/** The page's screen beside the world, where a part may open one panel
 *  of its own (a narration's player card). */
export interface WorldScreen {
  /** Opens what `build` puts into the host; returns the close, which runs
   *  `build`'s returned clean-up and empties the host. A panel a newer one
   *  pushed aside is built again once that one closes, so its close stays
   *  the one to call. */
  show(build: (host: HTMLElement) => () => void): () => void;
}

/** One panel asked for and not closed yet; `panel` while it shows. */
interface ScreenEntry {
  readonly build: (host: HTMLElement) => () => void;
  panel: HTMLElement | null;
  cleanUp: (() => void) | null;
}

/** What a screen tells the page. */
export interface ScreenOptions {
  /** A pushed-aside panel failed to build again when a newer one closed;
   *  default `console.error`. */
  readonly onError?: (error: unknown) => void;
}

/** A screen in `host` (the page's panel root): one panel at a time, the
 *  newest shown. A newer one takes the older one down (its clean-up
 *  runs) and, once it closes, the older one is built again: two
 *  overlapping narration circles hand the screen back and forth. */
export function screenIn(
  host: HTMLElement,
  options: ScreenOptions = {},
): WorldScreen {
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error(error);
    });
  /** Every panel asked for and not closed, the newest last. */
  const asked: ScreenEntry[] = [];
  const takeDown = (entry: ScreenEntry): void => {
    const { panel, cleanUp } = entry;
    entry.panel = null;
    entry.cleanUp = null;
    try {
      cleanUp?.();
    } finally {
      panel?.remove();
    }
  };
  const showNewest = (): void => {
    const entry = asked.at(-1);
    if (entry === undefined || entry.panel !== null) return;
    const panel = host.ownerDocument.createElement("div");
    host.append(panel);
    entry.panel = panel;
    try {
      entry.cleanUp = entry.build(panel);
    } catch (error) {
      // A build that throws shows nothing and is not asked again; the
      // panel it pushed aside comes back (one that throws too is dropped).
      asked.splice(asked.indexOf(entry), 1);
      entry.panel = null;
      panel.remove();
      try {
        showNewest();
      } catch {
        // Dropped as well; the first error is the one told.
      }
      throw error;
    }
  };
  return {
    show(build) {
      const shown = asked.at(-1);
      if (shown !== undefined) takeDown(shown);
      const entry: ScreenEntry = { build, panel: null, cleanUp: null };
      asked.push(entry);
      showNewest();
      return () => {
        const at = asked.indexOf(entry);
        if (at === -1) return;
        asked.splice(at, 1);
        try {
          takeDown(entry);
        } finally {
          // The rebuild is the other panel's: its throw is told, never
          // thrown into this close, which a part's dispose runs before
          // freeing its sound and its look.
          try {
            showNewest();
          } catch (error) {
            onError(error);
          }
        }
      };
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
  /** A 3D model file by its asset id, as a three scene; rejects for an id
   *  the tour lacks, or on a page that reads no model. */
  loadModel(id: string): Promise<Object3D>;
  /** Switches the renderer's clipping on, for a part cut by a plane; a
   *  page with no such switch does nothing. */
  enableClipping(): void;
  /** A sound of the tour by its asset id, heard by `channel`'s rule
   *  (`world-sound.ts`); in `edit` always the silent handle. */
  sound(id: string, channel: SoundChannel): SoundHandle;
  /** The page's screen, in `play` only (none: a part opens no panel). */
  readonly screen?: WorldScreen;
  /** Whether the visitor asked for less motion (none: the page does not
   *  say, so motion is allowed); read each frame, as it can change. */
  readonly reduceMotion?: () => boolean;
}

/** What a page gives its parts beyond reading files, every field
 *  optional: its sounds, its screen, a model reader, its renderer's
 *  clipping switch, the visitor's reduced-motion wish. */
export interface WorldEnvOptions {
  readonly sound?: WorldSound;
  readonly screen?: WorldScreen;
  readonly parseModel?: (blob: Blob) => Promise<Object3D>;
  readonly enableClipping?: () => void;
  readonly reduceMotion?: () => boolean;
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
  /** Settles once the part shows what it loads (a model's file), and
   *  rejects when it cannot show it; absent: it shows all at once. The
   *  renderer places the part at once and never waits for it; a part whose
   *  `ready` rejects is then freed, taken out and named in `skipped`. */
  readonly ready?: Promise<void>;
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
 *  `load` by the path the tour's `assets` name for an id, and what the
 *  page gives in `options`: its sounds (none: silence), its `screen`
 *  (handed on in `play` only), a model reader (none: a model is refused)
 *  and a clipping switch (none: ignored). */
export function worldEnv(
  mode: WorldMode,
  assets: readonly TourAsset[],
  load: (path: string) => Promise<Blob>,
  options: WorldEnvOptions = {},
): WorldEnv {
  const paths = new Map(assets.map((a) => [a.id, a.path]));
  const loadAsset = (id: string): Promise<Blob> => {
    const path = paths.get(id);
    return path === undefined
      ? Promise.reject(new Error(`no file "${id}" in the tour`))
      : load(path);
  };
  const {
    sound = SILENT_WORLD_SOUND,
    screen,
    parseModel,
    enableClipping,
    reduceMotion,
  } = options;
  return {
    mode,
    loadAsset,
    canvasTexture: (canvas) => canvasTexture(canvas),
    loadModel: (id) =>
      parseModel === undefined
        ? Promise.reject(new Error("this page reads no model"))
        : loadAsset(id).then(parseModel),
    enableClipping: () => {
      enableClipping?.();
    },
    sound: (id, channel) =>
      mode === "edit"
        ? SILENT_SOUND
        : sound.sound(() => loadAsset(id), channel),
    ...(mode === "play" && screen !== undefined ? { screen } : {}),
    ...(reduceMotion === undefined ? {} : { reduceMotion }),
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
const facingLocal = new Vector3();
const parentTurn = new Quaternion();

function isCamera(object: Object3D): object is Camera {
  return (object as Partial<Camera>).isCamera === true;
}

/**
 * Every camera frame (`main.ts`): each of `parts` shown under a
 * station's content group of `scene` (`shownIn`) and having an
 * `update` is given the page clock (`nowMs`, as seconds) and the world
 * position of `viewer` (the camera) in its object's parent frame, and
 * the direction it looks in that frame. A
 * viewer that is a camera is handed on too (a hint at the screen's edge
 * places its tag by it, a picture faces it), with its lens over
 * `viewHeightPx` (the view's height in CSS px) where that is given. No
 * scene or no camera: nothing is ticked.
 */
export function tickWorldParts(
  scene: Object3D | null,
  viewer: Object3D | null,
  nowMs: number,
  parts: readonly WorldPart[] = mountedWorldParts(),
  viewHeightPx?: number,
): void {
  if (scene === null || viewer === null) return;
  const seconds = nowMs / 1000;
  const camera = isCamera(viewer) ? viewer : undefined;
  const lens = camera?.projectionMatrix.elements[5] ?? 0;
  const metresPerPxAtOneM =
    camera !== undefined &&
    viewHeightPx !== undefined &&
    viewHeightPx > 0 &&
    lens > 0
      ? 2 / (lens * viewHeightPx)
      : undefined;
  for (const part of parts) {
    if (part.update === undefined || !shownIn(part.object, scene)) continue;
    const parent = part.object.parent;
    viewer.getWorldPosition(viewerLocal);
    viewer.getWorldDirection(facingLocal);
    if (parent !== null) {
      parent.worldToLocal(viewerLocal);
      parent.getWorldQuaternion(parentTurn);
      facingLocal.applyQuaternion(parentTurn.invert());
    }
    part.update({
      seconds,
      viewer: [viewerLocal.x, viewerLocal.y, viewerLocal.z],
      facing: [facingLocal.x, facingLocal.y, facingLocal.z],
      ...(camera === undefined ? {} : { camera }),
      ...(metresPerPxAtOneM === undefined ? {} : { metresPerPxAtOneM }),
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
