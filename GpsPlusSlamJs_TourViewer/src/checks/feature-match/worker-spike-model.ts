/**
 * The worker spike's rules and words, as pure functions: the frame-gap
 * statistics and the "camera stays smooth" verdict, the run's plan and
 * its progress (step x of y, the time left, the status line), and the
 * result card (camera smooth or not, XFeat in a worker or not, the time
 * per method), plus the plain sentences an error shows instead of its
 * stack. The page (`worker-spike.ts`) only measures and draws.
 *
 * @see worker-spike-model.ts.md
 */
import { lowerMedian } from "gps-plus-slam-app-framework/utils/median";
import { nearestRankPercentile } from "gps-plus-slam-app-framework/utils/percentile";

import type { MethodResult } from "./bench-run";
import { measureMsOf } from "./measure-worker-core";

/** The smoothness rule: p95 and p99 within this factor of the baseline. */
export const GAP_FACTOR = 1.25;
/** ... and no single frame gap above this, in ms. */
export const GAP_CAP_MS = 250;
/** The other values the rule is read at in the log. */
const FACTOR_RANGE = [1.1, 1.25, 1.5] as const;
const CAP_RANGE = [150, 250, 400] as const;

/** A first guess of one pair's time, until a pair is measured. */
const PAIR_GUESS_MS = 20_000;
/** A guess of the XFeat try, load included. */
const XFEAT_GUESS_MS = 20_000;

