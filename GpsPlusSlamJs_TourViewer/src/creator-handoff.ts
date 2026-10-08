/**
 * The rebuilt zip's hand-off (code book refactor plan M2, split out of
 * `creator-setup.ts` unchanged): the download / share / Drive-save button
 * after a Finish, its labels per open tour, the result line, and the
 * "replace the hosted file" steps it earns.
 *
 * @see creator-handoff.ts.md
 */

import {
  driveReplaceSteps,
  FINISH_LABELS,
  finishBusyLabel,
  finishHandoffStatus,
  finishHelpVisibility,
  finishIdleLabel,
  finishRoute,
  type FinishRoute,
  type HandoffOutcome,
} from "./qr-author-mode.js";
import { isDriveUrl } from "./open-errors.js";
import type { TourViewerSeams } from "./seams.js";
import type { TourViewerSession } from "./tour-viewer-session.js";

/** The elements the hand-off owns (all in step 4's tail, outside AR). */
export interface CreatorHandoffDom {
  downloadButton: HTMLButtonElement;
  finishStatus: HTMLElement;
  replaceHelp: HTMLElement;
  replaceHelpShare: HTMLElement;
  replaceHelpGeneric: HTMLElement;
  replaceHelpDrive: HTMLElement;
}

export interface CreatorHandoff {
  /** The open tour is on Google Drive (it saves, never shares). */
  drive(): boolean;
  /** The route the button takes for the open tour. */
  route(): FinishRoute;
  /** The button's idle label for the open tour. */
  idleLabel(): string;
  /** A tour closed: the button, the line and the steps are stale. */
  reset(): void;
}

export function wireCreatorHandoff(deps: {
  ctx: TourViewerSession;
  seams: Pick<
    TourViewerSeams,
    "canShareZip" | "downloadZip" | "shareOrDownloadZip"
  >;
  dom: CreatorHandoffDom;
  /** Re-render the panel (a delivered file changes the save guard). */
  render: () => void;
}): CreatorHandoff {
  const { ctx, seams, dom } = deps;
  // The capability, asked ONCE at wire time. A button that says "Share"
  // where nothing can be shared is a lie, and one that says "Download" on
  // a phone that can share describes the wrong action. The ROUTE, though,
  // is per open tour (Drive replace plan §5 #3): a Drive tour saves even
  // where the device could share, so the labels are derived when shown.
  const canShare = seams.canShareZip();
  function drive(): boolean {
    return ctx.session !== null && isDriveUrl(ctx.session.archive.url);
  }
  function route(): FinishRoute {
    return finishRoute({ canShare, drive: drive() });
  }
  function idleLabel(): string {
    return finishIdleLabel(route() === "share", drive());
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
  dom.downloadButton.textContent = idleLabel();
  dom.downloadButton.addEventListener("click", () => {
    const rebuilt = ctx.rebuiltZip;
    if (rebuilt === null) return;
    // Async-UI rule: in-progress before the await, the durable end state
    // after; nothing delivered (a dismissed save picker, an abandoned
    // share sheet) keeps the button live.
    dom.downloadButton.disabled = true;
    dom.downloadButton.textContent = finishBusyLabel(route() === "share");
    // The share sheet can stay up for as long as the creator wants, and a
    // tour can be closed underneath it. Every other post-await path in this
    // module re-checks its generation; this one resolved straight into the
    // DOM, so a hand-off that settled after a close revealed the step-6
    // instructions on the CLOSED tour's panel - invisible at the time,
    // because the block that holds them is hidden, and then already on
    // screen the moment the next tour reached its finish (PR #440 review).
    const openGeneration = ctx.openGeneration;
    // A Drive tour SAVES, through its own seam - the share-or-download one
    // would open the share sheet on a phone (plan §2 decision 4, §5 #3).
    const handoff: Promise<HandoffOutcome> = drive()
      ? seams
          .downloadZip(rebuilt.blob, rebuilt.filename)
          .then((delivered) => ({ route: "download" as const, delivered }))
      : seams.shareOrDownloadZip(rebuilt.blob, rebuilt.filename);
    handoff.then(
      (outcome) => {
        const { delivered } = outcome;
        if (openGeneration !== ctx.openGeneration) return;
        // Saved: the guard stops asking, and Finish comes back (U2).
        if (delivered && ctx.rebuiltZip === rebuilt) {
          ctx.rebuiltZip = { ...rebuilt, delivered: true };
          deps.render();
        }
        dom.downloadButton.disabled = false;
        dom.downloadButton.textContent = idleLabel();
        dom.finishStatus.textContent = finishHandoffStatus(
          outcome,
          rebuilt.filename,
          drive(),
        );
        // The replace instructions were step 6; they are the last thing to
        // do and only once the file exists, so they appear once the zip has
        // actually gone somewhere (F10). The share route reveals one extra
        // sentence, because on that route the file is inside another app
        // rather than on this device, and the instruction above assumes it
        // can be found. The branch itself is `finishHelpVisibility`, a pure
        // function, because this one is otherwise reachable only by walking
        // an AR setup on a phone (M2 review #4).
        // REVEAL-ONLY. `finishHelpVisibility` says what this outcome
        // EARNS, not what the panel should look like: a creator who saved
        // the zip and then tapped again and dismissed the picker has still
        // saved it, and hiding the step-6 instructions they had already
        // earned would take the flow's last instruction off the screen at
        // the moment they most need it (PR #439 review #3). Only
        // `reset`, on a tour close, hides them again.
        const help = finishHelpVisibility(outcome);
        if (help.replaceHelp) {
          presentReplaceSteps(rebuilt.filename);
          dom.replaceHelp.hidden = false;
        }
        // `shareNote` is a claim about WHICH hand-off happened, so unlike
        // `replaceHelp` it is not earned-and-kept: a share followed by a
        // save would otherwise leave "you shared it rather than saving it"
        // on screen beside a file that is now on disk, sending the creator
        // to look for it in an app. Only a hand-off that DELIVERED gets to
        // change it - a dismissed picker changed nothing (PR #440 review).
        if (delivered) dom.replaceHelpShare.hidden = !help.shareNote;
      },
      (err: unknown) => {
        if (openGeneration !== ctx.openGeneration) return;
        dom.downloadButton.disabled = false;
        dom.downloadButton.textContent = idleLabel();
        dom.finishStatus.textContent = FINISH_LABELS.failed(
          err instanceof Error ? err.message : String(err),
        );
      },
    );
  });

  return {
    drive,
    route,
    idleLabel,
    reset: () => {
      dom.downloadButton.disabled = true;
      // The LABEL too, because the hand-off continuation is generation-
      // guarded and returns without restoring it for a tour that closed
      // underneath an open share sheet. Without this the next tour's
      // finish enables a button that still reads "Sharing…" (PR #441
      // review) - the guard moved the leak here rather than removing it.
      dom.downloadButton.textContent = idleLabel();
      dom.finishStatus.textContent = "";
      dom.replaceHelp.hidden = true;
      dom.replaceHelpShare.hidden = true;
      // The Drive steps belonged to the closing tour's host (plan §5 #13).
      dom.replaceHelpDrive.hidden = true;
      dom.replaceHelpGeneric.hidden = false;
    },
  };
}
