/**
 * Test-only: a station's content written as a station's children, the one
 * way the Tour Viewer's tests build it. A station holds free blocks,
 * plain folders of free blocks, and stories; a story holds its blocks, choices and quizzes in the order a
 * visitor meets them, so being in a story is what shows a block.
 *
 * `stationBlocks` reads every block of a station back, wherever it sits.
 */

import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  isStory,
  isTourFolder,
  isTourStoryBlock,
  tourStationBlocks,
  type TourChoice,
  type TourFolderChild,
  type TourQuizEntry,
  type TourStationChild,
  type TourStepAdvance,
  type TourStory,
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
    kind: "folder",
    role: "story",
    title,
    children: children.map((child): TourStory["children"][number] =>
      isChoiceOrQuiz(child) ? child : { advance: { mode: "tap" }, ...child },
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

/** The fields of a station holding `children`. */
export function stationContent(
  children: readonly TourStationChild[],
): Pick<TourStation, "children"> {
  return { children };
}

/** `children` of a plain folder with `edit` applied to every block, at
 *  any depth. */
function editedFolderChildren(
  children: readonly TourFolderChild[],
  edit: (block: TourBlock) => TourBlock,
): TourFolderChild[] {
  return children.map((child) =>
    isTourFolder(child)
      ? { ...child, children: editedFolderChildren(child.children, edit) }
      : edit(child),
  );
}

/** The content of `station` with `edit` applied to every block, free, in
 *  stories and in plain folders, keeping where each one sits. */
export function editedBlocks(
  station: Pick<TourStation, "children">,
  edit: (block: TourBlock) => TourBlock,
): Pick<TourStation, "children"> {
  return {
    children: station.children.map((child): TourStationChild => {
      if (isStory(child)) {
        return {
          ...child,
          children: child.children.map((kid) =>
            isTourStoryBlock(kid)
              ? { ...edit(kid), advance: kid.advance }
              : kid,
          ),
        };
      }
      if (isTourFolder(child)) {
        return {
          ...child,
          children: editedFolderChildren(child.children, edit),
        };
      }
      return edit(child);
    }),
  };
}

/** The content of `station` with `blocks` added as free blocks. */
export function withFreeBlocks(
  station: Pick<TourStation, "children">,
  blocks: readonly TourBlock[],
): Pick<TourStation, "children"> {
  return { children: [...station.children, ...blocks] };
}

/** Every block of `station`, free and in stories. */
export function stationBlocks(
  station: Pick<TourStation, "children">,
): readonly TourBlock[] {
  return tourStationBlocks(station);
}
