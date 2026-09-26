/**
 * AR shadows in the PhysicsDemo (W4 AR shadows plan 2026-09-26-0549, M3):
 * the thrown balls cast onto the reconstructed room, in live AR and in the
 * desktop replay alike.
 *
 * The framework's `createArShadows` does the work (receiver, rig, map
 * re-render rule); this module only wires the demo's scene to it: the
 * light's frame, the current occluder, the ball count, and the teardown.
 *
 * @see ar-shadows-wiring.ts.md
 */

import * as THREE from "three";
import { SCENE_NODE } from "gps-plus-slam-app-framework/ar/scene-node-names";
import {
  AR_SHADOWS,
  createArShadows,
} from "gps-plus-slam-app-framework/visualization/ar-shadows";
import type { OcclusionMesh } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import { enableSunShadows } from "gps-plus-slam-app-framework/visualization/sun-shadow";

/**
 * The shadow square's centre sits this far below the camera: about the
 * floor under a hand-held phone. The square is ±5 m wide and the light's
 * depth range tens of metres, so a rough floor height is enough.
 */
export const FLOOR_BELOW_CAMERA_M = 1.4;

/** Where the light is placed along its direction (the rig moves it anyway). */
const LIGHT_DISTANCE_M = 10;

export interface DemoShadowsDeps {
  readonly renderer: THREE.WebGLRenderer;
  /** The AR scene, holding the framework's `SUN_LIGHT` at its root. */
  readonly scene: THREE.Scene;
  /** The room's frame: the occluder and the balls hang under it. */
  readonly arWorldGroup: THREE.Object3D;
  /** The CURRENT occluder (`setMeshMode` recreates it), or null. */
  readonly getOccluder: () => OcclusionMesh | null;
  readonly ballCount: () => number;
  /**
   * The viewer the shadow square follows: in AR the tracked camera, in the
   * replay the recorded phone pose (any object: only its position is read).
   */
  readonly getCamera: () => THREE.Object3D | null;
}

export interface DemoShadows {
  /** Per frame, before the render. */
  update(): void;
  isActive(): boolean;
  /**
   * Whether a WORLD position lies within the shadow's reach: within the
   * square's half width (5 m) of the viewer's spot, measured flat in the
   * room's frame (a circle inside the square, so it never over-promises).
   */
  inRange(worldPosition: THREE.Vector3): boolean;
  /**
   * The on/off switch (round-2 plan M1): the framework's `setEnabled`, by
   * shadow intensity only, so switching never recompiles a material.
   */
  setEnabled(on: boolean): void;
  /** The switch's state (on until switched off). */
  isEnabled(): boolean;
  /** Restores the light where it was found. Idempotent. */
  dispose(): void;
}

/** `?shadows=0` (or `off` / `false`) switches the shadows off; on otherwise. */
export function shadowsEnabledFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get("shadows");
  return value === null || !["0", "off", "false"].includes(value.toLowerCase());
}

/**
 * The stats line's shadow note, the owner's view on the phone: "on" while
 * drawn, "off" when switched off, "unavailable" when switched on but not
 * drawn (no light from above, or the renderer's rule says no).
 */
export function shadowsLabel(
  shadows: Pick<DemoShadows, "isActive" | "isEnabled"> | null,
): string {
  if (!shadows) return "";
  if (shadows.isActive()) return " · shadows on";
  return shadows.isEnabled() ? " · shadows unavailable" : " · shadows off";
}

/**
 * The owner's switch (round-2 plan M1), one binding for AR and the replay:
 * sets `initialOn` (the page's `?shadows=`), mirrors it on the toggle when
 * the page has one, and follows the toggle both ways. Returns the release.
 */
export function bindShadowSwitch(
  shadows: Pick<DemoShadows, "setEnabled">,
  initialOn: boolean,
  toggle: HTMLInputElement | undefined,
): () => void {
  shadows.setEnabled(initialOn);
  if (!toggle) return () => {};
  toggle.checked = initialOn;
  const onChange = (): void => shadows.setEnabled(toggle.checked);
  toggle.addEventListener("change", onChange);
  return () => toggle.removeEventListener("change", onChange);
}

