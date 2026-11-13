/**
 * Where each step of a story leads, pure: an answer of a choice goes on
 * to the next step, jumps ahead, goes back, ends the story or (naming a
 * step that is gone) nowhere; a block and a quiz go on to the next step.
 * On that graph, the steps a visitor can reach from the first one and
 * never leave for the end - a loop no answer can leave - are the one
 * jump the editor warns about. The step cards' chips, the jump picker
 * and the Problems list read it.
 *
 * @see story-steps.ts.md
 */
import type {
  TourChoiceOption,
  TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

/** The picker's value for "End the story". No child id holds a colon
 *  (`tour-ids`), so it never names a step. */
export const END_TARGET = ":end";

/** Where the visitor goes from a step: `to` is a step's index. */
export type StepJump =
  | { readonly type: "next"; readonly to: number }
  | { readonly type: "jump"; readonly to: number }
  | { readonly type: "back"; readonly to: number }
  /** `implicit`: the last step going on, so the story ends. */
  | { readonly type: "end"; readonly implicit: boolean }
  /** A jump to a step the story no longer holds. */
  | { readonly type: "missing" };

/** Where `option` of the choice at `index` leads; null: where the step
 *  at `index` goes on to by itself (a block, a quiz). */
export function stepJump(
  steps: readonly TourStoryChild[],
  index: number,
  option: TourChoiceOption | null,
): StepJump {
  if (option?.end === true) return { type: "end", implicit: false };
  if (option?.goto === undefined) {
    return index + 1 < steps.length
      ? { type: "next", to: index + 1 }
      : { type: "end", implicit: true };
  }
  const to = steps.findIndex((s) => s.id === option.goto);
  if (to < 0) return { type: "missing" };
  if (to <= index) return { type: "back", to };
  return { type: to === index + 1 ? "next" : "jump", to };
}

/** A jump as its chip says it. */
export function stepJumpText(jump: StepJump): string {
  switch (jump.type) {
    case "next":
      return `next: step ${String(jump.to + 1)}`;
    case "jump":
      return `jumps to step ${String(jump.to + 1)}`;
    case "back":
      return `goes back to step ${String(jump.to + 1)}`;
    case "end":
      return jump.implicit ? "then the story ends" : "ends the story";
    default:
      return "jumps nowhere";
  }
}

/** The steps the step at `index` may lead to; `steps.length` stands for
 *  the end of the story (a jump to a gone step ends it for the visitor,
 *  as the player does). */
export function stepExits(
  steps: readonly TourStoryChild[],
  index: number,
): number[] {
  const to = (jump: StepJump) =>
    jump.type === "end" || jump.type === "missing" ? steps.length : jump.to;
  const step = steps[index];
  if (step === undefined) return [];
  return step.kind === "choice"
    ? step.options.map((o) => to(stepJump(steps, index, o)))
    : [to(stepJump(steps, index, null))];
}

/** The steps a visitor can reach from the first one but never leave for
 *  the end, in order. */
export function trappedSteps(steps: readonly TourStoryChild[]): number[] {
  const n = steps.length;
  if (n === 0) return [];
  const reached = new Set([0]);
  const queue = [0];
  for (let i = queue.pop(); i !== undefined; i = queue.pop()) {
    for (const j of stepExits(steps, i)) {
      if (j < n && !reached.has(j)) {
        reached.add(j);
        queue.push(j);
      }
    }
  }
  const ends = new Array<boolean>(n).fill(false);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < n; i += 1) {
      if (
        !ends[i] &&
        stepExits(steps, i).some((j) => j === n || ends[j] === true)
      ) {
        ends[i] = true;
        changed = true;
      }
    }
  }
  return [...reached].filter((i) => ends[i] !== true).sort((a, b) => a - b);
}

/** Of `trapped`, the steps on the loop itself: a step that only leads
 *  into the loop is left out. */
export function loopSteps(
  steps: readonly TourStoryChild[],
  trapped: readonly number[],
): number[] {
  const inTrap = new Set(trapped);
  return trapped.filter((i) => {
    const seen = new Set<number>();
    const queue = stepExits(steps, i).filter((j) => inTrap.has(j));
    for (let j = queue.pop(); j !== undefined; j = queue.pop()) {
      if (j === i) return true;
      if (seen.has(j)) continue;
      seen.add(j);
      for (const k of stepExits(steps, j)) if (inTrap.has(k)) queue.push(k);
    }
    return false;
  });
}

