/**
 * A station's scene, step by step (tour kit plan K4, §4.2): a story's
 * children in order, a scene choice that jumps to its option's child (or,
 * for an option that names none, goes on to the next child), and the end.
 * Pure: which child is showing, nothing about how (`scene-view.ts` renders
 * it, and owns the tap and the timer of an auto block).
 *
 * It plays blocks (rendered by the view) and scene choices. A QUIZ is not
 * played yet: it is skipped here, as a lenient reader skips what it cannot
 * show, so a visitor meets the rest of the scene instead of a dead end.
 */

import type { TourStoryChild } from "gps-plus-slam-app-framework/ar/tour-story";

/** Whether this build shows the child (quizzes arrive with K5). */
export function isPlayableInK4(child: TourStoryChild): boolean {
  return child.kind !== "quiz";
}

/**
 * How many steps a choice-free scene shows (the story card's dots): its playable children, quizzes left out. Null for a scene
 * with a choice, whose path - and so its number of steps - the visitor's
 * answers decide.
 */
export function playableStepCount(
  children: readonly TourStoryChild[],
): number | null {
  const playable = children.filter(isPlayableInK4);
  return playable.some((c) => c.kind === "choice") ? null : playable.length;
}

export interface ScenePlayer {
  /** The child showing, or null once the scene ended. */
  current(): TourStoryChild | null;
  /** Continue past the current child (a tap, or an auto block's timer). A
   *  choice is not continued: it waits for an answer. Returns the new
   *  current child. */
  next(): TourStoryChild | null;
  /** Answer the current choice: jump to its option's child, or to the next
   *  child for an option that names none. An unknown option, or a call
   *  while no choice shows, changes nothing. */
  choose(optionId: string): TourStoryChild | null;
  ended(): boolean;
}

export function createScenePlayer(
  children: readonly TourStoryChild[],
): ScenePlayer {
  const byId = new Map(children.map((c, i) => [c.id, i]));
  /** The first playable index at or after `from`, or -1 (the end). */
  const playableFrom = (from: number): number => {
    for (let i = from; i < children.length; i += 1) {
      if (isPlayableInK4(children[i]!)) return i;
    }
    return -1;
  };
  let index = playableFrom(0);
  const current = (): TourStoryChild | null =>
    index < 0 ? null : children[index]!;

  return {
    current,
    next() {
      const child = current();
      if (child === null || child.kind === "choice") return child;
      index = playableFrom(index + 1);
      return current();
    },
    choose(optionId) {
      const child = current();
      if (child === null || child.kind !== "choice") return child;
      const option = child.options.find((o) => o.id === optionId);
      if (option === undefined) return child;
      const target =
        option.goto === undefined ? index + 1 : byId.get(option.goto);
      if (target === undefined) return child;
      index = playableFrom(target);
      return current();
    },
    ended: () => index < 0,
  };
}
