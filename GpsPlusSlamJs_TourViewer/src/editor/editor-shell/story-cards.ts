/**
 * A story's steps as the story inspector's cards, pure: what each step
 * is (its tag and title), how a block moves on, where each answer of a
 * choice leads (a jump chip the editor can follow), a quiz's right
 * answer and where the story goes after it, and the warning on the
 * steps of a loop no answer can leave, with its one fix on the loop's
 * last choice. `shell-inspector` draws them.
 *
 * @see story-cards.ts.md
 */
import {
  isTourStoryBlock,
  type TourStepAdvance,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { kindWithArticle } from "../../kinds/edit-kinds.js";
import {
  stepJump,
  stepJumpText,
  storyTrap,
  type StepJump,
} from "../story-steps.js";
import { storyRows, type TreeRowKind } from "./tree-model.js";

/** A jump chip: its words, its kind (the chip's look) and the id of the
 *  step it leads to (null: the end, or a step that is gone). */
export interface StoryCardJump {
  readonly text: string;
  readonly type: StepJump["type"];
  readonly to: string | null;
}

/** One line under a card: an answer, or a quiz's "After the answer". */
interface StoryCardAnswer {
  readonly label: string;
  /** A quiz's answer: whether it is the right one; null otherwise. */
  readonly right: boolean | null;
  /** Where it leads; null for a quiz's answer (the quiz goes on). */
  readonly jump: StoryCardJump | null;
}

/** One step as its card draws it. */
export interface StoryCard {
  readonly id: string;
  /** 1-based, in the story's order. */
  readonly number: number;
  readonly kind: TreeRowKind;
  /** "Asks", "Quiz", or "Shows a ..." for a block. */
  readonly tag: string;
  readonly title: string;
  /** The line under the title (a choice's and a quiz's), or null. */
  readonly line: string | null;
  /** A block's chips: how it moves on. */
  readonly chips: readonly string[];
  readonly answers: readonly StoryCardAnswer[];
  /** The loop warning on a step of the loop, or null. */
  readonly issue: string | null;
  /** The fix button's words, on the loop's last choice only. */
  readonly fix: string | null;
}

/** How a block moves on, as its chip says it. */
function advanceChip(advance: TourStepAdvance): string {
  if (advance.mode === "auto") return `After ${String(advance.afterS)} s`;
  return advance.mode === "lineEnd" ? "When the line ends" : "On a tap";
}

function jumpOf(
  steps: readonly TourStoryChild[],
  index: number,
  option: Parameters<typeof stepJump>[2],
): StoryCardJump {
  const jump = stepJump(steps, index, option);
  const to =
    jump.type === "end" || jump.type === "missing"
      ? null
      : (steps[jump.to]?.id ?? null);
  return { text: stepJumpText(jump), type: jump.type, to };
}

function answersOf(
  steps: readonly TourStoryChild[],
  index: number,
  step: TourStoryChild,
): StoryCardAnswer[] {
  if (isTourStoryBlock(step)) return [];
  if (step.kind === "choice") {
    return step.options.map((o) => ({
      label: o.label,
      right: null,
      jump: jumpOf(steps, index, o),
    }));
  }
  const options = step.answer.type === "single" ? step.answer.options : [];
  const correct = step.answer.type === "single" ? step.answer.correct : null;
  return [
    ...options.map((o) => ({
      label: o.label,
      right: o.id === correct,
      jump: null,
    })),
    {
      label: "After the answer",
      right: null,
      jump: jumpOf(steps, index, null),
    },
  ];
}

/** The cards of a story's `steps`, in order. */
export function storyCards(steps: readonly TourStoryChild[]): StoryCard[] {
  const rows = storyRows({ children: steps });
  const trap = storyTrap(steps);
  return steps.map((step, index): StoryCard => {
    const row = rows[index];
    const inTrap = trap?.steps.includes(index) === true;
    const head = isTourStoryBlock(step)
      ? {
          tag: `Shows ${kindWithArticle(step.kind)}`,
          title: row?.title ?? "",
          line: null,
          chips: [advanceChip(step.advance)],
        }
      : step.kind === "choice"
        ? {
            tag: "Asks",
            title: step.prompt,
            line: `The visitor picks one of ${String(step.options.length)} answers.`,
            chips: [],
          }
        : {
            tag: "Quiz",
            title: step.question,
            line: `${String(step.points)} points for the right answer, then the story goes on.`,
            chips: [],
          };
    return {
      id: step.id,
      number: index + 1,
      kind: row?.kind ?? "text",
      ...head,
      answers: answersOf(steps, index, step),
      issue: inTrap ? (trap?.message ?? null) : null,
      fix:
        inTrap && trap?.fixOn === step.id
          ? `Let "${trap.fixLabel?.trim() || "the last answer"}" end the story`
          : null,
    };
  });
}
