/**
 * The cockpit view's dock as plain data, read from the page state: what
 * the big button does and says, the side buttons, the two tiles (the
 * scene's previous shot and the current one), the instruction line, the
 * readouts, the progress segments and the status line. Pure, so the view
 * only copies fields into its fixed boxes and every rule is unit-tested.
 *
 * @see cockpit-model.ts.md
 */
import type { FeatureMatchState } from "./feature-match-slice";
import { readyCount, shotContext, warned } from "./guided-model";
import { LIGHT_NOTE, retakeText } from "./guided-texts";
import { planPhotos, planShots } from "./run-plan";
import { lightOf, nextOpen } from "./scenes";
import { stillProgress } from "./still-detector";

type ShutterMode =
  "start" | "capture" | "cancel" | "busy" | "retake" | "next" | "save";

export interface ShutterView {
  readonly mode: ShutterMode;
  readonly text: string;
  /** The prototype's `data-mode`: armed, busy, save or none. */
  readonly tone: "" | "armed" | "busy" | "save";
  readonly disabled: boolean;
  /** The shot "next" moves to; -1 otherwise. */
  readonly index: number;
}

type RetakeAction =
  /** Take the current shot again. */
  | { readonly kind: "shoot" }
  /** Go back to the scene's previous shot. */
  | { readonly kind: "back"; readonly index: number };

export interface RetakeView {
  readonly label: string;
  readonly disabled: boolean;
  readonly action: RetakeAction | null;
  /** What a retake redoes, for the button's description; empty otherwise. */
  readonly hint: string;
}

export interface TileView {
  /** The prototype's `data-state`: armed, taken or none. */
  readonly state: "" | "armed" | "taken";
  readonly text: string;
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

const base = { disabled: false, index: -1, tone: "" } as const;

/** Whether the current shot is waiting to take itself (armed or waiting). */
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
  if (s.guided.count) {
    return { ...base, mode: "cancel", text: "Tap to stop", tone: "armed" };
  }
  const c = shotContext(s);
  const key = c.shot.key;
  if (c.photo && c.fixAt !== c.index) {
    // Only a new L1 fixes this shot's light check: lead there, camera or not.
    return { ...base, mode: "next", text: "Back to L1", index: c.fixAt };
  }
  const wants = !c.photo || warned(c.light);
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
      text: `Taking ${key}`,
      tone: "busy",
      disabled: true,
    };
  }
  if (!c.photo && handsOffWaits(s)) {
    // A tap still takes the shot (with the countdown): the way out of the wait.
    return {
      ...base,
      mode: "capture",
      tone: "armed",
      text: s.handsOff.phase === "armed" ? "Waiting" : "Hold still",
    };
  }
  if (!c.photo) {
    const secs = s.plan.settings.countdown;
    return {
      ...base,
      mode: "capture",
      text: secs ? `${key} in ${String(secs)} s` : `Take ${key}`,
    };
  }
  if (wants) {
    return { ...base, mode: "retake", text: `Retake ${key}` };
  }
  const next = nextOpen(c.list, planPhotos(s.plan), c.index);
  return next === null
    ? { ...base, mode: "save", text: "All done", tone: "save" }
    : { ...base, mode: "next", text: "Next shot", index: next };
}

const OFF: RetakeView = {
  label: "Retake",
  disabled: true,
  action: null,
  hint: "",
};

/**
 * The side button left of the big one: retakes the current shot once it
 * has a photo, else goes back to the scene's previous shot.
 */
export function retakeView(s: FeatureMatchState): RetakeView {
  if (s.busy !== "idle" || s.guided.count) {
    return OFF;
  }
  const c = shotContext(s);
  if (c.photo && c.fixAt !== c.index) {
    return {
      label: "Back to L1",
      disabled: false,
      action: { kind: "back", index: c.fixAt },
      hint: "",
    };
  }
  if (c.photo) {
    return {
      label: `Retake ${c.shot.key}`,
      disabled: false,
      action: { kind: "shoot" },
      hint: retakeText(c.shot.key, c.redoes),
    };
  }
  if (c.prev && c.prevPhoto) {
    return {
      label: `Back to ${c.prev.key}`,
      disabled: false,
      action: { kind: "back", index: c.index - 1 },
      hint: "",
    };
  }
  return OFF;
}

