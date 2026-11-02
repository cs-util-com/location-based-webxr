/**
 * Saving a file IN PLACE through the File System Access API: a file
 * opened with write permission, written back where it came from - never
 * over a file something else changed meanwhile - plus the save dialog for
 * a new file and one tab's Web Lock on a name. Page-free: the caller
 * passes the window and the lock manager, and every sentence a user reads
 * may come from the caller.
 *
 * @see save-target.ts.md
 */

import { bytesToHex, sha256Hex } from '../utils/sha256-hex.js';
import { classifyPickerRejection } from './picker-errors.js';
import { writeFileOrAbort } from './write-file-or-abort.js';
import type { DownloadFileType } from './zip-export.js';

/** The tail compared by the `"tail"` check: 64 KiB, which holds a zip's
 *  central directory for any archive a page writes. */
export const SAME_FILE_TAIL_BYTES = 64 * 1024;

/**
 * How a file whose modified time changed while its size did not is told
 * apart from a changed one (a sync client may touch a file it uploaded):
 * - `"tail"` - the last {@link SAME_FILE_TAIL_BYTES} bytes are compared.
 *   For a zip, whose central directory at the end names every entry with
 *   its checksum, the same tail is the same archive.
 * - `"hash"` - a SHA-256 of the whole content is compared. For anything
 *   whose end says nothing about the rest (JSON, text). Costs a full read
 *   of the file at every such check.
 */
export type SameFileCheck = 'tail' | 'hash';

/** A picked file's handle, with the permission calls Chromium has and the
 *  DOM typings do not carry yet. */
export type WritableFileHandle = FileSystemFileHandle & {
  requestPermission?: (descriptor: {
    mode: 'read' | 'readwrite';
  }) => Promise<PermissionState>;
};

/** The `types` list of a File System Access picker. */
type PickerFileTypes = {
  description: string;
  accept: Record<string, string[]>;
}[];

/** The part of `window` the open dialog needs. */
export interface PickerWindow {
  showOpenFilePicker?: (options: {
    types: PickerFileTypes;
    multiple: false;
  }) => Promise<WritableFileHandle[]>;
}

/** The part of `window` the save dialog needs. */
export interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: PickerFileTypes;
  }) => Promise<FileSystemFileHandle>;
}

/** A picker's type filter for one kind of file. */
function pickerFileTypes(fileType: DownloadFileType): PickerFileTypes {
  return [
    {
      description: fileType.description,
      accept: { [fileType.mimeType]: [fileType.extension] },
    },
  ];
}

export type PickOutcome =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'cancelled' }
  /** Picked, but gone before it could be read (moved, deleted, a volume
   *  unmounted). */
  | { readonly kind: 'unreadable'; readonly reason: string }
  | {
      readonly kind: 'picked';
      readonly file: File;
      readonly handle: WritableFileHandle;
      /** Write permission was granted: the file can be saved in place. */
      readonly writable: boolean;
    };

/**
 * Let the user pick one file of `fileType`, and ask to write it on the
 * same gesture. The permission is asked FIRST, before any read of the
 * file, while the picker's activation still holds. `unavailable` is a
 * browser without the picker, or one this page may not use (an iframe's
 * `SecurityError`, a `TypeError`): the caller then uses a file input.
 * Any other rejection - a dismissed picker, or a second one refused while
 * the first is open (`NotAllowedError`) - is `cancelled`: no choice, and
 * no second dialog. Note that this differs from the save dialog's rule
 * ({@link pickSaveFile}), where a refusal lets the caller download.
 */
