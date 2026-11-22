/**
 * The guided view's screens as plain data, read from the page state: the
 * run screen (which pair, which photo is due, which step is lit, what the
 * big button does), the pairs sheet's rows and the end screen. Pure, so the
 * view only copies fields into the DOM and every rule is unit-tested.
 *
 * @see guided-model.ts.md
 */
import type { FeatureMatchState } from "./feature-match-slice";
import { guidedCard, LIGHT_NOTE, GUIDED_STEPS } from "./guided-texts";
import type { DiagramKind } from "./guided-diagram";
import {
  doneCount,
  nextStep,
  shotDue,
  slotStatus,
  type SlotStatus,
} from "./plan-slots";
import { planSlots } from "./run-plan";

/** A step of the card's A / change / B list. */
export type StepMark = "now" | "past" | "todo";

export interface ThumbView {
  readonly filled: boolean;
  readonly retaking: boolean;
  readonly disabled: boolean;
  /** "empty", "retake" or "retaking". */
  readonly sub: string;
}

export type PrimaryMode = "capture" | "cancel" | "next" | "missing" | "finish";

export interface PrimaryView {
  readonly mode: PrimaryMode;
  readonly label: string;
  readonly sub: string;
  readonly disabled: boolean;
  /** The slot "next" and "missing" move to; -1 otherwise. */
  readonly index: number;
  /** The photo "capture" takes; null otherwise. */
  readonly shot: "a" | "b" | null;
}

export interface RunView {
  readonly pos: string;
  readonly done: number;
  readonly total: number;
  readonly slot: string;
  readonly key: string;
  readonly title: string;
  /** "place N" on the light pairs, else empty. */
  readonly place: string;
  readonly purpose: string;
  readonly avoid: string;
  readonly diagram: DiagramKind;
  readonly steps: {
    readonly a: string;
    readonly change: string;
    readonly b: string;
  };
  readonly chip: { readonly shot: "a" | "b" | "done"; readonly text: string };
  readonly seq: {
    readonly a: StepMark;
    readonly change: StepMark;
    readonly b: StepMark;
  };
  /** Both photos taken and none due: the finder shows the pair. */
  readonly reviewing: boolean;
  readonly note: { readonly warn: boolean; readonly text: string };
  /** The ghost of photo A can be laid over the finder. */
  readonly ghost: boolean;
  readonly slots: { readonly a: ThumbView; readonly b: ThumbView };
  readonly primary: PrimaryView;
}

const up = (w: "a" | "b"): string => w.toUpperCase();
const isLight = (key: string): boolean => key.startsWith("1");

const COMPLETE_NOTE =
  "Pair complete. Check both photos are sharp; tap A or B below to retake one.";

function primaryView(s: FeatureMatchState, due: "a" | "b" | null): PrimaryView {
  const busy = s.busy !== "idle";
  const g = s.guided;
  const base = { disabled: busy, index: -1, shot: null };
  if (g.count) {
    return {
      ...base,
      mode: "cancel",
      label: "Cancel",
      sub: `shooting ${up(g.count.shot)} in ${String(g.count.left)} s`,
    };
  }
  if (due) {
    const secs = s.plan.settings.countdown;
    return {
      ...base,
      shot: due,
      mode: "capture",
      label: `${g.retake ? "Retake" : "Capture"} ${up(due)}`,
      sub: secs ? `then ${String(secs)} s hands off` : "shoots at once",
    };
  }
  const list = planSlots(s.plan);
  const step = nextStep(list, s.plan.slots, s.plan.current);
  if (step.kind === "next") {
    const next = list[step.index]!;
    const rec = s.plan.slots[list[s.plan.current]!.id];
    const warn = rec?.light != null && rec.light !== "ok";
    return {
      ...base,
      mode: "next",
      index: step.index,
      label: "Next pair",
      sub: warn
        ? "or tap A or B to retake first"
        : `${next.key}: ${GUIDED_STEPS[next.key as keyof typeof GUIDED_STEPS].title}`,
    };
  }
  if (step.kind === "missing") {
    return {
      ...base,
      mode: "missing",
      index: step.index,
      label: "Next missing pair",
      sub: "some pairs are not done yet",
    };
  }
  return {
    ...base,
    mode: "finish",
    label: "Finish",
    sub: "all pairs done: download",
  };
}

