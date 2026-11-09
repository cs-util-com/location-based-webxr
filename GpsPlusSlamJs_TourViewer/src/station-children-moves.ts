/**
 * An item of a station moved to another place in it, pure: a free item
 * into a story and back out, a block from one story to another or to
 * another place in its own, a story among the stories. The format's rules
 * for each place are kept on the way: an item leaving a story stands in
 * the world (its view, or its kind's world floor by the framework's rule),
 * one entering a story moves on by a tap, and the answers that jumped to a
 * block leaving its story are dropped. A move onto another station
 * (`movedToStation`) stands a single item at that station's centre; a
 * whole story goes with its steps keeping their layout around the new
 * centre. The document's reducer writes the moves (`tour-document.ts`);
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
  isStory,
  isTourFolder,
  isTourStoryBlock,
  tourChildrenPlace,
  type TourChildrenPlace,
  type TourStationChild,
  type TourStory,
  type TourStoryBlock,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { NARRATION_DEFAULT_RADIUS_M } from "./kinds/audio/sound-reach.js";
import { withoutStoryChild } from "./tour-story-edit.js";

interface Holder {
  readonly children: readonly TourStationChild[];
}

/** Where an item goes: among the station's free items (they all stand in
 *  the world at once, so they have no place among themselves), into the
 *  story `story` at the slot `index` (counted in that story before the
 *  move: 0 first, its length last), or, for a story, to the slot `index`
 *  among the stories, or onto the station `station` (`movedToStation`;
 *  `movedChild` refuses it as `missing`). */
export type ChildMoveTo =
  | { readonly place: "free" }
  | { readonly place: "story"; readonly story: string; readonly index: number }
  | { readonly place: "stories"; readonly index: number }
  | { readonly place: "station"; readonly station: string };

/** Why a move is not made: no such item, story or slot; a choice or a quiz
 *  leaving its story (its answers name that story's entries); a story
 *  into a story or among the free items, or a free item among the stories;
 *  a block that cannot stand in the world (a model without a size, or a
 *  video: no free host shows one yet, so it would stand unseen); or the
 *  item would stay where it is. */
export type ChildMoveRefusal =
  "missing" | "ownStory" | "noNesting" | "cannotStandFree" | "unchanged";

/** A move made: the station after it, how many answers lost their jump,
 *  and whether the item took its kind's world floor for a view. */
