/**
 * The words of the toast an explicit Save ends with, on the desktop
 * editor. A download that left the walk recording out of the copy puts the
 * debug-data step FIRST and offers it as the toast's action: "Save the
 * debug data" reads the opened file, so it must run before the creator
 * puts the copy in that file's place.
 *
 * @see save-toast.ts.md
 */

import { FINISH_LABELS } from "../qr-author-mode.js";

export interface SavedToastFacts {
  /** The save was written over the opened file. */
  readonly inPlace: boolean;
  /** The file written in place, or the name the download was saved as. */
  readonly name: string;
  /** How many walk recording files the copy left out. */
  readonly leftOut: number;
}

export interface SavedToastWords {
  readonly text: string;
  /** Offer "Save the debug data" as the toast's action. */
  readonly offerDebugSave: boolean;
}

const PUT_IN_PLACE =
  "in place of the old file, under the same name, so the printed codes keep opening it.";

export function savedToastWords(facts: SavedToastFacts): SavedToastWords {
  const { inPlace, name, leftOut } = facts;
  if (inPlace) {
    // The opened file was written: what it left out cannot be read back
    // from it, so nothing is offered.
    return {
      text:
        leftOut > 0
          ? `Saved to ${name}. ${FINISH_LABELS.scanLeftOut(leftOut)}`
          : `Saved to ${name}.`,
      offerDebugSave: false,
    };
  }
  if (leftOut === 0) {
    return {
      text: `Saved as ${name}. Put it ${PUT_IN_PLACE}`,
      offerDebugSave: false,
    };
  }
  return {
    text: `Saved as ${name}. ${FINISH_LABELS.leanCopy(leftOut)} Save the debug data first, before you put this copy in place: it is read from the file you opened. Then put it ${PUT_IN_PLACE}`,
    offerDebugSave: true,
  };
}
