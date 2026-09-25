/**
 * Builds and tears down the live AR viewing scene (plan VC5–VC8, VC12).
 *
 * Everything here only makes sense inside a running WebXR session: the
 * `arWorldGroup`, the camera, the XR session's `select` ray and the framework
 * frame loop all come from `initAR`. It is deliberately thin — the decisions
 * live in component 8 (`createTourScene`) and in `ar-seams.ts`; this file is
 * the wiring that can only be written once the session exists, and is
 * therefore the part proven on the phone rather than in Node (plan VC19).
 */

import { Matrix4, type Object3D, type PerspectiveCamera } from "three";

import { createTourScene } from "../../components/ar-scene/runtime/tour-scene.js";
import type { TourScene } from "../../components/ar-scene/runtime/tour-scene.js";
import { createThreeSceneAdapter } from "../../components/ar-scene/view/three-scene-adapter.js";
import { TRAIL_ORB_POOL_SIZE } from "../../components/ar-scene/config.js";
import type { AssetProvider } from "../../store/types.js";
import type { ViewingStateShape } from "../../store/selectors.js";
import { createArSeams, type ArSeams } from "./ar-seams.js";
import { createSceneAudioListener } from "./audio-listener.js";

/** Contract D16 default — the same fraction component 8's own demo uses. */
const HYSTERESIS_FRACTION = 0.15;

/** The store surface the scene needs (structural, so the real RTK store fits). */
interface SceneStore {
  getState(): ViewingStateShape;
  subscribe(listener: () => void): () => void;
  dispatch(action: { type: string; payload?: unknown }): void;
}

/** Minimal XR shapes — TourBuilder carries no WebXR type dependency, and
 *  component 8's own `XrSessionLike` takes the same structural approach. */
export interface XrSelectEventLike {
  readonly inputSource: { readonly targetRaySpace?: unknown };
  readonly frame?: {
    getPose(
      space: unknown,
      base: unknown,
    ): { transform: { matrix: ArrayLike<number> } } | null | undefined;
  };
}

interface XrSessionLike {
  addEventListener(
    type: "select",
    listener: (event: XrSelectEventLike) => void,
  ): void;
  removeEventListener(
    type: "select",
    listener: (event: XrSelectEventLike) => void,
  ): void;
}

/** The framework functions this module calls; injected so it stays testable. */
export interface ArRuntime {
  getArWorldGroup(): Object3D | null;
  getCamera(): PerspectiveCamera | null;
  getXrSession(): XrSessionLike | null;
  getXrReferenceSpace(): unknown;
  enableArWorldGroupAlignment(options: {
    store: unknown;
    arWorldGroup: Object3D;
  }): { dispose(): void };
  registerFrameUpdate(fn: (dt: number, elapsed: number) => void): () => void;
  selectAlignmentMatrix(state: unknown): readonly number[] | null;
  selectZeroReference(state: unknown): { lat: number; lon: number } | null;
}

export interface StartArSceneOptions {
  readonly store: SceneStore;
  readonly assetProvider: AssetProvider;
  /** The context component 9 unlocked. Never unlocked here (plan A16/VC4). */
  readonly audioContext: AudioContext;
  readonly runtime: ArRuntime;
  /**
   * The geo→world seams. Defaults to the GPS/alignment ones; the desktop
   * preview passes its own pinned-frame implementation, which is what lets
   * this one file build the identical scene with or without a WebXR session.
   */
  readonly seams?: ArSeams;
  /**
   * Where taps are raycast from when there is no XR session to supply a
   * target ray — i.e. the desktop preview's canvas.
   */
  readonly domElement?: HTMLElement;
  readonly onAudioBlocked?: () => void;
  readonly log?: (message: string) => void;
}

export interface ArSceneHandle {
  /** Ordered teardown. Idempotent. */
  dispose(): void;
  /** Introspection for the HUD / tests. */
  readonly scene: TourScene;
}

/**
 * The select ray as a scene-world matrix. `getPose` yields a raw WebXR-space
 * pose, but pick targets live in aligned NUE space under `arWorldGroup`; the
 * camera's parent (`arpose`, below `basisChangeNode`) is exactly the node that
 * maps WebXR space into that frame, so the ray must be lifted through it.
 * Skipping this makes taps miss once alignment / the basis change is non-identity.
 */
