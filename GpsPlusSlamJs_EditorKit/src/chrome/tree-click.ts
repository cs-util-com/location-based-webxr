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
  /** The groups to unfold, outermost first (none: empty). */
  readonly unfold: readonly string[];
  /** The group to fold, or none. */
  readonly fold: string | null;
  /** The nested group whose fold flips, or none. */
  readonly toggle: string | null;
  /** The selection belongs to no group: the app opens where such
   *  selections live. */
  readonly ungrouped: boolean;
  /** The camera flies to the new selection. */
  readonly fly: boolean;
}

/** A group of the tree: its id, the ids of the cards inside it, and any
 *  groups nested in it. A nested group is selected by its own `selection`
 *  (the group prefix names only the top level, and is no use below it). */
export interface TreeGroup {
  readonly id: string;
  readonly selection?: string;
  readonly children: readonly string[];
  readonly groups?: readonly TreeGroup[];
}

/** Where a selection sits: the groups from the outermost down to the one
 *  that names it (`own`) or holds it. */
interface TreeChain {
  readonly ids: readonly string[];
  readonly own: boolean;
}

/** The chain from `group` down to `id`, or null when it is not inside. */
function chainIn(group: TreeGroup, id: string): TreeChain | null {
  if (group.selection === id) return { ids: [group.id], own: true };
  if (group.children.includes(id)) return { ids: [group.id], own: false };
  for (const inner of group.groups ?? []) {
    const chain = chainIn(inner, id);
    if (chain !== null) {
      return { ids: [group.id, ...chain.ids], own: chain.own };
    }
  }
  return null;
}

/** The chain of the selection `id`, or null for an ungrouped one. */
function chainOf(
  id: string,
  groups: readonly TreeGroup[],
  prefix: string,
): TreeChain | null {
  if (id.startsWith(prefix)) {
    return { ids: [id.slice(prefix.length)], own: true };
  }
  for (const group of groups) {
    const chain = chainIn(group, id);
    if (chain !== null) return chain;
  }
  return null;
}

/** Whether the chain ends in a nested group that the click named itself. */
function isNestedOwn(chain: TreeChain | null): boolean {
  return chain?.own === true && chain.ids.length > 1;
}

/** A deselecting click: a nested group flips its fold and stays selected,
 *  a top-level group folds, anything else just clears the selection. */
function deselectPlan(id: string, chain: TreeChain | null): TreeClickPlan {
  const nested = isNestedOwn(chain);
  return {
    select: nested ? id : null,
    unfold: [],
    fold: chain?.own === true && !nested ? (chain.ids[0] ?? null) : null,
    toggle: nested ? (chain?.ids.at(-1) ?? null) : null,
    ungrouped: false,
    fly: false,
  };
}

/** A selecting click: everything that holds the card unfolds, and a nested
 *  group keeps its own fold. */
function selectPlan(id: string, chain: TreeChain | null): TreeClickPlan {
  return {
    select: id,
    unfold: isNestedOwn(chain)
      ? (chain?.ids.slice(0, -1) ?? [])
      : (chain?.ids ?? []),
    fold: null,
    toggle: null,
    ungrouped: chain === null,
    fly: true,
  };
}

/**
 * The plan for `outcome` on the card `id` (a group's `<groupPrefix><id>`,
 * a nested group's `selection`, a child of a group at any depth, or else
 * ungrouped), or null when nothing happens. A selected top-level group
 * unfolds; a selected child unfolds its whole chain; a selected nested
 * group unfolds what holds it and leaves its own fold, and a second click
 * flips that fold with the selection staying (a folder is opened on
 * purpose, and selected to be edited); an ungrouped selection says so; a
 * deselected top-level group folds. The prefix is the app's: the kit has
 * none of its own. Throws for a missing or an empty prefix (every id would
 * read as a group).
 */
export function treeClickPlan(
  outcome: TreeClickOutcome,
  id: string,
  groups: readonly TreeGroup[],
  options: { readonly groupPrefix: string },
): TreeClickPlan | null {
  const prefix = (options as { groupPrefix?: unknown } | undefined)
    ?.groupPrefix;
  if (typeof prefix !== "string" || prefix === "") {
    throw new RangeError("a tree click plan needs a non-empty group prefix");
  }
  if (outcome === "none") return null;
  const chain = chainOf(id, groups, prefix);
  return outcome === "deselect"
    ? deselectPlan(id, chain)
    : selectPlan(id, chain);
}
