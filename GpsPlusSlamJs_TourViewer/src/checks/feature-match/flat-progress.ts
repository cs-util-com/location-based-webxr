/**
 * The flat target capture mode's progress: which surfaces were started,
 * their class, reference taps and every photo's pose, light bin and
 * whether it was downloaded. A pure reducer, kept across reloads as JSON.
 * The photos themselves live in the page's memory only.
 *
 * @see flat-progress.ts.md
 */
import { isFiniteNumber as isNum } from "gps-plus-slam-app-framework/utils/json-guards";

import { LIGHT_FLOOR_A } from "./bench-export";
import { isObj } from "./fm-helpers";
import {
  LIGHT_BINS,
  lightBin,
  lumaRatio,
  POSES,
  SURFACE_CLASSES,
  type BinId,
  type Point,
  type PoseId,
  type Size,
  type SurfaceClass,
} from "./flat-target";

/** Surfaces planned per class (15 in all). */
export const SURFACES_PER_CLASS = 5;
/** Darker bins (below the full-light one) a pose needs to count as complete. */
const DIM_BINS_PER_POSE = 2;

/** A surface's accepted reference: the four taps and the sizes. */
interface ReferenceTaps extends Size {
  readonly corners: readonly Point[];
  readonly rectified: Size;
}

/** One query photo's tags. */
interface ShotRecord {
  readonly pose: PoseId;
  /** Number within the pose, from 1; never reused. */
  readonly q: number;
  readonly fullLight: boolean;
  readonly greyMean: number;
  readonly lumaRatio: number;
  readonly bin: BinId;
  /** In a download already. */
  readonly saved: boolean;
}

export interface SurfaceProgress {
  readonly id: number;
  readonly cls: SurfaceClass;
  /** Whether a digital original of the surface exists. */
  readonly original: boolean;
  readonly reference: ReferenceTaps | null;
  readonly referenceSaved: boolean;
  readonly shots: readonly ShotRecord[];
}

export interface FlatProgress {
  readonly surfaces: readonly SurfaceProgress[];
  /** The surface being captured, or null on the overview. */
  readonly current: number | null;
}

export const EMPTY_PROGRESS: FlatProgress = { surfaces: [], current: null };

export type FlatAction =
  | {
      readonly type: "add-surface";
      readonly cls: SurfaceClass;
      readonly original: boolean;
    }
  | { readonly type: "select"; readonly id: number | null }
  | {
      readonly type: "set-reference";
      readonly id: number;
      readonly reference: ReferenceTaps;
    }
  | {
      readonly type: "add-shot";
      readonly id: number;
      readonly pose: PoseId;
      readonly greyMean: number;
    }
  | {
      readonly type: "remove-last-shot";
      readonly id: number;
      readonly pose: PoseId;
    }
  | { readonly type: "saved"; readonly id: number };

const shotsOf = (s: SurfaceProgress, pose: PoseId): ShotRecord[] =>
  s.shots.filter((x) => x.pose === pose);

/** Whether a grey mean is bright enough to be a pose's full-light shot. */
export const usableFullLight = (greyMean: number): boolean =>
  greyMean >= LIGHT_FLOOR_A;

function addShot(
  s: SurfaceProgress,
  pose: PoseId,
  greyMean: number,
): SurfaceProgress {
  if (s.reference === null || !Number.isFinite(greyMean)) {
    return s;
  }
  const mean = Math.min(255, Math.max(0, greyMean));
  const earlier = shotsOf(s, pose);
  const full = earlier[0];
  if (!full && !usableFullLight(mean)) {
    return s;
  }
  const ratio = full ? lumaRatio(mean, full.greyMean) : 1;
  const shot: ShotRecord = {
    pose,
    q: Math.max(0, ...earlier.map((x) => x.q)) + 1,
    fullLight: !full,
    greyMean: mean,
    lumaRatio: ratio,
    bin: lightBin(ratio),
    saved: false,
  };
  return { ...s, shots: [...s.shots, shot] };
}