/** The run screen for the current plan slot. */
export function runView(s: FeatureMatchState): RunView {
  const list = planSlots(s.plan);
  const i = Math.min(Math.max(0, s.plan.current), list.length - 1);
  const slot = list[i]!;
  const key = slot.key as keyof typeof GUIDED_STEPS;
  const card = guidedCard(key);
  const rec = s.plan.slots[slot.id];
  const g = s.guided;
  const due = shotDue(rec, g.retake);
  const busy = s.busy !== "idle";

  const nowPart =
    due === "a"
      ? "a"
      : due === "b"
        ? rec?.a && !g.retake
          ? "change"
          : "b"
        : null;
  const mark = (part: "a" | "change" | "b"): StepMark => {
    if (part === nowPart || (nowPart === "change" && part === "b"))
      return "now";
    const had = part === "a" ? rec?.a : rec?.b;
    return had && !g.retake ? "past" : "todo";
  };
  const thumb = (w: "a" | "b"): ThumbView => {
    const has = Boolean(rec?.[w]);
    const retaking = g.retake === w;
    return {
      filled: has,
      retaking,
      disabled: !has || g.count !== null || busy,
      sub: retaking ? "retaking" : has ? "retake" : "empty",
    };
  };
  const reviewing = due === null && g.count === null;
  const light = rec?.light ?? null;

  return {
    pos: `Pair ${String(i + 1)} of ${String(list.length)}`,
    done: doneCount(list, s.plan.slots),
    total: list.length,
    slot: slot.id,
    key: slot.key,
    title: card.title,
    place: isLight(slot.key) ? `place ${String(slot.spot)}` : "",
    purpose: card.purpose,
    avoid: card.avoid,
    diagram: card.diagram,
    steps: { a: card.a, change: card.change, b: card.b },
    chip: due
      ? { shot: due, text: `${g.retake ? "Retake" : "Shot"} ${up(due)}` }
      : { shot: "done", text: "Check" },
    seq: { a: mark("a"), change: mark("change"), b: mark("b") },
    reviewing,
    note: light
      ? { warn: light !== "ok", text: LIGHT_NOTE[light] }
      : { warn: false, text: COMPLETE_NOTE },
    ghost: due === "b" && Boolean(rec?.a),
    slots: { a: thumb("a"), b: thumb("b") },
    primary: primaryView(s, due),
  };
}

export interface PairRow {
  readonly index: number;
  readonly label: string;
  readonly sub: string;
  readonly status: SlotStatus;
  readonly current: boolean;
}

const STATUS_WORDS: Readonly<Record<SlotStatus, string>> = {
  done: "done",
  half: "A only",
  retake: "retake suggested",
  missing: "missing",
};

/** The pairs sheet: every slot, its state in words, the current one marked. */
export function pairRows(s: FeatureMatchState): PairRow[] {
  return planSlots(s.plan).map((slot, index) => {
    const status = slotStatus(s.plan.slots[slot.id]);
    const title = GUIDED_STEPS[slot.key as keyof typeof GUIDED_STEPS].title;
    return {
      index,
      label: isLight(slot.key)
        ? `${slot.key} place ${String(slot.spot)}`
        : slot.key,
      sub: `${title} - ${STATUS_WORDS[status]}`,
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
}

/** The end screen: what is captured and whether the zip can be made. */
export function endView(s: FeatureMatchState): EndView {
  const list = planSlots(s.plan);
  const done = doneCount(list, s.plan.slots);
  const all = done === list.length;
  return {
    all,
    done,
    total: list.length,
    kicker: all
      ? "All pairs captured"
      : `${String(done)} of ${String(list.length)} pairs captured`,
    title: all ? "Thank you. One last step." : "You can send what you have.",
    lede: all
      ? "Download the zip, then send it together with the summary below."
      : "Only complete pairs go into the zip. Go back to the pairs any time to add the rest.",
    canDownload: done > 0 && s.busy === "idle",
  };
}
