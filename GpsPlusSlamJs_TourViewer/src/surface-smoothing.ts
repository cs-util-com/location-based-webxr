/**
 * The mesh cursor's smoothing in time (mesh-cursor smoothing plan
 * 2026-10-15-0944, the owner's "a little bit more lerping"): the ring eases
 * toward each frame's surface point with time constants - frame-rate
 * independent, so it feels the same at 30 and at 120 Hz - and jumps
 * instead of gliding when it would have to cross to a different surface.
 *
 * @see surface-smoothing.ts.md
 */

import { Quaternion, Vector3 } from "three";
import type { SurfacePoint } from "gps-plus-slam-app-framework/ar/hit-test-reticle-driver";

export interface SurfaceSmoothingConfig {
  /** Seconds for the position to close 63 % of its lag (0: no smoothing). */
  positionTauS: number;
  /** The same for the normal's angle; longer: the owner asked for the
   *  rotation to be calmed more than the position. */
  normalTauS: number;
  /** Snap when the ring is farther from the new point than this share of
   *  the point's distance from the camera (a different surface). */
  snapRatio: number;
}

/** Conservative: "a little bit more", not a ring that trails the phone
 *  (the sweeps behind these are in the plan doc and the property test). */
export const DEFAULT_SURFACE_SMOOTHING: SurfaceSmoothingConfig = {
  positionTauS: 0.1,
  normalTauS: 0.2,
  snapRatio: 0.3,
};

/**
 * The share of the remaining lag one step of `dtS` seconds closes under a
 * time constant `tauS`: `1 - exp(-dt / tau)`. Two steps compose exactly
 * into one of their summed length (frame-rate independence). A zero or
 * negative `dtS` closes nothing (a clock that runs backward must not push
 * the ring away); an unknown one (NaN, infinite) closes all of it; a zero
 * `tauS` means no smoothing.
 */
export function smoothingAlpha(tauS: number, dtS: number): number {
  if (!Number.isFinite(dtS)) return 1;
  if (dtS <= 0) return 0;
  if (tauS <= 0) return 1;
  return 1 - Math.exp(-dtS / tauS);
}

export interface SurfaceSmoother {
  /**
   * The ring's point after `dtS` seconds toward `target`, which lies
   * `viewDistanceM` from the camera. The first sample, a sample after
   * `reset()` and a lag beyond the snap ratio land exactly on the target.
   * A non-finite point or a zero/non-finite normal is no sample: the
   * smoother resets and returns null. Returns fresh vectors.
   */
  update(
    target: SurfacePoint,
    dtS: number,
    viewDistanceM: number,
  ): SurfacePoint | null;
  /** Forget the ring: the next sample lands where it is. */
  reset(): void;
}

function assertSetting(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `surface smoothing: ${name} must be a finite number >= 0, got ${String(value)}`,
    );
  }
}

function isFiniteVector(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function createSurfaceSmoother(
  overrides: Partial<SurfaceSmoothingConfig> = {},
): SurfaceSmoother {
  const config = { ...DEFAULT_SURFACE_SMOOTHING, ...overrides };
  assertSetting("positionTauS", config.positionTauS);
  assertSetting("normalTauS", config.normalTauS);
  assertSetting("snapRatio", config.snapRatio);

  let held = false;
  const position = new Vector3();
  const normal = new Vector3();
  const targetNormal = new Vector3();
  const turn = new Quaternion();
  const partTurn = new Quaternion();
  const IDENTITY = new Quaternion();

  function output(): SurfacePoint {
    return { position: position.clone(), normal: normal.clone() };
  }

  return {
    update(target, dtS, viewDistanceM) {
      targetNormal.copy(target.normal);
      const length = targetNormal.length();
      if (
        !isFiniteVector(target.position) ||
        !Number.isFinite(length) ||
        length === 0
      ) {
        held = false;
        return null;
      }
      targetNormal.divideScalar(length);
      const snapM = Number.isFinite(viewDistanceM)
        ? config.snapRatio * Math.max(viewDistanceM, 0)
        : 0;
      if (!held || position.distanceTo(target.position) > snapM) {
        position.copy(target.position);
        normal.copy(targetNormal);
        held = true;
        return output();
      }
      position.lerp(target.position, smoothingAlpha(config.positionTauS, dtS));
      // The normal turns along the great circle toward the target: repeated
      // steps toward a held target stay on it, so they compose exactly.
      turn.setFromUnitVectors(normal, targetNormal);
      partTurn.slerpQuaternions(
        IDENTITY,
        turn,
        smoothingAlpha(config.normalTauS, dtS),
      );
      normal.applyQuaternion(partTurn).normalize();
      return output();
    },
    reset() {
      held = false;
    },
  };
}
