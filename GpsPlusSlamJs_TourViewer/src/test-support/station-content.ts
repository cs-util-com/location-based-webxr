/**
 * Test-only: a station's content written as a station's children, the one
 * way the Tour Viewer's tests build it. A station holds free blocks and
 * stories; a story holds its blocks, choices and quizzes in the order a
 * visitor meets them, so being in a story is what shows a block.
 *
 * This is the only file that knows how that list is stored on a station,
 * and `stationBlocks` the only one that reads it back.
 */

import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type {
  TourChoice,
  TourQuizEntry,
  TourStationChild,
  TourStepAdvance,
  TourStory,
  TourStoryBlock,
} from "gps-plus-slam-app-framework/ar/tour-story";

/** A story's child as a test writes it: a block's advance is a tap unless
 *  it says otherwise, as the reader has it. */
export type StoryChildInput =
  | (TourBlock & { readonly advance?: TourStepAdvance })
  | TourChoice
  | TourQuizEntry;

const isChoiceOrQuiz = (
  child: StoryChildInput,
): child is TourChoice | TourQuizEntry =>
  child.kind === "choice" || child.kind === "quiz";

/** A story of `children`. Ids are one namespace across the tour, so two
 *  stations never share a story id. */
export function storyOf(
  id: string,
  children: readonly StoryChildInput[],
  title = "A story",
): TourStory {
  return {
    id,
    kind: "story",
    title,
    children: children.map((child): TourStory["children"][number] =>
      isChoiceOrQuiz(child)
        ? child
        : ({ advance: { mode: "tap" }, ...child } as TourStoryBlock),
    ),
  };
}

/** A story of one short card, for a test that needs a station with
 *  something to play and does not care what. */
export function playableStory(id: string): TourStory {
  return storyOf(id, [
    {
      id: `${id}-card`,
      kind: "shortText",
      view: "card",
      caption: "Hello",
      pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    },
  ]);
}

const isStory = (child: TourStationChild): child is TourStory =>
  child.kind === "story";

/** The fields of a station holding `children`. */
export function stationContent(
  children: readonly TourStationChild[],
): Pick<TourStation, "blocks" | "steps"> {
  const stories = children.filter(isStory);
  if (stories.length > 1) throw new Error("this version plays one story");
  const blocks: TourBlock[] = [];
  const steps: TourStation["steps"][number][] = [];
  for (const child of children) {
    if (!isStory(child)) blocks.push(child);
  }
  for (const child of stories[0]?.children ?? []) {
    if (child.kind === "choice" || child.kind === "quiz") {
      const { id, ...action } = child;
      steps.push({ id, action, advance: { mode: "tap" } });
    } else {
      const { advance, ...block } = child;
      blocks.push(block as TourBlock);
      steps.push({
        id: block.id,
        action: { kind: "show", block: block.id },
        advance,
      });
    }
  }
  return { blocks, steps };
}

/** The content of `station` with `edit` applied to every block, free and in
 *  stories, keeping where each one sits. */
export function editedBlocks(
  station: Pick<TourStation, "blocks" | "steps">,
  edit: (block: TourBlock) => TourBlock,
): Pick<TourStation, "blocks" | "steps"> {
  return { blocks: station.blocks.map(edit), steps: station.steps };
}

/** The content of `station` with `blocks` added as free blocks. */
export function withFreeBlocks(
  station: Pick<TourStation, "blocks" | "steps">,
  blocks: readonly TourBlock[],
): Pick<TourStation, "blocks" | "steps"> {
  return { blocks: [...station.blocks, ...blocks], steps: station.steps };
}

/** Every block of `station`, free and in stories. */
export function stationBlocks(station: {
  readonly blocks: readonly TourBlock[];
}): readonly TourBlock[] {
  return station.blocks;
}