export function resolveTargetRayMatrix(
  event: XrSelectEventLike,
  referenceSpace: unknown,
  camera: PerspectiveCamera,
  out: Matrix4,
): Matrix4 | null {
  const targetRaySpace = event.inputSource.targetRaySpace;
  if (
    event.frame === undefined ||
    referenceSpace === null ||
    targetRaySpace === undefined
  ) {
    return null;
  }
  const pose = event.frame.getPose(targetRaySpace, referenceSpace);
  if (!pose) return null;
  out.fromArray(Array.from(pose.transform.matrix));
  const parent = camera.parent;
  if (parent !== null) {
    parent.updateWorldMatrix(true, false);
    out.premultiply(parent.matrixWorld);
  }
  return out;
}

export function startArScene(options: StartArSceneOptions): ArSceneHandle {
  const { runtime, store } = options;

  const arWorldGroup = runtime.getArWorldGroup();
  const camera = runtime.getCamera();
  if (arWorldGroup === null || camera === null) {
    throw new Error("AR session is not running — cannot build the tour scene");
  }

  // VC6: one lerper for the whole view, owned by the framework. Every anchored
  // waypoint and the camera ride the same smoothed alignment.
  const alignment = runtime.enableArWorldGroupAlignment({
    store,
    arWorldGroup,
  });

  // VC4/R4: install the unlocked context BEFORE constructing the listener,
  // then park it on the camera so spatialisation follows the visitor's head.
  const audioListener = createSceneAudioListener(options.audioContext);
  camera.add(audioListener);

  const seams =
    options.seams ??
    createArSeams({
      getAlignmentMatrix: () => runtime.selectAlignmentMatrix(store.getState()),
      getGpsZeroRef: () => runtime.selectZeroReference(store.getState()),
      getArWorldGroup: () => arWorldGroup,
      getCamera: () => camera,
    });

  // Registered before the scene exists: the anchors it creates join the same
  // frame loop, and must tick after their floor height has been refreshed.
  const unregisterSeamsUpdate = seams.update
    ? runtime.registerFrameUpdate(() => seams.update?.())
    : () => {};

  const xrSession = runtime.getXrSession();
  const scratchMatrix = new Matrix4();

  const adapter = createThreeSceneAdapter({
    parent: arWorldGroup,
    camera,
    audioListener,
    createAnchor: (object3D, coord) => seams.createAnchor(object3D, coord),
    toWorld: (coord) => seams.toWorld(coord),
    getUserWorldPos: () => seams.getUserWorldPos(),
    orbPoolSize: TRAIL_ORB_POOL_SIZE,
    ...(xrSession
      ? {
          xrSession,
          // VC22/R3: the target ray pose must be resolved against the
          // framework's own reference space — three may install an offset
          // space, and a self-requested one is not guaranteed to agree, which
          // shows up as taps that miss what the visitor aimed at.
          getTargetRayMatrix: (event: XrSelectEventLike) =>
            resolveTargetRayMatrix(
              event,
              runtime.getXrReferenceSpace(),
              camera,
              scratchMatrix,
            ),
        }
      : options.domElement
        ? { domElement: options.domElement }
        : {}),
  } as Parameters<typeof createThreeSceneAdapter>[0]);

  const scene = createTourScene({
    store,
    assetProvider: options.assetProvider,
    adapter,
    hysteresisFraction: HYSTERESIS_FRACTION,
    ...(options.onAudioBlocked
      ? { onAudioBlocked: options.onAudioBlocked }
      : {}),
    ...(options.log ? { log: options.log } : {}),
  });

  // VC8: one loop drives the scene, the anchors and the alignment lerper, so
  // their per-frame order stays consistent.
  const unregisterTick = runtime.registerFrameUpdate((dt) => {
    scene.tick(dt);
  });

  let disposed = false;
  return {
    scene,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Order matters (VC12): stop ticking, let the scene release every asset
      // reference and GPU handle, then drop the alignment binding. Doing this
      // before the session ends is what keeps outstanding asset refs at zero.
      unregisterTick();
      unregisterSeamsUpdate();
      scene.dispose();
      camera.remove(audioListener);
      alignment.dispose();
    },
  };
}