/**
 * The two tiles: "a" the scene's previous shot (a tap goes back to it),
 * "b" the current one (armed while it is due).
 */
export function tileView(s: FeatureMatchState): {
  readonly a: TileView;
  readonly b: TileView;
} {
  const c = shotContext(s);
  const off = s.busy !== "idle" || s.guided.count !== null;
  const count = s.guided.count;
  const b: TileView =
    !c.photo && s.camera
      ? {
          state: "armed",
          text: count ? `${String(count.left)} s` : "now",
          disabled: true,
        }
      : {
          state: c.photo ? "taken" : "",
          text: c.photo ? "taken" : "-",
          disabled: true,
        };
  return {
    a: {
      state: c.prevPhoto ? "taken" : "",
      text: c.prev ? c.prev.key : "-",
      disabled: !c.prev || off,
    },
    b,
  };
}

/** The instruction line: an optional bold label and its text. */
export function instrView(s: FeatureMatchState): {
  readonly label: string | null;
  readonly text: string;
  /** A word of `text` shown bold, as the prototype marks the action. */
  readonly bold?: string;
} {
  if (s.running !== null) {
    return {
      label: null,
      text: "Measuring. The camera is paused; leave the phone where it is.",
    };
  }
  const c = shotContext(s);
  if (!c.photo && !s.camera) {
    return {
      label: null,
      text: "Put the phone on its stand, then tap Start to turn the camera on.",
      bold: "Start",
    };
  }
  if (!c.photo) {
    return {
      label: c.shot.key,
      text:
        c.shot.step === 0
          ? `${c.card.setup} ${c.card.capture}`
          : `${c.card.change} ${c.card.capture}`,
    };
  }
  if (warned(c.light)) {
    return { label: c.shot.key, text: LIGHT_NOTE[c.light] };
  }
  return nextOpen(c.list, planPhotos(s.plan), c.index) === null
    ? {
        label: null,
        text: "All shots done. Download all saves the pairs in one zip.",
      }
    : {
        label: null,
        text: `Shot done. Retake it, or go to the next shot. ${retakeText(c.shot.key, c.redoes)}`,
      };
}

/** "done / total": shots with a photo whose light check did not fail. */
export function progressText(s: FeatureMatchState): string {
  const photos = planPhotos(s.plan);
  const list = planShots(s.plan);
  const done = list.filter(
    (sh) => photos[sh.id] && !warned(lightOf(sh.id, photos)),
  ).length;
  return `${String(done)} / ${String(list.length)}`;
}

/** One class per shot for the progress segments. */
export function segClasses(s: FeatureMatchState): string[] {
  const photos = planPhotos(s.plan);
  return planShots(s.plan).map((sh, i) =>
    i === s.plan.current
      ? "cur"
      : !photos[sh.id]
        ? ""
        : warned(lightOf(sh.id, photos))
          ? "warn"
          : "kept",
  );
}

/** "Download all (N)": the ready pairs, or the plain label with none. */
export function downloadLabel(s: FeatureMatchState): string {
  const n = readyCount(s);
  return n > 0 ? `Download all (${String(n)})` : "Download all";
}

/** Before a dimmed shot is taken: the dock must not light the room. */
export function nightOn(s: FeatureMatchState): boolean {
  const c = shotContext(s);
  return (c.shot.key === "L3" || c.shot.key === "L4") && !c.photo;
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
  const c = shotContext(s);
  const still: Readout = !motion.seen
    ? { text: "still: -", tone: "" }
    : motion.moving
      ? { text: "moving", tone: "wait" }
      : { text: "steady", tone: "good" };
  const light: Readout = c.light
    ? { text: `light ${c.light}`, tone: c.light === "ok" ? "good" : "wait" }
    : c.photo
      ? {
          text: `light ${c.shot.key} ${String(Math.round(c.photo.greyMean))}`,
          tone: "",
        }
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
 * dwell while a shot waits for the phone to rest, else empty.
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

/** The status text of the run going, else empty. */
export const runStatusText = (s: FeatureMatchState): string =>
  s.running === null ? "" : s.status[s.running];

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
    a.shot === b.shot &&
    a.prev === b.prev &&
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
      text: `Countdown: ${c.shot.split("/").pop() ?? ""} in ${String(c.left)} s.`,
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
