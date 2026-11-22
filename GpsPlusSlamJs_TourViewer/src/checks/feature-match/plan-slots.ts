/**
 * The photo test's protocol as plain data: the list of pair slots a run
 * walks through, each slot's status, the photo due next, the step after a
 * complete pair and the summary the tester pastes back. Pure, so the slice
 * and every view share one reading of it.
 *
 * @see plan-slots.ts.md
 */
import type { LightCheck, PairKey } from "./bench-export";

/** The places the light pairs can be repeated at. */
export const MAX_SPOTS = 3;
/** The most "other" pairs a run can add. */
export const MAX_EXTRA = 8;

const LIGHT_KEYS = ["1a", "1b", "1c"] as const;
const OTHER_KEYS = [
  "2a",
  "2b",
  "2c",
  "2d",
  "3a",
  "3b",
  "3c",
  "4a",
  "4b",
  "4c",
  "4d",
] as const;

/** One pair of the run: its id names its folder in the run's zip. */
export interface Slot {
  readonly id: string;
  readonly key: PairKey;
  readonly spot: number;
}

/** What the status reads of a slot's pair. */
export interface PairLike {
  readonly a: unknown;
  readonly b: unknown;
  readonly light: LightCheck | null;
}

export type SlotStatus = "missing" | "half" | "done" | "retake";

/** A step after a pair: the next pair not done after the current one, an
 * earlier pair still missing a photo, or the end screen. */
export type NextStep =
  | { readonly kind: "next"; readonly index: number }
  | { readonly kind: "missing"; readonly index: number }
  | { readonly kind: "end" };

const clampInt = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo;

/**
 * The light pairs per place, then the other pairs at place 1, then the
 * extra pairs. Places are clamped to 1..MAX_SPOTS, extras to 0..MAX_EXTRA.
 */
export function slotList(spots: number, extra: number): Slot[] {
  const s = clampInt(spots, 1, MAX_SPOTS);
  const x = clampInt(extra, 0, MAX_EXTRA);
  const list: Slot[] = [];
  for (let spot = 1; spot <= s; spot++) {
    for (const key of LIGHT_KEYS) {
      list.push({ id: `${key}-s${String(spot)}`, key, spot });
    }
  }
  for (const key of OTHER_KEYS) {
    list.push({ id: `${key}-s1`, key, spot: 1 });
  }
  for (let i = 1; i <= x; i++) {
    list.push({ id: `x${String(i)}-s1`, key: "x", spot: 1 });
  }
  return list;
}

/** Missing (no photo), half (A only), done, or retake (a light check failed). */
export function slotStatus(p: PairLike | undefined): SlotStatus {
  if (!p?.a) {
    return "missing";
  }
  if (!p.b) {
    return "half";
  }
  return p.light === null || p.light === "ok" ? "done" : "retake";
}

const complete = (st: SlotStatus): boolean => st === "done" || st === "retake";

/** The slots of `list` whose pair has both photos. */
export const doneCount = (
  list: readonly Slot[],
  pairs: Readonly<Record<string, PairLike>>,
): number => list.filter((s) => complete(slotStatus(pairs[s.id]))).length;

/** The photo the camera button takes next: a retake's, else A, then B. */
export function shotDue(
  p: PairLike | undefined,
  retake: "a" | "b" | null,
): "a" | "b" | null {
  if (retake) {
    return retake;
  }
  if (!p?.a) {
    return "a";
  }
  return p.b ? null : "b";
}

/**
 * The first pair after `current` that is not done (a retake counts as
 * open there, so the walk stops at it), else the first pair still missing
 * a photo unless that is the current one, else the end.
 */
export function nextStep(
  list: readonly Slot[],
  pairs: Readonly<Record<string, PairLike>>,
  current: number,
): NextStep {
  const after = list.findIndex(
    (s, i) => i > current && slotStatus(pairs[s.id]) !== "done",
  );
  if (after >= 0) {
    return { kind: "next", index: after };
  }
  const first = list.findIndex((s) => !complete(slotStatus(pairs[s.id])));
  return first >= 0 && first !== current
    ? { kind: "missing", index: first }
    : { kind: "end" };
}

/** The run's zip, named by the session token only. */
export const runZipName = (session: string): string =>
  `feature-match-run-${session}.zip`;

export interface SummaryInput {
  readonly session: string;
  readonly spots: number;
  readonly list: readonly Slot[];
  readonly pairs: Readonly<Record<string, PairLike>>;
  /** Photos taken in the run, retakes included. */
  readonly shots: number;
  /** Times the run's zip was downloaded. */
  readonly downloads: number;
  readonly device: string;
}

/** The plain text the tester copies: what is complete, missing and checked. */
export function summaryText(i: SummaryInput): string {
  const statuses = i.list.map((s) => slotStatus(i.pairs[s.id]));
  const done = statuses.filter(complete).length;
  const halves = statuses.filter((st) => st === "half").length;
  const missing = i.list.filter((_s, n) => !complete(statuses[n] ?? "missing"));
  const light = i.list.flatMap((s) => {
    const l = i.pairs[s.id]?.light;
    return l ? [`${s.id} ${l}`] : [];
  });
  const places = clampInt(i.spots, 1, MAX_SPOTS);
  const retakes = Math.max(0, i.shots - 2 * done - halves);
  return [
    "Feature matcher photo test - summary",
    `Session: ${i.session}`,
    `Pairs complete: ${String(done)} of ${String(i.list.length)} (light tests at ${String(places)} place${places === 1 ? "" : "s"})`,
    `Missing: ${missing.length ? missing.map((s) => s.id).join(", ") : "none"}`,
    `Light checks: ${light.length ? light.join(", ") : "-"}`,
    `Extra shots (retakes): ${String(retakes)}`,
    `File: ${runZipName(i.session)}${i.downloads > 0 ? "" : " (not downloaded yet)"}`,
    `Phone: ${i.device}`,
    "No location, no time and no names are included.",
  ].join("\n");
}
