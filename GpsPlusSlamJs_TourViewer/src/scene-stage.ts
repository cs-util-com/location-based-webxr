/**
 * What a story shows in AR at its station (tour kit plan K4): a cut-out
 * character (a PNG figure such as the castle's knight) standing on the
 * station's spot and turned towards the visitor, or a 3D model (`.glb`)
 * placed with the station's pose. At the SCENE ROOT in the session's
 * GPS-world NUE, as the tour's other content (`content-placement.ts`).
 *
 * One thing at a time: a new figure or model replaces the previous one, and
 * `clear` removes it (the story ended or was stopped). A decode that lands
 * after the stage moved on is disposed, never shown. A station with no
 * position yet does not fail the show: what was decoded waits for it, and
 * the show's `onWaiting` says so (the guide holds the pose back until the
 * alignment has a heading, which can take a walk).
 *
 * The figure follows its station's presence (visitor plan 2026-10-18-2349,
 * "the figure fades, the audio plays on"): `follow` is told each tick
 * which stations' content shows; a figure whose station stops showing fades
 * out and leaves the scene, kept decoded, and fades back in when the
 * visitor steps back. One decoded while its station is not shown waits off
 * the scene. The story panel and its sound are not the stage's: they play
 * on (`scene-view.ts`).
 *
 * The character's size and placement are the K4 build agent's choice, not
 * the owner's (the plan leaves them open; revised by K4 review R6): 1.7 m
 * tall, its feet at the station's altitude, facing the visitor about the
 * vertical only. A code-only station's pose (from the guide) stands on the
 * estimated ground below the code and is turned about the vertical only,
 * so a model there takes the code's yaw, never its tilt.
 *
 * A character in one of the story views (`bubble`, `speak`, `two-stations`,
 * `portrait`, `popup`; tour format 4.2) stands as a character LOOK
 * (`character-look.ts`): a die-cut figure that turns itself, with its
 * bubble, name tag, ring or pop-up stage, updated every rendered frame
 * against the viewer's camera while it shows. Its fade is the look's own
 * presence (`setSubtreeOpacity` caches material opacities the look changes
 * every frame), and its holder is never turned. It stands at the block's
 * pose in the station's frame and rests at the block's facing, which the
 * look turns from toward the visitor by at most 60 degrees.
 *
 * After his step a look stays (`release`, the story ended): idle,
 * beckoning in two stations, until his station stops showing; then he
 * fades out and is let go for good, so he does not come back on a return.
 * Any other figure or model leaves with its story, as before.
 */

import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";

import {
  CONTENT_FADE_MS,
  setSubtreeOpacity,
  stepAlpha,
} from "./content-fade.js";
import {
  createCharacterLook,
  type CharacterBeckon,
  type CharacterLook,
  type CharacterPainters,
  type CharacterVoice,
} from "./character-look.js";
import type { FigureSource } from "./character-canvas.js";
import { restYawOf, type StageCharacterView } from "./character-views.js";
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type Object3D,
  type Texture,
} from "three";

/** What a character speaks in one of the story views. */
export interface StageCharacterLook {
  readonly view: StageCharacterView;
  readonly name: string;
  /** The step's caption: the bubble's or the scroll's line. */
  readonly line: string;
  /** The line has a voice, which a tap plays; default false. */
  readonly voiced?: boolean;
  /** The image is his frames sheet (four poses in one row), which the look
   *  slices; default false (one pose). */
  readonly sheet?: boolean;
  /** The block's pose in the station's frame (NUE m, a quaternion [x, y,
   *  z, w]); absent: on the station's spot, facing its +Z. */
  readonly pose?: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
  };
}

/** A cut-out character's height (m): a standing adult. */
export const CHARACTER_HEIGHT_M = 1.7;

export interface StagePose {
  readonly positionNue: readonly [number, number, number];
  readonly rotationNue: readonly [number, number, number, number];
}

