/**
 * The rules of a stand-here video (pure): how far its projection has
 * developed from where the visitor stands and looks. On the footprints at
 * its viewpoint, facing it, the faint sepia ghost on the wall develops
 * into the clip and it plays; walking off or turning away fades it back.
 * The creator's start trigger is not read: standing there is the start.
 * The measures are the chosen prototype's.
 *
 * @see stand-here.ts.md
 */
import { smoothstep } from "../../smoothstep.js";

/** The distance from the spot (m, on the ground) where it begins to
 *  develop, and where it is whole. */
export const STAND_HERE_RAMP_M = [4.5, 1] as const;
/** The angle between the view's middle and the video (degrees) where it
 *  begins to develop, and where it is whole. */
export const STAND_HERE_FACE_DEG = [32, 12] as const;
/** How fast the develop eases toward its target (per second). */
export const STAND_HERE_RATE = 1.6;
/** The develop past which a waiting video starts. */
export const STAND_HERE_PLAYS_AT = 0.6;
/** The develop from which the guide line is no longer said. */
const STAND_HERE_GUIDE_UNTIL = 0.55;
/** Within this distance of the spot (m) the guide asks to face it. */
const STAND_HERE_ON_SPOT_M = 1.2;
/** The develop past which its captions show. */
export const STAND_HERE_CAPTIONS_AT = 0.5;

/**
 * Where the develop goes: 1 on the spot (within `STAND_HERE_RAMP_M[1]`)
 * facing it (within `STAND_HERE_FACE_DEG[1]`), 0 beyond either far edge,
 * smooth between. `spotM` is the ground distance to the viewpoint and
 * `offDeg` the angle to the video; both null: no viewpoint, so it develops
 * at once. A value that is no number counts as far.
 */
export function standHereTarget(
  spotM: number | null,
  offDeg: number | null,
): number {
  if (spotM === null && offDeg === null) return 1;
  const d = spotM ?? Number.NaN;
  const a = offDeg ?? Number.NaN;
  if (!Number.isFinite(d) || !Number.isFinite(a)) return 0;
  return (
    smoothstep(STAND_HERE_RAMP_M[0], STAND_HERE_RAMP_M[1], d) *
    smoothstep(STAND_HERE_FACE_DEG[0], STAND_HERE_FACE_DEG[1], a)
  );
}

/** The develop after a frame of `dtS` seconds: eased toward `target` at
 *  `STAND_HERE_RATE`, the same after one long step as after many short
 *  ones; within 0 to 1. A step that is no positive number is no step. */
export function standHereDevelop(
  develop: number,
  target: number,
  dtS: number,
): number {
  const from = Number.isFinite(develop) ? develop : 0;
  const to = Number.isFinite(target) ? target : 0;
  const step = Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
  const next = from + (to - from) * (1 - Math.exp(-step * STAND_HERE_RATE));
  return Math.min(1, Math.max(0, next));
}

/** The line that guides the visitor while it is undeveloped: onto the
 *  footprints with the distance left, then to face it; none once it has
 *  developed past `STAND_HERE_GUIDE_UNTIL`, and none without a
 *  viewpoint (it then develops by itself). */
export function standHereGuide(
  develop: number,
  spotM: number,
  hasViewpoint: boolean,
): string | null {
  if (!hasViewpoint || develop >= STAND_HERE_GUIDE_UNTIL) return null;
  if (spotM > STAND_HERE_ON_SPOT_M) {
    return `Stand on the footprints · ${String(Math.round(spotM))} m`;
  }
  return "Face the video";
}

/** How the projection and its footprints are drawn at `develop` (0 to
 *  1) and the page clock `seconds`: the clip's opacity, its sepia tone
 *  (1: all sepia), its warm tint (a gain), its soft edge (the feather of
 *  its ellipse), the footprints' opacity and their pulse's. */
export interface StandHereShade {
  readonly opacity: number;
  readonly tone: number;
  readonly tint: number;
  readonly feather: number;
  readonly footprints: number;
  readonly pulse: number;
}

export function standHereShade(
  develop: number,
  seconds: number,
): StandHereShade {
  const d = Number.isFinite(develop) ? Math.min(1, Math.max(0, develop)) : 0;
  const t = Number.isFinite(seconds) ? seconds : 0;
  return {
    opacity: 0.13 + 0.87 * d,
    tone: 1 - d,
    tint: 1.15 + (1 - 1.15) * d,
    feather: 0.75 + (0.38 - 0.75) * d,
    footprints: 0.9 * (1 - d * 0.65),
    pulse: (1 - d) * (0.18 + 0.14 * Math.sin(t / 0.5)),
  };
}

/** Whether its captions show at `develop`: only once the picture is
 *  clear enough to read with. */
export function standHereCaptions(develop: number): boolean {
  return develop > STAND_HERE_CAPTIONS_AT;
}
