/**
 * What a toast's Undo does when it is tapped: the step it offers is taken
 * back while it is still the newest edit of the same tour; after a newer
 * change (or once another tour is open) the offer ends, and the page says
 * why instead of staying silent. The page's delete, "Replace everywhere"
 * and other one-step edits offer their Undo through it (`edit-main.ts`).
 *
 * @see undo-offer.ts.md
 */

/** Said when a toast's Undo is tapped after a newer change. */
export const UNDO_NOT_NEWEST =
  "A newer change came after it: undo the newer changes first.";

/** The page as an Undo tap needs it. */
export interface UndoTapPage {
  /** The session open now (another one after the tour changed). */
  readonly current: () => unknown;
  /** Ends the offer (its toast and its hold on the autosave). */
  readonly end: () => void;
  /** One step back on the edit stack (`runStep("undo")`). */
  readonly undo: () => void;
  readonly say: (text: string) => void;
}

/**
 * The Undo tap of a step made in `mine` at revision `at`: the undo when
 * `mine` is still open and nothing came after the step; else the offer
 * ended, with `UNDO_NOT_NEWEST` said while `mine` is still open.
 */
export function undoTap(
  mine: { revision(): number },
  at: number,
  page: UndoTapPage,
): () => void {
  return () => {
    if (page.current() !== mine || mine.revision() !== at) {
      page.end();
      // Never silent: the step is no longer the newest one.
      if (page.current() === mine) page.say(UNDO_NOT_NEWEST);
      return;
    }
    page.undo();
  };
}
