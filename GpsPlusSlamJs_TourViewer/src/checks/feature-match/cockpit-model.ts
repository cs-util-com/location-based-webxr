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

type Shot = "a" | "b";
const up = (w: Shot): string => w.toUpperCase();

export type ShutterMode =
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

export type RetakeAction =
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
        text: "All pairs done. Download all saves them in one zip.",
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
    mode: { text: secs ? `tap, ${String(secs)} s` : "tap", tone: "" },
  };
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
    return { text: s.status.run, tone: "" };
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
  if (s.fileSave.text) {
    return { text: s.fileSave.text, tone: "" };
  }
  if (s.cameraStart === "starting") {
    return { text: "Starting the camera...", tone: "" };
  }
  if (s.cameraStart === "failed") {
    return { text: "Camera unavailable: tap Retry camera.", tone: "bad" };
  }
  return { text: "", tone: "" };
}