interface ChildMoved<H> {
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

/** Whether `place` lies inside a plain folder: the editor moves no
 *  folder and nothing in one (it shows a folder's blocks as free items and
 *  a save writes them so), so a move refuses it as `missing`. */
const inPlainFolder = (place: TourChildrenPlace): boolean =>
  place.path.length > 0 && place.story === undefined;

/** `block` given the fields its floor view requires that a story view
 *  does not: a sound in the card view has no radius, and a narration
 *  circle cannot be written without one. A radius it already carries is
 *  the author's and is kept; only a missing one takes the editor's
 *  starting value. */
function withFloorFields(block: TourBlock): TourBlock {
  if (block.kind !== "audio" || block.view !== "spot") return block;
  if (block.radiusM !== undefined) return block;
  return { ...block, radiusM: NARRATION_DEFAULT_RADIUS_M };
}

/** `block` as a free item: without its advance, in a view its kind may
 *  stand free in (its own, else the kind's floor, with the fields that
 *  floor requires); null when it cannot stand free at all. */
function freeBlock(
  block: TourStoryBlock,
): { block: TourBlock; floored: boolean } | null {
  const { advance: _advance, ...free } = block;
  if (free.kind === "model" && free.sizeM === undefined) return null;
  // The format takes a free video, but no host draws one yet
  // (`free-items.ts`): out of its story it would be an item nobody sees.
  if (free.kind === "video") return null;
  const views: readonly string[] = TOUR_FREE_BLOCK_VIEWS[free.kind];
  if (views.includes(free.view)) {
    return { block: free, floored: false };
  }
  const view = tourFloorView(free.kind);
  return {
    block: withFloorFields({ ...free, view } as TourBlock),
    floored: true,
  };
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
      isStory(c) && c.id === id ? { ...c, children } : c,
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
    (c): c is TourStory => isStory(c) && c.id === story,
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
  const stories = holder.children.filter(isStory);
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
        ...holder.children.filter((c) => !isStory(c)),
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
  if (place === null || to.place === "station" || inPlainFolder(place)) {
    return refused("missing");
  }
  const { story } = place;
  if (story === undefined) {
    const child = holder.children[place.index] as TourStationChild;
    if (isStory(child)) {
      return to.place === "stories"
        ? movedStory(holder, id, to.index)
        : refused("noNesting");
    }
    if (isTourFolder(child)) return refused("missing");
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

/** A move onto another station made: both stations after it, how many
 *  answers lost their jump, and whether the item took its kind's world
 *  floor for a view. */
interface StationsMoved<H> {
  readonly from: H;
  readonly to: H;
  readonly answers: number;
  readonly floored: boolean;
}

export type StationMove<H> =
  StationsMoved<H> | { readonly refused: ChildMoveRefusal };

/** `block` standing at its station's centre, its turn kept. */
function centred(block: TourBlock): TourBlock {
  return { ...block, pose: { ...block.pose, position: [0, 0, 0] } };
}

/** `holder` with `story` after its last story, ahead of its free items. */
function withStory<H extends Holder>(holder: H, story: TourStory): H {
  const children = [...holder.children];
  let at = 0;
  children.forEach((c, index) => {
    if (isStory(c)) at = index + 1;
  });
  children.splice(at, 0, story);
  return { ...holder, children };
}

/**
 * `from`'s item `id` moved onto the station `to`, or why not. A free item
 * goes among `to`'s free items, and a story's entry out of its story
 * there, both at `to`'s centre (their offset meant a place near `from`):
 * the editor asks that it be placed again. A story goes whole after `to`'s
 * stories, its entries keeping their offsets, now around `to`'s centre.
 * The rules of a move within a station hold: a choice or a quiz never
 * leaves its story, a model without a size never stands free, an answer
 * that jumped to a block leaving its story is dropped. Never changes its
 * inputs.
 */
export function movedToStation<H extends Holder & { readonly id: string }>(
  from: H,
  to: H,
  id: string,
): StationMove<H> {
  const place = tourChildrenPlace(from.children, id);
  if (place === null || inPlainFolder(place)) return refused("missing");
  const { story } = place;
  if (story === undefined) {
    if (to.id === from.id) return refused("unchanged");
    const child = from.children[place.index] as TourStationChild;
    if (isTourFolder(child)) return refused("missing");
    const rest = {
      ...from,
      children: from.children.filter((c) => c.id !== id),
    };
    return {
      from: rest,
      to: isStory(child)
        ? withStory(to, child)
        : { ...to, children: [...to.children, centred(child)] },
      answers: 0,
      floored: false,
    };
  }
  const child = story.children[place.index] as TourStoryChild;
  if (!isTourStoryBlock(child)) return refused("ownStory");
  if (to.id === from.id) return refused("unchanged");
  const free = freeBlock(child);
  if (free === null) return refused("cannotStandFree");
  const out = withoutStoryChild(from, id);
  if (out === null) return refused("missing");
  return {
    from: out.frame,
    to: { ...to, children: [...to.children, centred(free.block)] },
    answers: out.answers,
    floored: free.floored,
  };
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
  return holder.children.find((c): c is TourStory => isStory(c) && c.id === id);
}

/**
 * Whether `holder`'s item `id` may go into the list `list`: exactly when
 * `movedChild` takes a drop there, or keeps the item where it is (a drop
 * on its own place). So a story goes only among the stories, a choice or a
 * quiz only within its own story, a model without a size or a video never
 * out of its story, and any other item into any story of its station or among its
 * free items. The tree's drag offers only these; asking the rule itself is
 * what keeps the two from disagreeing. A drop's slot
 * changes no refusal but "unchanged", so the first slot answers for all.
 */
export function childMayGo(holder: Holder, id: string, list: string): boolean {
  const to = childDropTo(holder, list, { slot: 0 });
  if (to === null) return false;
  const out = movedChild(holder, id, to);
  return !("refused" in out) || out.refused === "unchanged";
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
  if (place === null || inPlainFolder(place)) return null;
  const { story } = place;
  const ids =
    story !== undefined
      ? story.children.map((c) => c.id)
      : isStory(holder.children[place.index] as TourStationChild)
        ? holder.children.filter(isStory).map((s) => s.id)
        : null;
  if (ids === null) return null;
  const from = ids.indexOf(id);
  const slot = way === "earlier" ? from - 1 : from + 2;
  if (slot < 0 || slot > ids.length) return null;
  return story === undefined
    ? { place: "stories", index: slot }
    : { place: "story", story: story.id, index: slot };
}
