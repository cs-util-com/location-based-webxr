/**
 * The cockpit view's dock as plain data, read from the page state: what
 * the big button does and says, the side buttons, the A and B tiles, the
 * instruction line, the readouts, the progress segments and the status
 * line. Pure, so the view only copies fields into its fixed boxes and
 * every rule is unit-tested.
 *
 * @see cockpit-model.ts.md
 */
import type { LightCheck } from "./bench-export";
import type { FeatureMatchState } from "./feature-match-slice";
import { guidedCard } from "./guided-texts";
import { doneCount, nextStep, shotDue, slotStatus } from "./plan-slots";
import { keptState, planSlots } from "./run-plan";
import { stillProgress } from "./still-detector";

type Shot = "a" | "b";
const up = (w: Shot): string => w.toUpperCase();

type ShutterMode =
  "start" | "capture" | "cancel" | "busy" | "retake" | "next" | "save";

export interface ShutterView {
  readonly mode: ShutterMode;
  readonly text: string;
  /** The prototype's `data-mode`: armed, busy, save or none. */
  readonly tone: "" | "armed" | "busy" | "save";
  readonly disabled: boolean;
  /** The photo "capture" and "retake" take; null otherwise. */
  readonly shot: Shot | null;
  /** The slot "next" moves to; -1 otherwise. */
  readonly index: number;
}

/** The pair finished last, for "Retake B of NN" after the automatic move. */
export interface LastPair {
  readonly index: number;
  readonly seq: number;
}

type RetakeAction =
  | { readonly kind: "toggle"; readonly which: Shot }
  | { readonly kind: "back"; readonly index: number };

export interface RetakeView {
  readonly label: string;
  readonly disabled: boolean;
  readonly action: RetakeAction | null;
}

export interface TileView {
  /** The prototype's `data-state`: armed, taken, retake or none. */
  readonly state: "" | "armed" | "taken" | "retake";
  readonly text: string;
  /** A tap toggles the retake of a taken photo. */
  readonly disabled: boolean;
}

export interface Readout {
  readonly text: string;
  readonly tone: "" | "good" | "wait";
}

export interface Line {
  readonly text: string;
  readonly tone: "" | "ok" | "bad";
}

/** The current slot, its record and the photo due. */
function current(s: FeatureMatchState) {
  const list = planSlots(s.plan);
  const index = Math.min(Math.max(0, s.plan.current), list.length - 1);
  const slot = list[index]!;
  const rec = s.plan.slots[slot.id];
  return { list, index, slot, rec, due: shotDue(rec, s.guided.retake) };
}

const warned = (
  light: LightCheck | null | undefined,
): light is Exclude<LightCheck, "ok"> =>
  light !== null && light !== undefined && light !== "ok";

/**
 * The photo a failed light check asks to take again. Only an almost black
 * A needs A again; every other case is fixed by a new B (a B that is not
 * darker is dimmed further), so a retake never loops on the same photo.
 */
export const warnShot = (light: Exclude<LightCheck, "ok">): Shot =>
  light === "too-dark-a" ? "a" : "b";

/** The instruction line after a failed light check, matching `warnShot`. */
const WARN_NOTE: Readonly<Record<Exclude<LightCheck, "ok">, string>> = {
  "not-darker": "Photo B is not darker than A. Dim further, then retake B.",
  "too-dark-a": "Photo A is almost black. Turn the light on and retake A.",
  "too-dark-b":
    "Photo B is black: nothing to match. Dim a little less and retake B.",
  changed:
    "The light changed during the control pair. Retake B with the same light.",
};

const base = { disabled: false, shot: null, index: -1, tone: "" } as const;

/** Whether photo B is waiting to take itself (armed or waiting). */
const handsOffWaits = (s: FeatureMatchState): boolean =>
  s.handsOff.phase === "armed" || s.handsOff.phase === "waiting";

