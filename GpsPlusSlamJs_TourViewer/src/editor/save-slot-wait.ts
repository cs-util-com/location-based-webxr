/**
 * Waiting for the desktop editor's one save slot to be free, for a
 * claimant that must take it with no await between its last check and its
 * claim (pure over the injected slot).
 *
 * @see save-slot-wait.ts.md
 */

/** The page's save slot, as a waiter sees it. */
export interface SaveSlotView {
  /** Whether a save, or another claimant, holds the slot now. */
  readonly busy: () => boolean;
  /** The end of the claim that holds it now (a new promise per claim). */
  readonly end: () => Promise<void>;
  /** Wait until no save runs; never spins on a claim left set. */
  readonly settled: () => Promise<void>;
}

/**
 * Ask `still` what the slot is to be claimed for, and while a save holds
 * it, wait for the save to end and ask again. Resolves to `still`'s last
 * answer: null when there is nothing to claim it for any more; else a
 * value, with the slot free and no await since that was checked, so the
 * caller claims it at once. A claim still set on an ended save is a bug,
 * not a wait: the value is then given with the slot still held, and the
 * caller's claim replaces the stuck one rather than the tab spinning.
 */
export async function waitForSaveSlot<T>(
  slot: SaveSlotView,
  still: () => Promise<T | null>,
): Promise<T | null> {
  let value = await still();
  while (value !== null && slot.busy()) {
    const end = slot.end();
    await slot.settled();
    if (slot.busy() && slot.end() === end) break;
    value = await still();
  }
  return value;
}
