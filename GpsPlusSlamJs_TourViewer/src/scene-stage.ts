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
 * position yet does not fail the show: what was decoded waits for it.
 *
 * The character's size and placement are the K4 build agent's choice, not
 * the owner's (the plan leaves them open; revised by K4 review R6): 1.7 m
 * tall, its feet at the station's altitude, facing the visitor about the
 * vertical only. A code-only station's pose (from the guide) stands on the
 * estimated ground below the code and is turned about the vertical only,
 * so a model there takes the code's yaw, never its tilt.
 */

import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Object3D,
  type Texture,
} from "three";

/** A cut-out character's height (m): a standing adult. */
export const CHARACTER_HEIGHT_M = 1.7;

export interface StagePose {
  readonly positionNue: readonly [number, number, number];
  readonly rotationNue: readonly [number, number, number, number];
}

export interface SceneStageDeps {
  getScene(): Object3D | null;
  /** The station's pose at the scene root, or null when it cannot be
   *  placed yet (no GPS zero). */
  poseOf(stationId: string): StagePose | null;
  /** Decode a figure within the decode caps (`station-prefetch.ts`
   *  `decodeFigure`: its size read from its own header). */
  decodeTexture(blob: Blob): Promise<Texture | null>;
  /** A `.glb` already checked inert (`checkGlbInert`, K0). */
  loadModel(blob: Blob): Promise<Object3D>;
}

export interface SceneStage {
  showCharacter(stationId: string, image: Blob): Promise<void>;
  showModel(stationId: string, model: Blob): Promise<void>;
  clear(): void;
  /** Turn a standing character towards the visitor (NUE). */
  faceVisitor(visitorNue: readonly [number, number, number]): void;
}

export function createSceneStage(deps: SceneStageDeps): SceneStage {
  /** The scene it was added to, kept: the e2e scene root is a stub that
   *  sets no `parent`. */
  let shown: { root: Object3D; scene: Object3D; character: boolean } | null =
    null;
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
    settle: () => void;
  } | null = null;

  function clear(): void {
    token += 1;
    if (waiting !== null) {
      disposeObject3D(waiting.root);
      waiting.settle();
      waiting = null;
    }
    if (shown === null) return;
    shown.scene.remove(shown.root);
    disposeObject3D(shown.root);
    shown = null;
  }

  /** Mount `root` at the station, unless the stage moved on meanwhile;
   *  settles once it is mounted (or dropped). */
  function mount(
    mine: number,
    stationId: string,
    root: Object3D,
    character: boolean,
  ): Promise<void> {
    if (mine !== token) {
      disposeObject3D(root);
      return Promise.resolve();
    }
    if (tryMount(stationId, root, character)) return Promise.resolve();
    return new Promise((settle) => {
      waiting = { mine, stationId, root, character, settle };
    });
  }

  /** Mount now if the scene and the station's pose exist. */
  function tryMount(
    stationId: string,
    root: Object3D,
    character: boolean,
  ): boolean {
    const scene = deps.getScene();
    const pose = deps.poseOf(stationId);
    if (scene === null || pose === null) return false;
    const holder = new Group();
    holder.name = `station-stage:${stationId}`;
    holder.position.set(...pose.positionNue);
    if (!character) holder.quaternion.set(...pose.rotationNue);
    holder.add(root);
    scene.add(holder);
    shown = { root: holder, scene, character };
    return true;
  }

  /** A visitor update: mount what waits for its position, if it has one. */
  function retryWaiting(): void {
    if (waiting === null || waiting.mine !== token) return;
    const w = waiting;
    if (!tryMount(w.stationId, w.root, w.character)) return;
    waiting = null;
    w.settle();
  }

  return {
    async showCharacter(stationId, image) {
      clear();
      const mine = token;
      const texture = await deps.decodeTexture(image);
      if (texture === null) throw new Error("the figure did not decode");
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
      await mount(mine, stationId, plane, true);
    },
    async showModel(stationId, model) {
      clear();
      const mine = token;
      const root = await deps.loadModel(model);
      root.name = "station-model";
      await mount(mine, stationId, root, false);
    },
    clear,
    faceVisitor(visitor) {
      retryWaiting();
      if (shown === null || !shown.character) return;
      const p = shown.root.position;
      const north = visitor[0] - p.x;
      const east = visitor[2] - p.z;
      if (north === 0 && east === 0) return;
      // The plane faces +Z (East); turn it about Up towards the visitor.
      shown.root.rotation.set(0, Math.atan2(north, east), 0);
    },
  };
}
