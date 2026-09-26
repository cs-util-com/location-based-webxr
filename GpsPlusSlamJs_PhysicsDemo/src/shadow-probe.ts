/**
 * A test hook for the shadow pixel probe (owner feedback round 2, plan
 * 2026-09-26-2055 M1): with `?shadowProbe=1` the desktop replay exposes
 * `window.__physicsShadowProbe`, so an e2e can rest a ball on the
 * reconstructed floor and count the pixels its shadow darkens. The stats
 * line's "shadows on" said only that the rule was active; this measures
 * what a viewer sees.
 *
 * @see shadow-probe.ts.md
 */

import * as THREE from "three";

import type { DemoShadows } from "./ar-shadows-wiring";
import type { PhysicsRuntime } from "./physics-runtime";

/** A ball has come to rest once it moved less than this over REST_MS. */
const REST_EPSILON_M = 0.0005;
export const REST_MS = 1000;
/** A floor face: its world normal is within about 45° of straight up. */
const FLOOR_MIN_NORMAL_Y = 0.7;
/** Where the ball is dropped from, above the floor hit. */
const DROP_HEIGHT_M = 0.3;
/**
 * A standing phone user: the eye this high above the floor and this far from
 * the ball, looking at it. The replay's own camera hangs about 200 m over the
 * room, where an 8 cm ball is sub-pixel.
 */
const STAND_HEIGHT_M = 1.5;
const STAND_BACK_M = 1.2;
/** The floor is searched with a grid of downward rays over the room. */
const FLOOR_GRID = 15;
/**
 * A drop point needs floor all around: eight rays on a ring this wide must
 * also meet an upward first surface within FLAT_TOLERANCE_M of its height.
 * Swept on the replay fixture's sparse room (2026-09-26, ring {0.1, 0.15,
 * 0.2, 0.25} m x tolerance {2, 3, 5, 8} cm): on the blocky floor only 15 cm
 * / 2 cm found a point the ball stayed on; wider rings found none.
 */
const FLAT_RING_M = 0.15;
const FLAT_TOLERANCE_M = 0.02;

export interface ShadowProbeDeps {
  readonly pause: () => void;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly runtime: Pick<PhysicsRuntime, "spawnBallWithVelocity" | "balls">;
  /** The reconstructed room's mesh to drop onto, or null before it exists. */
  readonly getFloorMesh: () => THREE.Object3D | null;
  readonly shadows: Pick<DemoShadows, "setEnabled"> | null;
  /** Milliseconds, for the rest check (performance.now in the page). */
  readonly now: () => number;
}

export interface ShadowProbe {
  /** Stops the replay, so the orbit camera stops following the walk. */
  pause(): void;
  /**
   * Drops a ball above the room's floor: of the first surfaces a grid of
   * downward rays meets, the LOWEST that faces up and has floor all around
   * it (so not a table top, never a wall, a stray facet under the floor or
   * a patch it would roll off); the hit, or null if the room has none. Puts
   * the standing view at azimuth 0.
   */
  dropOnFloor(flat?: { ringM?: number; toleranceM?: number }): number[] | null;
  /**
   * Moves the standing view around the ball to `azimuthDeg` (0 = +x,
   * counter-clockwise seen from above), 1.5 m up and `backM` away (default
   * 1.2 m; a thrower usually stands 2-4 m off).
   */
  standAt(azimuthDeg: number, backM?: number): void;
  /** The standing view, or null before a ball was dropped. */
  viewCamera(): THREE.PerspectiveCamera | null;
  /** True once the last ball has stayed put for REST_MS. */
  atRest(): boolean;
  /** The last ball's centre and radius in the standing view, in drawing-buffer pixels. */
  ballScreen(): { x: number; y: number; r: number };
  setShadowsEnabled(on: boolean): void;
  /**
   * Renders one frame through the standing view and returns the RGBA bytes
   * of a drawing-buffer rect (x, y from the top-left), read in the same task
   * as the render.
   */
  readRegion(x: number, y: number, w: number, h: number): number[];
}

/**
 * The rest rule: at rest once the newest sample and every sample in the
 * last `REST_MS` lie within `REST_EPSILON_M` of each other.
 */
export function restTracker(now: () => number) {
  const samples: { t: number; p: THREE.Vector3 }[] = [];
  return (position: THREE.Vector3 | undefined): boolean => {
    if (!position) return false;
    const t = now();
    samples.push({ t, p: position.clone() });
    while (samples.length > 1 && t - samples[0]!.t > REST_MS) samples.shift();
    const span = t - samples[0]!.t;
    return (
      span >= REST_MS * 0.9 &&
      samples.every((s) => s.p.distanceTo(position) < REST_EPSILON_M)
    );
  };
}

/**
 * The drop point: over a grid of downward rays across `floor`'s bounds, the
 * lowest FIRST surface that faces up and has floor all around it (eight rays
 * on a ring of `ringM` meet an upward first surface within `toleranceM`);
 * null if there is none.
 */