/** The big button. */
export function shutterView(s: FeatureMatchState): ShutterView {
  if (s.running !== null) {
    return {
      ...base,
      mode: "busy",
      text: "Measuring",
      tone: "busy",
      disabled: true,
    };
  }
  if (s.busy !== "idle") {
    return {
      ...base,
      mode: "busy",
      text: "Saving",
      tone: "busy",
      disabled: true,
    };
  }
  const { list, index, rec, due } = current(s);
  if (s.guided.count) {
    return { ...base, mode: "cancel", text: "Tap to stop", tone: "armed" };
  }
  const light = rec?.light;
  const wants: Shot | null = due ?? (warned(light) ? warnShot(light) : null);
  if (wants && !s.camera) {
    return s.cameraStart === "starting"
      ? { ...base, mode: "start", text: "Starting", disabled: true }
      : {
          ...base,
          mode: "start",
          text: s.cameraStart === "failed" ? "Retry camera" : "Start",
        };
  }
  if (s.handsOff.phase === "taking") {
    return {
      ...base,
      mode: "busy",
      text: "Taking B",
      tone: "busy",
      disabled: true,
    };
  }
  if (due === "b" && handsOffWaits(s)) {
    // A tap still takes B (with the countdown): the way out of the wait.
    return {
      ...base,
      mode: "capture",
      shot: "b",
      tone: "armed",
      text: s.handsOff.phase === "armed" ? "Waiting" : "Hold still",
    };
  }
  if (due) {
    const secs = s.plan.settings.countdown;
    return {
      ...base,
      mode: "capture",
      shot: due,
      text: secs
        ? `${up(due)} in ${String(secs)} s`
        : `${s.guided.retake ? "Retake" : "Take"} ${up(due)}`,
    };
  }
  if (wants) {
    return {
      ...base,
      mode: "retake",
      shot: wants,
      text: `Retake ${up(wants)}`,
    };
  }
  const step = nextStep(list, s.plan.slots, index);
  return step.kind === "end"
    ? { ...base, mode: "save", text: "All done", tone: "save" }
    : { ...base, mode: "next", text: "Next pair", index: step.index };
}

const OFF: RetakeView = { label: "Retake", disabled: true, action: null };

/** The side button left of the big one. */
export function retakeView(
  s: FeatureMatchState,
  last: LastPair | null,
): RetakeView {
  if (s.busy !== "idle" || s.guided.count) {
    return OFF;
  }
  const { index, rec, due } = current(s);
  const r = s.guided.retake;
  if (r) {
    return {
      label: "Cancel retake",
      disabled: false,
      action: { kind: "toggle", which: r },
    };
  }
  if (due === "b" && rec?.a) {
    return {
      label: "Retake A",
      disabled: false,
      action: { kind: "toggle", which: "a" },
    };
  }
  if (due === "a" && last && last.index !== index) {
    return {
      label: `Retake B of ${String(last.seq).padStart(2, "0")}`,
      disabled: false,
      action: { kind: "back", index: last.index },
    };
  }
  if (due === null && rec?.a && rec.b) {
    const which = warned(rec.light) ? warnShot(rec.light) : "b";
    return {
      label: `Retake ${up(which)}`,
      disabled: false,
      action: { kind: "toggle", which },
    };
  }
  return OFF;
}

/** The A and B tiles; a tap on a taken one toggles its retake. */
export function tileView(s: FeatureMatchState): Record<Shot, TileView> {
  const { rec, due } = current(s);
  const off = s.busy !== "idle" || s.guided.count !== null;
  const tile = (w: Shot): TileView => {
    const has = Boolean(rec?.[w]);
    const disabled = !has || off;
    if (s.guided.retake === w) {
      return { state: "retake", text: "retake", disabled };
    }
    if (due === w && s.camera) {
      const c = s.guided.count;
      return {
        state: "armed",
        text: c?.shot === w ? `${String(c.left)} s` : "now",
        disabled,
      };
    }
    return { state: has ? "taken" : "", text: has ? "taken" : "-", disabled };
  };
  return { a: tile("a"), b: tile("b") };
}

