/**
 * The rebuilt zip's hand-off (code book refactor plan M2, split out of
 * `creator-setup.ts`): the Finish saves the rebuilt zip by itself and the
 * one button left saves it again (the 2026-10-08 field test, F4; owner
 * decisions D-F4a, D-F4b), the result line, and the "replace the hosted
 * file" steps a save earns - and, once per Finish, the question whether the
 * creator put that file in place (follow-up F19).
 *
 * @see creator-handoff.ts.md
 */

import {
  driveFileAddress,
  driveReplaceSteps,
  FINISH_LABELS,
  finishSaveStatus,
} from "./qr-author-mode.js";
import { copyWithFeedback } from "gps-plus-slam-app-framework/utils/copy-with-feedback";
import { isDriveUrl } from "./open-errors.js";
import { hostReplaceText, type TourHost } from "./tour-host.js";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourViewerSeams } from "./seams.js";
import type { TourViewerSession } from "./tour-viewer-session.js";

/** The elements the hand-off owns (all in step 4's tail, outside AR). */
export interface CreatorHandoffDom {
  downloadButton: HTMLButtonElement;
  finishStatus: HTMLElement;
  replaceHelp: HTMLElement;
  replaceHelpGeneric: HTMLElement;
  replaceHelpDrive: HTMLElement;
  /** Step 6's "copy the file's Drive address", shown with the Drive steps. */
  replaceDriveCopy: HTMLButtonElement;
  /** The question after a save delivered (F19): its box, its line, and
   *  its two answers. */
  uploadAsk: HTMLElement;
  uploadAskText: HTMLElement;
  uploadYes: HTMLButtonElement;
  uploadNo: HTMLButtonElement;
}

/** The Drive address button's labels (polish round M2, step 6). */
export const DRIVE_COPY_LABELS = {
  idle: "Copy the file's Drive address",
  busy: "Copying…",
  done: "Copied - paste it into a new browser tab",
  failed: (address: string) => `Could not copy - the address is ${address}`,
} as const;

/**
 * The question after a download-only Finish (follow-up F19, owner decision
 * 2026-10-14): nothing tells a page that the creator uploaded the file it
 * saved, so it asks once. A yes makes the written versions SEEN hosted, so
 * a note deleted later on a computer is not offered back from this phone.
 */
export const UPLOAD_ASK_LABELS = {
  question:
    "Did you upload it? Tap Yes once the file at your link is replaced with this one.",
  yes: "Yes, it is replaced",
  no: "Not yet",
  noting: "Noting it…",
  noted:
    "Noted. A note you delete later on a computer stays deleted on this phone.",
  failed:
    "This phone could not note it. If a note deleted on a computer is offered back here, you can decline it.",
} as const;

export interface CreatorHandoff {
  /**
   * Save the rebuilt zip to this phone - the Finish's own save, and the
   * button's. `notes`: the result sentences the Finish shows after the
   * save's status (the code's position, a walk left out, photos not
   * placed); kept for the button's later saves. The button calls it
   * without them.
   */
  save(notes?: string): void;
  /**
   * The rebuilt zip waits for the button: a save would start inside an AR
   * session still running (F4 milestone review #1, #6). The line says it is
   * not saved, with the Finish's `notes`, and the button is live.
   */
  offer(notes: string): void;
  /** A new Finish starts: a question left from an earlier Finish's file is
   *  put away, so its yes can never be read as this Finish's (F19 review
   *  #2). */
  finishStarted(): void;
  /** A tour closed: the button, the line and the steps are stale. */
  reset(): void;
}

