/**
 * The desktop editor's in-place save (M6 E2b-1): a tour file opened through
 * the browser's file picker with write permission, written back where it
 * came from. Page-free: the page passes the window and the lock manager.
 *
 * @see save-target.ts.md
 */

import {
  DEFAULT_ARCHIVE_LIMITS,
  writeFileOrAbort,
} from "gps-plus-slam-app-framework/storage";
import { hasFilePicker } from "../file-picker.js";

/** The tail of the file a sync client's touch leaves alone: compared when
 *  only the modified time differs, so a touched file is not "changed". */
const TAIL_BYTES = 64 * 1024;

/** The lock names' family: a sibling of the recordings'
 *  (`gps-plus-slam/tour-viewer/`), so their housekeeping never lists it. */
const LOCK_PREFIX = "gps-plus-slam/tour-viewer-editor/";

/** A picked file's handle, with the permission calls Chromium has and the
 *  DOM typings do not carry yet. */
export type WritableFileHandle = FileSystemFileHandle & {
  requestPermission?: (descriptor: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

/** The part of `window` the picker needs. */
export interface PickerWindow {
  showOpenFilePicker?: (options: {
    types: { description: string; accept: Record<string, string[]> }[];
    multiple: false;
  }) => Promise<WritableFileHandle[]>;
}

export type PickOutcome =
  | { readonly kind: "unavailable" }
  | { readonly kind: "cancelled" }
  /** Picked, but gone before it could be read (moved, deleted, a volume
   *  unmounted, PR #614 review). */
  | { readonly kind: "unreadable"; readonly reason: string }
  | {
      readonly kind: "picked";
      readonly file: File;
      readonly handle: WritableFileHandle;
      /** Write permission was granted: the file can be saved in place. */
      readonly writable: boolean;
    };

/** The part of `navigator` the adoption check reads. */
export interface PlatformNavigator {
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
}

/** Whether the browser runs on Android: its client hints where it gives
 *  them, else its user agent. */
function onAndroid(nav: PlatformNavigator): boolean {
  const platform = nav.userAgentData?.platform;
  if (typeof platform === "string" && platform !== "") {
    return platform === "Android";
  }
  return /\bAndroid\b/i.test(nav.userAgent ?? "");
}

/**
 * Whether the first Save of a tour without a file (a link, the sample, a
 * drop, the file input) asks for a file with the save dialog in its click
 * and then ADOPTS it - saved into in place, and by itself, as a file opened
 * with "Choose..." is. Where the browser has both file dialogs, but not on
 * Android: no feature check can tell whether a picked file there can be
 * created under a new name and rewritten without a cut-short write leaving
 * half a tour (its files are content URIs, with no replace in one step),
 * so Android keeps today's Save as a copy until a check on a phone says
 * otherwise.
 */
export function adoptsSavedFile(
  win: PickerWindow & SavePickerWindow,
  nav: PlatformNavigator,
): boolean {
  return (
    hasFilePicker(win) &&
    typeof win.showSaveFilePicker === "function" &&
    !onAndroid(nav)
  );
}

/**
 * The open dialog's fine print about Save, true for this browser (tour
 * editor plan 2026-10-17-1816, W2): where the file picker exists, a chosen
 * file is written in place (and saved by itself after a change); a tour
 * from a link or the sample is saved where the first Save's dialog puts it
 * and into that file from then on where the browser adopts it
 * (`adoptsSavedFile`), else as a new copy; without the picker, Save
 * downloads a new copy. It opens with what leaves the computer: nothing of
 * the tour, but the map comes from OpenStreetMap (W6: "nothing is
 * uploaded" hid the tiles).
 */
export function saveFinePrint(
  win: PickerWindow & SavePickerWindow,
  nav: PlatformNavigator = {},
): string {
  const stays =
    "The tour file stays on this computer. The map comes from OpenStreetMap.";
  const chosen = `${stays} A file you choose is saved into that file, where the browser allows it, and by itself a few seconds after each change.`;
  if (adoptsSavedFile(win, nav)) {
    return `${chosen} A tour opened from a link, or the sample, asks where to save it at its first Save, and is saved into that file from then on.`;
  }
  return hasFilePicker(win)
    ? `${chosen} A tour opened from a link, or the sample, is saved as a new copy to put in place of the old one.`
    : `${stays} Save gives you a new copy of the tour to put in place of the old one.`;
}

/**
 * Let the creator pick a tour zip, and ask to write it on the same gesture.
 * The permission is asked FIRST, before any read of the file, while the
 * picker's activation still holds (E2b plan review #8). `unavailable` is a
 * browser without the picker, or one that refuses it (an iframe): the page
 * then uses its file input.
 */
export async function pickTourFile(win: PickerWindow): Promise<PickOutcome> {
  const picker = win.showOpenFilePicker;
  if (typeof picker !== "function") return { kind: "unavailable" };
  let handles: WritableFileHandle[];
  try {
    handles = await picker.call(win, {
      types: [
        {
          description: "Tour file",
          accept: { "application/zip": [".zip"] },
        },
      ],
      multiple: false,
    });
  } catch (err) {
    // Only a picker this page may not use (an iframe's SecurityError, a
    // TypeError) falls back to the file input. Anything else - a dismissed
    // picker, or a second one refused while the first is open
    // (NotAllowedError) - is no choice, and no second dialog (E2b-1 review
    // #5).
    if (
      err instanceof TypeError ||
      (err instanceof DOMException && err.name === "SecurityError")
    ) {
      return { kind: "unavailable" };
    }
    return { kind: "cancelled" };
  }
  const handle = handles[0];
  if (handle === undefined) return { kind: "cancelled" };
  const writable = await askToWrite(handle);
  try {
    return { kind: "picked", file: await handle.getFile(), handle, writable };
  } catch (err) {
    return {
      kind: "unreadable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The part of `window` the save dialog needs. */
export interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
}

export type SaveFilePick =
  | { readonly kind: "picked"; readonly handle: FileSystemFileHandle }
  /** The creator dismissed the dialog: nothing is to be written. */
  | { readonly kind: "cancelled" }
  /** No save dialog here, or the browser refused one (no click to open it
   *  on, an iframe): the caller downloads instead. */
  | { readonly kind: "unavailable" };

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
  const picker = win.showSaveFilePicker;
  if (typeof picker !== "function") {
    return Promise.resolve({ kind: "unavailable" });
  }
  let asked: Promise<FileSystemFileHandle>;
  try {
    asked = picker.call(win, {
      suggestedName,
      types: [
        { description: "ZIP Archive", accept: { "application/zip": [".zip"] } },
      ],
    });
  } catch {
    return Promise.resolve({ kind: "unavailable" });
  }
  return asked.then(
    (handle): SaveFilePick => ({ kind: "picked", handle }),
    (err: unknown): SaveFilePick =>
      err instanceof DOMException && err.name === "AbortError"
        ? { kind: "cancelled" }
        : { kind: "unavailable" },
  );
}

async function askToWrite(handle: WritableFileHandle): Promise<boolean> {
  if (typeof handle.requestPermission !== "function") return false;
  try {
    return (
      (await handle.requestPermission({ mode: "readwrite" })) === "granted"
    );
  } catch {
    return false;
  }
}

/** Why an in-place write was refused: the file on disk is not the one this
 *  page last opened or wrote, or the tour grew past what may be opened. */
export class InPlaceRefusal extends Error {
  constructor(readonly kind: "changed" | "gone" | "too-large") {
    super(
      kind === "gone"
        ? "The file was moved, renamed or deleted since it was opened."
        : kind === "too-large"
          ? "The saved tour would be larger than a tour may be, so it was not written over the file."
          : "The file changed on disk since it was opened.",
    );
    this.name = "InPlaceRefusal";
  }
}

/**
 * Whether `other` is the file `opened` names: the browser's answer
 * (`isSameEntry`) where a handle can give one, else the same name -
 * refusing a target costs a retry, writing over the tour costs the tour
 * (the M4b fix re-review #1). `handle` is null for a file opened without
 * one (the file input, a drop, a link).
 */
export async function isSameFile(
  opened: { readonly name: string; readonly handle: FileSystemHandle | null },
  other: FileSystemHandle,
): Promise<boolean> {
  const { handle } = opened;
  try {
    if (handle !== null && typeof handle.isSameEntry === "function") {
      return await handle.isSameEntry(other);
    }
  } catch {
    // Unknown: decided by the name below.
  }
  return other.name === opened.name;
}

export interface SaveTarget {
  /** The file's name, as the picker gave it. */
  readonly name: string;
  /** Whether the file on disk is still the one opened or last written. */
  check(): Promise<"same" | "changed" | "gone">;
  /**
   * Write `blob` over the file - unless it changed meanwhile or is larger
   * than a tour may be, which throws `InPlaceRefusal` and writes nothing.
   * Resolves once the write landed.
   */
  write(blob: Blob): Promise<void>;
  /**
   * Whether `other` is this very file (`isSameEntry`) - asked before the
   * walk's zip is written into a file the save dialog gave (the M4b fix
   * re-review #1: written over the tour, it left the tour nowhere). Where
   * the browser cannot tell, the same name counts as the same file.
   */
  isSame(other: FileSystemHandle): Promise<boolean>;
}

interface Baseline {
  readonly size: number;
  readonly lastModified: number;
  readonly tail: Uint8Array;
}

async function tailOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(
    await blob.slice(Math.max(0, blob.size - TAIL_BYTES)).arrayBuffer(),
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The in-place target for a file opened through `pickTourFile` with write
 * permission. `opened` is the file as read at the open: its size, time and
 * tail are the baseline, read NOW - a `File` from disk becomes unreadable
 * once the file changes.
 */
export async function createSaveTarget(
  handle: WritableFileHandle,
  opened: File,
  options: {
    /** The largest file written over the original: the open cap, so the
     *  file stays one the pages can open (E2b-1 review #2). */
    readonly maxBytes?: number;
  } = {},
): Promise<SaveTarget> {
  const maxBytes = options.maxBytes ?? DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes;
  let base: Baseline = {
    size: opened.size,
    lastModified: opened.lastModified,
    tail: await tailOf(opened),
  };
  async function check(): Promise<"same" | "changed" | "gone"> {
    let now: File;
    try {
      now = await handle.getFile();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        return "gone";
      }
      throw err;
    }
    if (now.size !== base.size) return "changed";
    if (now.lastModified === base.lastModified) return "same";
    // Only the time differs: a sync client may touch a file it uploaded.
    // The same end of the zip (its central directory) is the same file.
    if (!sameBytes(await tailOf(now), base.tail)) return "changed";
    base = { ...base, lastModified: now.lastModified };
    return "same";
  }
  return {
    name: handle.name,
    check,
    isSame: (other) => isSameFile({ name: handle.name, handle }, other),
    async write(blob) {
      // The rebuild stores entries uncompressed, so a deflated tour grows.
      if (blob.size > maxBytes) throw new InPlaceRefusal("too-large");
      // Checked again right before the write: the build may have taken
      // seconds. Another program writing DURING our write is not caught;
      // the check and the write are not one step.
      const state = await check();
      if (state !== "same") throw new InPlaceRefusal(state);
      await writeFileOrAbort(handle, blob);
      const written = await handle.getFile();
      // The baseline moves only once the write landed. Its size and tail
      // are the bytes written (one source, so they describe one file); its
      // time is the file's, which only a read gives.
      base = {
        size: blob.size,
        lastModified: written.lastModified,
        tail: await tailOf(blob),
      };
    },
  };
}

/**
 * One editing tab per file name (E2b plan review #6): an exclusive Web Lock
 * held until `release` (another tour opened) or until the page goes.
 * `granted: false` when another tab holds it. Without Web Locks, or when
 * the request fails, it grants: there is nothing to coordinate with, and
 * refusing would only stop this tab from saving.
 */
/** One tab's hold on a file's name. */
export interface EditorLock {
  readonly granted: boolean;
  release(): void;
  /** Settles once the hold has let go - a new request for the same name
   *  made before that is refused (E2b-1 review #3). */
  readonly released: Promise<void>;
}

export function holdEditorLock(
  locks: LockManager | undefined,
  fileName: string,
): Promise<EditorLock> {
  return holdLock(locks, `${LOCK_PREFIX}${fileName}`);
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
  return holdLock(locks, `${LOCK_PREFIX}draft/${draftKey}`);
}

function holdLock(
  locks: LockManager | undefined,
  name: string,
): Promise<EditorLock> {
  const free: EditorLock = {
    granted: true,
    release: () => undefined,
    released: Promise.resolve(),
  };
  if (locks === undefined) return Promise.resolve(free);
  return new Promise((resolve) => {
    let markReleased: () => void = () => undefined;
    const released = new Promise<void>((settle) => {
      markReleased = settle;
    });
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve({
            granted: false,
            release: () => undefined,
            released: Promise.resolve(),
          });
          return undefined;
        }
        return new Promise<void>((done) => {
          resolve({ granted: true, release: () => done(), released });
        });
      })
      .then(
        () => {
          markReleased();
        },
        () => {
          markReleased();
          resolve(free);
        },
      );
  });
}