/** The frame gaps of one window, in ms. */
export interface GapStats {
  readonly count: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** The gaps' p95, p99 and largest; non-finite and negative gaps dropped. */
export function gapStats(gaps: readonly number[]): GapStats {
  const ok = gaps.filter((g) => Number.isFinite(g) && g >= 0);
  if (ok.length === 0) {
    return { count: 0, p95: Number.NaN, p99: Number.NaN, max: Number.NaN };
  }
  return {
    count: ok.length,
    p95: nearestRankPercentile(ok, 0.95),
    p99: nearestRankPercentile(ok, 0.99),
    max: Math.max(...ok),
  };
}

export type CameraVerdict = "smooth" | "stutter" | "unknown";

/**
 * Smooth when the run's p95 and p99 gaps are at most `factor` times the
 * baseline's and no gap exceeds `cap`; unknown when either window has no
 * gaps (no frames is never a pass).
 */
export function cameraVerdict(
  run: GapStats,
  base: GapStats,
  factor: number = GAP_FACTOR,
  cap: number = GAP_CAP_MS,
): CameraVerdict {
  if (run.count === 0 || base.count === 0) {
    return "unknown";
  }
  return run.p95 <= factor * base.p95 &&
    run.p99 <= factor * base.p99 &&
    run.max <= cap
    ? "smooth"
    : "stutter";
}

/** The verdict at every factor and cap of the range, for the log. */
export function verdictSweep(run: GapStats, base: GapStats): string {
  const rows = FACTOR_RANGE.map(
    (f) =>
      `${String(f)}: ${CAP_RANGE.map((c) => (cameraVerdict(run, base, f, c) === "smooth" ? "Y" : "n")).join("")}`,
  );
  return `factor ${rows.join(", ")} (caps ${CAP_RANGE.join("/")} ms)`;
}

/** What one run does; the URL may shorten it for a test run. */
export interface SpikePlan {
  /** The camera at rest, nothing else running. */
  readonly baselineMs: number;
  /** Photo pairs measured in the worker, one after another. */
  readonly pairs: number;
  /** The wait between two photos. */
  readonly photoGapMs: number;
  /** Long edges in pixels, the photo test's sizes. */
  readonly sizes: readonly number[];
}

export const DEFAULT_PLAN: SpikePlan = {
  baselineMs: 10_000,
  pairs: 6,
  photoGapMs: 500,
  sizes: [320, 480, 640],
};

const wholeIn = (v: string | null, min: number, max: number): number | null => {
  const n = v === null ? Number.NaN : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** `?baseline=<1-60 s>&pairs=<1-12>`; anything else keeps the default. */
export function spikePlanFrom(search: string): SpikePlan {
  const q = new URLSearchParams(search);
  const seconds = wholeIn(q.get("baseline"), 1, 60);
  const pairs = wholeIn(q.get("pairs"), 1, 12);
  return {
    ...DEFAULT_PLAN,
    baselineMs: seconds === null ? DEFAULT_PLAN.baselineMs : seconds * 1000,
    pairs: pairs ?? DEFAULT_PLAN.pairs,
  };
}

/** The guessed length of a whole run, in whole minutes (for the intro). */
export function planMinutes(plan: SpikePlan): number {
  const ms =
    plan.baselineMs +
    2 * plan.pairs * plan.photoGapMs +
    plan.pairs * PAIR_GUESS_MS +
    XFEAT_GUESS_MS;
  return Math.max(1, Math.ceil(ms / 60_000));
}

export type SpikeStep =
  | { readonly kind: "baseline" }
  | { readonly kind: "photos"; readonly taken: number }
  | { readonly kind: "pairs"; readonly done: number }
  | { readonly kind: "xfeat" };

export interface ProgressInput {
  readonly plan: SpikePlan;
  readonly step: SpikeStep;
  readonly stepStartedAt: number;
  /** The wall time of each measured pair, in ms. */
  readonly pairMs: readonly number[];
  /** The camera so far while the worker measures. */
  readonly live: CameraVerdict;
  readonly now: number;
}

export interface SpikeProgress {
  /** 1-based. */
  readonly step: number;
  readonly of: number;
  /** 0 to 1, for the bar. */
  readonly fraction: number;
  readonly leftMs: number;
  readonly left: string;
  readonly status: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function leftText(ms: number): string {
  if (ms <= 0) {
    return "almost done";
  }
  if (ms < 60_000) {
    return `about ${String(Math.max(5, Math.ceil(ms / 5000) * 5))} s left`;
  }
  return `about ${String(Math.ceil(ms / 60_000))} min left`;
}

const cameraWords: Record<CameraVerdict, string> = {
  smooth: " - camera smooth",
  stutter: " - camera stuttering",
  unknown: "",
};

/** Where the run is: the step, the bar, the time left and the status line. */
export function spikeProgress(p: ProgressInput): SpikeProgress {
  const { plan, step } = p;
  const photos = 2 * plan.pairs;
  const of = 3 + plan.pairs;
  const elapsed = Math.max(0, p.now - p.stepStartedAt);
  const pairMs = p.pairMs.length > 0 ? lowerMedian(p.pairMs) : PAIR_GUESS_MS;
  const photosMs = photos * plan.photoGapMs;
  const pairsMs = plan.pairs * pairMs;
  let index: number;
  let within: number;
  let leftMs: number;
  let status: string;
  switch (step.kind) {
    case "baseline":
      index = 1;
      within = elapsed / plan.baselineMs;
      leftMs =
        Math.max(0, plan.baselineMs - elapsed) +
        photosMs +
        pairsMs +
        XFEAT_GUESS_MS;
      status = "Measuring the camera at rest - hold the phone still";
      break;
    case "photos":
      index = 2;
      within = step.taken / photos;
      leftMs =
        (photos - step.taken) * plan.photoGapMs + pairsMs + XFEAT_GUESS_MS;
      status = `Taking photo ${String(Math.min(photos, step.taken + 1))} of ${String(photos)}`;
      break;
    case "pairs": {
      const done = Math.min(plan.pairs, step.done);
      index = 3 + Math.min(plan.pairs - 1, done);
      within = 0;
      leftMs =
        Math.max(0, (plan.pairs - done) * pairMs - Math.min(elapsed, pairMs)) +
        XFEAT_GUESS_MS;
      const which = `pair ${String(Math.min(plan.pairs, done + 1))} of ${String(plan.pairs)} in the background`;
      status =
        (p.pairMs.length === 0
          ? `Loading the models, then measuring ${which}`
          : `Measuring ${which}`) + cameraWords[p.live];
      break;
    }
    case "xfeat":
      index = of;
      within = Math.min(0.9, elapsed / XFEAT_GUESS_MS);
      leftMs = Math.max(0, XFEAT_GUESS_MS - elapsed);
      status = "Trying XFeat in a background worker";
      break;
  }
  return {
    step: index,
    of,
    fraction: clamp01((index - 1 + clamp01(within)) / of),
    leftMs,
    left: leftText(leftMs),
    status,
  };
}

/**
 * The longest reason the card shows: room for a browser's one-line
 * error such as the module-worker `importScripts` refusal, not a stack.
 */
export const REASON_MAX = 140;

/** An error's first line in a few words, for the result card. */
export function shortReason(text: string): string {
  const first = (text.split("\n")[0] ?? "").replace(/^init:\s*/, "").trim();
  if (first === "") {
    return "no reason given";
  }
  return first.length <= REASON_MAX
    ? first
    : `${first.slice(0, REASON_MAX - 3)}...`;
}

const seconds = (ms: number): string => {
  const s = ms / 1000;
  return `${s < 1 ? s.toFixed(2) : s.toFixed(1)} s`;
};

/** One method's line on the result card. */
export interface MethodTime {
  readonly id: string;
  readonly label: string;
  /** Where it ran; empty when it never ran. */
  readonly backend: string;
  readonly failed: boolean;
  readonly text: string;
}

const ranAt = (r: MethodResult): boolean =>
  r.error === null && r.sizes.some((s) => s.error === null);

/**
 * Per method (in the order they ran): the median time of a pair (every
 * size, load left out) and the first load, or why it never ran.
 */
export function methodTimes(
  pairs: readonly (readonly MethodResult[])[],
): MethodTime[] {
  const byId = new Map<string, MethodResult[]>();
  for (const pair of pairs) {
    for (const r of pair) {
      byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
    }
  }
  return [...byId.values()].map((runs) => {
    const first = runs[0]!;
    const ok = runs.filter(ranAt);
    const head = { id: first.id, label: first.label, backend: first.backend };
    if (ok.length === 0) {
      const why =
        first.error ??
        first.sizes.find((s) => s.error !== null)?.error ??
        "no size ran";
      return {
        ...head,
        backend: "",
        failed: true,
        text: `could not run: ${shortReason(why)}`,
      };
    }
    const median = lowerMedian(ok.map((r) => measureMsOf([r])));
    return {
      ...head,
      backend: ok[0]!.backend,
      failed: false,
      text: `${seconds(median)} per pair, first load ${seconds(ok[0]!.initMs)} (${String(ok.length)} pair${ok.length === 1 ? "" : "s"})`,
    };
  });
}

export interface XFeatOutcome {
  readonly started: boolean;
  readonly text: string;
}

/** Whether XFeat started in its worker, from its results or the error. */
export function xfeatOutcome(
  results: readonly MethodResult[] | null,
  error: string | null,
): XFeatOutcome {
  const no = (why: string): XFeatOutcome => ({
    started: false,
    text: `Could not start: ${shortReason(why)}`,
  });
  if (error !== null) {
    return no(error);
  }
  const r = results?.[0];
  if (r === undefined) {
    return no("no XFeat result came back");
  }
  if (!ranAt(r)) {
    return no(r.error ?? r.sizes.find((s) => s.error !== null)?.error ?? "");
  }
  return {
    started: true,
    text: `Started: ${seconds(measureMsOf([r]))} per pair on ${r.backend}.`,
  };
}

/** An error as a person reads it: what happened and what to do. */
export interface PlainError {
  readonly message: string;
  readonly todo: string;
}

const nameOf = (e: unknown): string =>
  e instanceof Error || e instanceof DOMException ? e.name : "";

/** The plain sentence for a failure; its text and stack go to the log. */
export function plainError(
  where: "camera" | "worker" | "models" | "hidden" | "page",
  e: unknown,
): PlainError {
  if (where === "camera") {
    switch (nameOf(e)) {
      case "NotAllowedError":
      case "SecurityError":
        return {
          message: "The camera was blocked.",
          todo: "Allow the camera for this site (tap the icon left of the address), then tap Try again.",
        };
      case "NotFoundError":
      case "OverconstrainedError":
        return {
          message: "No camera was found.",
          todo: "Open this page on a phone with a back camera.",
        };
      case "NotReadableError":
        return {
          message: "The camera is busy in another app.",
          todo: "Close the other camera app, then tap Try again.",
        };
      default:
        return {
          message: "The camera could not start.",
          todo: "Tap Try again. If it fails again, tap Copy log and send it.",
        };
    }
  }
  switch (where) {
    case "worker":
      return {
        message: "The background worker stopped.",
        todo: "Tap Copy log and send it: that is a result too.",
      };
    case "models":
      return {
        message: "The measuring models could not load.",
        todo: "Check the internet connection and tap Try again, or tap Copy log and send it.",
      };
    case "hidden":
      return {
        message:
          "The page was hidden during the test, so its numbers are not valid.",
        todo: "Tap Try again and keep this page open until the result shows.",
      };
    case "page":
      return {
        message: "The test stopped because of an error.",
        todo: "Tap Copy log and send it, then tap Try again.",
      };
  }
}

/** The result card. */
export interface SpikeResult {
  readonly camera: { readonly verdict: CameraVerdict; readonly text: string };
  readonly xfeat: XFeatOutcome;
  readonly methods: readonly MethodTime[];
  /** Shown above the card when the numbers are missing. */
  readonly notice: PlainError | null;
}

const msText = (v: number): string => `${String(Math.round(v))} ms`;

/** The result card from the gaps, the XFeat try and the method times. */
export function spikeSummary(input: {
  readonly run: GapStats;
  readonly base: GapStats;
  readonly xfeat: XFeatOutcome;
  readonly methods: readonly MethodTime[];
  /** The measuring worker stopped during the run. */
  readonly workerCrashed?: boolean;
  /** The page was hidden (throttled) at some moment of the run. */
  readonly hidden?: boolean;
}): SpikeResult {
  const { run, base } = input;
  const verdict = cameraVerdict(run, base);
  const worst = `The worst frame gap was ${msText(run.max)} (at rest ${msText(base.max)}`;
  // A stutter names the rule it broke: one long gap, or late frames that
  // stayed under the cap but came more often than at rest.
  const late = `No. Frames came late more often: 95% of gaps within ${msText(run.p95)}, at rest ${msText(base.p95)} (the limit is ${String(GAP_FACTOR)}x).`;
  const text =
    verdict === "smooth"
      ? `Yes. ${worst}).`
      : verdict === "stutter"
        ? run.max > GAP_CAP_MS
          ? `No. ${worst}; the limit is ${String(GAP_CAP_MS)} ms).`
          : late
        : "Not known: the camera showed no frames while the worker measured.";
  const noneRan =
    input.methods.length > 0 && input.methods.every((m) => m.failed);
  return {
    camera: { verdict, text },
    xfeat: input.xfeat,
    methods: input.methods,
    notice:
      input.hidden === true
        ? plainError("hidden", null)
        : noneRan
          ? plainError("models", null)
          : input.workerCrashed === true
            ? plainError("worker", null)
            : null,
  };
}
