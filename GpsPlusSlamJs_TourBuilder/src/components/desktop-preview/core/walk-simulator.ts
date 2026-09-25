/**
 * The desktop preview's stand-in for GPS: a pure walk integrator.
 *
 * Poses are expressed in the same frame the AR scene anchors into — GPS-world
 * NUE metres, `x = north`, `z = east` — so the preview seams can hand the
 * result straight to component 8 without any further conversion. Heading is
 * measured clockwise from north, i.e. the forward vector is
 * `(cos h, sin h)` in `(x, z)`.
 *
 * No DOM, no Three.js: the keyboard lives in `view/`, the camera lives in the
 * viewport, and this file is what the unit tests can pin down.
 */

/** A walker's pose on the ground plane. */
export interface WalkPose {
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

/** Normalised control input for one step. Each axis is clamped to [-1, 1]. */
export interface WalkInput {
  /** +1 forward, -1 backward. */
  readonly forward: number;
  /** +1 right (strafe), -1 left. */
  readonly strafe: number;
  /** +1 turn right (heading increases), -1 turn left. */
  readonly turn: number;
  readonly run?: boolean;
}

export interface WalkSimulatorOptions {
  readonly start?: WalkPose;
  /** Comfortable walking pace; the default is 3.0 m/s. */
  readonly walkSpeedMps?: number;
  readonly runMultiplier?: number;
  readonly turnRateRadPerSec?: number;
}

export interface WalkSimulator {
  /** Advance by `dt` seconds under `input` and return the new pose. */
  step(dt: number, input: WalkInput): WalkPose;
  pose(): WalkPose;
  /** Rotate in place — the mouse-look path, which is not rate-limited. */
  turnBy(deltaRad: number): void;
  /** Jump to a pose, e.g. when handing control back from the autopilot. */
  teleport(pose: WalkPose): void;
}

const ORIGIN: WalkPose = { x: 0, z: 0, headingRad: 0 };

const clamp = (value: number): number => Math.max(-1, Math.min(1, value));

export function createWalkSimulator(
  options: WalkSimulatorOptions = {},
): WalkSimulator {
  const walkSpeed = options.walkSpeedMps ?? 3.0;
  const runMultiplier = options.runMultiplier ?? 5.2;
  const turnRate = options.turnRateRadPerSec ?? Math.PI * 0.9;
  let current: WalkPose = options.start ?? ORIGIN;

  return {
    step(dt, input) {
      const headingRad = current.headingRad + clamp(input.turn) * turnRate * dt;

      // Diagonal input is normalised, not summed: pressing W+D must not walk
      // √2 times faster than W alone (the classic "strafe-running" bug).
      let forward = clamp(input.forward);
      let strafe = clamp(input.strafe);
      const magnitude = Math.hypot(forward, strafe);
      if (magnitude > 1) {
        forward /= magnitude;
        strafe /= magnitude;
      }

      const distance =
        walkSpeed * (input.run === true ? runMultiplier : 1) * dt;
      const forwardX = Math.cos(headingRad);
      const forwardZ = Math.sin(headingRad);
      // The walker's right-hand vector: heading + 90°, i.e. east when facing
      // north.
      const rightX = -forwardZ;
      const rightZ = forwardX;

      current = {
        x: current.x + (forwardX * forward + rightX * strafe) * distance,
        z: current.z + (forwardZ * forward + rightZ * strafe) * distance,
        headingRad,
      };
      return current;
    },
    pose() {
      return current;
    },
    turnBy(deltaRad) {
      current = { ...current, headingRad: current.headingRad + deltaRad };
    },
    teleport(pose) {
      current = pose;
    },
  };
}
