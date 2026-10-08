/**
 * The rebuilt zip's hand-off (code book refactor plan M2, split out of
 * `creator-setup.ts`): the Finish saves the rebuilt zip by itself and the
 * one button left saves it again (the 2026-10-08 field test, F4; owner
 * decisions D-F4a, D-F4b), the result line, and the "replace the hosted
 * file" steps a save earns.
 *
 * @see creator-handoff.ts.md
 */

import {
  driveReplaceSteps,
  FINISH_LABELS,
  finishSaveStatus,
} from "./qr-author-mode.js";
import { isDriveUrl } from "./open-errors.js";
import type { TourViewerSeams } from "./seams.js";
import type { TourViewerSession } from "./tour-viewer-session.js";

/** The elements the hand-off owns (all in step 4's tail, outside AR). */
export interface CreatorHandoffDom {
  downloadButton: HTMLButtonElement;
  finishStatus: HTMLElement;
  replaceHelp: HTMLElement;
  replaceHelpGeneric: HTMLElement;
  replaceHelpDrive: HTMLElement;
}

export interface CreatorHandoff {
  /** The open tour is on Google Drive (its steps are the Drive website's). */
  drive(): boolean;
  /**
   * Save the rebuilt zip to this phone - the Finish's own save, and the
   * button's. `notes`: the result sentences the Finish shows after the
   * save's status (the code's position, a walk left out, photos not
   * placed); kept for the button's later saves. The button calls it
   * without them.
   */
  save(notes?: string): void;
  /** A tour closed: the button, the line and the steps are stale. */
  reset(): void;
}

export function wireCreatorHandoff(deps: {
  ctx: TourViewerSession;
  seams: Pick<TourViewerSeams, "downloadZip">;
  dom: CreatorHandoffDom;
  /** Re-render the panel (a delivered file changes the save guard). */
  render: () => void;
}): CreatorHandoff {
  const { ctx, seams, dom } = deps;
  /** The Finish's result sentences, shown after the save's status. */
  let notes = "";
  function drive(): boolean {
    return ctx.session !== null && isDriveUrl(ctx.session.archive.url);
  }
  /** The status line: what the save did, then the Finish's notes. */
  function showStatus(line: string): void {
    dom.finishStatus.textContent = [line, notes]
      .filter((s) => s !== "")
      .join(" ");
  }
  /** The replace instructions for the open tour's host: a Drive tour gets
   *  its own numbered steps with the zip's name (plan §2 decision 1). */
  function presentReplaceSteps(filename: string): void {
    const onDrive = drive();
    dom.replaceHelpGeneric.hidden = onDrive;
    dom.replaceHelpDrive.hidden = !onDrive;
    if (!onDrive) return;
    const hosted = ctx.session?.hostedFileName() ?? null;
    const { steps } = driveReplaceSteps(hosted ?? filename, hosted !== null);
    dom.replaceHelpDrive.textContent = steps
      .map((step, i) => `${String(i + 1)}. ${step}`)
      .join("\n");
  }
  function save(next?: string): void {
    if (next !== undefined) notes = next;
    const rebuilt = ctx.rebuiltZip;
    if (rebuilt === null) return;
    // Async-UI rule: in-progress before the await, the durable end state
    // after; nothing saved (a dismissed save picker) keeps the button live.
    dom.downloadButton.disabled = true;
    dom.downloadButton.textContent = FINISH_LABELS.saving;
    // A tour can be closed while the save is open. Every post-await path
    // re-checks the generation: a save that settled after a close would
    // reveal the steps on the CLOSED tour's panel - invisible then, on
    // screen the moment the next tour reached its finish (PR #440 review).
    const openGeneration = ctx.openGeneration;
    // Always the plain save (D-F4b), also where the phone could share: the
    // Finish's own save has no fresh tap, which a share sheet needs; a
    // seam that throws becomes a rejection here, not a broken Finish.
    Promise.resolve()
      .then(() => seams.downloadZip(rebuilt.blob, rebuilt.filename))
      .then(
        (delivered) => {
          if (openGeneration !== ctx.openGeneration) return;
          // Saved: the guard stops asking, and Finish comes back (U2).
          if (delivered && ctx.rebuiltZip === rebuilt) {
            ctx.rebuiltZip = { ...rebuilt, delivered: true };
            deps.render();
          }
          dom.downloadButton.disabled = false;
          dom.downloadButton.textContent = FINISH_LABELS.saveAgain;
          showStatus(finishSaveStatus(delivered, rebuilt.filename, drive()));
          // REVEAL-ONLY: the replace instructions are earned by a save that
          // delivered, and a later save that did not takes nothing back -
          // they are the flow's last instruction (PR #439 review #3). Only
          // `reset`, on a tour close, hides them again.
          if (delivered) {
            presentReplaceSteps(rebuilt.filename);
            dom.replaceHelp.hidden = false;
          }
        },
        (err: unknown) => {
          if (openGeneration !== ctx.openGeneration) return;
          dom.downloadButton.disabled = false;
          dom.downloadButton.textContent = FINISH_LABELS.saveAgain;
          showStatus(
            FINISH_LABELS.failed(
              err instanceof Error ? err.message : String(err),
            ),
          );
        },
      );
  }
  dom.downloadButton.textContent = FINISH_LABELS.saveAgain;
  dom.downloadButton.addEventListener("click", () => {
    save();
  });

  return {
    drive,
    save,
    reset: () => {
      notes = "";
      dom.downloadButton.disabled = true;
      // The LABEL too: the save's continuation is generation-guarded and
      // returns without restoring it for a tour that closed underneath an
      // open save, so the next tour's finish would enable a button that
      // still reads "Saving…" (PR #441 review).
      dom.downloadButton.textContent = FINISH_LABELS.saveAgain;
      dom.finishStatus.textContent = "";
      dom.replaceHelp.hidden = true;
      // The Drive steps belonged to the closing tour's host (plan §5 #13).
      dom.replaceHelpDrive.hidden = true;
      dom.replaceHelpGeneric.hidden = false;
    },
  };
}
