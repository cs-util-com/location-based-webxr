/**
 * A station's scene, step by step (tour kit plan K4, §4.2): the steps in
 * order, a scene choice that jumps to its option's step (or, for an option
 * that names none, goes on to the next step), and the end. Pure: which
 * step is showing, nothing about how (`scene-view.ts` renders it, and owns
 * the tap and the timer of an auto step).
 *
 * It plays `show` steps (the block each names, rendered by the view) and
 * scene choices. A QUIZ step is not played yet: it is skipped here, as a
 * lenient reader skips what it cannot show, so a visitor meets the rest
 * of the scene instead of a dead end.
 */

import type { TourStep } from "gps-plus-slam-app-framework/ar/tour-story";

/** Whether this build shows the step (quizzes arrive with K5). */
export function isPlayableInK4(step: TourStep): boolean {
  return step.action.kind !== "quiz";
}

/**
 * How many steps a choice-free scene shows (the story card's dots): its playable steps, quizzes left out. Null for a scene
 * with a choice, whose path - and so its number of steps - the visitor's
 * answers decide.
 */
export function playableStepCount(steps: readonly TourStep[]): number | null {
  const playable = steps.filter(isPlayableInK4);
  return playable.some((s) => s.action.kind === "choice")
    ? null
    : playable.length;
}

export interface ScenePlayer {
  /** The step showing, or null once the scene ended. */
  current(): TourStep | null;
  /** Continue past the current step (a tap, or an auto step's timer). A
   *  choice is not continued: it waits for an answer. Returns the new
   *  current step. */
  next(): TourStep | null;
  /** Answer the current choice: jump to its option's step, or to the next
   *  step for an option that names none. An unknown option, or a call
   *  while no choice shows, changes nothing. */
  choose(optionId: string): TourStep | null;
  ended(): boolean;
}

export function createScenePlayer(steps: readonly TourStep[]): ScenePlayer {
  const byId = new Map(steps.map((s, i) => [s.id, i]));
  /** The first playable index at or after `from`, or -1 (the end). */
  const playableFrom = (from: number): number => {
    for (let i = from; i < steps.length; i += 1) {
      if (isPlayableInK4(steps[i]!)) return i;
    }
    return -1;
  };
  let index = playableFrom(0);
  const current = (): TourStep | null => (index < 0 ? null : steps[index]!);

  return {
    current,
    next() {
      const step = current();
      if (step === null || step.action.kind === "choice") return step;
      index = playableFrom(index + 1);
      return current();
    },
    choose(optionId) {
      const step = current();
      if (step === null || step.action.kind !== "choice") return step;
      const option = step.action.options.find((o) => o.id === optionId);
      if (option === undefined) return step;
      const target =
        option.goto === undefined ? index + 1 : byId.get(option.goto);
      if (target === undefined) return step;
      index = playableFrom(target);
      return current();
    },
    ended: () => index < 0,
  };
}