/** "Step 1", "Steps 1 and 3", "Steps 1, 2 and 5": `indexes` numbered
 *  from 1. */
export function stepNumbers(indexes: readonly number[]): string {
  const n = indexes.map((i) => String(i + 1));
  if (n.length === 1) return `Step ${n[0] ?? ""}`;
  return `Steps ${n.slice(0, -1).join(", ")} and ${n.at(-1) ?? ""}`;
}

/** A loop no answer can leave: its steps (indexes), the choice whose
 *  last answer the editor offers to end the story with (null when the
 *  loop holds no choice) and that answer's words, and what to say. */
export interface StoryTrap {
  readonly steps: readonly number[];
  readonly fixOn: string | null;
  readonly fixLabel: string | null;
  readonly message: string;
}

/** The story's loop no answer can leave, or null. A step stuck without
 *  a loop - a choice with no answers, which the format never holds - is
 *  no loop, and none is said. */
export function storyTrap(steps: readonly TourStoryChild[]): StoryTrap | null {
  const trap = loopSteps(steps, trappedSteps(steps));
  if (trap.length === 0) return null;
  const fixAt = trap.filter((i) => steps[i]?.kind === "choice").at(-1);
  const fix = fixAt === undefined ? undefined : steps[fixAt];
  const verb =
    trap.length === 1 ? "leads only back to itself" : "go round in a loop";
  return {
    steps: trap,
    fixOn: fix?.id ?? null,
    fixLabel:
      fix?.kind === "choice" ? (fix.options.at(-1)?.label ?? null) : null,
    message: `${stepNumbers(trap)} ${verb} that no answer can leave: a visitor who gets to step ${String((trap[0] ?? 0) + 1)} never reaches the end. Let one answer end the story or go on.`,
  };
}

/** One way the jump picker offers for an answer of the step at an
 *  index: `value` is "" for the next step, a step's id, or
 *  `END_TARGET`. */
export interface GotoChoice {
  readonly group: "next" | "ahead" | "back" | "end";
  readonly value: string;
  readonly label: string;
}

/** The jump picker's ways for an answer of the step at `index`: the next
 *  step, every step ahead, every step back (the step itself: "Ask this
 *  again") and the end; `title` names a step. */
export function gotoChoices(
  steps: readonly TourStoryChild[],
  index: number,
  title: (step: TourStoryChild) => string,
): GotoChoice[] {
  const next = steps[index + 1];
  const ways: GotoChoice[] = [
    {
      group: "next",
      value: "",
      label:
        next === undefined
          ? "Next step (the story ends)"
          : `Next step (${String(index + 2)}: ${title(next)})`,
    },
  ];
  for (let j = index + 2; j < steps.length; j += 1) {
    const step = steps[j];
    if (step === undefined) continue;
    ways.push({
      group: "ahead",
      value: step.id,
      label: `Jump to step ${String(j + 1)}: ${title(step)}`,
    });
  }
  for (let j = 0; j <= index && j < steps.length; j += 1) {
    const step = steps[j];
    if (step === undefined) continue;
    ways.push({
      group: "back",
      value: step.id,
      label:
        j === index
          ? `Ask this again (step ${String(j + 1)})`
          : `Go back to step ${String(j + 1)}: ${title(step)}`,
    });
  }
  ways.push({ group: "end", value: END_TARGET, label: "End the story" });
  return ways;
}

/** The picker's value for `option` of the step at `index`: a jump to the
 *  next step is the next step. */
export function gotoValue(
  steps: readonly TourStoryChild[],
  index: number,
  option: TourChoiceOption,
): string {
  if (option.end === true) return END_TARGET;
  if (option.goto === undefined) return "";
  return option.goto === steps[index + 1]?.id ? "" : option.goto;
}

/** `option` leading where the picker's `value` says: the next step (no
 *  jump), a step, or the end - one way at a time. */
export function withGoto(
  option: TourChoiceOption,
  value: string,
): TourChoiceOption {
  const { goto: _goto, end: _end, ...rest } = option;
  if (value === "") return rest;
  return value === END_TARGET
    ? { ...rest, end: true }
    : { ...rest, goto: value };
}
