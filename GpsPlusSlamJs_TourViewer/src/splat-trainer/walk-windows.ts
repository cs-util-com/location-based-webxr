/**
 * Cuts a recorded walk into what the splat trainer trains one at a time:
 * segments between tracking jumps, global hold-outs for evaluation, and
 * windows along each segment with a little overlap at their seams. Pure:
 * frame indices in, frame indices out.
 *
 * @see walk-windows.ts.md
 */

import type { Vector3 } from "gps-plus-slam-app-framework/core";

import { distance, requirePositive } from "./splat-math.js";
import type { TrainerSettings } from "./trainer-defaults.js";

/** What a plan needs of a capture: where it was and when (epoch ms or
 *  null). The reader's captures satisfy it. */
export interface WalkFrame {
  readonly position: Vector3;
  readonly capturedAt: number | null;
}

/** One window of the plan. Every list holds frame indices, ascending. */
interface WalkWindow {
  /** Index of the segment the window lies in. */
  readonly segment: number;
  /** The frames the window stands for, hold-outs included. The cores of
   *  all windows partition the walk, except for a segment of hold-outs
   *  alone, whose frames no window stands for. */
  readonly core: readonly number[];
  /** The frames it trains on: its core's non-hold-outs plus its
   *  neighbours' within the overlap reach, never a hold-out. */
  readonly train: readonly number[];
  /** The frames it is scored on: its core's hold-outs, plus neighbours'
   *  of the same segment when its own are fewer than `minHoldouts`. */
  readonly holdouts: readonly number[];
  /** True when even with borrowing it has fewer than `minHoldouts`. */
  readonly tooFewHoldouts: boolean;
  /** True when its core has fewer than `minFrames` training frames: only
   *  for a segment that short as a whole. */
  readonly tooFewFrames: boolean;
}

export interface WalkPlan {
  readonly segments: readonly (readonly number[])[];
  /** Every hold-out of the walk, ascending. */
  readonly holdouts: readonly number[];
  /** Each frame's distance along its segment's walk from the segment's
   *  first frame (m), by frame index. */
  readonly along: readonly number[];
  readonly windows: readonly WalkWindow[];
}

/**
 * The walk's runs between tracking jumps, each a list of consecutive
 * frame indices. A step between consecutive timed frames faster than
 * `jumpSpeedMPerS` starts a new run; a step with movement in no time (or
 * backwards in time) is an infinite speed. A step with an untimed frame
 * on either side has no speed and never cuts.
 */
