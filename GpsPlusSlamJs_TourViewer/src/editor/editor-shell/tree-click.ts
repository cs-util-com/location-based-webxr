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
  /** The codes' section is opened (a code was selected). */
  readonly openCodes: boolean;
  /** The camera flies to the new selection. */
  readonly fly: boolean;
}

/** A station's id in the page's selection (`editor-model.ts`). */
const STATION = "station:";

/**
 * The plan for `outcome` on the card `id` (a station's `station:<id>`,
 * an item of `stations`, or else a code), or null when nothing happens.
 * A selected station unfolds, a selected item unfolds its station, a
 * selected code opens the codes; a deselected station folds.
 */
export function treeClickPlan(
  outcome: TreeClickOutcome,
  id: string,
  stations: readonly {
    readonly id: string;
    readonly items: readonly { readonly id: string }[];
  }[],
): TreeClickPlan | null {
  if (outcome === "none") return null;
  const station = id.startsWith(STATION) ? id.slice(STATION.length) : null;
  const holder =
    station === null
      ? (stations.find((s) => s.items.some((i) => i.id === id))?.id ?? null)
      : null;
  if (outcome === "deselect") {
    return {
      select: null,
      unfold: null,
      fold: station,
      openCodes: false,
      fly: false,
    };
  }
  return {
    select: id,
    unfold: station ?? holder,
    fold: null,
    openCodes: station === null && holder === null,
    fly: true,
  };
}
