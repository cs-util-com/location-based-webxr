/**
 * The 3D view's tree click rule, pure: one click on a card selects it,
 * unfolds it and flies there; a second click on the selected card
 * deselects it and folds it, the camera staying; and a click that comes
 * inside the double-click interval after one on the same card - the rest
 * of a double click, a double tap - does nothing: only the first click of
 * a quick run on one card counts, whether it selected or deselected.
 *
 * The interval is the browser's own click count where it reports one
 * (`detail` > 1 follows the system's double-click setting), and a time
 * window for the same card otherwise (a tap, a synthetic click).
 *
 * @see tree-click.ts.md
 */

/** The fallback double-click window (ms) when the browser counts no
 *  double click: the system default on most desktops is 500 ms. */
export const TREE_DOUBLE_CLICK_MS = 500;

/** The last click the tree took: on which card, and when (ms). */
export interface TreeClickMemory {
  readonly id: string | null;
  readonly at: number;
}

export const NO_TREE_CLICK: TreeClickMemory = Object.freeze({
  id: null,
  at: Number.NEGATIVE_INFINITY,
});

/** What a click does: select its card, deselect it, or nothing. */
export type TreeClickOutcome = "select" | "deselect" | "none";

/**
 * What a click on the card `id` does, at `at` (the event's time stamp,
 * ms) with the browser's click count `detail`, while `selected` is
 * selected and `last` was the click before; and the memory for the next
 * one. A click on the card of the click before, inside the interval or
 * counted by the browser as a double click, does nothing; any other click
 * selects its card, or deselects it when it is the selected one. A time
 * that is not finite reads as a slow click.
 */
export function treeClick(input: {
  readonly id: string;
  readonly at: number;
  readonly detail: number;
  readonly selected: string | null;
  readonly last: TreeClickMemory;
}): { outcome: TreeClickOutcome; memory: TreeClickMemory } {
  const { id, at, detail, selected, last } = input;
  const memory: TreeClickMemory = { id, at };
  const soon =
    Number.isFinite(at) &&
    at - last.at >= 0 &&
    at - last.at < TREE_DOUBLE_CLICK_MS;
  const counted = Number.isFinite(detail) && detail > 1;
  if (last.id === id && (soon || counted)) return { outcome: "none", memory };
  return { outcome: id === selected ? "deselect" : "select", memory };
}

/** What the shell does for a click's outcome. */
export interface TreeClickPlan {
  /** The page's new selection (null: none). */
  readonly select: string | null;
  /** The station to unfold, or none. */
  readonly unfold: string | null;
  /** The station to fold, or none. */
  readonly fold: string | null;
  /** The selection belongs to no group: the app opens where such
   *  selections live (the Tour Viewer's codes). */
  readonly ungrouped: boolean;
  /** The camera flies to the new selection. */
  readonly fly: boolean;
}

/** A group of the tree: its id, and the ids of the cards inside it. */
export interface TreeGroup {
  readonly id: string;
  readonly children: readonly string[];
}

/** A group's selection by default: the Tour Viewer's `station:<id>`
 *  (`editor-model.ts`). */
const GROUP_PREFIX = "station:";

/** The group a selection `id` names, or holds as a child, and whether it
 *  is the group itself; null for an ungrouped selection. */
function groupOf(
  id: string,
  groups: readonly TreeGroup[],
  prefix: string,
): { readonly id: string; readonly own: boolean } | null {
  if (id.startsWith(prefix)) return { id: id.slice(prefix.length), own: true };
  const holder = groups.find((g) => g.children.includes(id));
  return holder === undefined ? null : { id: holder.id, own: false };
}

/**
 * The plan for `outcome` on the card `id` (a group's `<groupPrefix><id>`,
 * a child of one of `groups`, or else ungrouped), or null when nothing
 * happens. A selected group unfolds, a selected child unfolds its group,
 * an ungrouped selection says so; a deselected group folds. Throws for
 * an empty prefix (every id would read as a group).
 */
export function treeClickPlan(
  outcome: TreeClickOutcome,
  id: string,
  groups: readonly TreeGroup[],
  options: { readonly groupPrefix?: string } = {},
): TreeClickPlan | null {
  const prefix = options.groupPrefix ?? GROUP_PREFIX;
  if (prefix === "") throw new RangeError("a group prefix must not be empty");
  if (outcome === "none") return null;
  const group = groupOf(id, groups, prefix);
  if (outcome === "deselect") {
    return {
      select: null,
      unfold: null,
      fold: group?.own === true ? group.id : null,
      ungrouped: false,
      fly: false,
    };
  }
  return {
    select: id,
    unfold: group?.id ?? null,
    fold: null,
    ungrouped: group === null,
    fly: true,
  };
}
