/**
 * The character maker's draft: where the author is in the six steps, what
 * they wrote and chose, and the cut settings of "Adjust the cut". It is
 * kept in the page's local storage, so it is read back field by field and
 * every field that does not read falls back to its fresh value alone.
 * Also the stepper's words and the main button's label, as pure functions.
 */

import { CUT_SETTINGS, type CutSettings } from "./cut-settings.js";

export const MAKER_STEPS = [
  "Describe your character",
  "Copy the prompt",
  "Make the picture",
  "Bring the picture back",
  "Check your character",
  "Name and save",
] as const;

const BACKDROP_IDS = ["meadow", "autumn", "city", "snow"] as const;
export type BackdropId = (typeof BACKDROP_IDS)[number];
type TalkChoice = "drawn" | "steady";

/** The settings "Adjust the cut" offers. */
export interface CutChoice {
  readonly whiteTol: number;
  readonly shadowOn: boolean;
  readonly shadowFloor: number;
  readonly islandMin: number;
  readonly edgeSoft: number;
}
export type CutSliderKey = Exclude<keyof CutChoice, "shadowOn">;

export const CUT_CHOICE_DEFAULTS: CutChoice = {
  whiteTol: CUT_SETTINGS.whiteTol,
  shadowOn: CUT_SETTINGS.shadowOn,
  shadowFloor: CUT_SETTINGS.shadowFloor,
  islandMin: CUT_SETTINGS.islandMin,
  edgeSoft: CUT_SETTINGS.edgeSoft,
};

/** Each slider's range and step, as the page's inputs carry them. */
export const CUT_SLIDERS: Readonly<
  Record<CutSliderKey, { min: number; max: number; step: number }>
> = {
  whiteTol: { min: 8, max: 80, step: 1 },
  shadowFloor: { min: 150, max: 230, step: 1 },
  islandMin: { min: 0, max: 500, step: 4 },
  edgeSoft: { min: 32, max: 160, step: 4 },
};

export interface MakerDraft {
  readonly step: number;
  /** The furthest of steps 0 to 3 reached; 4 and 5 open with a cut. */
  readonly maxStep: number;
  readonly desc: string;
  readonly copiedAt: number;
  readonly leftAt: number;
  readonly choice: TalkChoice;
  readonly name: string;
  readonly savedId: string;
  readonly savedName: string;
  readonly failure: string;
  readonly cut: CutChoice;
  readonly ground: BackdropId;
}

export function freshDraft(): MakerDraft {
  return {
    step: 0,
    maxStep: 0,
    desc: "",
    copiedAt: 0,
    leftAt: 0,
    choice: "drawn",
    name: "",
    savedId: "",
    savedName: "",
    failure: "",
    cut: { ...CUT_CHOICE_DEFAULTS },
    ground: "meadow",
  };
}

const DESC_MAX = 2000;
const TEXT_MAX = 200;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function intIn(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi
    ? v
    : fallback;
}
function textOf(v: unknown, max: number, fallback: string): string {
  return typeof v === "string" && v.length <= max ? v : fallback;
}
function timeOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** The cut choice read back: each slider inside its range, else its default. */
function cutChoiceOf(v: unknown): CutChoice {
  const g = isObject(v) ? v : {};
  const d = CUT_CHOICE_DEFAULTS;
  const slider = (k: CutSliderKey): number =>
    intIn(g[k], CUT_SLIDERS[k].min, CUT_SLIDERS[k].max, d[k]);
  return {
    whiteTol: slider("whiteTol"),
    shadowOn: typeof g.shadowOn === "boolean" ? g.shadowOn : d.shadowOn,
    shadowFloor: slider("shadowFloor"),
    islandMin: slider("islandMin"),
    edgeSoft: slider("edgeSoft"),
  };
}