/** The instruction line: an optional bold "A:" or "B:" and its text. */
export function instrView(s: FeatureMatchState): {
  readonly label: "A" | "B" | null;
  readonly text: string;
  /** A word of `text` shown bold, as the prototype marks the action. */
  readonly bold?: string;
} {
  if (s.running !== null) {
    return {
      label: null,
      text: "Measuring the pair. The camera is paused; leave the phone where it is.",
    };
  }
  const { list, index, slot, rec, due } = current(s);
  if (due && !s.camera) {
    return {
      label: null,
      text: "Put the phone on its stand, then tap Start to turn the camera on.",
      bold: "Start",
    };
  }
  const card = guidedCard(slot.key);
  if (due === "a") {
    return { label: "A", text: card.a };
  }
  if (due === "b") {
    return {
      label: "B",
      text: s.guided.retake ? card.b : `${card.change} ${card.b}`,
    };
  }
  if (warned(rec?.light)) {
    return { label: null, text: WARN_NOTE[rec.light] };
  }
  return nextStep(list, s.plan.slots, index).kind === "end"
    ? {
        label: null,
        text:
          downloadCount(s) === 0
            ? "All pairs done and downloaded."
            : "All pairs done. Download all saves them in one zip.",
      }
    : {
        label: null,
        text: "Pair done. Tap A or B to retake one, or go to the next pair.",
      };
}

/**
 * The slot to move to once a complete pair is packed: the next open one,
 * else an earlier one still missing a photo; null after a failed light
 * check (the pair is taken again first), at the end, or on a half pair.
 */
export function nextAfterPair(s: FeatureMatchState): number | null {
  const { list, index, rec, due } = current(s);
  if (due !== null || !rec?.a || !rec.b || warned(rec.light)) {
    return null;
  }
  const step = nextStep(list, s.plan.slots, index);
  return step.kind === "end" ? null : step.index;
}

/** "done / total", the pairs complete without a failed light check. */
export function progressText(s: FeatureMatchState): string {
  const list = planSlots(s.plan);
  const done = list.filter(
    (sl) => slotStatus(s.plan.slots[sl.id]) === "done",
  ).length;
  return `${String(done)} / ${String(list.length)}`;
}

/** One class per slot for the progress segments. */
export function segClasses(s: FeatureMatchState): string[] {
  return planSlots(s.plan).map((sl, i) => {
    if (i === s.plan.current) {
      return "cur";
    }
    const k = keptState(s.plan, sl.id);
    return k === "saved"
      ? "saved"
      : k === "warn"
        ? "warn"
        : k === "kept" || k === "done"
          ? "kept"
          : "";
  });
}

/** Complete takes not downloaded yet: what Download all adds. */
export function downloadCount(s: FeatureMatchState): number {
  const list = planSlots(s.plan);
  return (
    doneCount(list, s.plan.slots) -
    list.filter((sl) => {
      const r = s.plan.slots[sl.id];
      return r?.a && r.b && r.downloaded;
    }).length
  );
}

/** Between photo A and B of the dimmed pairs: the dock must not light the room. */
export function nightOn(s: FeatureMatchState): boolean {
  const { slot, rec, due } = current(s);
  return (
    (slot.key === "1b" || slot.key === "1c") && due === "b" && Boolean(rec?.a)
  );
}

/** The three readouts under the buttons. */
export function readoutView(
  s: FeatureMatchState,
  motion: { readonly seen: boolean; readonly moving: boolean },
): {
  readonly still: Readout;
  readonly light: Readout;
  readonly mode: Readout;
} {
  const { rec } = current(s);
  const still: Readout = !motion.seen
    ? { text: "still: -", tone: "" }
    : motion.moving
      ? { text: "moving", tone: "wait" }
      : { text: "steady", tone: "good" };
  const light: Readout = rec?.light
    ? { text: `light ${rec.light}`, tone: rec.light === "ok" ? "good" : "wait" }
    : rec?.a
      ? { text: `light A ${String(Math.round(rec.a.greyMean))}`, tone: "" }
      : { text: "light: -", tone: "" };
  const secs = s.plan.settings.countdown;
  return {
    still,
    light,
    mode: handsOffWaits(s)
      ? { text: "auto", tone: "good" }
      : { text: secs ? `tap, ${String(secs)} s` : "tap", tone: "" },
  };
}

/**
 * The meter ring's fill from 0 to 1: the countdown while one runs, the
 * dwell while photo B waits for the phone to rest, else empty.
 */
