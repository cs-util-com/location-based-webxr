/**
 * The guided view's screens as plain data, read from the page state: the
 * run screen (which shot, which step is lit, what the big button does),
 * the shots sheet's rows and the end screen; plus the current shot's
 * context both views read, and the motion and device helpers. Pure, so
 * the view only copies fields into the DOM and every rule is unit-tested.
 *
 * @see guided-model.ts.md
 */
import type { DeviceInfo } from "./bench-report";
// Types only: the slice imports still-detector, which imports this module.
import type { FeatureMatchState, MeasureProgress } from "./feature-match-slice";
import type { DiagramKind } from "./guided-diagram";
import {
  LIGHT_NOTE,
  retakeText,
  shotCard,
  type ShotCard,
} from "./guided-texts";
import { planPhotos, planShots, type PhotoMeta } from "./run-plan";
import {
  derivedPairs,
  lightOf,
  nextOpen,
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

/** Shots with a photo, and every shot. */
export function shotCounts(s: FeatureMatchState): {
  readonly done: number;
  readonly total: number;
} {
  const list = planShots(s.plan);
  return {
    done: list.filter((sh) => s.plan.shots[sh.id]).length,
    total: list.length,
  };
}

/** The pairs whose two shots have a photo: what Download all saves. */
export const readyCount = (s: FeatureMatchState): number =>
  readyPairs(derivedPairs(s.plan.spots, s.plan.extra), planPhotos(s.plan))
    .length;

/** A step of the card's setup / change / shot list. */
type StepMark = "now" | "past" | "todo";

interface ThumbView {
  readonly filled: boolean;
  readonly disabled: boolean;
  readonly sub: string;
}

type PrimaryMode = "capture" | "cancel" | "next" | "missing" | "finish";

interface PrimaryView {
  readonly mode: PrimaryMode;
  readonly label: string;
  readonly sub: string;
  readonly disabled: boolean;
  /** The shot "next" and "missing" move to; -1 otherwise. */
  readonly index: number;
}

export interface RunView {
  readonly pos: string;
  readonly done: number;
  readonly total: number;
  readonly shot: string;
  readonly key: string;
  readonly title: string;
  /** "place N" on the light shots, else empty. */
  readonly place: string;
  readonly purpose: string;
  readonly avoid: string;
  readonly diagram: DiagramKind;
  readonly steps: {
    readonly a: string;
    readonly change: string;
    readonly b: string;
  };
  /** "a" on a scene's first shot, "b" on a later one, "done" once taken. */
  readonly chip: { readonly shot: "a" | "b" | "done"; readonly text: string };
  readonly seq: {
    readonly a: StepMark;
    readonly change: StepMark;
    readonly b: StepMark;
  };
  /** The shot has its photo and no count runs: the finder shows it. */
  readonly reviewing: boolean;
  readonly note: { readonly warn: boolean; readonly text: string };
  /** The scene's previous photo can be laid over the finder. */
  readonly ghost: boolean;
  /** Thumb "a": the scene's previous shot; "b": this one. */
  readonly slots: { readonly a: ThumbView; readonly b: ThumbView };
  /** Photo ids of the two thumbs. */
  readonly photos: { readonly a: string | null; readonly b: string | null };
  readonly primary: PrimaryView;
}

function primaryView(s: FeatureMatchState, c: ShotContext): PrimaryView {
  const base = { disabled: s.busy !== "idle", index: -1 };
  const count = s.guided.count;
  if (count) {
    return {
      ...base,
      mode: "cancel",
      label: "Cancel",
      sub: `shooting ${c.shot.key} in ${String(count.left)} s`,
    };
  }
  if (c.photo && c.fixAt !== c.index) {
    return {
      ...base,
      mode: "next",
      index: c.fixAt,
      label: "Back to L1",
      sub: "L1 is too dark to dim from",
    };
  }
  const secs = s.plan.settings.countdown;
  const timing = secs ? `then ${String(secs)} s hands off` : "shoots at once";
  if (!c.photo || warned(c.light)) {
    return {
      ...base,
      mode: "capture",
      label: `${c.photo ? "Retake" : "Capture"} ${c.shot.key}`,
      sub: timing,
    };
  }
  const next = nextOpen(c.list, planPhotos(s.plan), c.index);
  if (next === null) {
    return { ...base, mode: "finish", label: "Finish", sub: "all shots done" };
  }
  const to = c.list[next]!;
  return next > c.index
    ? {
        ...base,
        mode: "next",
        index: next,
        label: "Next shot",
        sub: `${to.key}: ${shotCard(to).title}`,
      }
    : {
        ...base,
        mode: "missing",
        index: next,
        label: "Next missing shot",
        sub: "some shots are not taken yet",
      };
}

/** The run screen for the current shot. */
export function runView(s: FeatureMatchState): RunView {
  const c = shotContext(s);
  const { shot, card, photo } = c;
  const busy = s.busy !== "idle";
  const counting = s.guided.count !== null;
  const first = shot.step === 0;
  const reviewing = Boolean(photo) && !counting;
  const mark = (part: "a" | "change" | "b"): StepMark => {
    if (reviewing) return "past";
    if (first) return part === "a" ? "now" : "todo";
    return part === "a" ? "past" : "now";
  };
  const { done, total } = shotCounts(s);
  const retake = retakeText(shot.key, c.redoes);
  return {
    pos: `Shot ${String(c.index + 1)} of ${String(total)}`,
    done,
    total,
    shot: shot.id,
    key: shot.key,
    title: card.title,
    place: shot.kind === "light" ? `place ${String(shot.spot)}` : "",
    purpose: card.purpose,
    avoid: card.avoid,
    diagram: card.diagram,
    steps: {
      a: card.setup,
      change: first ? "This is the scene's first shot." : card.change,
      b: card.capture,
    },
    chip: reviewing
      ? { shot: "done", text: "Check" }
      : { shot: first ? "a" : "b", text: `Shot ${shot.key}` },
    seq: { a: mark("a"), change: mark("change"), b: mark("b") },
    reviewing,
    note: c.light
      ? { warn: warned(c.light), text: `${LIGHT_NOTE[c.light]} ${retake}` }
      : { warn: false, text: `Photo taken. Check it is sharp. ${retake}` },
    ghost: !photo && Boolean(c.prevPhoto),
    slots: {
      a: {
        filled: Boolean(c.prevPhoto),
        disabled: !c.prev || counting || busy,
        sub: c.prev ? c.prev.key : "-",
      },
      b: {
        filled: Boolean(photo),
        disabled: !photo || counting || busy,
        sub: photo ? "retake" : "empty",
      },
    },
    photos: { a: c.prevPhoto?.id ?? null, b: photo?.id ?? null },
    primary: primaryView(s, c),
  };
}

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

export interface EndView {
  readonly all: boolean;
  readonly done: number;
  readonly total: number;
  readonly kicker: string;
  readonly title: string;
  readonly lede: string;
  readonly canDownload: boolean;
  readonly download: {
    readonly label: string;
    readonly text: string;
    /** "ok" after a saved zip, "err" after a failed one. */
    readonly tone: "" | "ok" | "err";
  };
}

function downloadView(
  s: FeatureMatchState,
  ready: number,
): EndView["download"] {
  const z = s.runZip;
  switch (z.phase) {
    case "preparing":
      return { label: "Preparing the zip...", text: z.text, tone: "" };
    case "saved":
      return { label: "Download again", text: z.text, tone: "ok" };
    case "failed":
      return { label: "Download all", text: z.text, tone: "err" };
    case "idle":
      return {
        label: "Download all",
        text:
          z.text ||
          `One zip with ${String(ready)} pair${ready === 1 ? "" : "s"}, saved to this phone only.`,
        tone: "",
      };
  }
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
    return `Measuring stopped: the worker crashed twice. ${of} measured; the rest go to the PC.`;
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

/**
 * The end screen: what is captured and whether the zip can be made, and
 * with `progress` how far the phone got with measuring the pairs.
 */
export function endView(
  s: FeatureMatchState,
  progress?: MeasureProgress,
): EndView {
  const { done, total } = shotCounts(s);
  const ready = readyCount(s);
  const all = done === total;
  return {
    all,
    done,
    total,
    kicker: all
      ? "All shots taken"
      : `${String(done)} of ${String(total)} shots taken`,
    title: all ? "Thank you. One last step." : "You can send what you have.",
    lede: [
      all
        ? "Download the zip, then send it together with the summary below."
        : "Only pairs with both shots go into the zip. Go back to the shots any time to add the rest.",
      progress ? measureText(progress) : "",
    ]
      .filter((t) => t !== "")
      .join(" "),
    canDownload: ready > 0 && s.busy === "idle",
    download: downloadView(s, ready),
  };
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

/** The intro's "Keep the phone still" text for the countdown and sound settings. */
export function introCountdownText(s: {
  readonly countdown: number;
  readonly sound: boolean;
}): string {
  if (s.countdown <= 0) {
    return "A tap shakes the phone, and the countdown is off: each photo is taken at your tap. Rest the phone on something steady, or set a countdown under Shots.";
  }
  return `A tap shakes the phone, so each photo is taken ${String(s.countdown)} seconds after your tap${s.sound ? ", with a beep per second" : ""}. Hands off until the click.`;
}
