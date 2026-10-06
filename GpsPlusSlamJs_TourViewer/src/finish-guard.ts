/**
 * The creator's save cannot be forgotten (UI round 1, U2; owner decision
 * 2026-10-06: one big tapped Save, and a warning before leaving unsaved).
 * Pure rules over what the page knows; `creator-setup.ts` renders them and
 * `main.ts` / `archive-open.ts` ask `leaveNeedsConfirm` before the page or
 * the tour goes away.
 *
 * @see finish-guard.ts.md
 */

export interface FinishGuardInput {
  /** An AR session is running. */
  readonly sessionLive: boolean;
  /** This device can run AR (a phone); false on a desktop. */
  readonly arAvailable: boolean;
  /** Objects placed, edited or moved since the last Finish. */
  readonly placedCount: number;
  /** Objects deleted since the last Finish. */
  readonly deletedCount: number;
  /** The last Finish's rebuilt file, and whether a save delivered it. */
  readonly rebuilt: { readonly delivered: boolean } | null;
  /** The draft backs changes up on this device (false once a backup write
   *  failed or no store could open). */
  readonly draftPersists: boolean;
  /** The last Finish failed (its retry must stay reachable). */
  readonly finishFailed: boolean;
}

const FINISH = "Finish - rebuild the zip";
const FINISH_UNSAVED = "Finish and save your changes";

const LEAVE_WITH_BACKUP =
  "The updated tour file is not saved yet. Leave anyway? Your changes stay on this phone, and you can finish and save them later.";
const LEAVE_WITHOUT_BACKUP =
  "Your changes are not saved anywhere yet, and this device keeps no backup. Leave anyway and lose them?";

/** The question before the page or the tour goes away: it promises the
 *  phone keeps the work only while the draft backs it up (U2 milestone
 *  review #3). */
export function leaveQuestion(input: FinishGuardInput): string {
  return input.draftPersists ? LEAVE_WITH_BACKUP : LEAVE_WITHOUT_BACKUP;
}

function changedSinceFinish(input: FinishGuardInput): boolean {
  return input.placedCount > 0 || input.deletedCount > 0;
}

/** Work that has not reached a saved tour file. */
export function unsavedWork(input: FinishGuardInput): boolean {
  return (
    changedSinceFinish(input) ||
    (input.rebuilt !== null && !input.rebuilt.delivered)
  );
}

/** Finish's label: after AR with changes not finished (the back gesture
 *  ends a session without a Finish), it leads with saving them. */
export function finishButtonText(input: FinishGuardInput): string {
  return !input.sessionLive && changedSinceFinish(input)
    ? FINISH_UNSAVED
    : FINISH;
}

/** On a phone, Finish steps aside while the rebuilt file waits for its
 *  save, so the save is the page's one primary action; a desktop keeps it
 *  (editing on the page and finishing again is its flow). */
export function hideFinishForResult(input: FinishGuardInput): boolean {
  return (
    input.arAvailable &&
    !input.finishFailed &&
    !input.sessionLive &&
    !changedSinceFinish(input) &&
    input.rebuilt !== null &&
    !input.rebuilt.delivered
  );
}

/** Leaving (the page, or for another tour) asks first while a rebuilt
 *  file was not saved, and - when no backup holds them - while there are
 *  unfinished changes at all (U2 milestone review #3). With the draft, the
 *  changes are offered again, so they never ask. */
export function leaveNeedsConfirm(input: FinishGuardInput): boolean {
  if (input.rebuilt !== null && !input.rebuilt.delivered) return true;
  return !input.draftPersists && unsavedWork(input);
}
