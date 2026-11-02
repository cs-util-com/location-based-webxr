/**
 * The desktop editor's in-place save (M6 E2b-1): a tour file opened through
 * the browser's file picker with write permission, written back where it
 * came from. The mechanism is the framework's
 * (`gps-plus-slam-app-framework/storage/save-target`); this module keeps
 * what is the tour's: its words, its lock family, its accept list, its size
 * cap and the zip's tail check. Page-free: the page passes the window and
 * the lock manager.
 *
 * @see save-target.ts.md
 */

import { DEFAULT_ARCHIVE_LIMITS } from "gps-plus-slam-app-framework/storage";
import { hasFilePicker } from "gps-plus-slam-app-framework/storage/file-picker";
import {
  createSaveTarget as createFileSaveTarget,
  holdLock,
  pickSaveFile as pickSaveFileOfType,
  pickWritableFile,
  releaseUnusedPick as releaseUnusedPickSaying,
  type LockHold,
  type PickOutcome,
  type PickerWindow,
  type SaveFilePick,
  type SavePickerWindow,
  type SaveTarget,
  type WritableFileHandle,
} from "gps-plus-slam-app-framework/storage/save-target";
import {
  ZIP_FILE_TYPE,
  type DownloadFileType,
} from "gps-plus-slam-app-framework/storage/zip-export";

export {
  InPlaceRefusal,
  isSameFile,
  type PickOutcome,
  type PickerWindow,
  type SaveFilePick,
  type SavePickerWindow,
  type SaveTarget,
  type WritableFileHandle,
} from "gps-plus-slam-app-framework/storage/save-target";

/** The lock names' family: a sibling of the recordings'
 *  (`gps-plus-slam/tour-viewer/`), so their housekeeping never lists it. */
const LOCK_PREFIX = "gps-plus-slam/tour-viewer-editor/";

/** The open dialog's filter: a tour is a zip. */
const TOUR_FILE_TYPE: DownloadFileType = {
  description: "Tour file",
  mimeType: "application/zip",
  extension: ".zip",
};

/** The refusal of a tour over the open cap, in the tour's words. */
const TOO_LARGE =
  "The saved tour would be larger than a tour may be, so it was not written over the file.";

/**
 * Whether a tour without a file (a link, the sample, a drop, the file
 * input) asks for a file with the save dialog - as it opens from a link or
 * the sample, else at its first Save, in the click - and then ADOPTS it:
 * saved into in place, and by itself, as a file opened with "Choose..." is.
 * Wherever the browser has both file dialogs, Android included: a check on
 * a phone (Chrome 155, Android 10) showed a picked file there is saved
 * under a new name, kept across a reload (one tap grants the permission
 * again), and that a rewrite cut short by closing the tab leaves the old
 * file whole. A browser killed in the middle of a write was not measured.
 */
export function adoptsSavedFile(win: PickerWindow & SavePickerWindow): boolean {
  return hasFilePicker(win) && typeof win.showSaveFilePicker === "function";
}

/**
 * The open dialog's fine print about Save, true for this browser (tour
 * editor plan 2026-10-17-1816, W2): where the file picker exists, a chosen
 * file is written in place (and saved by itself after a change); a tour
 * from a link or the sample asks where to save it as it opens (or at its
 * first Save) and is saved into that file from then on where the browser
 * adopts it
 * (`adoptsSavedFile`), else as a new copy; without the picker, Save
 * downloads a new copy. It opens with what leaves the computer: nothing of
 * the tour, but the map comes from OpenStreetMap (W6: "nothing is
 * uploaded" hid the tiles).
 */
export function saveFinePrint(win: PickerWindow & SavePickerWindow): string {
  const stays =
    "The tour file stays on this computer. The map comes from OpenStreetMap.";
  const chosen = `${stays} A file you choose is saved into that file, where the browser allows it, and by itself a few seconds after each change.`;
  if (adoptsSavedFile(win)) {
    return `${chosen} A tour opened from a link, or the sample, asks where to save it as it opens (or at its first Save), and is saved into that file from then on.`;
  }
  return hasFilePicker(win)
    ? `${chosen} A tour opened from a link, or the sample, is saved as a new copy to put in place of the old one.`
    : `${stays} Save gives you a new copy of the tour to put in place of the old one.`;
}