export async function pickWritableFile(
  win: PickerWindow,
  fileType: DownloadFileType
): Promise<PickOutcome> {
  const picker = win.showOpenFilePicker;
  if (typeof picker !== 'function') return { kind: 'unavailable' };
  let handles: WritableFileHandle[];
  try {
    handles = await picker.call(win, {
      types: pickerFileTypes(fileType),
      multiple: false,
    });
  } catch (err) {
    if (
      err instanceof TypeError ||
      (err instanceof DOMException && err.name === 'SecurityError')
    ) {
      return { kind: 'unavailable' };
    }
    return { kind: 'cancelled' };
  }
  const handle = handles[0];
  if (handle === undefined) return { kind: 'cancelled' };
  const writable = await askToWrite(handle);
  try {
    return { kind: 'picked', file: await handle.getFile(), handle, writable };
  } catch (err) {
    return {
      kind: 'unreadable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SaveFilePick =
  | { readonly kind: 'picked'; readonly handle: FileSystemFileHandle }
  /** The user dismissed the dialog: nothing is to be written. */
  | { readonly kind: 'cancelled' }
  /** No save dialog here, or the browser refused one (no click to open it
   *  on, an iframe): the caller downloads instead. */
  | { readonly kind: 'unavailable' };

/**
 * Ask where a new file goes with the browser's save dialog, filtered to
 * `fileType`. Call it IN the click, before any await: Chromium opens the
 * dialog only within a few seconds of a click, and a dialog asked for
 * after a long build is refused. The dialog's own call happens before this
 * returns. The rejection is read by {@link classifyPickerRejection}.
 */
export function pickSaveFile(
  win: SavePickerWindow,
  suggestedName: string,
  fileType: DownloadFileType
): Promise<SaveFilePick> {
  const picker = win.showSaveFilePicker;
  if (typeof picker !== 'function') {
    return Promise.resolve({ kind: 'unavailable' });
  }
  let asked: Promise<FileSystemFileHandle>;
  try {
    asked = picker.call(win, {
      suggestedName,
      types: pickerFileTypes(fileType),
    });
  } catch (err) {
    return Promise.resolve({ kind: classifyPickerRejection(err) });
  }
  return asked.then(
    (handle): SaveFilePick => ({ kind: 'picked', handle }),
    (err: unknown): SaveFilePick => ({ kind: classifyPickerRejection(err) })
  );
}

/**
 * A file the save dialog gave that nothing will be written into (the work
 * it was asked for failed, or was refused, or its write did not land). It
 * is NEVER deleted: the browser empties a chosen file as the dialog
 * returns (the spec, and Chromium), so an empty file may be a new one or
 * an existing file the user chose to replace - and the page cannot tell
 * which. Resolves to `say(name)`, the caller's sentence (it must be true
 * in both cases), or null when no file was picked. Never throws, unless
 * `say` does.
 */
export async function releaseUnusedPick(
  pick: Promise<SaveFilePick> | null,
  say: (fileName: string) => string
): Promise<string | null> {
  const picked = await pick;
  if (picked?.kind !== 'picked') return null;
  return say(picked.handle.name);
}

async function askToWrite(handle: WritableFileHandle): Promise<boolean> {
  if (typeof handle.requestPermission !== 'function') return false;
  try {
    return (
      (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
    );
  } catch {
    return false;
  }
}

export type InPlaceRefusalKind = 'changed' | 'gone' | 'too-large';

/** The sentences used when the caller gives none. */
export const DEFAULT_IN_PLACE_REFUSALS: Readonly<
  Record<InPlaceRefusalKind, string>
> = {
  changed: 'The file changed on disk since it was opened.',
  gone: 'The file was moved, renamed or deleted since it was opened.',
  'too-large':
    'The file would be larger than allowed, so it was not written over the original.',
};

/** Why an in-place write was refused: the file on disk is not the one this
 *  page last opened or wrote, or the new content is over the size limit. */
export class InPlaceRefusal extends Error {
  readonly kind: InPlaceRefusalKind;

  constructor(kind: InPlaceRefusalKind, message?: string) {
    super(message ?? DEFAULT_IN_PLACE_REFUSALS[kind]);
    this.kind = kind;
    this.name = 'InPlaceRefusal';
  }
}

/**
 * Whether `other` is the file `opened` names: the browser's answer
 * (`isSameEntry`) where a handle can give one, else the same name -
 * refusing a target costs a retry, writing over the file costs the file.
 * `handle` is null for a file opened without one (a file input, a drop,
 * a link).
 */
export async function isSameFile(
  opened: { readonly name: string; readonly handle: FileSystemHandle | null },
  other: FileSystemHandle
): Promise<boolean> {
  const { handle } = opened;
  try {
    if (handle !== null && typeof handle.isSameEntry === 'function') {
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
  check(): Promise<'same' | 'changed' | 'gone'>;
  /**
   * Write `blob` over the file - unless it changed meanwhile or is larger
   * than `maxBytes`, which throws `InPlaceRefusal` and writes nothing.
   * Resolves once the write landed.
   */
  write(blob: Blob): Promise<void>;
  /**
   * Whether `other` is this very file (`isSameEntry`), asked before
   * something else is written into a file the save dialog gave. Where the
   * browser cannot tell, the same name counts as the same file.
   */
  isSame(other: FileSystemHandle): Promise<boolean>;
}

export interface SaveTargetOptions {
  /** How a touched file is told apart from a changed one. */
  readonly check: SameFileCheck;
  /** The largest content written over the original; no limit by default. */
  readonly maxBytes?: number;
  /** The refusals' sentences, by kind; the defaults where left out. */
  readonly refusals?: Partial<Readonly<Record<InPlaceRefusalKind, string>>>;
}

interface Baseline {
  readonly size: number;
  readonly lastModified: number;
  readonly fingerprint: string;
}

async function fingerprintOf(
  blob: Blob,
  check: SameFileCheck
): Promise<string> {
  if (check === 'hash') {
    return sha256Hex(new Uint8Array(await blob.arrayBuffer()));
  }
  return bytesToHex(
    new Uint8Array(
      await blob
        .slice(Math.max(0, blob.size - SAME_FILE_TAIL_BYTES))
        .arrayBuffer()
    )
  );
}

/**
 * The in-place target for a file opened with write permission
 * ({@link pickWritableFile}). `opened` is the file as read at the open: its
 * size, time and fingerprint are the baseline, read NOW - a `File` from
 * disk becomes unreadable once the file changes.
 */
export async function createSaveTarget(
  handle: WritableFileHandle,
  opened: File,
  options: SaveTargetOptions
): Promise<SaveTarget> {
  const { check: how } = options;
  if (how !== 'tail' && how !== 'hash') {
    throw new RangeError(`unknown same-file check: ${String(how)}`);
  }
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  if (Number.isNaN(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative number');
  }
  const refuse = (kind: InPlaceRefusalKind): InPlaceRefusal =>
    new InPlaceRefusal(kind, options.refusals?.[kind]);
  let base: Baseline = {
    size: opened.size,
    lastModified: opened.lastModified,
    fingerprint: await fingerprintOf(opened, how),
  };
  async function check(): Promise<'same' | 'changed' | 'gone'> {
    let now: File;
    try {
      now = await handle.getFile();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return 'gone';
      }
      throw err;
    }
    if (now.size !== base.size) return 'changed';
    if (now.lastModified === base.lastModified) return 'same';
    // Only the time differs: a sync client may touch a file it uploaded.
    if ((await fingerprintOf(now, how)) !== base.fingerprint) return 'changed';
    base = { ...base, lastModified: now.lastModified };
    return 'same';
  }
  return {
    name: handle.name,
    check,
    isSame: (other) => isSameFile({ name: handle.name, handle }, other),
    async write(blob) {
      if (blob.size > maxBytes) throw refuse('too-large');
      // Checked again right before the write: building the content may
      // have taken seconds. Another program writing DURING our write is
      // not caught; the check and the write are not one step.
      const state = await check();
      if (state !== 'same') throw refuse(state);
      await writeFileOrAbort(handle, blob);
      const written = await handle.getFile();
      // The baseline moves only once the write landed. Its size and
      // fingerprint are the bytes written (one source, so they describe
      // one file); its time is the file's, which only a read gives.
      base = {
        size: blob.size,
        lastModified: written.lastModified,
        fingerprint: await fingerprintOf(blob, how),
      };
    },
  };
}

/** One tab's hold on a name. */
export interface LockHold {
  readonly granted: boolean;
  release(): void;
  /** Settles once the hold has let go - a new request for the same name
   *  made before that is refused. */
  readonly released: Promise<void>;
}

export interface HoldLockOptions {
  /** The lock names' family, prepended to the key: the caller's, so two
   *  apps' locks never meet and each one's housekeeping can list its own. */
  readonly prefix: string;
  /**
   * What a browser without Web Locks, or a request that fails, gives:
   * `"grant"` - there is nothing to coordinate with, and refusing would
   * only stop this tab; `"refuse"` - nothing is held, so the caller must
   * not act as if it were.
   */
  readonly withoutLocks: 'grant' | 'refuse';
}

/**
 * An exclusive Web Lock on `prefix + key`, asked `ifAvailable` (it never
 * waits), held until `release` or until the page goes. `granted: false`
 * when another tab or page holds it; without Web Locks, or when the
 * request fails, the answer is `options.withoutLocks`.
 */
export function holdLock(
  locks: Pick<LockManager, 'request'> | undefined,
  key: string,
  options: HoldLockOptions
): Promise<LockHold> {
  const fallback: LockHold = {
    granted: options.withoutLocks === 'grant',
    release: () => undefined,
    released: Promise.resolve(),
  };
  if (locks === undefined) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    let markReleased: () => void = () => undefined;
    const released = new Promise<void>((settle) => {
      markReleased = settle;
    });
    locks
      .request(`${options.prefix}${key}`, { ifAvailable: true }, (lock) => {
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
          resolve(fallback);
        }
      );
  });
}