function removeLastShot(s: SurfaceProgress, pose: PoseId): SurfaceProgress {
  let last = -1;
  s.shots.forEach((x, i) => {
    if (x.pose === pose) {
      last = i;
    }
  });
  if (last < 0 || s.shots[last]!.saved) {
    return s;
  }
  return { ...s, shots: s.shots.filter((_, i) => i !== last) };
}

/** The next progress; an action on an unknown surface changes nothing. */
export function flatReducer(p: FlatProgress, a: FlatAction): FlatProgress {
  if (a.type === "add-surface") {
    const id = p.surfaces.length + 1;
    return {
      surfaces: [
        ...p.surfaces,
        {
          id,
          cls: a.cls,
          original: a.original,
          reference: null,
          referenceSaved: false,
          shots: [],
        },
      ],
      current: id,
    };
  }
  if (a.type === "select") {
    return a.id === null || p.surfaces.some((s) => s.id === a.id)
      ? { ...p, current: a.id }
      : p;
  }
  const i = p.surfaces.findIndex((s) => s.id === a.id);
  if (i < 0) {
    return p;
  }
  const s = p.surfaces[i]!;
  let next: SurfaceProgress = s;
  switch (a.type) {
    case "set-reference":
      // A new reference would not match the photos already measured.
      if (s.shots.length === 0) {
        next = { ...s, reference: a.reference, referenceSaved: false };
      }
      break;
    case "add-shot":
      next = addShot(s, a.pose, a.greyMean);
      break;
    case "remove-last-shot":
      next = removeLastShot(s, a.pose);
      break;
    case "saved":
      next = {
        ...s,
        referenceSaved: s.reference !== null,
        shots: s.shots.map((x) => (x.saved ? x : { ...x, saved: true })),
      };
      break;
  }
  if (next === s) {
    return p;
  }
  return { ...p, surfaces: p.surfaces.map((x, j) => (j === i ? next : x)) };
}

/**
 * The progress after a reload: the photos were in memory, so only what
 * was downloaded is kept (an unsaved reference goes with its photos).
 */
export function afterReload(p: FlatProgress): FlatProgress {
  return {
    ...p,
    surfaces: p.surfaces.map((s) => {
      const reference = s.referenceSaved ? s.reference : null;
      return {
        ...s,
        reference,
        shots: reference === null ? [] : s.shots.filter((x) => x.saved),
      };
    }),
  };
}

export interface PoseSummary {
  readonly shots: number;
  readonly full: boolean;
  /** Photos per bin, the full-light shot in b1. */
  readonly bins: Readonly<Record<BinId, number>>;
  /** Full-light shot plus DIM_BINS_PER_POSE darker bins. */
  readonly complete: boolean;
  /** The full-light shot's grey mean, null before it. */
  readonly fullMean: number | null;
}

export function poseSummary(s: SurfaceProgress, pose: PoseId): PoseSummary {
  const shots = shotsOf(s, pose);
  const bins = Object.fromEntries(LIGHT_BINS.map((b) => [b.id, 0])) as Record<
    BinId,
    number
  >;
  for (const x of shots) {
    bins[x.bin]++;
  }
  const darker = LIGHT_BINS.slice(1).filter((b) => bins[b.id] > 0).length;
  const full = shots[0];
  return {
    shots: shots.length,
    full: full !== undefined,
    bins,
    complete: full !== undefined && darker >= DIM_BINS_PER_POSE,
    fullMean: full?.greyMean ?? null,
  };
}

export interface SurfaceSummary {
  readonly posesComplete: number;
  readonly poses: number;
  readonly shots: number;
  readonly unsaved: number;
  readonly complete: boolean;
}

export function surfaceSummary(s: SurfaceProgress): SurfaceSummary {
  const posesComplete = POSES.filter(
    (p) => poseSummary(s, p.id).complete,
  ).length;
  return {
    posesComplete,
    poses: POSES.length,
    shots: s.shots.length,
    unsaved:
      s.shots.filter((x) => !x.saved).length +
      (s.reference !== null && !s.referenceSaved ? 1 : 0),
    complete: s.reference !== null && posesComplete === POSES.length,
  };
}

/**
 * What leaving the page would lose of a surface: its unsaved photos and
 * reference, plus an attached original (it lives only in the page) until
 * a zip of the surface was saved. Every zip carries the original, and a
 * zip is saved only with a reference, so a saved reference means a saved
 * original.
 */