/**
 * Let the creator pick a tour zip, and ask to write it on the same gesture
 * (the framework's `pickWritableFile`: the permission FIRST, E2b plan
 * review #8; a refused second picker is a cancel, E2b-1 review #5).
 * `unavailable` is a browser without the picker, or one that refuses it
 * (an iframe): the page then uses its file input.
 */
export function pickTourFile(win: PickerWindow): Promise<PickOutcome> {
  return pickWritableFile(win, TOUR_FILE_TYPE);
}

/**
 * Ask where a new zip goes with the browser's save dialog. Call it IN the
 * click, before any await: Chromium opens the dialog only within a few
 * seconds of a click, and a dialog asked for after a long build is refused
 * - which a plain download used to paper over (the M4b milestone review
 * #2). The dialog's own call happens before this returns.
 */
export function pickSaveFile(
  win: SavePickerWindow,
  suggestedName: string,
): Promise<SaveFilePick> {
  return pickSaveFileOfType(win, suggestedName, ZIP_FILE_TYPE);
}

/**
 * A file the save dialog gave that nothing will be written into (the open
 * it was asked for failed, or was refused, or its write did not land).
 * It is NEVER deleted (the framework's `releaseUnusedPick` says why).
 * Resolves to one sentence true whether the file was new or a tour the
 * creator chose to replace, null when no file was picked. Never throws.
 */
export function releaseUnusedPick(
  pick: Promise<SaveFilePick> | null,
): Promise<string | null> {
  return releaseUnusedPickSaying(
    pick,
    (name) =>
      `Nothing of the tour was written into ${name}. The browser may have emptied it when it was chosen, so if it was an existing file, do not rely on it.`,
  );
}

/**
 * The in-place target for a file opened through `pickTourFile` with write
 * permission, with the zip's tail check: a sync client's touch (a new
 * time, the same size) is "same" when the end of the zip, its central
 * directory, is. `opened` is the file as read at the open.
 */
export function createSaveTarget(
  handle: WritableFileHandle,
  opened: File,
  options: {
    /** The largest file written over the original: the open cap, so the
     *  file stays one the pages can open (E2b-1 review #2). */
    readonly maxBytes?: number;
  } = {},
): Promise<SaveTarget> {
  return createFileSaveTarget(handle, opened, {
    check: "tail",
    maxBytes: options.maxBytes ?? DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes,
    refusals: { "too-large": TOO_LARGE },
  });
}

/** One tab's hold on a file's name or a draft key (the framework's
 *  `LockHold`). */
export type EditorLock = LockHold;

/**
 * One editing tab per file name (E2b plan review #6): an exclusive Web Lock
 * held until `release` (another tour opened) or until the page goes.
 * `granted: false` when another tab holds it. Without Web Locks, or when
 * the request fails, it grants: there is nothing to coordinate with, and
 * refusing would only stop this tab from saving.
 */
export function holdEditorLock(
  locks: LockManager | undefined,
  fileName: string,
): Promise<EditorLock> {
  return holdLock(locks, fileName, {
    prefix: LOCK_PREFIX,
    withoutLocks: "grant",
  });
}

/**
 * This tab's hold on a tour's DRAFT (M6 E2c, the E2c plan review #6): the
 * draft is keyed by the tour's content (`editor/editor-draft.ts`), the
 * in-place save's lock by the file's name, so each has its own; only the
 * holder writes the draft. Same contract as {@link holdEditorLock}.
 */
export function holdEditorDraftLock(
  locks: LockManager | undefined,
  draftKey: string,
): Promise<EditorLock> {
  return holdLock(locks, `draft/${draftKey}`, {
    prefix: LOCK_PREFIX,
    withoutLocks: "grant",
  });
}
