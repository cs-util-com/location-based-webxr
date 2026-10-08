/**
 * The creator's Finish (code book refactor plan M2, split out of
 * `creator-setup.ts` unchanged): the open tour rebuilt in the browser
 * (DEC-N6) with the measured level, the manifest and the photos, a listed
 * tour's series continued, the walk left out unless kept, and what the
 * written zip changes on the page; plus the keep-the-walk switch.
 *
 * @see creator-finish.ts.md
 */

import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  createEmptyTourManifest,
  serializeTourManifest,
  type TourCaptureSpots,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  serializeSignedTourManifest,
  signedManifestFilesOf,
  successorManifest,
  TourIntegrityError,
  type SignedTourManifest,
  type TourFileRecord,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  ArchiveLimitError,
  rebuildZipWithEntries,
} from "gps-plus-slam-app-framework/storage";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";
import {
  applyObjectChanges,
  contentEntriesToRemove,
  objectContentKey,
} from "./authoring-draft.js";
import { bakeCaptureSpots } from "./capture-bake.js";
import {
  downloadSafeName,
  nameSurvivesDownload,
} from "./content-disposition.js";
import type { CreatorCodes } from "./creator-codes.js";
import type { CreatorDraft } from "./creator-draft.js";
import type { CreatorHandoff } from "./creator-handoff.js";
import type { CreatorMeasuring } from "./creator-measuring.js";
import type { CreatorPreviews } from "./creator-previews.js";
import type { CreatorSettle } from "./creator-settle.js";
import { finishEntries, type FinishEntry } from "./finish-entries.js";
import { FINISH_LABELS, finishReadiness } from "./qr-author-mode.js";
import { authoringFinished } from "./tour-authoring-actions.js";
import { scanEntryNames } from "./tour-read-set.js";
import { archiveFileName, type TourSession } from "./tour-session.js";
import type {
  ArController,
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import type { Wizard } from "./wizard.js";

/** A written entry's record for `manifest.json`: the SHA-256 and size of
 *  the bytes the zip will hold (a string is written as UTF-8). */
async function fileRecordOf(
  data: Blob | Uint8Array | string,
): Promise<TourFileRecord> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(await data.arrayBuffer());
  return { sha256: await sha256Hex(bytes), size: bytes.length };
}

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
  handoff: Pick<CreatorHandoff, "drive" | "route" | "idleLabel">;
  previews: Pick<CreatorPreviews, "keepFinishedPhoto" | "sync">;
  draft: Pick<CreatorDraft, "saveMeta">;
  sessionLive: () => boolean;
  render: () => void;
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

  /**
   * The recorded photos' spots for this Finish (scan-pass plan S1, S-D11):
   * the tour's own when it carries them, else baked from its recording,
   * else none - the tour then keeps the visitor's live join, as before S1,
   * and `notPlaced` says why for the creator. A recording that cannot be
   * read or joined never fails the Finish; a cap's refusal and a failed
   * integrity check do, as every read's does.
   */
  async function captureSpotsForFinish(
    current: TourSession,
    manifest: TourManifest,
  ): Promise<{ spots?: TourCaptureSpots; notPlaced?: string }> {
    if (manifest.captureSpots !== undefined) {
      return { spots: manifest.captureSpots };
    }
    if (!current.hasRecording) return {};
    try {
      const bake = await bakeCaptureSpots(current, {
        shouldContinue: () => ctx.session === current,
        onChunk: (done, total) => {
          ctx.finishProgress = FINISH_LABELS.placingPhotos(done, total);
          deps.render();
        },
      });
      return bake.kind === "baked"
        ? { spots: bake.spots }
        : { notPlaced: bake.reason };
    } catch (err) {
      if (err instanceof ArchiveLimitError) throw err;
      if (err instanceof TourIntegrityError) throw err;
      return {
        notPlaced: `reading the recording failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
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

  dom.finishButton.addEventListener("click", () => {
    const current = ctx.session;
    if (current === null || !canStart()) return;
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
    ctx.finishError = null;
    ctx.placementNote = null;
    ctx.finishProgress = FINISH_LABELS.reading(current.archive.size);
    deps.render();
    let wroteZip = false;
    void (async () => {
      try {
        // Assembled INSIDE the try (M4 review #1): a manifest the reader
        // rejects (a duplicate id) must fail the finish visibly, not throw
        // past `finishing = true` and freeze the panel.
        const entryNames = current.entries.map((e) => e.filename);
        // The session derived this prefix when it opened the zip; deriving
        // it a second time here is how the writer and the reader drifted
        // apart in the first place (PR #435 review).
        const wrap = current.manifestWrap;
        const manifestPath = `${wrap}${TOUR_MANIFEST_ENTRY}`;
        // The manifest: what the zip carried, with this device's records
        // REPLACING theirs by id (an edit or a move of a hosted object),
        // the new ones appended and the deleted ones filtered out (plan
        // §3.4, M4); the photos' bytes become content entries next to it.
        const manifest = ctx.tourManifest ?? createEmptyTourManifest();
        const photos = await captureSpotsForFinish(current, manifest);
        const captureSpots = photos.spots;
        if (ctx.session !== current) return; // re-opened meanwhile
        const deleted = [...ctx.deletedObjectIds];
        const written: TourManifest = {
          ...manifest,
          ...(captureSpots === undefined ? {} : { captureSpots }),
          // Never an id twice, and not for tidiness: the serializer REJECTS
          // duplicates, so one restored object that is already in the
          // manifest would make every finish throw - for as long as the
          // draft is restored, with no escape inside the app (M5 review #4).
          objects: applyObjectChanges(
            manifest.objects,
            ctx.placedObjects.map((p) => p.object),
            deleted,
          ),
        };
        // A deleted photo takes its content file with it. A signature over
        // the old list cannot cover the files this Finish rewrites, so it
        // goes - the output is unsigned until K2 signs on export. The list
        // itself CONTINUES for a listed tour (K1 milestone review R7, below);
        // anything else carrying the name is dropped with it.
        const [listName, ...signatureNames] = signedManifestFilesOf(entryNames);
        const listed =
          current.integrity.kind === "listed" && listName !== undefined
            ? { integrity: current.integrity, entry: listName }
            : null;
        // The published copy carries only what visitors read unless the
        // creator keeps the walk (S-D10): the walk, its unbaked frames, depth.
        // Never without baked spots (S1 milestone review #2): the walk is
        // then the only way a viewer can place the photos, and the hosted
        // file may be the creator's only copy of it.
        const scanLeftOut =
          dom.keepScanInput.checked || written.captureSpots === undefined
            ? []
            : scanEntryNames(entryNames, written, wrap);
        const removed = [
          ...contentEntriesToRemove(manifest.objects, deleted, wrap),
          ...scanLeftOut,
          ...signatureNames,
          ...(listed === null && listName !== undefined ? [listName] : []),
        ];
        // The level replaced where the zip holds it (also wrapped), a new
        // one inside a listed tour's folder or at the root
        // (`finish-entries.ts`), then the manifest and the photos.
        const entries: FinishEntry[] = finishEntries({
          entryNames,
          levels,
          wrap,
          listed: listed !== null,
          manifestPath,
          manifestJson: serializeTourManifest(written),
          photos: ctx.placedObjects.flatMap((p) =>
            p.object.kind === "photo" && p.blob !== undefined
              ? [{ image: p.object.image, blob: p.blob }]
              : [],
          ),
        });
        // The input is the NEWEST bytes for this tour: a previous finish's
        // rebuild when there is one, because it already carries that
        // batch's content entries - rebuilding from the hosted zip again
        // would write a manifest referencing photos the archive does not
        // contain (PR #435 review, the second half of the second-finish
        // bug). A tour close clears the rebuilt zip, so a re-opened tour
        // starts from what is actually hosted.
        const previous = ctx.rebuiltZip;
        const input = previous?.blob ?? (await current.readWholeArchive());
        if (ctx.session !== current) return; // re-opened meanwhile
        // The series' list, continued: the same series id, the next
        // version, and the hash of every file this zip will hold - the
        // kept ones from the list the input carries (checked at open and
        // as a whole by readWholeArchive, or written by the last Finish),
        // the written ones hashed here. Without it the series id's only
        // home was dropped (R7).
        let signedManifest: SignedTourManifest | undefined;
        if (listed !== null) {
          signedManifest = successorManifest(
            listed.integrity.manifest,
            listed.entry,
            {
              ...(previous?.signedManifest === undefined
                ? {}
                : { baseFiles: previous.signedManifest.files }),
              removed,
              written: new Map(
                await Promise.all(
                  entries.map(
                    async (e) => [e.path, await fileRecordOf(e.data)] as const,
                  ),
                ),
              ),
              createdAt: new Date().toISOString(),
            },
          );
          entries.push({
            path: listed.entry,
            data: serializeSignedTourManifest(signedManifest),
          });
        }
        const blob = await rebuildZipWithEntries(input, entries, {
          remove: removed,
          // The open archive is untrusted, so its rebuild inflates under
          // the session's own budget (K0 milestone review R1). A previous
          // Finish's zip is this page's own output, stored and bounded:
          // the rebuild sizes a budget for it itself.
          ...(previous === null ? { budget: current.budget } : {}),
          onProgress: (done, total) => {
            ctx.finishProgress = FINISH_LABELS.rebuilding(done, total);
            deps.render();
          },
        });
        if (ctx.session !== current) return;
        const hosted = current.hostedFileName();
        ctx.rebuiltZip = {
          blob,
          ...(signedManifest === undefined ? {} : { signedManifest }),
          // The hosted file's own name first: Drive offers "Replace" only
          // for the same name (Drive replace plan §2 decision 3) - made safe
          // to save where a phone would change it, and the Drive steps then
          // ask for the same rename on Drive (§5 #7).
          filename:
            hosted === null
              ? archiveFileName(current.archive.url)
              : nameSurvivesDownload(hosted)
                ? hosted
                : downloadSafeName(hosted),
        };
        dom.finishStatus.textContent = [
          deps.handoff.drive()
            ? FINISH_LABELS.readyDrive(blob.size, ctx.rebuiltZip.filename)
            : FINISH_LABELS.ready(blob.size, deps.handoff.route() === "share"),
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
        dom.downloadButton.textContent = deps.handoff.idleLabel();
        dom.downloadButton.disabled = false;
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
        const inZip = new Map(
          written.objects.map((o) => [o.id, objectContentKey(o)]),
        );
        const kept: typeof ctx.placedObjects = [];
        for (const p of ctx.placedObjects) {
          if (inZip.get(p.object.id) !== objectContentKey(p.object)) {
            kept.push(p);
          } else if (p.blob !== undefined) {
            deps.previews.keepFinishedPhoto(p.object.id, p.blob);
          }
        }
        ctx.placedObjects = kept;
        // The deletions are applied: the manifest no longer carries them.
        // (Their tombstones stay in the draft until the hosted zip lacks
        // them too - the same proof the objects wait for.)
        ctx.deletedObjectIds = ctx.deletedObjectIds.filter(
          (id) => !deleted.includes(id),
        );
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
        // download button is a fresh tap (a download needs its own user
        // gesture, plan §2.4) - unless it already ended and another one
        // started, which is then not ours to end.
        if (sessionGeneration === ctx.arSessionGeneration) {
          await deps.arController.disable();
          // A close during the session's end already hid the block; showing
          // it now would put the closed tour's button on the next page.
          if (ctx.session !== current) return;
        }
        // The download used to be step 5. It is the END of step 4 (F10):
        // the creator finished in AR, the session is closing, and what they
        // need next is one tap in the step they are already in. The reveal
        // happens AFTER the disable above, so the block cannot appear over
        // a session that is still compositing.
        deps.wizard.openStep("measure");
        dom.finishBlock.hidden = false;
        // The summary of every visit (M3b), on the page with the download.
        deps.settle.showSummary();
        // The save is the one thing left (UI round 1, U2): brought into
        // view and focused, rather than the top of step 4.
        dom.downloadButton.scrollIntoView?.({ block: "center" });
        dom.downloadButton.focus?.();
      } catch (err) {
        if (ctx.session === current) {
          ctx.finishError = FINISH_LABELS.failed(
            err instanceof Error ? err.message : String(err),
          );
          // A file this Finish already made stays reachable with the
          // retry (U2 milestone review #4).
          if (ctx.rebuiltZip !== null) dom.finishBlock.hidden = false;
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
      }
    })();
  });

  return { renderKeepScan, readiness, canStart };
}