export interface SceneStageDeps {
  getScene(): Object3D | null;
  /** The station's pose at the scene root, or null when it cannot be
   *  placed yet (no GPS zero, or no heading yet: the guide's
   *  `figurePoseOf`). */
  poseOf(stationId: string): StagePose | null;
  /** Decode a figure within the decode caps (`station-prefetch.ts`
   *  `decodeFigure`: its size read from its own header). */
  decodeTexture(blob: Blob): Promise<Texture | null>;
  /** A `.glb` already checked inert (`checkGlbInert`, K0). */
  loadModel(blob: Blob): Promise<Object3D>;
  /** The page clock (ms) for the figure's fade; default `Date.now`. */
  now?(): number;
  /** The fade's length (ms); default `CONTENT_FADE_MS`, as the station's
   *  own content. */
  readonly fadeMs?: number;
  /** Register a per-rendered-frame callback (the AR frame loop) while a
   *  fade runs; returns its unregister. Absent: the fade advances on
   *  `follow` calls only. */
  registerFrame?(fn: () => void): () => void;
  /** The viewer's camera, which a character look turns and opens to;
   *  absent or null: the look stands still until it has one. */
  getCamera?(): Camera | null;
  /** Where a character at this station beckons (the next station, as an
   *  NUE offset from his own pose, and its title), or null for none. */
  beckonOf?(stationId: string): CharacterBeckon | null;
  /** The look's painters (tests run without a canvas); default the
   *  canvas ones. */
  readonly lookPainters?: CharacterPainters;
}

export interface SceneStage {
  /** Settles once the figure stands (or the stage moved on). `onWaiting`
   *  is called once if, decoded, it waits for the station's pose. With a
   *  `look`, the figure stands as that story view's character look. */
  showCharacter(
    stationId: string,
    image: Blob,
    onWaiting?: () => void,
    look?: StageCharacterLook,
  ): Promise<void>;
  /** The step's voice: a look's ring, footer and beckon follow it. Kept
   *  across a figure's replacement (the voice may start first). It
   *  reaches a released look too: a tap on him after his story plays his
   *  voice again (a new story clears the stage first). `durationMs`: the
   *  voice's length, when known (`CharacterLook.setVoice`). */
  setVoice(voice: CharacterVoice, durationMs?: number): void;
  showModel(
    stationId: string,
    model: Blob,
    onWaiting?: () => void,
  ): Promise<void>;
  clear(): void;
  /** The story ended: a standing character look stays, heard, until its
   *  station stops showing, then goes for good; anything else is cleared
   *  as by `clear`. */
  release(): void;
  /** The standing look's visible parts, for the visitor's tap
   *  (`CharacterLook.tapTargets`); none while no look stands in the
   *  scene. */
  characterTapTargets(): Object3D[];
  /** A tap on the bubble view's look: its bubble shuts, or opens again. */
  toggleBubble(): void;
  /** Turn a standing character towards the visitor (NUE). */
  faceVisitor(visitorNue: readonly [number, number, number]): void;
  /** Which stations' content shows now (the present one, or all): the
   *  figure fades in or out with its station. Every tick. */
  follow(isShown: (stationId: string) => boolean): void;
}

