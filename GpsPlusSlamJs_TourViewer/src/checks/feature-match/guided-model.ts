/**
 * The photo test's shared readings of the page state: the current shot's
 * context both views read, the shot rows and counts, the measuring line,
 * and the motion and device helpers. Pure, so every rule is unit-tested.
 *
 * @see guided-model.ts.md
 */
import type { DeviceInfo } from "./bench-report";
// Types only: the slice imports still-detector, which imports this module.
import type { FeatureMatchState, MeasureProgress } from "./feature-match-slice";
import { shotCard, type ShotCard } from "./guided-texts";
import { planPhotos, planShots, type PhotoMeta } from "./run-plan";
import {
  derivedPairs,
  lightOf,
  pairsUsing,
  previousInScene,
  readyPairs,
  type Shot,
  type ShotLight,
} from "./scenes";

/** The current shot and what the views read around it. */
export interface ShotContext {
  readonly list: readonly Shot[];
  readonly index: number;
  readonly shot: Shot;
  readonly card: ShotCard;
  readonly photo: PhotoMeta | undefined;
  /** The scene's shot before this one; none for a first shot. */
  readonly prev: Shot | undefined;
  readonly prevPhoto: PhotoMeta | undefined;
  readonly light: ShotLight | null;
  /** The pairs a retake of this shot measures again. */
  readonly redoes: number;
  /**
   * The shot whose retake fixes this one's light check: the scene's L1
   * when L1 is too dark to dim from ("too-dark-a"), else this shot.
   */
  readonly fixAt: number;
}

/** The current shot of the plan, clamped into the list. */
export function shotContext(s: FeatureMatchState): ShotContext {
  const list = planShots(s.plan);
  const index = Math.min(Math.max(0, s.plan.current), list.length - 1);
  const shot = list[index]!;
  const prev = previousInScene(list, index);
  const light = lightOf(shot.id, planPhotos(s.plan));
  const first = list.findIndex((x) => x.id === `${shot.scene}/L1`);
  return {
    list,
    index,
    shot,
    card: shotCard(shot),
    photo: s.plan.shots[shot.id]?.photo,
    prev,
    prevPhoto: prev ? s.plan.shots[prev.id]?.photo : undefined,
    light,
    redoes: pairsUsing(derivedPairs(s.plan.spots, s.plan.extra), shot.id)
      .length,
    fixAt: light === "too-dark-a" && first >= 0 ? first : index,
  };
}

/** The shot's light check failed: it wants a retake. */
export const warned = (light: ShotLight | null): light is ShotLight =>
  light !== null && light !== "ok";

/** "L1 place 2" on the light shots, else the key. */
const shotLabel = (shot: Shot): string =>
  shot.kind === "light" ? `${shot.key} place ${String(shot.spot)}` : shot.key;

/** The pairs whose two shots have a photo: what Download all saves. */
export const readyCount = (s: FeatureMatchState): number =>
  readyPairs(derivedPairs(s.plan.spots, s.plan.extra), planPhotos(s.plan))
    .length;

export interface ShotRow {
  readonly index: number;
  readonly label: string;
  readonly sub: string;
  readonly status: "done" | "retake" | "missing";
  readonly current: boolean;
}

const STATUS_WORDS: Readonly<Record<ShotRow["status"], string>> = {
  done: "done",
  retake: "retake suggested",
  missing: "missing",
};

/** The shots sheet: every shot, its state in words, the current one marked. */
export function shotRows(s: FeatureMatchState): ShotRow[] {
  const photos = planPhotos(s.plan);
  return planShots(s.plan).map((shot, index) => {
    const status = !photos[shot.id]
      ? "missing"
      : warned(lightOf(shot.id, photos))
        ? "retake"
        : "done";
    return {
      index,
      label: shotLabel(shot),
      sub: `${shotCard(shot).title} - ${STATUS_WORDS[status]}`,
      status,
      current: index === s.plan.current,
    };
  });
}

/** "about 3 min" or "under a minute", rounded up to whole minutes. */
const minutesText = (ms: number): string =>
  ms < 60_000
    ? "under a minute"
    : `about ${String(Math.ceil(ms / 60_000))} min`;

/**
 * The end screen's measuring line: how far the phone got with the ready
 * pairs, about how long the rest takes, and that what is not measured
 * goes to the PC. Empty while no pair is ready.
 */
export function measureText(p: MeasureProgress): string {
  if (p.total === 0) {
    return "";
  }
  const of = `${String(p.done)} of ${String(p.total)} pairs`;
  if (p.stopped) {
    return `Measuring stopped: the worker crashed ${String(p.crashes)} times in a row. ${of} measured; the rest go to the PC.`;
  }
  if (p.running !== null) {
    const left =
      p.estimateMs === null ? "" : `, ${minutesText(p.estimateMs)} left`;
    return `Measuring on this phone: ${of}${left}. You can download now: pairs not measured yet go to the PC.`;
  }
  if (p.waiting === 0) {
    const failed =
      p.failed > 0
        ? `, ${String(p.failed)} failed (the PC measures ${p.failed === 1 ? "it" : "them"})`
        : "";
    return `Measured on this phone: ${of}${failed}.`;
  }
  return `${of} measured on this phone; the rest go to the PC.`;
}

/** The summary's phone line: model, OS version and cores, nothing else. */
export const deviceSummary = (d: DeviceInfo): string =>
  `${d.model ?? "unknown model"}, OS ${d.platformVersion ?? "-"}, ${d.hardwareConcurrency === null ? "-" : String(d.hardwareConcurrency)} cores`;

/**
 * Above this smoothed rotation rate (degrees per second) the steady chip
 * reads "phone moving". Swept 3 to 12 in the tests: 6 keeps a phone held
 * still in the hand steady and settles about 0.3 s after a tap's shake.
 */
export const STEADY_THRESHOLD = 6;

export type RotationRate = {
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
} | null;

/**
 * The finite rotation rates of a reading. A value that is not a finite
 * number counts as missing: one NaN would latch the level to NaN for good.
 */
const finiteRates = (r: RotationRate): number[] =>
  r
    ? [r.alpha, r.beta, r.gamma].filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      )
    : [];

/** Whether a `devicemotion` reading carries a usable rotation rate. */
export const hasRate = (r: RotationRate): boolean => finiteRates(r).length > 0;

/**
 * The summed absolute finite rotation rates of a reading, or null for a
 * reading without any, or whose sum overflows past the largest number.
 */
export function rateSum(r: RotationRate): number | null {
  const rates = finiteRates(r);
  if (rates.length === 0) return null;
  const m = rates.reduce((sum, v) => sum + Math.abs(v), 0);
  return Number.isFinite(m) ? m : null;
}

/** The next smoothed motion level from a `devicemotion` rotation rate. */
export function motionStep(level: number, r: RotationRate): number {
  const m = rateSum(r);
  return m === null ? level : level * 0.8 + m * 0.2;
}

export const isMoving = (level: number): boolean => level > STEADY_THRESHOLD;