export function jumpSegments(
  frames: readonly WalkFrame[],
  jumpSpeedMPerS: number,
): number[][] {
  requirePositive("jumpSpeedMPerS", jumpSpeedMPerS);
  const segments: number[][] = [];
  let current: number[] = [];
  frames.forEach((frame, i) => {
    const previous = frames[i - 1];
    if (previous !== undefined && isJump(previous, frame, jumpSpeedMPerS)) {
      segments.push(current);
      current = [];
    }
    current.push(i);
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

function isJump(a: WalkFrame, b: WalkFrame, speed: number): boolean {
  if (a.capturedAt === null || b.capturedAt === null) return false;
  const step = distance(a.position, b.position);
  const dtS = (b.capturedAt - a.capturedAt) / 1000;
  if (dtS <= 0) return step > 0;
  return step / dtS > speed;
}

/**
 * The walk's hold-outs: the middle frame of every block of `every`
 * (`i % every === floor(every / 2)`), counted over the whole walk rather
 * than per window, so a frame's role never depends on how the walk was
 * cut. The walk's first frame is never one: a hold-out sits between
 * trained frames.
 */
export function holdoutIndices(count: number, every: number): Set<number> {
  if (!Number.isInteger(every) || every < 2) {
    throw new RangeError(
      `holdoutEvery must be an integer of at least 2, got ${String(every)}`,
    );
  }
  const offset = Math.floor(every / 2);
  const out = new Set<number>();
  for (let i = offset; i < count; i += every) out.add(i);
  return out;
}

/**
 * The whole plan: segments, hold-outs and windows. Within a segment,
 * frames are binned by their distance along the walk into bins of
 * `windowM`; a group with fewer than `minFrames` training frames absorbs
 * the bins after it until it reaches `minFrames`, and a short last group
 * joins the one before it; a window with more than `maxFrames` is split
 * into equal parts by training count. A window with no training frame at
 * all (only possible for a segment of hold-outs alone) is dropped, its
 * frames left to no window. Each window then trains on its neighbours'
 * frames within `overlapFraction * windowM` along the walk of its core,
 * and, while it has fewer than `minHoldouts`, borrows the hold-outs of
 * its segment nearest its core along the walk. Throws a RangeError for
 * settings that cannot hold
 * (`maxFrames < 2 * minFrames`, or a non-positive length).
 */
export function planWindows(
  frames: readonly WalkFrame[],
  settings: TrainerSettings,
): WalkPlan {
  validate(settings);
  const segments = jumpSegments(frames, settings.jumpSpeedMPerS);
  const held = holdoutIndices(frames.length, settings.holdoutEvery);
  const along = alongWalk(frames, segments);
  const cores: { segment: number; core: number[] }[] = [];
  segments.forEach((segment, s) => {
    for (const core of segmentCores(segment, along, held, settings)) {
      if (core.some((i) => !held.has(i))) cores.push({ segment: s, core });
    }
  });
  const reach = settings.overlapFraction * settings.windowM;
  const windows = cores.map(({ segment, core }) => {
    const train = trainingFrames(
      core,
      segments[segment] ?? [],
      along,
      held,
      reach,
    );
    const holdouts = pooledHoldouts(
      core,
      segments[segment] ?? [],
      along,
      held,
      settings.minHoldouts,
    );
    return {
      segment,
      core,
      train,
      holdouts,
      tooFewHoldouts: holdouts.length < settings.minHoldouts,
      tooFewFrames:
        core.filter((i) => !held.has(i)).length < settings.minFrames,
    };
  });
  return {
    segments,
    holdouts: [...held].sort((a, b) => a - b),
    along,
    windows,
  };
}

function validate(settings: TrainerSettings): void {
  requirePositive("windowM", settings.windowM);
  if (
    !(settings.overlapFraction >= 0) ||
    !Number.isFinite(settings.overlapFraction)
  ) {
    throw new RangeError(
      `overlapFraction must be finite and at least 0, got ${String(settings.overlapFraction)}`,
    );
  }
  for (const key of ["minFrames", "maxFrames", "minHoldouts"] as const) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) {
      throw new RangeError(
        `${key} must be a positive integer, got ${String(settings[key])}`,
      );
    }
  }
  if (settings.maxFrames < 2 * settings.minFrames) {
    throw new RangeError(
      `maxFrames (${String(settings.maxFrames)}) must be at least twice minFrames (${String(settings.minFrames)}), or a split could leave a part under the minimum`,
    );
  }
}

/** Each frame's distance along its segment's walk from the segment's
 *  first frame (m). */
function alongWalk(
  frames: readonly WalkFrame[],
  segments: readonly (readonly number[])[],
): number[] {
  const along = new Array<number>(frames.length).fill(0);
  for (const segment of segments) {
    let total = 0;
    segment.forEach((i, k) => {
      const previous = frames[segment[k - 1] ?? i];
      const frame = frames[i];
      if (previous !== undefined && frame !== undefined) {
        total += distance(previous.position, frame.position);
      }
      along[i] = total;
    });
  }
  return along;
}

function segmentCores(
  segment: readonly number[],
  along: readonly number[],
  held: ReadonlySet<number>,
  settings: TrainerSettings,
): number[][] {
  const trainCount = (core: readonly number[]): number =>
    core.filter((i) => !held.has(i)).length;
  const bins = new Map<number, number[]>();
  for (const i of segment) {
    const bin = Math.floor((along[i] ?? 0) / settings.windowM);
    const list = bins.get(bin) ?? [];
    list.push(i);
    bins.set(bin, list);
  }
  const merged: number[][] = [];
  for (const bin of bins.values()) {
    const last = merged[merged.length - 1];
    if (last !== undefined && trainCount(last) < settings.minFrames) {
      last.push(...bin);
    } else {
      merged.push(bin);
    }
  }
  const tail = merged[merged.length - 1];
  if (
    merged.length > 1 &&
    tail !== undefined &&
    trainCount(tail) < settings.minFrames
  ) {
    merged.pop();
    merged[merged.length - 1]?.push(...tail);
  }
  return merged.flatMap((core) => splitByCount(core, held, settings.maxFrames));
}

/** `core` cut into `ceil(train / max)` parts of equal training count (to
 *  one frame); a hold-out goes with the training frame before it. */
function splitByCount(
  core: readonly number[],
  held: ReadonlySet<number>,
  max: number,
): number[][] {
  const train = core.filter((i) => !held.has(i)).length;
  if (train <= max) return [[...core]];
  const parts = Math.ceil(train / max);
  const out: number[][] = Array.from({ length: parts }, () => []);
  let trained = 0;
  let part = 0;
  for (const i of core) {
    if (!held.has(i)) {
      part = Math.floor((trained * parts) / train);
      trained += 1;
    }
    out[part]?.push(i);
  }
  return out;
}

function trainingFrames(
  core: readonly number[],
  segment: readonly number[],
  along: readonly number[],
  held: ReadonlySet<number>,
  reach: number,
): number[] {
  const inCore = new Set(core);
  const start = along[core[0] ?? 0] ?? 0;
  const end = along[core[core.length - 1] ?? 0] ?? 0;
  return segment.filter((i) => {
    if (held.has(i)) return false;
    if (inCore.has(i)) return true;
    const s = along[i] ?? 0;
    return s >= start - reach && s <= end + reach;
  });
}

/** The core's own hold-outs, topped up to `minHoldouts` (while the
 *  segment has more) with the segment's other hold-outs nearest the core
 *  along the walk; on equal distance the earlier frame. */
function pooledHoldouts(
  core: readonly number[],
  segment: readonly number[],
  along: readonly number[],
  held: ReadonlySet<number>,
  minHoldouts: number,
): number[] {
  const own = core.filter((i) => held.has(i));
  if (own.length >= minHoldouts) return own;
  const inCore = new Set(core);
  const start = along[core[0] ?? 0] ?? 0;
  const end = along[core[core.length - 1] ?? 0] ?? 0;
  const gap = (i: number): number => {
    const s = along[i] ?? 0;
    return Math.max(start - s, s - end, 0);
  };
  const borrowed = segment
    .filter((i) => held.has(i) && !inCore.has(i))
    .sort((a, b) => gap(a) - gap(b) || a - b)
    .slice(0, minHoldouts - own.length);
  return [...own, ...borrowed].sort((a, b) => a - b);
}