/** A stored draft read back, field by field; never throws. */
export function draftOf(v: unknown): MakerDraft {
  const f = freshDraft();
  if (!isObject(v)) return f;
  const choice =
    v.choice === "steady" || v.choice === "drawn" ? v.choice : f.choice;
  const ground = (BACKDROP_IDS as readonly unknown[]).includes(v.ground)
    ? (v.ground as BackdropId)
    : f.ground;
  return {
    step: intIn(v.step, 0, 5, f.step),
    maxStep: intIn(v.maxStep, 0, 3, f.maxStep),
    desc: textOf(v.desc, DESC_MAX, f.desc),
    copiedAt: timeOf(v.copiedAt),
    leftAt: timeOf(v.leftAt),
    choice,
    name: textOf(v.name, TEXT_MAX, f.name),
    savedId: textOf(v.savedId, TEXT_MAX, f.savedId),
    savedName: textOf(v.savedName, TEXT_MAX, f.savedName),
    failure: textOf(v.failure, TEXT_MAX, f.failure),
    cut: cutChoiceOf(v.cut),
    ground,
  };
}

/** The full cut settings for a choice. */
export function cutSettingsFor(choice: CutChoice): CutSettings {
  return { ...CUT_SETTINGS, ...choice };
}

/** An unfinished character: something written or a step taken, not saved. */
export function hasDraft(d: MakerDraft): boolean {
  return !d.savedId && (d.desc.trim() !== "" || d.step > 0);
}

export interface StepInfo {
  readonly state: "done" | "todo" | "failed";
  readonly sub: string;
}

function shortDesc(d: string): string {
  if (d.length <= 30) return d;
  const cut = d.slice(0, 28);
  const space = cut.lastIndexOf(" ");
  return `${(space > 10 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** The stepper's state and second line for step `i`. */
export function stepInfo(d: MakerDraft, i: number, hasCut: boolean): StepInfo {
  const desc = d.desc.trim();
  switch (i) {
    case 0:
      return desc
        ? { state: "done", sub: `"${shortDesc(desc)}"` }
        : { state: "todo", sub: "A few words" };
    case 1:
      return d.copiedAt
        ? { state: "done", sub: "Copied" }
        : { state: "todo", sub: "One button" };
    case 2:
      return d.maxStep > 2
        ? { state: "done", sub: "In your image AI" }
        : { state: "todo", sub: "In another tab or app" };
    case 3:
      if (d.failure) return { state: "failed", sub: d.failure };
      return hasCut
        ? { state: "done", sub: "Cut into four poses" }
        : { state: "todo", sub: "Choose, paste or drop it" };
    case 4:
      return hasCut
        ? {
            state: "done",
            sub: d.choice === "steady" ? "Steady body" : "As drawn",
          }
        : { state: "todo", sub: "Poses and animation" };
    default:
      return d.savedId
        ? { state: "done", sub: "Saved on this device" }
        : { state: "todo", sub: "Give it a name" };
  }
}

/** Steps 0 to 3 open once reached (step 3 always); 4 and 5 with a cut. */
export function reachable(d: MakerDraft, i: number, hasCut: boolean): boolean {
  return i <= 3 ? i <= d.maxStep || i === 3 : hasCut;
}

const NEXT = [
  "Next: get the prompt",
  "Next: make the picture",
  "I have the picture",
  "",
  "Next: name and save",
  "",
] as const;

/** The main button's label, and whether it is held while a cut runs. */
export function nextLabel(
  d: MakerDraft,
  hasCut: boolean,
  cutting: boolean,
): { label: string; disabled: boolean } {
  if (d.step === 3) {
    if (cutting) return { label: "Cutting the picture...", disabled: true };
    return {
      label:
        hasCut && !d.failure
          ? "Next: check your character"
          : "Choose the picture",
      disabled: false,
    };
  }
  if (d.step === 5) {
    return {
      label: d.savedId ? "Make another" : "Save the character",
      disabled: false,
    };
  }
  return { label: NEXT[d.step] ?? "Next", disabled: false };
}