function findFlatFloor(
  floor: THREE.Object3D,
  ringM: number,
  toleranceM: number,
): THREE.Vector3 | null {
  floor.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(floor);
  if (box.isEmpty()) return null;
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const top = box.max.y + 1;
  /** The first surface below (x, z) if it faces up, else null. */
  const floorAt = (x: number, z: number): THREE.Vector3 | null => {
    raycaster.set(new THREE.Vector3(x, top, z), down);
    // Only the FIRST surface from above counts: a reconstructed room has
    // stray facets under its floor, where no collider catches a ball
    // (measured: a drop there fell through).
    const hit = raycaster.intersectObject(floor, true)[0];
    if (!hit?.face) return null;
    const normal = hit.face.normal
      .clone()
      .transformDirection(hit.object.matrixWorld);
    return normal.y >= FLOOR_MIN_NORMAL_Y ? hit.point.clone() : null;
  };
  const flatAround = (p: THREE.Vector3): boolean => {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const q = floorAt(p.x + ringM * Math.cos(a), p.z + ringM * Math.sin(a));
      if (!q || Math.abs(q.y - p.y) > toleranceM) return false;
    }
    return true;
  };
  let best: THREE.Vector3 | null = null;
  for (let i = 0; i < FLOOR_GRID; i++) {
    for (let j = 0; j < FLOOR_GRID; j++) {
      const p = floorAt(
        THREE.MathUtils.lerp(box.min.x, box.max.x, (i + 0.5) / FLOOR_GRID),
        THREE.MathUtils.lerp(box.min.z, box.max.z, (j + 0.5) / FLOOR_GRID),
      );
      if (!p || (best && p.y >= best.y) || !flatAround(p)) continue;
      best = p;
    }
  }
  return best;
}

export function createShadowProbe(deps: ShadowProbeDeps): ShadowProbe {
  const rest = restTracker(deps.now);
  const bufferSize = () =>
    deps.renderer.getDrawingBufferSize(new THREE.Vector2());
  const lastBall = () => deps.runtime.balls().at(-1);
  let view: THREE.PerspectiveCamera | null = null;
  let floorPoint: THREE.Vector3 | null = null;
  const standAt = (azimuthDeg: number, backM = STAND_BACK_M) => {
    if (!floorPoint) throw new Error("shadow probe: no ball dropped yet");
    const size = bufferSize();
    view ??= new THREE.PerspectiveCamera(60, size.x / size.y, 0.05, 100);
    view.aspect = size.x / size.y;
    view.updateProjectionMatrix();
    const a = (azimuthDeg * Math.PI) / 180;
    view.position.set(
      floorPoint.x + backM * Math.cos(a),
      floorPoint.y + STAND_HEIGHT_M,
      floorPoint.z + backM * Math.sin(a),
    );
    view.lookAt(floorPoint);
    view.updateMatrixWorld(true);
  };
  const requireView = () => {
    if (!view) throw new Error("shadow probe: no standing view yet");
    return view;
  };
  return {
    pause: () => deps.pause(),
    dropOnFloor(flat = {}) {
      const floor = deps.getFloorMesh();
      if (!floor) return null;
      const best = findFlatFloor(
        floor,
        flat.ringM ?? FLAT_RING_M,
        flat.toleranceM ?? FLAT_TOLERANCE_M,
      );
      if (!best) return null;
      floorPoint = best;
      deps.runtime.spawnBallWithVelocity(
        best.clone().add(new THREE.Vector3(0, DROP_HEIGHT_M, 0)),
        new THREE.Vector3(0, 0, 0),
      );
      standAt(0);
      return best.toArray();
    },
    standAt,
    viewCamera: () => view,
    atRest: () => rest(lastBall()?.position),
    ballScreen() {
      const ball = lastBall();
      if (!ball) throw new Error("shadow probe: no ball");
      const camera = requireView();
      const size = bufferSize();
      const toPx = (p: THREE.Vector3) => {
        const ndc = p.clone().project(camera);
        return new THREE.Vector2(
          ((ndc.x + 1) / 2) * size.x,
          ((1 - ndc.y) / 2) * size.y,
        );
      };
      const centre = toPx(ball.position);
      const right = new THREE.Vector3().setFromMatrixColumn(
        camera.matrixWorld,
        0,
      );
      const edge = toPx(
        ball.position.clone().addScaledVector(right, ball.radius),
      );
      return { x: centre.x, y: centre.y, r: centre.distanceTo(edge) };
    },
    setShadowsEnabled: (on) => deps.shadows?.setEnabled(on),
    readRegion(x, y, w, h) {
      deps.renderer.render(deps.scene, requireView());
      const gl = deps.renderer.getContext();
      const size = bufferSize();
      const out = new Uint8Array(w * h * 4);
      // WebGL counts rows from the bottom.
      gl.readPixels(x, size.y - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return Array.from(out);
    },
  };
}

/** Puts the probe on `window.__physicsShadowProbe`; returns the removal. */
export function installShadowProbe(
  target: { __physicsShadowProbe?: ShadowProbe },
  probe: ShadowProbe,
): () => void {
  target.__physicsShadowProbe = probe;
  return () => {
    if (target.__physicsShadowProbe === probe) {
      delete target.__physicsShadowProbe;
    }
  };
}
