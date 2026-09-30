/**
 * The offer of a troubleshooting recording a killed tab left unsaved
 * (authoring recording plan 2026-09-28-0953 §3.1, M1b): "The recording from
 * <time> was not saved. Save it or delete it?", one recording at a time,
 * inside the recording block beside the record switch.
 *
 * The draft offer's pattern, deliberately (`creator-setup.ts`, F13): three
 * choices, because declining and deleting are different intentions - "Not
 * now" hides it and it comes back on the next open, "Delete it" is the only
 * way an unsaved recording is ever removed. And it reveals its step, as the
 * draft offer learned to (M5 review #8): an element un-hidden inside a
 * collapsed disclosure is no signal at all. It is NOT the draft offer's
 * element: that one belongs to a tour's draft and appears when a tour
 * opens, while this one appears at page open, in both modes, and both can
 * be pending at once.
 *
 * "Save it" takes the path "Save the recording" takes (`handOverRecording`):
 * the folder is marked saved only after a hand-off that delivered.
 *
 * The module reaches no globals: every element, the clock, the folder
 * operations and the hand-off arrive as dependencies, so it is tested in
 * node.
 *
 * @see recording-offer.ts.md
 */

import type { ShareOrDownloadResult } from "gps-plus-slam-app-framework/storage";

import type { PackedRecording } from "./recording-folders.js";
import { handOverRecording } from "./recording-panel.js";

export const RECORDING_OFFER_SAVE_LABEL = "Save it";
export const RECORDING_OFFER_SAVE_BUSY_LABEL = "Saving the recording…";
const DISCARD_LABEL = "Delete it";
const DISCARD_BUSY_LABEL = "Deleting…";

export interface RecordingOfferDom {
  /** The offer's container (hidden while nothing is offered). */
  offer: HTMLElement;
  text: HTMLElement;
  saveButton: HTMLButtonElement;
  dismissButton: HTMLButtonElement;
  discardButton: HTMLButtonElement;
  /** The recording block's outcome line (shared with "Save the
   *  recording": the last save's or delete's outcome). */
  status: HTMLElement;
}

/** What the offer needs of a left-behind folder. */
interface OfferedRecording {
  readonly name: string;
  readonly startedAtMs: number;
}

export interface RecordingOffer {
  /** Offer these recordings, oldest first; an empty list offers nothing. */
  present(recordings: readonly OfferedRecording[]): void;
}

export function wireRecordingOffer(deps: {
  dom: RecordingOfferDom;
  /** Rebuild the folder's `session.json` and zip it
   *  (`packOrphanRecording`, bound). */
  pack: (
    name: string,
  ) => Promise<
    Pick<PackedRecording, "blob" | "filename" | "metadataError" | "markSaved">
  >;
  /** Delete the folder (`deleteRecordingFolder`, bound). */
  discard: (name: string) => Promise<void>;
  /** The share sheet or a save picker - the same seam as the tour zip's. */
  handOff: (blob: Blob, filename: string) => Promise<ShareOrDownloadResult>;
  now: () => Date;
  /** The start time in the author's words (the page's locale). */
  describeTime: (ms: number) => string;
  /** Open the step the offer sits in. */
  reveal: () => void;
}): RecordingOffer {
  const { dom } = deps;
  let queue: OfferedRecording[] = [];
  /** How many this page offered in all, for the "(1 of 2)". */
  let offeredCount = 0;
  let busy = false;

  function setBusy(next: boolean): void {
    busy = next;
    dom.saveButton.disabled = next;
    dom.dismissButton.disabled = next;
    dom.discardButton.disabled = next;
  }

  function render(): void {
    const current = queue[0];
    dom.offer.hidden = current === undefined;
    if (current === undefined) return;
    const position =
      offeredCount > 1
        ? ` (${String(offeredCount - queue.length + 1)} of ${String(offeredCount)})`
        : "";
    dom.text.textContent = `The recording from ${deps.describeTime(current.startedAtMs)} was not saved. Save it or delete it?${position}`;
  }

  function advance(): void {
    queue = queue.slice(1);
    render();
  }

  dom.saveButton.addEventListener("click", () => {
    const current = queue[0];
    if (busy || current === undefined) return;
    setBusy(true);
    dom.saveButton.textContent = RECORDING_OFFER_SAVE_BUSY_LABEL;
    dom.status.textContent = "";
    void (async () => {
      try {
        const handed = await handOverRecording(
          await deps.pack(current.name),
          deps.handOff,
          deps.now,
          RECORDING_OFFER_SAVE_LABEL,
        );
        dom.status.textContent = handed.text;
        if (handed.delivered) advance();
      } catch (err) {
        dom.status.textContent = `Could not save the recording: ${
          err instanceof Error ? err.message : String(err)
        }`;
      } finally {
        dom.saveButton.textContent = RECORDING_OFFER_SAVE_LABEL;
        setBusy(false);
      }
    })();
  });

  dom.dismissButton.addEventListener("click", () => {
    if (busy) return;
    // Declining is NOT deleting (the draft offer's rule): the folder stays,
    // and the next page open offers it again.
    queue = [];
    render();
  });

  dom.discardButton.addEventListener("click", () => {
    const current = queue[0];
    if (busy || current === undefined) return;
    setBusy(true);
    dom.discardButton.textContent = DISCARD_BUSY_LABEL;
    dom.status.textContent = "";
    void (async () => {
      try {
        await deps.discard(current.name);
        dom.status.textContent = `Deleted the recording from ${deps.describeTime(current.startedAtMs)}.`;
        advance();
      } catch (err) {
        dom.status.textContent = `Could not delete the recording: ${
          err instanceof Error ? err.message : String(err)
        }`;
      } finally {
        dom.discardButton.textContent = DISCARD_LABEL;
        setBusy(false);
      }
    })();
  });

  return {
    present(recordings) {
      queue = [...recordings];
      offeredCount = queue.length;
      render();
      if (queue.length > 0) deps.reveal();
    },
  };
}
