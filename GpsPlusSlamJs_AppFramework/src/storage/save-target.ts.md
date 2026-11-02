# storage/save-target.ts

## Purpose

Saving a file IN PLACE through the File System Access API, for any app: a
file opened with write permission and written back where it came from,
never over a file something else changed meanwhile; the save dialog for a
new file; and one tab's Web Lock on a name. Moved here from the Tour
Viewer's desktop editor, whose `editor/save-target.ts` now keeps only the
tour's words, its lock family, its accept list and its size cap over these
blocks. Page-free: the caller passes the window and the lock manager.

Deep import: `gps-plus-slam-app-framework/storage/save-target` (not in the
`storage` barrel, which feeds the package root).

## Public API

- `pickWritableFile(win, fileType): Promise<PickOutcome>` -
  `showOpenFilePicker` for one file of `fileType` (a `DownloadFileType`),
  then `requestPermission({ mode: 'readwrite' })`, then the file.
  - `unavailable` - no picker, or one this page may not use (an iframe's
    `SecurityError`, a `TypeError`): the caller uses a file input.
  - `cancelled` - the picker dismissed, or a second one refused while the
    first is open (`NotAllowedError`): no choice, and no second dialog.
    This is the OPEN dialog's rule and differs from the save dialog's on
    purpose: opening a file input in its place would be a second dialog.
  - `unreadable` - `{ reason }`: picked, but gone before its read.
  - `picked` - `{ file, handle, writable }`; `writable` is false for a
    refused, dismissed or failing permission request, or a handle without
    one: the file opens all the same and is saved another way.
- `pickSaveFile(win, suggestedName, fileType): Promise<SaveFilePick>` - the
  save dialog filtered to `fileType`, opened BEFORE the call returns, so
  the caller calls it in the click before any await (Chromium refuses the
  dialog a few seconds after a click). `picked` - `{ handle }`;
  `cancelled` / `unavailable` by `classifyPickerRejection`
  (`picker-errors.ts`): an error named `AbortError` is a dismissal;
  a missing dialog, a synchronous throw or any other rejection is
  `unavailable`, and the caller downloads instead.
- (internal) `pickerFileTypes(fileType)` - the pickers' `types` list
  for one `DownloadFileType`.
- `releaseUnusedPick(pick, say): Promise<string | null>` - a file the save
  dialog gave that nothing will be written into. It is NEVER deleted and
  not read: the browser empties a file as it is chosen in the save dialog
  (the File System Access spec's `showSaveFilePicker`, and Chromium's
  `CreateAndTruncateFile` for `SELECT_SAVEAS_FILE`), so an empty file may
  be a new one or an existing file the user chose to replace. Resolves to
  `say(fileName)`, the caller's sentence (it must be true in both cases);
  null for no pick, a dismissed or an unavailable dialog.
- `isSameFile({ name, handle }, other): Promise<boolean>` - the browser's
  answer (`isSameEntry`) where `handle` gives one, else the same name
  (refusing costs a retry, writing over the file costs it). `handle` is
  null for a file opened without one.
- `createSaveTarget(handle, opened, { check, maxBytes?, refusals? }):
Promise<SaveTarget>` - the baseline (size, modified time, fingerprint)
  is read from `opened` at once.
  - `check: 'tail' | 'hash'` (required): what tells a touched file (a sync
    client's new modified time, same size) from a changed one. `'tail'`
    compares the last `SAME_FILE_TAIL_BYTES` (64 KiB): right for a zip,
    whose central directory at the end names every entry with its
    checksum. `'hash'` compares a SHA-256 of the whole content (`sha256Hex`):
    for JSON or text, whose end says nothing about the rest; it reads the
    whole file at each such check. Another value throws `RangeError`.
  - `maxBytes` - the largest content written over the original; no limit
    by default; negative or NaN throws `RangeError`.
  - `refusals` - the sentences of `InPlaceRefusal`, by kind; each left out
    is `DEFAULT_IN_PLACE_REFUSALS[kind]`.
  - `check()` - `'same'` when size and time match, or when only the time
    differs and the fingerprint matches (the new time is then adopted);
    `'changed'` otherwise; `NotFoundError` is `'gone'`.
  - `write(blob)` - refuses a blob over `maxBytes`, checks again, then
    `writeFileOrAbort`. A refusal throws `InPlaceRefusal` (`kind`:
    `changed`, `gone`, `too-large`) and writes nothing. The baseline moves
    only once the write landed: size and fingerprint from the bytes
    written, the time from the file read back.
  - `isSame(other)` - `isSameFile` for this file.
- `holdLock(locks, key, { prefix, withoutLocks }): Promise<LockHold>` - an
  exclusive Web Lock on `prefix + key`, asked `ifAvailable` (it never
  waits), held until `release()` or the page goes. `granted: false` when
  another holder has it. Without Web Locks, or when the request fails, the
  answer is the caller's policy: `'grant'` (nothing to coordinate with;
  the Tour Viewer's editor) or `'refuse'` (nothing is held; the Tour
  Viewer's recording folders). `released` settles once the hold let go: a
  request for the same name made before that is refused.
- Types: `WritableFileHandle`, `PickerWindow`, `SavePickerWindow`,
  `PickOutcome`, `SaveFilePick`, `SaveTarget`,
  `SaveTargetOptions`, `SameFileCheck`, `InPlaceRefusalKind`, `LockHold`,
  `HoldLockOptions`; the class `InPlaceRefusal(kind, message?)`.

## Invariants & assumptions

- The permission is asked FIRST, while the picker's activation holds.
- The check before a write and the write are not one step: another
  program writing during ours is not caught.
- The baseline's bytes are read at once: a `File` from disk becomes
  unreadable once the file changes.
- Every write goes through `writeFileOrAbort` (`createWritable()` with
  `keepExistingData: false`): Chrome writes a temporary copy and swaps it
  in at `close()`, and a failed write is aborted, leaving the file as it
  was. A file picked in the save dialog is emptied at the pick, before any
  write.
- No words of any app: every sentence a user reads is a default the
  caller can replace (`refusals`, `say`).

## Examples

```ts
import {
  createSaveTarget,
  pickWritableFile,
} from 'gps-plus-slam-app-framework/storage/save-target';

const JSON_FILE = {
  description: 'Pins',
  mimeType: 'application/json',
  extension: '.json',
};
const picked = await pickWritableFile(window, JSON_FILE);
if (picked.kind === 'picked' && picked.writable) {
  const target = await createSaveTarget(picked.handle, picked.file, {
    check: 'hash',
  });
  await target.write(new Blob([JSON.stringify(pins)])); // throws InPlaceRefusal when refused
}
```

## Tests

`save-target.test.ts` on fake handles: the open dialog's filter, its
unavailable and cancelled cases, the permission before the read, the
refusals that still open, an unreadable pick; the save dialog's filter,
its call before it returns, cancelled only by a dismissal; the released
pick's sentence; both checks writing, refusing a changed file, accepting a
touched one, a gone file, a failed write keeping the baseline; the hash
catching a change outside the tail; the size limit with the caller's and
the default sentence, no limit by default, bad options; `isSameFile`;
`holdLock` with its prefix, release and both policies.
`save-target.property.test.ts`: for any content, any edit and either check,
`check()` is `'same'` exactly when what the check reads is unchanged.
The Tour Viewer's `editor/save-target.test.ts` pins the tour's use of
these blocks, and its `editor.spec.js` writes a real file through them.
