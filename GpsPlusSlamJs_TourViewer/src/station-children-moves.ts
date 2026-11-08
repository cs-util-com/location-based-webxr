/**
 * An item of a station moved to another place in it, pure: a free item
 * into a story and back out, a block from one story to another or to
 * another place in its own, a story among the stories. The format's rules
 * for each place are kept on the way: an item leaving a story stands in
 * the world (its view, or its kind's world floor by the framework's rule),
 * one entering a story moves on by a tap, and the answers that jumped to a
 * block leaving its story are dropped. Moves across stations are not
 * offered. The document's reducer writes the moves (`tour-document.ts`);
 * the editor's tree and inspector read the list helpers to offer only a
 * move the rule takes.
 *
 * @see station-children-moves.ts.md
 */
import {
  TOUR_FREE_BLOCK_VIEWS,
  tourFloorView,
  type TourBlock,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import {
  isTourStory,
  isTourStoryBlock,
  tourChildrenPlace,
  type TourStationChild,
  type TourStory,
  type TourStoryBlock,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { withoutStoryChild } from "./tour-story-edit.js";

interface Holder {
  readonly children: readonly TourStationChild[];
}

/** Where an item goes: among the station's free items (they all stand in
 *  the world at once, so they have no place among themselves), into the
 *  story `story` at the slot `index` (counted in that story before the
 *  move: 0 first, its length last), or, for a story, to the slot `index`
 *  among the stories. */
export type ChildMoveTo =
  | { readonly place: "free" }
  | { readonly place: "story"; readonly story: string; readonly index: number }
  | { readonly place: "stories"; readonly index: number };

/** Why a move is not made: no such item, story or slot; a choice or a quiz
 *  leaving its story (its answers name that story's entries); a story
 *  into a story or among the free items, or a free item among the stories;
 *  a block that cannot stand in the world (a model without a size); or the
 *  item would stay where it is. */
export type ChildMoveRefusal =
  "missing" | "ownStory" | "noNesting" | "cannotStandFree" | "unchanged";

/** A move made: the station after it, how many answers lost their jump,
 *  and whether the item took its kind's world floor for a view. */
export interface ChildMoved<H> {
  readonly station: H;
  readonly answers: number;
  readonly floored: boolean;
}

export type ChildMove<H> =
  ChildMoved<H> | { readonly refused: ChildMoveRefusal };

const TAP = { mode: "tap" } as const;

/** `ids` with the one at `from` moved to `slot` (counted before the
 *  move), null where it stays: the editor kit's `movedTo` rule, kept here
 *  because the visitor's pages reach this module (through the document)
 *  and must not load the editor's chrome. `slot` is in range. */
function reorderedIds(ids: readonly string[], from: number, slot: number) {
  if (slot === from || slot === from + 1) return null;
  const rest = ids.filter((_, index) => index !== from);
  rest.splice(slot > from ? slot - 1 : slot, 0, ids[from] as string);
  return rest;
}

const refused = (reason: ChildMoveRefusal) => ({ refused: reason }) as const;

/** `block` as a free item: without its advance, in a view its kind may
 *  stand free in (its own, else the kind's floor); null when it cannot
 *  stand free at all. */
function freeBlock(
  block: TourStoryBlock,
): { block: TourBlock; floored: boolean } | null {
  const { advance: _advance, ...free } = block;
  if (free.kind === "model" && free.sizeM === undefined) return null;
  const views: readonly string[] = TOUR_FREE_BLOCK_VIEWS[free.kind];
  if (views.includes(free.view)) {
    return { block: free, floored: false };
  }
  const view = tourFloorView(free.kind);
  return { block: { ...free, view } as TourBlock, floored: true };
}

/** `holder`'s story `id` given `children`. */
function withStoryChildren<H extends Holder>(
  holder: H,
  id: string,
  children: readonly TourStoryChild[],
): H {
  return {
    ...holder,
    children: holder.children.map((c) =>
      isTourStory(c) && c.id === id ? { ...c, children } : c,
    ),
  };
}

/** `child` put into `holder`'s story `story` at `index`, or null when it
 *  has no such story or slot. */
function intoStory<H extends Holder>(
  holder: H,
  story: string,
  index: number,
  child: TourStoryChild,
): H | null {
  const target = holder.children.find(
    (c): c is TourStory => isTourStory(c) && c.id === story,
  );
  if (
    target === undefined ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > target.children.length
  ) {
    return null;
  }
  const children = [...target.children];
  children.splice(index, 0, child);
  return withStoryChildren(holder, story, children);
}

/** The station's stories in a new order, the free items after them. */
function movedStory<H extends Holder>(
  holder: H,
  id: string,
  index: number,
): ChildMove<H> {
  const stories = holder.children.filter(isTourStory);
  const from = stories.findIndex((s) => s.id === id);
  if (!Number.isInteger(index) || index < 0 || index > stories.length) {
    return refused("missing");
  }
  const order = reorderedIds(
    stories.map((s) => s.id),
    from,
    index,
  );
  if (order === null) return refused("unchanged");
  const byId = new Map(stories.map((s) => [s.id, s]));
  return {
    station: {
      ...holder,
      children: [
        ...order.map((sid) => byId.get(sid) as TourStory),
        ...holder.children.filter((c) => !isTourStory(c)),
      ],
    },
    answers: 0,
    floored: false,
  };
}

/** A story's entry moved inside its own story: its answers still resolve. */
function reordered<H extends Holder>(
  holder: H,
  story: TourStory,
  from: number,
  index: number,
): ChildMove<H> {
  const ids = story.children.map((c) => c.id);
  if (!Number.isInteger(index) || index < 0 || index > ids.length) {
    return refused("missing");
  }
  const order = reorderedIds(ids, from, index);
  if (order === null) return refused("unchanged");
  const byId = new Map(story.children.map((c) => [c.id, c]));
  return {
    station: withStoryChildren(
      holder,
      story.id,
      order.map((cid) => byId.get(cid) as TourStoryChild),
    ),
    answers: 0,
    floored: false,
  };
}

/**
 * `holder` (a station with its stories and its free items) with its item
 * `id` moved `to`, or why not. Never changes its input; every other item
 * keeps its place.
 */
export function movedChild<H extends Holder>(
  holder: H,
  id: string,
  to: ChildMoveTo,
): ChildMove<H> {
  const place = tourChildrenPlace(holder.children, id);
  if (place === null) return refused("missing");
  const { story } = place;
  if (story === undefined) {
    const child = holder.children[place.index] as TourStationChild;
    if (isTourStory(child)) {
      return to.place === "stories"
        ? movedStory(holder, id, to.index)
        : refused("noNesting");
    }
    if (to.place === "stories") return refused("noNesting");
    if (to.place === "free") return refused("unchanged");
    const rest = {
      ...holder,
      children: holder.children.filter((c) => c.id !== id),
    };
    const into = intoStory(rest, to.story, to.index, {
      ...child,
      advance: TAP,
    });
    return into === null
      ? refused("missing")
      : { station: into, answers: 0, floored: false };
  }
  const child = story.children[place.index] as TourStoryChild;
  if (to.place === "stories") return refused("noNesting");
  const stays = to.place === "story" && to.story === story.id;
  if (!isTourStoryBlock(child)) {
    if (!stays) return refused("ownStory");
  }
  if (stays) return reordered(holder, story, place.index, to.index);
  const out = withoutStoryChild(holder, id);
  if (out === null || !isTourStoryBlock(child)) return refused("missing");
  if (to.place === "free") {
    const free = freeBlock(child);
    if (free === null) return refused("cannotStandFree");
    return {
      station: { ...out.frame, children: [...out.frame.children, free.block] },
      answers: out.answers,
      floored: free.floored,
    };
  }
  const into = intoStory(out.frame, to.story, to.index, child);
  return into === null
    ? refused("missing")
    : { station: into, answers: out.answers, floored: false };
}

/** The tree's names for a station's lists (its drag's `data-list` and
 *  `data-into`, the inspector's `move-to:<list>`): its stories, a story's
 *  entries (`story:<id>`, the story's selection id) and its free items. */
export const STORIES_LIST = "stories";
export const FREE_LIST = "free";
const STORY_LIST = "story:";

/** The list of the story `id`'s entries. */
export function storyList(id: string): string {
  return `${STORY_LIST}${id}`;
}

/** `holder`'s story whose entries are the list `list`. */
function storyOfList(holder: Holder, list: string): TourStory | undefined {
  if (!list.startsWith(STORY_LIST)) return undefined;
  const id = list.slice(STORY_LIST.length);
  return holder.children.find(
    (c): c is TourStory => isTourStory(c) && c.id === id,
  );
}

/**
 * Whether `holder`'s item `id` may go into the list `list`, as `movedChild`
 * takes it: a story only among the stories; a choice or a quiz only in its
 * own story; any other item into any story of its station or among its
 * free items. The tree's drag offers only these.
 */
export function childMayGo(holder: Holder, id: string, list: string): boolean {
  const place = tourChildrenPlace(holder.children, id);
  if (place === null) return false;
  const { story } = place;
  if (story === undefined) {
    const own = holder.children[place.index];
    if (own === undefined) return false;
    if (isTourStory(own)) return list === STORIES_LIST;
  } else {
    const own = story.children[place.index];
    if (own === undefined) return false;
    if (!isTourStoryBlock(own)) return list === storyList(story.id);
  }
  return list === FREE_LIST || storyOfList(holder, list) !== undefined;
}

/** The move a drop into `list` makes: at `drop.slot` (counted before the
 *  move), or at its end (`into`). Null for a list `holder` does not have,
 *  or into the stories (they are no folder). */
export function childDropTo(
  holder: Holder,
  list: string,
  drop: { readonly slot: number } | { readonly into: true },
): ChildMoveTo | null {
  if (list === FREE_LIST) return { place: "free" };
  if (list === STORIES_LIST) {
    return "slot" in drop ? { place: "stories", index: drop.slot } : null;
  }
  const story = storyOfList(holder, list);
  if (story === undefined) return null;
  return {
    place: "story",
    story: story.id,
    index: "slot" in drop ? drop.slot : story.children.length,
  };
}

/** The move one place `way` in its list: a story among the stories, an
 *  entry in its story. Null at an end of its list, for a free item (the
 *  free items have no order) and for an unknown id. */
export function childStepTo(
  holder: Holder,
  id: string,
  way: "earlier" | "later",
): ChildMoveTo | null {
  const place = tourChildrenPlace(holder.children, id);
  if (place === null) return null;
  const { story } = place;
  const ids =
    story !== undefined
      ? story.children.map((c) => c.id)
      : isTourStory(holder.children[place.index] as TourStationChild)
        ? holder.children.filter(isTourStory).map((s) => s.id)
        : null;
  if (ids === null) return null;
  const from = ids.indexOf(id);
  const slot = way === "earlier" ? from - 1 : from + 2;
  if (slot < 0 || slot > ids.length) return null;
  return story === undefined
    ? { place: "stories", index: slot }
    : { place: "story", story: story.id, index: slot };
}
