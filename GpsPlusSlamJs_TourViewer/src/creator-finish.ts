/**
 * The creator's Finish (code book refactor plan M2, split out of
 * `creator-setup.ts` unchanged): the open tour rebuilt in the browser
 * (DEC-N6) with the measured level, the manifest and the photos, a listed
 * tour's series continued, the walk left out unless kept, and what the
 * written zip changes on the page; plus the keep-the-walk switch. The
 * rebuild's rules are `finish-rebuild.ts`, shared with the desktop editor
 * (M6 E0); this file is the phone page around them.
 *
 * @see creator-finish.ts.md
 */

import {
  createEmptyTourManifest,
  type TourCaptureSpots,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { CreatorCodes } from "./creator-codes.js";
import type { CreatorDraft } from "./creator-draft.js";
import type { CreatorHandoff } from "./creator-handoff.js";
import type { CreatorMeasuring } from "./creator-measuring.js";
import type { CreatorPreviews } from "./creator-previews.js";
import type { CreatorSettle } from "./creator-settle.js";
import {
  captureSpotsForRebuild,
  finishedFileName,
  pendingAfterRebuild,
  rebuildFinishedTour,
} from "./finish-rebuild.js";
import { FINISH_LABELS, finishReadiness } from "./qr-author-mode.js";
import { authoringFinished } from "./tour-authoring-actions.js";
import { scanEntryNames } from "./tour-read-set.js";
import type { TourSession } from "./tour-session.js";
import type {
  ArController,
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import type { Wizard } from "./wizard.js";

/** The elements the Finish reads and owns, in step 4. */
export interface CreatorFinishDom {
  finishButton: HTMLButtonElement;
  keepScanRow: HTMLElement;
  keepScanInput: HTMLInputElement;
  finishStatus: HTMLElement;
  downloadButton: HTMLButtonElement;
  finishBlock: HTMLElement;
}

export interface CreatorFinish {
  /** Whether a Finish could run, and why not (the readout's hint). */
  readiness(): ReturnType<typeof finishReadiness>;
  /** A tap would start a Finish now: ready, no measurement in flight and
   *  none running. The ONE rule the button and the click share (M2
   *  review #2): M4 changes readiness, and two copies could disagree. */
  canStart(): boolean;
  /** Start a Finish now if `canStart()`; whether one started (the
   *  creator's Done in AR, polish round M3). */
  start(): boolean;
  /** Show the keep-the-walk switch only for a tour with something
   *  visitors never read, on the page, with no rebuilt file waiting. */
  renderKeepScan(): void;
}

export function wireCreatorFinish(deps: {
  ctx: TourViewerSession;
  arStore: Pick<TourViewerStore, "dispatch">;
  arController: Pick<ArController, "disable">;
  wizard: Pick<Wizard, "openStep">;
  dom: CreatorFinishDom;
  measuring: Pick<CreatorMeasuring, "inFlight">;
  codes: Pick<CreatorCodes, "inHand" | "toWrite" | "finished">;
  settle: Pick<
    CreatorSettle,
    | "settleVisit"
    | "positionSentence"
    | "afterFinish"
    | "showSummary"
    | "unsettle"
  >;
  handoff: Pick<CreatorHandoff, "save" | "offer" | "finishStarted">;
  previews: Pick<CreatorPreviews, "keepFinishedPhoto" | "sync">;
  draft: Pick<CreatorDraft, "saveMeta" | "finished">;
  sessionLive: () => boolean;
  /** The tour's name as typed in step 3 (`tour-name-field.ts`): a name
   *  becomes the manifest's `title` (polish round M4a), an emptied one
   *  removes it, null keeps the tour's own (W2). */
  tourTitle?: () => string | null;
  render: () => void;
  /** Re-render the AR button when a finish ends (polish round M3). */
  renderArEntry?: () => void;
}): CreatorFinish {
  const { ctx, arStore, dom } = deps;
  /** The open tour's entries a visitor never reads, kept for the tour and
   *  manifest it was computed for: the readout renders on every dispatch,
   *  and a scan can hold thousands of entries. */
  let scanMemo: {
    session: TourSession;
    manifest: TourManifest | null;
    count: number;
  } | null = null;

  function renderKeepScan(): void {
    const current = ctx.session;
    if (current === null || ctx.tourManifestStatus !== "settled") {
      dom.keepScanRow.hidden = true;
      return;
    }
    if (
      scanMemo?.session !== current ||
      scanMemo.manifest !== ctx.tourManifest
    ) {
      scanMemo = {
        session: current,
        manifest: ctx.tourManifest,
        count: scanEntryNames(
          current.entries.map((e) => e.filename),
          ctx.tourManifest ?? createEmptyTourManifest(),
          current.manifestWrap,
        ).length,
      };
    }
    // Chosen on the page before AR (UI round 1, U2): hidden in a session,
    // since the Finish there reads it.
    // ... and while a rebuilt file waits: the next Finish rebuilds from it,
    // so a changed tick could not change it (U2 milestone review #2).
    dom.keepScanRow.hidden =
      deps.sessionLive() || ctx.rebuiltZip !== null || scanMemo.count === 0;
  }

  /** The recorded photos' spots for this Finish: the shared rule
   *  (`finish-rebuild.ts` `captureSpotsForRebuild`, M6 E0b) with this
   *  page's progress line and its re-open check. */
  function captureSpotsForFinish(
    current: TourSession,
    manifest: TourManifest,
  ): Promise<{ spots?: TourCaptureSpots; notPlaced?: string }> {
    return captureSpotsForRebuild(current, manifest, {
      shouldContinue: () => ctx.session === current,
      onChunk: (done, total) => {
        ctx.finishProgress = FINISH_LABELS.placingPhotos(done, total);
        deps.render();
      },
    });
  }

  function readiness(): ReturnType<typeof finishReadiness> {
    return finishReadiness({
      hasWork: hasWork(),
      tourOpen: ctx.session !== null,
      manifest: ctx.tourManifestStatus,
    });
  }

  /**
   * Something to write (M4d): a code the book would write, an object
   * changed or deleted, or - in AR - a code in hand, whose settle may
   * still change it. A desk edit (no AR visit, no code) qualifies; a page
   * with nothing changed does not, so Finish stays hidden there.
   */
  function hasWork(): boolean {
    return (
      deps.codes.toWrite().length > 0 ||
      ctx.placedObjects.length > 0 ||
      ctx.deletedObjectIds.length > 0 ||
      (deps.sessionLive() && deps.codes.inHand() !== null)
    );
  }

  function canStart(): boolean {
    return (
      readiness() === "ready" && !deps.measuring.inFlight() && !ctx.finishing
    );
  }

  /** Start a Finish if one can start now - the panel's button and the
   *  creator's Done in AR (polish round M3, Q-Done) share this; false when
   *  none could start. */
  function start(): boolean {
    const current = ctx.session;
    if (current === null || !canStart()) return false;
    // The visit still running is settled BEFORE anything is read for the
    // zip (plan §3.2): its objects and its code are written as settled, not
    // as tapped. A visit already over was settled at its end.
    const settledAtTap = deps.sessionLive() ? ctx.arSessionGeneration : null;
    if (settledAtTap !== null) deps.settle.settleVisit("finish");
    // Read AFTER the settle, which may re-mint the code in hand. Null for a
    // desk edit (M4d, §9 D4): no level is written then.
    const minted = deps.codes.inHand();
    // Every code this page changed, captured with the code in hand (M4c-1):
    // a code the zip already holds unchanged is not written again.
    const levels = deps.codes.toWrite();
    // Both guards for the continuation: the tour may be re-opened and the
    // AR session may end (and a new one start) while the rebuild runs; the
    // result must not land in a session or a tour it was not made for
    // (M3 review #2).
    const sessionGeneration = ctx.arSessionGeneration;
    ctx.finishing = true;
    // A tap now would save the previous Finish's zip just before this one
    // saves the new one under the same name (F4 milestone review #5).
    dom.downloadButton.disabled = true;
    // A question about the previous Finish's file is put away: its yes must
    // not be read as this Finish's (F19 review #2).
    deps.handoff.finishStarted();
    ctx.finishError = null;
    // The AR button reads the finish ("Saving…"): a finish started from the
    // panel's retry left it saying "Close AR" (M3 review #3).
    deps.renderArEntry?.();
    ctx.placementNote = null;
    ctx.finishProgress = FINISH_LABELS.reading(current.archive.size);
    deps.render();
    let wroteZip = false;
    /** The zip THIS Finish made, and its result sentences: a failure after
     *  it still hands the zip over (F4 milestone review #1). */
    let madeZip: typeof ctx.rebuiltZip = null;
    let notes = "";
    /** Save the zip off AR; with a session running, leave it to the button
     *  (a download must not start inside an AR session, review #6). */
    const handOver = (): void => {
      if (deps.sessionLive()) deps.handoff.offer(notes);
      else deps.handoff.save(notes);
    };
    void (async () => {
      try {
        // Assembled INSIDE the try (M4 review #1): a manifest the reader
        // rejects (a duplicate id) must fail the finish visibly, not throw
        // past `finishing = true` and freeze the panel.
        const manifest = ctx.tourManifest ?? createEmptyTourManifest();
        const photos = await captureSpotsForFinish(current, manifest);
        if (ctx.session !== current) return; // re-opened meanwhile
        const deleted = [...ctx.deletedObjectIds];
        // The Finish's rules, shared with the desktop editor (M6 E0,
        // `finish-rebuild.ts`): the edits applied, the files written and
        // removed, a listed tour's series continued, from the newest bytes.
        const previous = ctx.rebuiltZip;
        const finished = await rebuildFinishedTour({
          tour: current,
          manifest,
          // A snapshot: placements land in this list during the rebuild.
          placed: [...ctx.placedObjects],
          deleted,
          levels,
          title: deps.tourTitle?.() ?? null,
          ...(photos.spots === undefined ? {} : { captureSpots: photos.spots }),
          keepScan: dom.keepScanInput.checked,
          previous,
          shouldContinue: () => ctx.session === current,
          onProgress: (done, total) => {
            ctx.finishProgress = FINISH_LABELS.rebuilding(done, total);
            deps.render();
          },
        });
        if (finished === null || ctx.session !== current) return;
        const { blob, written, signedManifest, scanLeftOut } = finished;
        ctx.rebuiltZip = {
          blob,
          written,
          ...(signedManifest === undefined ? {} : { signedManifest }),
          // The hosted file's own name, made safe (`finishedFileName`, the
          // rule the desktop editor shares); the Drive steps then ask for the
          // same rename on Drive (Drive replace plan §5 #7).
          filename: finishedFileName(current),
        };
        madeZip = ctx.rebuiltZip;
        // The Finish's result sentences: they stay on the line under the
        // save's status (`creator-handoff.ts`).
        notes = [
          ...(scanLeftOut.length === 0
            ? []
            : [FINISH_LABELS.scanLeftOut(scanLeftOut.length)]),
          ...(photos.notPlaced === undefined
            ? []
            : [FINISH_LABELS.photosNotPlaced(photos.notPlaced)]),
          // What the settles decided for the code (UI round 1, U3): no
          // button announces it any more.
          deps.settle.positionSentence(),
        ]
          .filter((line) => line !== "")
          .join(" ");
        dom.finishStatus.textContent = [
          FINISH_LABELS.savingTour(blob.size),
          notes,
        ]
          .filter((line) => line !== "")
          .join(" ");
        // The placed objects are in the zip now; the next finish (a
        // re-measure, a re-opened tour) must not append them again - and
        // the in-memory manifest has to ADVANCE to what was just written,
        // or a second finish in the same open tour would rebuild from the
        // pre-finish manifest and silently drop this batch (PR #435
        // review). `tourManifest` is otherwise only written at tour open.
        ctx.tourManifest = written;
        // Only what this zip carries leaves the list - by CONTENT, not id:
        // a photo that landed while the zip was rebuilt is in neither, and
        // waits for the next Finish (M2c review #6). A photo that leaves
        // keeps its bytes here for its preview: the hosted zip does not
        // have them until the creator uploads this one.
        // The shared rule (`pendingAfterRebuild`, M6 E0b), on the lists
        // as they are NOW: a placement that landed during the rebuild stays.
        const pending = pendingAfterRebuild(
          { placed: ctx.placedObjects, deleted: ctx.deletedObjectIds },
          written,
          deleted,
        );
        for (const p of pending.finished) {
          if (p.blob !== undefined) {
            deps.previews.keepFinishedPhoto(p.object.id, p.blob);
          }
        }
        ctx.placedObjects = pending.placed;
        // Their versions in this file are this device's own (M6 E2p): a
        // creator who uploads it from this tab must not see a later edit
        // called "replaced by a newer one".
        deps.draft.finished(
          pending.finished.map((p) => p.object.id),
          written,
        );
        // The deletions are applied: the manifest no longer carries them.
        // (Their tombstones stay in the draft until the hosted zip lacks
        // them too - the same proof the objects wait for.)
        ctx.deletedObjectIds = pending.deleted;
        deps.previews.sync();
        wroteZip = true;
        deps.codes.finished(levels);
        // The result screen said them; the next Finish reports its own.
        deps.settle.afterFinish();
        arStore.dispatch(
          authoringFinished({
            levelId: minted?.id ?? null,
            levelIds: levels.map((l) => l.id),
            manifest: written,
            atMs: Date.now(),
          }),
        );
        // NOT cleared here, and not on the download tap either: the zip is
        // only in the creator's hands, not yet in the file the world sees.
        // It is cleared when a re-opened tour turns out to carry these ids
        // (see presentDraftForTour) - the one signal that is proof.
        void deps.draft.saveMeta();
        // The session ends so the creator lands on the page, where the
        // result and the save are - unless it already ended and another one
        // started, which is then not ours to end.
        if (sessionGeneration === ctx.arSessionGeneration) {
          await deps.arController.disable();
          // A close during the session's end already hid the block; showing
          // it now would put the closed tour's button on the next page.
          if (ctx.session !== current) return;
        }
        // The completion step of its own (polish round M2, B9): the
        // saved status and the host's replace steps, where the creator
        // lands once the session has ended. The reveal happens AFTER the
        // disable above, so the block cannot appear over a session that is
        // still compositing.
        deps.wizard.openStep("done");
        dom.finishBlock.hidden = false;
        // The summary of every visit (M3b), on the page with the save.
        deps.settle.showSummary();
        // The Finish saves the rebuilt zip itself (the 2026-10-08 field
        // test, F4; owner decision D-F4a): the creator once left with only
        // the troubleshooting recording, the tour zip waiting on a button
        // they never saw. The button stays, to save it again.
        handOver();
        // What the save did, brought into view rather than the top of
        // step 4 (UI round 1, U2).
        dom.finishStatus.scrollIntoView?.({ block: "center" });
      } catch (err) {
        if (ctx.session === current) {
          ctx.finishError = FINISH_LABELS.failed(
            err instanceof Error ? err.message : String(err),
          );
          // A file this Finish already made stays reachable with the
          // retry (U2 milestone review #4) - and is handed over: saved off
          // AR, else offered on the button (F4 milestone review #1). An
          // earlier Finish's file stays saveable from the button.
          if (ctx.rebuiltZip !== null) dom.finishBlock.hidden = false;
          if (madeZip !== null && ctx.rebuiltZip === madeZip) handOver();
          else if (ctx.rebuiltZip !== null) {
            dom.downloadButton.disabled = false;
          }
        }
      } finally {
        // A Finish that wrote no zip leaves its visit unsettled again while
        // it still runs: what the creator places after a failure must
        // settle with the rest of the visit at its end, through one
        // alignment - the tap's settle is redone then.
        if (!wroteZip) deps.settle.unsettle(settledAtTap);
        ctx.finishing = false;
        ctx.finishProgress = "";
        deps.render();
        // The AR button reads the finish (Saving…, Close AR after a
        // failure), and nothing else re-renders it when a finish ends.
        deps.renderArEntry?.();
      }
    })();
    return true;
  }

  dom.finishButton.addEventListener("click", () => {
    start();
  });

  return { renderKeepScan, readiness, canStart, start };
}
