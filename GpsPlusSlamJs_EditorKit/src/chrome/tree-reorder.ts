/**
 * A list's reorder, as numbers (pure): the slot a dragged card is dropped
 * at, from the cards' middles on screen, and the items' order once it
 * lands there. Earlier and Later buttons move by the same rule (a slot one
 * before, or two after, the item's own). A move across lists (out of one
 * nested list into another) keeps the same slot rule.
 *
 * @see tree-reorder.ts.md
 */

/** The slot (0 to `middles.length`) a card dropped at `y` goes to: before
 *  the first card whose middle lies below `y`, else last. `middles` are the
 *  cards' vertical middles, top to bottom, in the pointer's coordinates. */
export function dropSlot(middles: readonly number[], y: number): number {
  if (!Number.isFinite(y)) {
    throw new RangeError(`a drop needs a finite position, got ${String(y)}`);
  }
  const index = middles.findIndex((middle) => y < middle);
  return index < 0 ? middles.length : index;
}

/**
 * `ids` with the one at `from` moved to `slot` (a slot counted in the list
 * before the move: 0 is first, `ids.length` last); null when that leaves
 * it where it was (the slot just before or just after it). Throws for a
 * place or a slot outside the list.
 */
export function movedTo(
  ids: readonly string[],
  from: number,
  slot: number,
): string[] | null {
  if (!Number.isInteger(from) || from < 0 || from >= ids.length) {
    throw new RangeError(`no item at place ${String(from)}`);
  }
  if (!Number.isInteger(slot) || slot < 0 || slot > ids.length) {
    throw new RangeError(`no slot ${String(slot)} in ${String(ids.length)}`);
  }
  if (slot === from || slot === from + 1) return null;
  const moving = ids[from] as string;
  const rest = ids.filter((_, index) => index !== from);
  rest.splice(slot > from ? slot - 1 : slot, 0, moving);
  return rest;
}

/** Where an item stands in one of several lists, and where it goes: a
 *  slot of a list, counted in that list before the move. */
export interface ListPlace {
  readonly list: string;
  readonly index: number;
}

/**
 * `lists` (ids per list, every id once in all) with the item at `from`
 * moved to the slot `to.slot` of the list `to.list`: inside one list
 * `movedTo`'s rule, across two the item leaves the one and enters the
 * other at that slot. Null when the move leaves it where it was. Throws
 * for a list, a place or a slot that is not there. The lists untouched
 * are returned as they were (the same arrays).
 */
export function movedAcross(
  lists: Readonly<Record<string, readonly string[]>>,
  from: ListPlace,
  to: { readonly list: string; readonly slot: number },
): Record<string, readonly string[]> | null {
  const source = listOf(lists, from.list);
  if (source === undefined) {
    throw new RangeError(`no list ${from.list}`);
  }
  if (to.list === from.list) {
    const order = movedTo(source, from.index, to.slot);
    return order === null ? null : { ...lists, [from.list]: order };
  }
  const target = listOf(lists, to.list) ?? [];
  if (!within(from.index, source.length - 1)) {
    throw new RangeError(`no item at place ${String(from.index)}`);
  }
  if (!within(to.slot, target.length)) {
    throw new RangeError(
      `no slot ${String(to.slot)} in ${String(target.length)}`,
    );
  }
  const moving = source[from.index] as string;
  const into = [...target];
  into.splice(to.slot, 0, moving);
  return {
    ...lists,
    [from.list]: source.filter((_, index) => index !== from.index),
    [to.list]: into,
  };
}

/** A list by name, never one inherited from the object's prototype. */
function listOf(
  lists: Readonly<Record<string, readonly string[]>>,
  name: string,
): readonly string[] | undefined {
  return Object.hasOwn(lists, name) ? lists[name] : undefined;
}

/** A whole number from 0 up to `last`, both included. */
function within(value: number, last: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= last;
}
