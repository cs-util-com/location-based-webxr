/**
 * The choice and quiz inspectors' edits, pure: each control - the
 * question, an answer's words, its way on, Add and Remove answer, the
 * right answer, the points - turns into the whole step it writes. The
 * document checks the step as the format reads it (`withStoryStep`), so
 * nothing here repeats the format's rules beyond what a control offers.
 *
 * @see story-step-edits.ts.md
 */
import type {
  TourChoice,
  TourChoiceOption,
  TourQuizEntry,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { END_TARGET, withGoto } from "./story-steps.js";

/** A choice or a quiz of a story. */
export type StoryStep = TourChoice | TourQuizEntry;

/** What the story menu adds besides an entry: a choice or a quiz. */
export type StepKind = StoryStep["kind"];

/** A quiz whose one right answer is picked from its answers: the one
 *  kind of quiz the inspector edits. */
export type SingleQuiz = TourQuizEntry & {
  readonly answer: Extract<TourQuizEntry["answer"], { type: "single" }>;
};

/** The fewest and the most answers the inspector offers. */
export const MIN_ANSWERS = 2;
export const MAX_ANSWERS = 4;

/** The field of a step's question (`step:prompt`), an answer's words
 *  (`step:label:<answer id>`) and a quiz's points (`step:points`). */
export const STEP_FIELD = "step:";
const LABEL = "step:label:";

const POINTS_RULE = "Points are a whole number, 0 or more.";

/** A new step of `kind`, id `id`, with words in every field so the
 *  format reads it at once: a choice of two answers going on, or a quiz
 *  of three answers, the first right, worth 10 points. */
export function newStoryStep(kind: StepKind, id: string): StoryStep {
  const answers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `a${String(i + 1)}`,
      label: `Answer ${String(i + 1)}`,
    }));
  if (kind === "choice") {
    return {
      id,
      kind,
      prompt: "What does the visitor choose?",
      options: answers(MIN_ANSWERS),
    };
  }
  return {
    id,
    kind,
    question: "What is the right answer?",
    points: 10,
    answer: { type: "single", options: answers(3), correct: "a1" },
  };
}

/** Whether `step` is a quiz the inspector edits. */
export function isSingleQuiz(step: StoryStep): step is SingleQuiz {
  return step.kind === "quiz" && step.answer.type === "single";
}

/** The answers of `step` the inspector lists: a choice's, or a single
 *  quiz's; none for another quiz. */
function answersOf(
  step: StoryStep,
): readonly { readonly id: string; readonly label: string }[] {
  if (step.kind === "choice") return step.options;
  return isSingleQuiz(step) ? step.answer.options : [];
}

/** `step` with its answers `answers` (a quiz's right answer kept, or the
 *  first when it went). */
function withAnswers(
  step: StoryStep,
  answers: readonly TourChoiceOption[],
): StoryStep | null {
  if (step.kind === "choice") return { ...step, options: answers };
  if (!isSingleQuiz(step)) return null;
  const options = answers.map(({ id, label }) => ({ id, label }));
  const kept = options.some((o) => o.id === step.answer.correct);
  return {
    ...step,
    answer: {
      ...step.answer,
      options,
      correct: kept ? step.answer.correct : (options[0]?.id ?? ""),
    },
  };
}

/** A typed field of the step as the step it writes; null when it writes
 *  nothing (the value it has, or a field it has not); `invalid` for
 *  points that are no whole number of 0 or more. */
export function stepFieldEdit(
  step: StoryStep,
  field: string,
  value: string,
): StoryStep | { readonly invalid: string } | null {
  if (field === `${STEP_FIELD}prompt`) {
    const text = value.trim();
    if (step.kind === "choice") {
      return text === step.prompt ? null : { ...step, prompt: text };
    }
    return text === step.question ? null : { ...step, question: text };
  }
  if (field === `${STEP_FIELD}points`) {
    if (step.kind !== "quiz") return null;
    const points = /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(points)) return { invalid: POINTS_RULE };
    return points === step.points ? null : { ...step, points };
  }
  if (!field.startsWith(LABEL)) return null;
  const id = field.slice(LABEL.length);
  const text = value.trim();
  const answers = answersOf(step);
  const answer = answers.find((a) => a.id === id);
  if (answer === undefined || answer.label === text) return null;
  return withAnswers(
    step,
    answers.map((a) => (a.id === id ? { ...a, label: text } : a)),
  );
}

/** The choice with its answer `answerId` leading where the jump picker's
 *  `value` says ("" the next step, a step's id, `END_TARGET`); null for
 *  an unknown answer or the way it already has. */
export function stepWithGoto(
  step: TourChoice,
  answerId: string,
  value: string,
): TourChoice | null {
  const option = step.options.find((o) => o.id === answerId);
  const now = option?.end === true ? END_TARGET : (option?.goto ?? "");
  if (option === undefined || now === value) return null;
  return {
    ...step,
    options: step.options.map((o) =>
      o.id === answerId ? withGoto(o, value) : o,
    ),
  };
}

/** `step` with one more answer ("Answer 3", an id of its own, going on
 *  to the next step); null at `MAX_ANSWERS` or for a quiz it does not
 *  edit. */
export function stepWithAnswer(step: StoryStep): StoryStep | null {
  const answers = answersOf(step);
  if (answers.length >= MAX_ANSWERS || answers.length === 0) return null;
  const taken = new Set(answers.map((a) => a.id));
  let n = 1;
  while (taken.has(`a${String(n)}`)) n += 1;
  return withAnswers(step, [
    ...answers,
    { id: `a${String(n)}`, label: `Answer ${String(answers.length + 1)}` },
  ]);
}

/** `step` without its answer `answerId`; null at `MIN_ANSWERS` or for an
 *  unknown answer. A quiz losing its right answer makes the first left
 *  right. */
export function stepWithoutAnswer(
  step: StoryStep,
  answerId: string,
): StoryStep | null {
  const answers = answersOf(step);
  if (answers.length <= MIN_ANSWERS || !answers.some((a) => a.id === answerId))
    return null;
  return withAnswers(
    step,
    answers.filter((a) => a.id !== answerId),
  );
}

/** The quiz with `answerId` its right answer; null when it already is,
 *  or is none of its answers. */
export function stepWithRight(
  step: TourQuizEntry,
  answerId: string,
): TourQuizEntry | null {
  if (!isSingleQuiz(step) || step.answer.correct === answerId) return null;
  if (!step.answer.options.some((o) => o.id === answerId)) return null;
  return { ...step, answer: { ...step.answer, correct: answerId } };
}
