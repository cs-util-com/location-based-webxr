/**
 * The tree's reorder of the stations, as numbers (pure): the slot a
 * dragged card is dropped at, from the cards' middles on screen, and the
 * stations' order once it lands there. The Earlier and Later buttons move
 * by the same rule (a slot one before, or two after, the station's own).
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
    throw new RangeError(`no station at place ${String(from)}`);
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
