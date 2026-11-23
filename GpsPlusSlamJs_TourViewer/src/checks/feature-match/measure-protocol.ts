/**
 * The messages between the page and the feature-match measuring worker:
 * one request per pair (the two shot PNGs, the turn of a rotation pair,
 * the methods and sizes), progress lines, and the pair's results or why
 * it failed. Both sides check what they receive, so a malformed message
 * is dropped instead of breaking the queue.
 *
 * @see measure-protocol.ts.md
 */
import type { MethodResult } from "./bench-run";
import type { TurnDegrees } from "./rotation-square";

/** The methods the worker can run (XFeat's runtime cannot start in it). */
interface WorkerMethods {
  readonly sift: boolean;
  readonly aliked: boolean;
  readonly siftLightGlue: boolean;
}

/** One pair to measure. */
export interface MeasureJob {
  readonly a: Blob;
  readonly b: Blob;
  /** A rotation pair: both cut to the centre square, B turned clockwise. */
  readonly turn: TurnDegrees | null;
  readonly methods: WorkerMethods;
  /** Long edges in pixels. */
  readonly sizes: readonly number[];
  /** The protocol key of the pair, for the run settings line. */
  readonly pair: string;
}

export interface MeasureRequest extends MeasureJob {
  readonly type: "measure";
  readonly job: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** A measured pair. */
export interface MeasureDone {
  readonly results: readonly MethodResult[];
  /** The sizes of the frames measured (the squares for a rotation pair). */
  readonly frames: { readonly a: Size; readonly b: Size };
  /** The run settings line: backend, runs, warm-up. */
  readonly settings: string;
  /** The run's time with the methods' load times left out, in ms. */
  readonly measureMs: number;
}

export type MeasureAnswer =
  | { readonly type: "progress"; readonly job: number; readonly line: string }
  | ({ readonly type: "done"; readonly job: number } & MeasureDone)
  | { readonly type: "failed"; readonly job: number; readonly message: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const isJob = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
const isSize = (v: unknown): v is Size =>
  isObj(v) &&
  typeof v.width === "number" &&
  typeof v.height === "number" &&
  v.width > 0 &&
  v.height > 0;

/** A request as the worker receives it, or null when malformed. */
export function requestOf(data: unknown): MeasureRequest | null {
  if (!isObj(data) || data.type !== "measure" || !isJob(data.job)) {
    return null;
  }
  const m = data.methods;
  const ok =
    data.a instanceof Blob &&
    data.b instanceof Blob &&
    (data.turn === null ||
      data.turn === 0 ||
      data.turn === 90 ||
      data.turn === 180) &&
    isObj(m) &&
    typeof m.sift === "boolean" &&
    typeof m.aliked === "boolean" &&
    typeof m.siftLightGlue === "boolean" &&
    Array.isArray(data.sizes) &&
    data.sizes.length > 0 &&
    data.sizes.every(
      (s) => typeof s === "number" && Number.isFinite(s) && s > 0,
    ) &&
    typeof data.pair === "string";
  return ok ? (data as unknown as MeasureRequest) : null;
}

/** An answer as the page receives it, or null when malformed. */
export function answerOf(data: unknown): MeasureAnswer | null {
  if (!isObj(data) || !isJob(data.job)) {
    return null;
  }
  switch (data.type) {
    case "progress":
      return typeof data.line === "string" ? (data as MeasureAnswer) : null;
    case "failed":
      return typeof data.message === "string" ? (data as MeasureAnswer) : null;
    case "done": {
      const f = data.frames;
      const ok =
        Array.isArray(data.results) &&
        data.results.every(
          (r) =>
            isObj(r) &&
            typeof r.id === "string" &&
            typeof r.label === "string" &&
            Array.isArray(r.sizes),
        ) &&
        isObj(f) &&
        isSize(f.a) &&
        isSize(f.b) &&
        typeof data.settings === "string" &&
        typeof data.measureMs === "number" &&
        Number.isFinite(data.measureMs);
      return ok ? (data as unknown as MeasureAnswer) : null;
    }
    default:
      return null;
  }
}