/** No light from above: nothing to draw, but the switch still answers. */
function inert(): DemoShadows {
  let enabled = true;
  return {
    update() {},
    isActive: () => false,
    inRange: () => false,
    setEnabled(on) {
      enabled = on;
    },
    isEnabled: () => enabled,
    dispose() {},
  };
}

/**
 * Makes the framework's `SUN_LIGHT` cast from the room's frame and the
 * current occluder receive. Returns an inert handle (no shadow map turned
 * on) when the scene has no such light, or when it does not shine from
 * above.
 *
 * The frame (plan §11): the light starts at the scene root, while the room
 * and the balls hang under `arWorldGroup`, which receives the alignment. A
 * root light would swing every shadow on a heading correction, so the light
 * AND its target move under `arWorldGroup`, keeping the world direction
 * they had at that moment.
 */
export function startDemoShadows(deps: DemoShadowsDeps): DemoShadows {
  const light = deps.scene.getObjectByName(SCENE_NODE.SUN_LIGHT);
  if (!(light instanceof THREE.DirectionalLight)) return inert();
  const { arWorldGroup } = deps;
  const target = light.target;
  const found = {
    parent: light.parent,
    position: light.position.clone(),
    targetParent: target.parent,
    targetPosition: target.position.clone(),
  };

  const worldDir = light
    .getWorldPosition(new THREE.Vector3())
    .sub(target.getWorldPosition(new THREE.Vector3()));
  arWorldGroup.updateWorldMatrix(true, false);
  const localDir = worldDir.transformDirection(
    arWorldGroup.matrixWorld.clone().invert(),
  );
  if (!(localDir.y > 0)) return inert();

  arWorldGroup.add(light, target);
  light.position.copy(localDir).multiplyScalar(LIGHT_DISTANCE_M);
  target.position.set(0, 0, 0);
  enableSunShadows(deps.renderer);
  const shadows = createArShadows({
    renderer: deps.renderer,
    light,
    getOccluder: deps.getOccluder,
    dynamicCasters: true,
  });

  const cameraPosition = new THREE.Vector3();
  /** The square's centre in arWorldGroup's frame, from the last update. */
  const centre = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  const local = new THREE.Vector3();
  let disposed = false;
  let enabled = true;
  return {
    update() {
      if (disposed) return;
      const camera = deps.getCamera();
      if (!camera) return;
      arWorldGroup.updateWorldMatrix(true, false);
      const c = arWorldGroup.worldToLocal(
        camera.getWorldPosition(cameraPosition),
      );
      centre.set(c.x, c.y - FLOOR_BELOW_CAMERA_M, c.z);
      shadows.update({
        centre: [c.x, c.y - FLOOR_BELOW_CAMERA_M, c.z],
        casterCount: deps.ballCount(),
      });
    },
    isActive: () => !disposed && shadows.isActive(),
    inRange(worldPosition) {
      arWorldGroup.updateWorldMatrix(true, false);
      const p = arWorldGroup.worldToLocal(local.copy(worldPosition));
      return (
        Math.hypot(p.x - centre.x, p.z - centre.z) <= AR_SHADOWS.halfWidthM
      );
    },
    setEnabled(on) {
      enabled = on;
      if (!disposed) shadows.setEnabled(on);
    },
    isEnabled: () => enabled,
    dispose() {
      if (disposed) return;
      disposed = true;
      shadows.dispose();
      restore(light, found.parent, found.position);
      restore(target, found.targetParent, found.targetPosition);
    },
  };
}

function restore(
  node: THREE.Object3D,
  parent: THREE.Object3D | null,
  position: THREE.Vector3,
): void {
  if (parent) parent.add(node);
  else node.removeFromParent();
  node.position.copy(position);
  node.updateMatrixWorld();
}