export const unsavedCount = (
  s: SurfaceProgress,
  originalAttached: boolean,
): number =>
  surfaceSummary(s).unsaved + (originalAttached && !s.referenceSaved ? 1 : 0);

export interface ClassSummary {
  readonly cls: SurfaceClass;
  readonly label: string;
  readonly started: number;
  readonly complete: number;
  readonly target: number;
}

export function classSummary(p: FlatProgress): ClassSummary[] {
  return SURFACE_CLASSES.map((c) => {
    const of = p.surfaces.filter((s) => s.cls === c.id);
    return {
      cls: c.id,
      label: c.label,
      started: of.length,
      complete: of.filter((s) => surfaceSummary(s).complete).length,
      target: SURFACES_PER_CLASS,
    };
  });
}

/** The stored form of `p`. */
export const flatProgressText = (p: FlatProgress): string => JSON.stringify(p);

const isPoint = (v: unknown): v is Point =>
  isObj(v) && isNum(v.x) && isNum(v.y);
const isSize = (v: unknown): v is Size =>
  isObj(v) && isNum(v.width) && isNum(v.height);

function readReference(v: unknown): ReferenceTaps | null | undefined {
  if (v === null) {
    return null;
  }
  if (!isSize(v)) {
    return undefined;
  }
  const o = v as unknown as Record<string, unknown>;
  if (
    !Array.isArray(o.corners) ||
    o.corners.length !== 4 ||
    !o.corners.every(isPoint) ||
    !isSize(o.rectified)
  ) {
    return undefined;
  }
  const r = v as unknown as ReferenceTaps;
  return {
    corners: r.corners.map((c) => ({ x: c.x, y: c.y })),
    width: r.width,
    height: r.height,
    rectified: { width: r.rectified.width, height: r.rectified.height },
  };
}

function readShot(v: unknown): ShotRecord | undefined {
  if (
    !isObj(v) ||
    !POSES.some((p) => p.id === v.pose) ||
    !isNum(v.q) ||
    typeof v.fullLight !== "boolean" ||
    !isNum(v.greyMean) ||
    !isNum(v.lumaRatio) ||
    !LIGHT_BINS.some((b) => b.id === v.bin) ||
    typeof v.saved !== "boolean"
  ) {
    return undefined;
  }
  return {
    pose: v.pose as PoseId,
    q: v.q,
    fullLight: v.fullLight,
    greyMean: v.greyMean,
    lumaRatio: v.lumaRatio,
    bin: v.bin as BinId,
    saved: v.saved,
  };
}

function readSurface(v: unknown, index: number): SurfaceProgress | undefined {
  if (
    !isObj(v) ||
    v.id !== index + 1 ||
    !SURFACE_CLASSES.some((c) => c.id === v.cls) ||
    typeof v.original !== "boolean" ||
    typeof v.referenceSaved !== "boolean" ||
    !Array.isArray(v.shots)
  ) {
    return undefined;
  }
  const reference = readReference(v.reference);
  const shots = v.shots.map(readShot);
  if (reference === undefined || shots.some((x) => x === undefined)) {
    return undefined;
  }
  return {
    id: v.id,
    cls: v.cls as SurfaceClass,
    original: v.original,
    reference,
    referenceSaved: v.referenceSaved,
    shots: shots as ShotRecord[],
  };
}

/**
 * The stored progress, or EMPTY_PROGRESS for nothing stored or any text
 * that does not read back as a whole; never throws.
 */
export function parseFlatProgress(text: string | null): FlatProgress {
  if (text === null || text === "") {
    return EMPTY_PROGRESS;
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (!isObj(v) || !Array.isArray(v.surfaces)) {
    return EMPTY_PROGRESS;
  }
  const surfaces = v.surfaces.map(readSurface);
  if (surfaces.some((s) => s === undefined)) {
    return EMPTY_PROGRESS;
  }
  const current =
    isNum(v.current) && v.current >= 1 && v.current <= surfaces.length
      ? v.current
      : null;
  return { surfaces: surfaces as SurfaceProgress[], current };
}
