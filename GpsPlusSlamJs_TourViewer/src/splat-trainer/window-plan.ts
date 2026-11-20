/**
 * The splat trainer page's view of the walk's windows: one stretch per
 * window of {@link planWindows}, with the walked metres the page prints
 * under it. It plans nothing itself - which frames a window trains on and
 * is scored on comes unchanged from `walk-windows.ts` with the trainer's
 * defaults (`trainer-defaults.ts`); this module only numbers the windows
 * and measures where along the walk each one lies.
 *
 * @see window-plan.ts.md
 */

import type { Vector3 } from "gps-plus-slam-app-framework/core";

import { TRAINER_DEFAULTS, type TrainerSettings } from "./trainer-defaults.js";
import { planWindows, type WalkFrame, type WalkPlan } from "./walk-windows.js";

/** What the page shows of one stretch; the page's state holds this. */
export interface StretchSummary {
  /** Stable within one recording: `w<index>`. */
  readonly id: string;
  /** 0-based position along the walk. */
  readonly index: number;
  /** Walked distance where the stretch starts and ends, metres. */
  readonly fromM: number;
  readonly toM: number;
  /** How many photos the stretch stands for (its core, hold-outs included). */
  readonly frames: number;
}

/** One stretch with the frame lists the trainer needs, kept beside the state. */
export interface PlannedWindow extends StretchSummary {
  readonly window: WalkPlan["windows"][number];
}

/** What a planner needs from a recording: its captures in order. */
interface PlannerInput {
  readonly captures: readonly WalkFrame[];
}

export type WindowPlanner = (input: PlannerInput) => readonly PlannedWindow[];

function step(a: Vector3, b: Vector3): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return Number.isFinite(d) ? d : 0;
}

/**
 * Cumulative walked distance at each capture (0 at the first), for the
 * metres the page prints. A non-finite step counts as 0, so one bad pose
 * cannot poison the rest.
 */
export function walkedDistances(
  captures: readonly { readonly position: Vector3 }[],
): number[] {
  const out: number[] = [];
  let total = 0;
  captures.forEach((c, i) => {
    const prev = captures[i - 1];
    if (prev !== undefined) total += step(prev.position, c.position);
    out.push(total);
  });
  return out;
}

/**
 * One stretch per window of `plan`, in the plan's order. A stretch runs
 * from its first core frame's distance to the next stretch's first core
 * frame (the last one to its own last core frame); a window without core
 * frames is left out, since it has nothing to show or train.
 */
export function stretchesFromPlan(
  captures: readonly WalkFrame[],
  plan: WalkPlan,
): PlannedWindow[] {
  const dist = walkedDistances(captures);
  const at = (frame: number | undefined): number =>
    frame === undefined ? 0 : (dist[frame] ?? 0);
  const windows = plan.windows.filter((w) => w.core.length > 0);
  return windows.map((window, index) => {
    const next = windows[index + 1];
    return {
      id: `w${index}`,
      index,
      fromM: at(window.core[0]),
      toM: next === undefined ? at(window.core.at(-1)) : at(next.core[0]),
      frames: window.core.length,
      window,
    };
  });
}

/** The page's planner: {@link planWindows} with the given settings. */
export function windowPlanner(
  settings: TrainerSettings = TRAINER_DEFAULTS,
): WindowPlanner {
  return (input) =>
    stretchesFromPlan(input.captures, planWindows(input.captures, settings));
}

/** The summary the page's state keeps of a planned stretch. */
export const summaryOf = (p: StretchSummary): StretchSummary => ({
  id: p.id,
  index: p.index,
  fromM: p.fromM,
  toM: p.toM,
  frames: p.frames,
});