export function createSceneStage(deps: SceneStageDeps): SceneStage {
  const now = (): number => deps.now?.() ?? Date.now();
  const fadeMs = deps.fadeMs ?? CONTENT_FADE_MS;
  /** The scene it was added to, kept: the e2e scene root is a stub that
   *  sets no `parent`. `inScene` and `alpha`: the presence fade. */
  let shown: {
    root: Object3D;
    scene: Object3D;
    character: boolean;
    stationId: string;
    inScene: boolean;
    alpha: number;
    target: number;
    lastMs: number;
    look: CharacterLook | null;
    /** The look's offset from the station's own position (NUE m), which
     *  its beckon starts from. */
    offset: Vector3;
    /** Released (`release`): it goes for good once faded out. */
    released: boolean;
  } | null = null;
  /** Which stations' content shows (`follow`); everything until told. */
  let isShown: (stationId: string) => boolean = () => true;
  let unregisterFrame: (() => void) | null = null;
  /** The look's per-frame update, registered while a look stands. */
  let unregisterLook: (() => void) | null = null;
  let voice: CharacterVoice = "idle";
  let voiceMs: number | undefined;
  let token = 0;
  /** Decoded and waiting for the station's position (no GPS zero yet, or a
   *  code-only station before the visitor's height is known): mounted on
   *  the next visitor update that has one (K4 review R8: it used to fail
   *  for good, and the story said "could not be loaded"). */
  let waiting: {
    mine: number;
    stationId: string;
    root: Object3D;
    character: boolean;
    look: CharacterLook | null;
    lookPose: StageCharacterLook["pose"];
    settle: () => void;
  } | null = null;

  function clear(): void {
    token += 1;
    if (waiting !== null) {
      waiting.look?.dispose();
      disposeObject3D(waiting.root);
      waiting.settle();
      waiting = null;
    }
    if (shown === null) return;
    if (shown.inScene) shown.scene.remove(shown.root);
    shown.look?.dispose();
    disposeObject3D(shown.root);
    shown = null;
    stopFrames();
    unregisterLook?.();
    unregisterLook = null;
  }

  function stopFrames(): void {
    unregisterFrame?.();
    unregisterFrame = null;
  }

  /** The look's frame: it turns, opens and beckons against the camera. */
  function tickLook(): void {
    const look = shown?.look ?? null;
    if (shown === null || look === null || !shown.inScene) return;
    const camera = deps.getCamera?.() ?? null;
    if (camera === null) return;
    look.setBeckon(beckonFrom(shown.stationId, shown.offset));
    look.update({ nowMs: now(), camera });
  }

  /** The station's beckon, from the look's own place (it may stand off
   *  the station's position). */
  function beckonFrom(
    stationId: string,
    offset: Vector3,
  ): CharacterBeckon | null {
    const b = deps.beckonOf?.(stationId) ?? null;
    if (b === null) return null;
    return { dx: b.dx - offset.x, dz: b.dz - offset.z, title: b.title };
  }

  /** Keep the look's frame registered (a session's end clears the
   *  registry; registering is idempotent per function). Without a frame
   *  loop the look follows the page's ticks. */
  function keepLookTicking(): void {
    if (shown?.look == null) return;
    if (deps.registerFrame === undefined) tickLook();
    else unregisterLook = deps.registerFrame(tickLook);
  }

  /** The figure's fade: a look's own presence, else every material's. */
  function applyAlpha(
    root: Object3D,
    look: CharacterLook | null,
    alpha: number,
  ): void {
    if (look !== null) look.setPresence(alpha);
    else setSubtreeOpacity(root, alpha);
  }

  /** Fade the figure towards its station's presence; it leaves the scene
   *  once faded out and comes back (from 0) when its station shows again. */
  function advance(): void {
    if (shown === null) return;
    const t = now();
    const target = isShown(shown.stationId) ? 1 : 0;
    if (target !== shown.target) {
      shown.target = target;
      shown.lastMs = t;
    }
    if (target === 1 && !shown.inScene) {
      shown.scene.add(shown.root);
      shown.inScene = true;
    }
    const before = shown.alpha;
    shown.alpha = stepAlpha(shown.alpha, target, t - shown.lastMs, fadeMs);
    shown.lastMs = t;
    // The page follows on every tick: a settled figure writes no material.
    if (shown.alpha !== before) applyAlpha(shown.root, shown.look, shown.alpha);
    if (target === 0 && shown.alpha <= 0 && shown.inScene) {
      if (shown.released) {
        clear();
        return;
      }
      shown.scene.remove(shown.root);
      shown.inScene = false;
    }
    if (shown.alpha === target) {
      stopFrames();
    } else if (deps.registerFrame !== undefined) {
      // Idempotent per function: a session's end clears the registry, and
      // the next fade registers again.
      unregisterFrame = deps.registerFrame(advance);
    }
  }

  /** Mount `root` at the station, unless the stage moved on meanwhile;
   *  settles once it is mounted (or dropped). */
  function mount(
    mine: number,
    stationId: string,
    root: Object3D,
    character: boolean,
    onWaiting: (() => void) | undefined,
    look: CharacterLook | null = null,
    lookPose?: StageCharacterLook["pose"],
  ): Promise<void> {
    if (mine !== token) {
      look?.dispose();
      disposeObject3D(root);
      return Promise.resolve();
    }
    if (tryMount(stationId, root, character, look, lookPose)) {
      return Promise.resolve();
    }
    return new Promise((settle) => {
      waiting = { mine, stationId, root, character, look, lookPose, settle };
      onWaiting?.();
    });
  }

  /** Mount now if the scene and the station's pose exist. */
  function tryMount(
    stationId: string,
    root: Object3D,
    character: boolean,
    look: CharacterLook | null,
    lookPose?: StageCharacterLook["pose"],
  ): boolean {
    const scene = deps.getScene();
    const pose = deps.poseOf(stationId);
    if (scene === null || pose === null) return false;
    const holder = new Group();
    holder.name = `station-stage:${stationId}`;
    holder.position.set(...pose.positionNue);
    if (!character) holder.quaternion.set(...pose.rotationNue);
    // A look stands at its block's pose in the station's frame, its
    // holder never turned (the look turns itself from its rest facing).
    const offset = new Vector3();
    if (look !== null) {
      const stationQ = new Quaternion(...pose.rotationNue).normalize();
      if (lookPose !== undefined && lookPose.position.every(Number.isFinite)) {
        offset.set(...lookPose.position).applyQuaternion(stationQ);
      }
      holder.position.add(offset);
      // He rests at the block's facing in the scene: the station's
      // rotation, then the block's own.
      const blockQ = new Quaternion(
        ...(lookPose?.rotation ?? [0, 0, 0, 1]),
      ).normalize();
      look.setRestYaw(restYawOf(stationQ.multiply(blockQ).toArray()));
    }
    holder.add(root);
    // At once where its station shows (the story's start); off the scene,
    // faded out, where it does not.
    const visible = isShown(stationId);
    if (visible) scene.add(holder);
    else applyAlpha(holder, look, 0);
    look?.setVoice(voice, voiceMs);
    shown = {
      root: holder,
      scene,
      character,
      stationId,
      inScene: visible,
      alpha: visible ? 1 : 0,
      target: visible ? 1 : 0,
      lastMs: now(),
      look,
      offset,
      released: false,
    };
    // The first frame snaps: the look opens where it stands, no ease-in.
    const camera = deps.getCamera?.() ?? null;
    if (look !== null && camera !== null) {
      look.setBeckon(beckonFrom(stationId, offset));
      look.update({ nowMs: now(), camera, snap: true });
    }
    keepLookTicking();
    return true;
  }

  /** A visitor update: mount what waits for its position, if it has one. */
  function retryWaiting(): void {
    if (waiting === null || waiting.mine !== token) return;
    const w = waiting;
    if (!tryMount(w.stationId, w.root, w.character, w.look, w.lookPose)) {
      return;
    }
    waiting = null;
    w.settle();
  }

  return {
    async showCharacter(stationId, image, onWaiting, lookSpec) {
      clear();
      const mine = token;
      const texture = await deps.decodeTexture(image);
      if (texture === null) throw new Error("the figure did not decode");
      if (lookSpec !== undefined) {
        if (mine !== token) {
          texture.dispose();
          return;
        }
        // The look paints its own die-cut textures from the decoded image.
        const look = createCharacterLook({
          view: lookSpec.view,
          name: lookSpec.name,
          line: lookSpec.line,
          figure: texture.image as FigureSource,
          heightM: CHARACTER_HEIGHT_M,
          voiced: lookSpec.voiced === true,
          sheet: lookSpec.sheet === true,
          ...(deps.lookPainters === undefined
            ? {}
            : { painters: deps.lookPainters }),
        });
        texture.dispose();
        look.root.name = "station-character";
        await mount(
          mine,
          stationId,
          look.root,
          true,
          onWaiting,
          look,
          lookSpec.pose,
        );
        return;
      }
      const source = texture.image as
        { width?: number; height?: number } | undefined;
      const aspect =
        source?.width !== undefined &&
        source.height !== undefined &&
        source.height > 0
          ? source.width / source.height
          : 0.5;
      const plane = new Mesh(
        new PlaneGeometry(CHARACTER_HEIGHT_M * aspect, CHARACTER_HEIGHT_M),
        new MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: DoubleSide,
        }),
      );
      // Feet on the station's altitude.
      plane.position.set(0, CHARACTER_HEIGHT_M / 2, 0);
      plane.name = "station-character";
      await mount(mine, stationId, plane, true, onWaiting);
    },
    async showModel(stationId, model, onWaiting) {
      clear();
      const mine = token;
      const root = await deps.loadModel(model);
      root.name = "station-model";
      await mount(mine, stationId, root, false, onWaiting);
    },
    clear,
    release() {
      if (waiting !== null || shown?.look == null || !shown.inScene) {
        clear();
        return;
      }
      // A late decode of this story lands on nothing; the look keeps its
      // frames and its presence fade, heard.
      token += 1;
      voice = "idle";
      voiceMs = undefined;
      shown.released = true;
      shown.look.setVoice("spoken");
    },
    characterTapTargets() {
      if (shown?.look == null || !shown.inScene) return [];
      return shown.look.tapTargets();
    },
    toggleBubble() {
      shown?.look?.toggleBubble();
    },
    setVoice(next, durationMs) {
      voice = next;
      voiceMs = durationMs;
      shown?.look?.setVoice(next, durationMs);
    },
    faceVisitor(visitor) {
      retryWaiting();
      // A look turns itself, against the camera, every frame.
      if (shown === null || !shown.character || shown.look !== null) return;
      const p = shown.root.position;
      const north = visitor[0] - p.x;
      const east = visitor[2] - p.z;
      if (north === 0 && east === 0) return;
      // The plane faces +Z (East); turn it about Up towards the visitor.
      shown.root.rotation.set(0, Math.atan2(north, east), 0);
    },
    follow(next) {
      isShown = next;
      advance();
      keepLookTicking();
    },
  };
}
