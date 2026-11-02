# editor/save-target.ts

## Purpose

The desktop editor's in-place save (M6 E2b-1): a tour zip picked through
the browser's file picker with write permission, written back over itself,
never over a file something else changed. The mechanism is the framework's
`gps-plus-slam-app-framework/storage/save-target` (moved there from this
file so other apps can save in place; its sidecar holds the rules of the
pickers, the same-file check, the write and the lock). This module keeps
what is the tour's: its words, its lock family, its accept list, its size
cap and the zip's tail check. Page-free: the page passes the window and
the lock manager. Design: the M6 design doc §9, "E2b - the build plan,
re-cut" and its cold review
(`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`);
the move: `GpsPlusSlamJs_Docs/docs/2026-10-27-1850-editor-on-the-full-globe-plan.md`.

## Public API

- `pickTourFile(win): Promise<PickOutcome>` - the framework's
  `pickWritableFile` for one `.zip` ("Tour file"): the permission asked
  before the read (E2b plan review #8); `unavailable` (no picker, an
  iframe's `SecurityError`, a `TypeError`: the page uses its file input);
  `cancelled` (dismissed, or a second picker refused while one is open,
  `NotAllowedError`: no second dialog, E2b-1 review #5); `unreadable`
  (picked, but gone before its read, PR #614 review); `picked` with
  `writable` false for a refused permission: the tour opens all the same
  and saves as a download.
- `pickSaveFile(win, suggestedName): Promise<SaveFilePick>` - the
  framework's save dialog for a new `.zip` ("ZIP Archive"), opened BEFORE
  the call returns: the caller calls it in the click (the M4b milestone
  review #2). `cancelled` only for a dismissal (an error named
  `AbortError`, the framework's `classifyPickerRejection`); `unavailable`
  for no dialog or any other refusal: the caller downloads instead.
- `releaseUnusedPick(pick): Promise<string | null>` - the framework's, with
  the tour's sentence: "Nothing of the tour was written into <name>. The
  browser may have emptied it when it was chosen, so if it was an existing
  file, do not rely on it." A picked file is never deleted or read: the
  browser empties it as it is chosen (the framework's sidecar cites the
  spec and Chromium); the e2e seeds the file and asserts it is neither
  written nor deleted.
- `createSaveTarget(handle, opened, { maxBytes? }): Promise<SaveTarget>` -
  the framework's with the `"tail"` check (the last 64 KiB, a zip's central
  directory: a sync client's touch is "same"), `maxBytes` defaulting to the
  open cap (`DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes`; the rebuild stores
  entries uncompressed, so a deflated tour grows, and past the cap it would
  open nowhere, E2b-1 review #2), and the tour's sentence for the cap: "The
  saved tour would be larger than a tour may be, so it was not written over
  the file." `check()`, `write(blob)` and `isSame(other)` are the
  framework's (writes through `writeFileOrAbort`; `InPlaceRefusal` with
  `kind` `changed`, `gone`, `too-large`).
- `holdEditorLock(locks, fileName)` - an `EditorLock` (the framework's
  `LockHold`: `granted`, `release`, `released`) on
  `gps-plus-slam/tour-viewer-editor/<name>`, through `holdLock` with
  `withoutLocks: "grant"`. `released` settles once the hold let go: the
  page waits for it before opening the same file again (E2b-1 review #3).
- `holdEditorDraftLock(locks, draftKey)` (M6 E2c) - the same hold on
  `gps-plus-slam/tour-viewer-editor/draft/<key>` (E2c plan review #6).
- `adoptsSavedFile(win): boolean` - whether a tour without a file asks for
  one with the save dialog (as it opens from a link or the sample, else at
  its first Save) and then keeps saving into it: wherever both file
  dialogs exist, Android included. Android was held back until a check on
  a phone (Chrome 155, Android 10, the file-access check page) measured
  it: a file saved under a new name, the handle kept across a reload (one
  tap grants the permission again), and a 200 MiB rewrite cut at 185 MiB
  by closing the tab leaving the old file whole. Not measured: a browser
  killed in the middle of a write.
- `saveFinePrint(win)` (W2 of the tour editor plan 2026-10-17-1816) - the
  open dialog's fine print about Save, true for this browser: where
  `showOpenFilePicker` exists (the framework's `storage/file-picker`, the
  check the setup page's line about the editor uses too), a chosen file is
  saved into itself (and by itself after a change) while a tour from a
  link or the sample asks for its file as it opens (or at its first Save)
  and is saved into it where `adoptsSavedFile`, else as a new copy;
  elsewhere Save gives a new copy. It opens with what leaves the computer
  (W6): the tour file stays, the map comes from OpenStreetMap.
- Re-exported from the framework: `InPlaceRefusal`, `isSameFile`, and the
  types `WritableFileHandle`, `PickerWindow`, `SavePickerWindow`,
  `PickOutcome`, `SaveFilePick`, `SaveTarget`; `EditorLock` is
  `LockHold`.

## Invariants & assumptions

- The lock's prefix is a sibling of the recordings'
  (`gps-plus-slam/tour-viewer/`, `recording-folders.ts`), so their
  housekeeping never counts it. Keyed by the file's NAME: two different
  files of one name in two tabs collide, and the second tab is told and may
  edit anyway. Without Web Locks, or when the request fails, it grants
  (nothing to coordinate with; refusing would only stop saving).
- The tail check is right for a zip only; the framework's `"hash"` check
  is for content whose end says nothing about the rest.

## Examples

```ts
const picked = await pickTourFile(window as unknown as PickerWindow);
if (picked.kind === "picked" && picked.writable) {
  const target = await createSaveTarget(picked.handle, picked.file);
  await target.write(rebuilt); // throws InPlaceRefusal when refused
}
```

## Tests

`save-target.test.ts` on fake handles, unchanged across the move to the
framework (its proof): the permission before the read, the refusals that
still open, the write and its own baseline, a changed file refused and not
written, a touched file accepted, a gone file, a failed write keeping the
baseline, the cap's sentence, and the lock (granted, refused, released,
without Web Locks); the save dialog opened before `pickSaveFile` returns,
its zip filter, cancelled only by a dismissal, unavailable without one or
on any other refusal; `isSame` and `isSameFile`; `adoptsSavedFile` and the
fine print's words; `releaseUnusedPick`'s sentence and its never removing a
picked file. The framework's own tests cover the blocks for any app. The
page's e2e (`playwright-tests/editor.spec.js`) writes a real
origin-private file through it.