export function wireCreatorHandoff(deps: {
  ctx: TourViewerSession;
  seams: Pick<TourViewerSeams, "downloadZip"> &
    Partial<Pick<TourViewerSeams, "copyText">>;
  dom: CreatorHandoffDom;
  /** Re-render the panel (a delivered file changes the save guard). */
  render: () => void;
  /** The host chosen in step 1 (`tour-host.ts`), read at each save; null
   *  or absent: none chosen, and the paragraph about every host stays. */
  host?: () => TourHost | null;
  /** The creator said yes, the file is uploaded (F19): the draft notes
   *  `written`, the tour.json of the file the question was asked about;
   *  whether that landed. Absent: the question is never asked. */
  onUploaded?: (written: TourManifest) => Promise<boolean>;
}): CreatorHandoff {
  const { ctx, seams, dom } = deps;
  /** The file the question on screen is about, and the tour.json it
   *  carries, captured when it was asked (F19 review #2): a yes notes
   *  exactly that file, never a later Finish's. */
  let asked: { readonly blob: Blob; readonly written: TourManifest } | null =
    null;
  /** The file a yes was given for: no save of it asks again. */
  let answeredYes: Blob | null = null;
  function hideAsk(): void {
    asked = null;
    dom.uploadAsk.hidden = true;
  }
  /** The question, fresh, for the file a save just delivered. */
  function ask(rebuilt: { blob: Blob; written: TourManifest }): void {
    asked = { blob: rebuilt.blob, written: rebuilt.written };
    dom.uploadAskText.textContent = UPLOAD_ASK_LABELS.question;
    for (const [button, label] of [
      [dom.uploadYes, UPLOAD_ASK_LABELS.yes],
      [dom.uploadNo, UPLOAD_ASK_LABELS.no],
    ] as const) {
      button.textContent = label;
      button.hidden = false;
      button.disabled = false;
    }
    dom.uploadAsk.hidden = false;
  }
  hideAsk();
  /** The open tour's Drive address while the Drive steps show. */
  let driveAddress: string | null = null;
  /** The page's paragraph about every host, put back when a tour closes. */
  const everyHostText = dom.replaceHelpGeneric.textContent;
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
    // The file's Drive address, for the Drive website's upload (the
    // owner's way to replace a Drive tour); none when it cannot be read.
    driveAddress = onDrive
      ? driveFileAddress(ctx.session?.archive.url ?? "")
      : null;
    dom.replaceDriveCopy.hidden = driveAddress === null;
    dom.replaceDriveCopy.textContent = DRIVE_COPY_LABELS.idle;
    if (!onDrive) {
      // The chosen host's own words (polish round M2, step 6), else the
      // paragraph about every host.
      const host = deps.host?.() ?? null;
      dom.replaceHelpGeneric.textContent =
        (host === null ? null : hostReplaceText(host)) ?? everyHostText;
      return;
    }
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
    // A question about another file is stale the moment this one saves.
    if (asked !== null && asked.blob !== rebuilt.blob) hideAsk();
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
            // Asked after each save that delivered the file, until a yes
            // was given for it (F19; review #9: "Not yet" is not final).
            // One question per save: a fresh one replaces the last.
            if (deps.onUploaded !== undefined && answeredYes !== rebuilt.blob) {
              ask(rebuilt);
            }
          }
        },
        (err: unknown) => {
          if (openGeneration !== ctx.openGeneration) return;
          dom.downloadButton.disabled = false;
          dom.downloadButton.textContent = FINISH_LABELS.saveAgain;
          showStatus(
            FINISH_LABELS.saveFailed(
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
  // Async-UI rule: "Noting it…" with both answers off while the draft
  // writes, then what it came to; the answers go, the line stays.
  dom.uploadYes.addEventListener("click", () => {
    const noted = deps.onUploaded;
    const about = asked;
    if (
      noted === undefined ||
      about === null ||
      dom.uploadAsk.hidden ||
      dom.uploadYes.disabled ||
      dom.uploadYes.hidden
    ) {
      return;
    }
    answeredYes = about.blob;
    const openGeneration = ctx.openGeneration;
    dom.uploadYes.disabled = true;
    dom.uploadNo.disabled = true;
    dom.uploadAskText.textContent = UPLOAD_ASK_LABELS.noting;
    let noting: Promise<boolean>;
    try {
      noting = noted(about.written);
    } catch {
      noting = Promise.resolve(false);
    }
    void noting
      .catch(() => false)
      .then((ok) => {
        // A note that did not land is asked about again at the next save.
        if (!ok && answeredYes === about.blob) answeredYes = null;
        if (openGeneration !== ctx.openGeneration) return;
        dom.uploadAskText.textContent = ok
          ? UPLOAD_ASK_LABELS.noted
          : UPLOAD_ASK_LABELS.failed;
        dom.uploadYes.hidden = true;
        dom.uploadNo.hidden = true;
      });
  });
  // "Not yet", or no answer at all, leaves the draft as it is.
  dom.uploadNo.addEventListener("click", hideAsk);
  // Async-UI rule: busy before the await, the outcome after; a failed copy
  // shows the address so it can still be copied by hand.
  dom.replaceDriveCopy.addEventListener("click", () => {
    const address = driveAddress;
    if (address === null) return;
    // The framework's one copy sequence (F7, DEC-H3).
    void copyWithFeedback(dom.replaceDriveCopy, address, seams.copyText, {
      busy: DRIVE_COPY_LABELS.busy,
      done: DRIVE_COPY_LABELS.done,
      failed: DRIVE_COPY_LABELS.failed(address),
    });
  });

  return {
    save,
    finishStarted: hideAsk,
    offer: (next) => {
      notes = next;
      if (asked !== null && asked.blob !== ctx.rebuiltZip?.blob) hideAsk();
      dom.downloadButton.disabled = ctx.rebuiltZip === null;
      dom.downloadButton.textContent = FINISH_LABELS.saveAgain;
      showStatus(FINISH_LABELS.notSaved);
    },
    reset: () => {
      notes = "";
      answeredYes = null;
      hideAsk();
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
      dom.replaceHelpGeneric.textContent = everyHostText;
      driveAddress = null;
      dom.replaceDriveCopy.hidden = true;
    },
  };
}