export function meterFill(s: FeatureMatchState): number {
  const c = s.guided.count;
  const secs = s.plan.settings.countdown;
  if (c) {
    return secs > 0
      ? Math.min(1, Math.max(0, (secs - c.left + 1) / (secs + 1)))
      : 0;
  }
  const st = s.handsOff.still;
  return s.handsOff.phase === "waiting" && st ? stillProgress(st) : 0;
}

/** The status text of the run going (its own slot), else the photo pair's. */
export function runStatusText(s: FeatureMatchState): string {
  const k = s.running;
  return k === null || k === "plan" ? s.status.run : s.status[k];
}

/** Added to a packed pair's save line when no measurement went with it. */
export const NOT_MEASURED = "Not measured: see Results.";

/** What a pair's zip needs to know of one method's result. */
interface Measured {
  readonly error: string | null;
  readonly sizes: readonly { readonly error?: string | null }[];
}

/**
 * Whether the last photo-pair run measured take `seq` of `slot`: it
 * finished with results for that take, and at least one method measured
 * at least one size (a missing sift.js leaves every method in error).
 */
export function pairMeasured(
  s: FeatureMatchState,
  results: readonly Measured[] | undefined,
  slot: string,
  seq: number,
): boolean {
  const r = s.planRun;
  return (
    r !== null &&
    r.resultsId !== null &&
    r.slot === slot &&
    r.seq === seq &&
    (results ?? []).some(
      (m) => m.error === null && m.sizes.some((z) => !z.error),
    )
  );
}

/** How a hands-off capture went: a throw is "failed", no picture "refused". */
export function handsOffResult(
  shoot: () => boolean,
  onError: (e: unknown) => void = () => undefined,
): "taken" | "refused" | "failed" {
  try {
    return shoot() ? "taken" : "refused";
  } catch (e) {
    onError(e);
    return "failed";
  }
}

/**
 * Whether `next` draws the same page as `prev`: only the hands-off
 * detector moved, in the same phase and the same 1/50 of the meter. A
 * reading at 60 Hz then redraws only when something visible changes.
 */
export function sameDrawing(
  prev: FeatureMatchState,
  next: FeatureMatchState,
): boolean {
  if (prev === next) {
    return true;
  }
  for (const k of Object.keys(next) as (keyof FeatureMatchState)[]) {
    if (k !== "handsOff" && prev[k] !== next[k]) {
      return false;
    }
  }
  const a = prev.handsOff;
  const b = next.handsOff;
  return (
    a.phase === b.phase &&
    a.text === b.text &&
    a.slot === b.slot &&
    a.a === b.a &&
    Math.round(meterFill(prev) * 50) === Math.round(meterFill(next) * 50)
  );
}

/** The status line: the newest workflow line, with its tone. */
export function statusView(s: FeatureMatchState): Line {
  if (s.photoStoreFailing) {
    return {
      text: "Photos are not stored on this phone: Download all before a reload.",
      tone: "bad",
    };
  }
  if (s.running !== null) {
    return { text: runStatusText(s), tone: "" };
  }
  const c = s.guided.count;
  if (c) {
    return {
      text: `Countdown: photo ${up(c.shot)} in ${String(c.left)} s.`,
      tone: "",
    };
  }
  if (s.runZip.text) {
    const z = s.runZip.phase;
    return {
      text: s.runZip.text,
      tone: z === "saved" ? "ok" : z === "failed" ? "bad" : "",
    };
  }
  if (s.cameraStart === "starting") {
    return { text: "Starting the camera...", tone: "" };
  }
  if (s.cameraStart === "failed") {
    return { text: "Camera unavailable: tap Retry camera.", tone: "bad" };
  }
  if (s.fileSave.text) {
    return {
      text: s.fileSave.text,
      tone: s.fileSave.text.includes(NOT_MEASURED) ? "bad" : "",
    };
  }
  const h = s.handsOff;
  if (h.phase !== "off" && h.text) {
    return {
      text: h.text,
      tone:
        h.phase === "taken"
          ? "ok"
          : h.phase === "refused" || h.phase === "failed"
            ? "bad"
            : "",
    };
  }
  return { text: "", tone: "" };
}
