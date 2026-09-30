/**
 * The page-open housekeeping of the troubleshooting recordings (authoring
 * recording plan 2026-09-28-0953 §3.1, M1b): wire the orphan offer against
 * the page's OPFS, clean up what `recording-folders.ts`'s bound names, and
 * offer what a killed tab left unsaved. It runs wherever the recording's
 * controls show - a creator's page, and a visitor's with `?debug=1`.
 *
 * The saving page's own tag (`contextTag`) is the orphan's fallback tag
 * (M1b review #7): a recording with no log action of either kind is labelled
 * by the page that saves it, so a visitor's page never labels one an
 * authoring recording.
 *
 * Moved out of `main.ts` so the wiring is tested in node; it reaches no
 * globals.
 *
 * @see recording-housekeeping.ts.md
 */

import type { ShareOrDownloadResult } from "gps-plus-slam-app-framework/storage";

import {
  deleteRecordingFolder,
  heldRecordingFolders,
  openRecordingsDir,
  packOrphanRecording,
  tidyRecordings,
  type RecordingContextTag,
  type RecordingEnvironment,
  type RecordingLocks,
} from "./recording-folders.js";
import {
  wireRecordingOffer,
  type RecordingOfferDom,
} from "./recording-offer.js";
import type { SaveGuard } from "./recording-panel.js";

export function wireRecordingHousekeeping(deps: {
  dom: RecordingOfferDom & {
    /** The recording block: its `data-housekeeping` turns `done` once the
     *  page-open check ran (the e2e waits for it). */
    block: HTMLElement;
  };
  /** The OPFS root, or undefined where there is none; may reject. */
  openRoot: () => Promise<FileSystemDirectoryHandle | undefined>;
  /** `navigator.locks`, or undefined. */
  locks: RecordingLocks | undefined;
  /** The saving page's own tag: the orphan's fallback. */
  contextTag: RecordingContextTag;
  /** What the saving page knows about itself, read at each save. */
  environment: () => RecordingEnvironment;
  handOff: (blob: Blob, filename: string) => Promise<ShareOrDownloadResult>;
  canShare: () => boolean;
  now: () => Date;
  describeTime: (ms: number) => string;
  reveal: () => void;
  saveGuard: SaveGuard;
}): Promise<void> {
  const openRecordings = async () => {
    const root = await deps.openRoot();
    return root === undefined ? null : openRecordingsDir(root, false);
  };
  const offer = wireRecordingOffer({
    dom: deps.dom,
    pack: async (name) => {
      const dir = await openRecordings();
      if (dir === null) throw new Error("the recordings folder is gone");
      return packOrphanRecording(
        dir,
        name,
        deps.environment(),
        deps.contextTag,
      );
    },
    discard: async (name) => {
      const dir = await openRecordings();
      if (dir !== null) await deleteRecordingFolder(dir, name);
    },
    handOff: deps.handOff,
    canShare: deps.canShare,
    now: deps.now,
    describeTime: deps.describeTime,
    reveal: deps.reveal,
    saveGuard: deps.saveGuard,
  });
  return (async () => {
    try {
      const dir = await openRecordings();
      if (dir === null) return;
      offer.present(
        await tidyRecordings(
          dir,
          () => heldRecordingFolders(deps.locks),
          deps.now().getTime(),
        ),
      );
    } catch {
      // No private file storage: nothing was left to offer.
    } finally {
      // Observable end of the page-open check (the e2e waits for it
      // before asserting that nothing is offered).
      deps.dom.block.dataset["housekeeping"] = "done";
    }
  })();
}
