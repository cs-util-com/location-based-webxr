/**
 * The camera's controls (globe plan §7.5), moved out of the globe lab: the
 * library's `GlobeControls` on the canvas, with the clip planes fitted from
 * the drawn ground (F2 plan F2a, M4) or, in first person, from the nearest
 * item (G1 5). The camera has ONE owner at a time:
 * - the intro (spin, turn, hold) while it drives: it sets the pose, then
 *   `followIntro` fits the planes and keeps the controls' up direction in
 *   step, so the press that takes the camera finds the Earth under it;
 * - the controls once the user touches: their `start` event calls `onTake`,
 *   and from then on only `update` moves the camera, its planes included;
 * - `release` gives the camera back: it drops any drag and leftover
 *   momentum, so the next touch starts clean.
 * The controls stay enabled throughout: a disabled control ignores the
 * very press that should take the camera.
 *
 * @see globe-camera-controls.ts.md
 */

import * as THREE from "three";
import { GlobeControls, type Ellipsoid } from "3d-tiles-renderer";

import { clipPlanes } from "./globe-camera.js";
import {
  applyEyeControls,
  eyeClipPlanes,
  nearestItemDistanceM,
} from "./globe-eye-camera.js";
import { limitGlobeZoomOut } from "./globe-zoom-limit.js";

/** What the controls need of the globe: its ellipsoid and its frame's group. */
export interface GlobeControlsGlobe {
  tiles: {
    ellipsoid: Ellipsoid;
    group: THREE.Object3D;
  };
}

/** The relief's part of the clip planes (`clipPlanes`' `relief`). */
type ReliefPlanes = () => { clearanceM?: number; peakM?: number };

/**
 * The library's internals the lab reads and resets (0.5.3): typed here,
 * once, because the library's declarations leave them out.
 */
interface ControlsInternals {
  pointerTracker: { getPointerCount(): number };
  state: number;
  globeInertiaFactor: number;
  globeInertia: THREE.Quaternion;
  zoomDelta: number;
  _inertiaNeedsUpdate?: () => boolean;
  cameraRadius: number;
  minDistance: number;
}

export interface GlobeCameraControlsOptions {
  /** The user took the camera (the controls' `start` event). */
  onTake: () => void;
  /** The relief's clearance and peak for the planes; `{}` over the ellipsoid. */
  reliefPlanes?: ReliefPlanes;
  /** First person: the items' world bounding spheres; null otherwise. */
  eyeItems?: (() => Iterable<THREE.Sphere>) | null;
  /** For tests: the controls in place of the library's. */
  createControls?: (
    scene: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
  ) => GlobeControls;
}

export interface GlobeCameraControls {
  /** The planes to where the camera is now; the frame calls it last. */
  fitPlanes(): void;
  /** After the intro placed the camera: the planes and the up direction. */
  followIntro(): void;
  /** The controls' step, then the planes. */
  update(): void;
  /** What the controls' rays hit: the carrier drawing most of the frame. */
  pickFrom(object: THREE.Object3D): void;
  /** The farthest the controls zoom out, metres from the centre. */
  limit(limitM: () => number): void;
  /** The library's height adjustment (its two raycasts a frame). */
  setAdjustHeight(on: boolean): void;
  /** In a gesture or still gliding: a frame move waits. */
  busy(): boolean;
  /** Ends any drag and drops the momentum. */
  release(): void;
}

/**
 * The controls over `scene` for `camera` on `canvas`. The planes are fitted
 * from the camera's position in the globe's frame: `eyeClipPlanes` with
 * `eyeItems`, else `clipPlanes`, both with `reliefPlanes()`; the camera's
 * projection is updated only when a plane changed.
 */
export function createGlobeCameraControls(
  scene: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLElement,
  globe: GlobeControlsGlobe,
  {
    onTake,
    reliefPlanes = () => ({}),
    eyeItems = null,
    createControls = (s, c, el) => new GlobeControls(s, c, el),
  }: GlobeCameraControlsOptions,
): GlobeCameraControls {
  if (typeof onTake !== "function") {
    throw new TypeError("the controls need an onTake function");
  }
  const controls = createControls(scene, camera, canvas);
  const inner = controls as unknown as ControlsInternals;
  controls.setEllipsoid(globe.tiles.ellipsoid, globe.tiles.group);
  controls.enableDamping = true;
  if (eyeItems) applyEyeControls(inner);
  controls.addEventListener("start", onTake);
  const local = new THREE.Vector3();
  let picking: THREE.Object3D = scene;
  const fitPlanes = () => {
    local.copy(camera.position);
    globe.tiles.group.worldToLocal(local);
    const { near, far } = eyeItems
      ? eyeClipPlanes(globe.tiles.ellipsoid, local, {
          ...reliefPlanes(),
          nearestItemM: nearestItemDistanceM(camera.position, eyeItems()),
        })
      : clipPlanes(globe.tiles.ellipsoid, local, reliefPlanes());
    if (camera.near !== near || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  };
  return {
    fitPlanes,
    followIntro() {
      fitPlanes();
      controls.getCameraUpDirection(controls.up);
    },
    update() {
      controls.update();
      fitPlanes();
    },
    pickFrom(object) {
      if (picking !== object) {
        picking = object;
        controls.setScene(object);
      }
    },
    limit(limitM) {
      limitGlobeZoomOut(controls, limitM);
    },
    setAdjustHeight(on) {
      controls.adjustHeight = on;
    },
    busy() {
      return (
        inner.pointerTracker.getPointerCount() > 0 ||
        inner.state !== 0 ||
        inner.globeInertiaFactor !== 0 ||
        Boolean(inner._inertiaNeedsUpdate?.())
      );
    },
    release() {
      // Toggling `enabled` is the library's own reset: it ends any drag,
      // forgets the pointers and drops the drag and rotation momentum. The
      // globe's spin momentum and a pending wheel step are cleared here.
      controls.enabled = false;
      controls.enabled = true;
      inner.zoomDelta = 0;
      inner.globeInertia.identity();
      inner.globeInertiaFactor = 0;
    },
  };
}
