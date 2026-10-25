# editor/save-target.ts

## Purpose

The desktop editor's in-place save (M6 E2b-1): a tour zip picked through
the browser's file picker with write permission, written back over itself,
never over a file something else changed. Page-free: the page passes the
window and the lock manager. Design: the M6 design doc §9, "E2b - the
build plan, re-cut" and its cold review
(`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`).

## Public API

- `pickTourFile(win): Promise<PickOutcome>` - `showOpenFilePicker` for one
  `.zip`, then `requestPermission({ mode: "readwrite" })`, then the file.
  - `unavailable` - no picker, or one this page may not use (an iframe's
    `SecurityError`, a `TypeError`): the page uses its file input.
  - `cancelled` - the picker dismissed, or a second one refused while the
    first is open (`NotAllowedError`): no choice, and no second dialog
    (E2b-1 review #5).
  - `unreadable` - `{ reason }`: picked, but gone before its read (moved,
    deleted, a volume unmounted, PR #614 review); the page says so.
  - `picked` - `{ file, handle, writable }`; `writable` is false for a
    refused, dismissed or failing permission request, or a handle without
    one: the tour opens all the same and saves as a download.
- `SaveTarget.isSame(other)` - whether `other` is this very file
  (`isSameEntry`); where the browser cannot tell (no `isSameEntry`, or it
  throws), the same name counts as the same file: refusing a move costs a
  retry, writing the walk over the tour costs the tour (the M4b fix
  re-review #1). The rule itself is `isSameFile`.
- `isSameFile({ name, handle }, other): Promise<boolean>` - the same
  question for any opened file: the browser's answer where `handle` (null
  for a file opened without one: the file input, a drop, a link) gives
  one, else the same name. "Save the debug data" asks it of the opened
  tour file (r901 review #5).
- `pickSaveFile(win, suggestedName): Promise<SaveFilePick>` - the
  browser's save dialog (`showSaveFilePicker`) for a new `.zip`, opened
  BEFORE the call returns: the caller calls it in the click, before any
  await (Chromium refuses the dialog a few seconds after a click; the M4b
  milestone review #2). `picked` - `{ handle }`; `cancelled` - only a
  dismissal (`AbortError`): nothing is to be written; `unavailable` - no
  dialog, or any other refusal (`SecurityError`, `NotAllowedError`, a
  thrown `TypeError`): the caller downloads instead and asks again before
  it relies on the download. `SavePickerWindow` is the part of `window`
  it reads.
- `createSaveTarget(handle, opened, { maxBytes? }): Promise<SaveTarget>` -
  the baseline (size, modified time, the last 64 KiB) is read from `opened`
  at once; `maxBytes` defaults to the open cap
  (`DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes`).
  - `check()` - `"same"` when size and time match; a new time with the same
    size and the same tail (a sync client's touch) is `"same"` too, and the
    new time is adopted; another size, or another tail, is `"changed"`;
    `NotFoundError` (moved, renamed, deleted) is `"gone"`.
  - `write(blob)` - refuses a blob over `maxBytes` (the rebuild stores
    entries uncompressed, so a deflated tour grows; written over the
    original past the cap it would open nowhere, E2b-1 review #2), checks
    again, then `writeFileOrAbort`. A refusal throws `InPlaceRefusal`
    (`kind`: `changed`, `gone`, `too-large`) and writes nothing; the
    baseline moves only once the write landed: its size and tail from the
    bytes written (one source, so a lagging read back cannot make the next
    check say "changed"), its modified time from the file read back.
- `holdEditorLock(locks, fileName)` - an `EditorLock` (`granted`,
  `release`, `released`): an exclusive Web Lock
  `gps-plus-slam/tour-viewer-editor/<name>`, `ifAvailable`, held until `release` or the page goes. `released` settles
  once the hold has let go: the same name asked before that is refused, so
  the page waits for it before opening the same file again (E2b-1 review
  #3).
- `holdEditorDraftLock(locks, draftKey)` (M6 E2c) - the same hold on a
  tour's DRAFT key, `gps-plus-slam/tour-viewer-editor/draft/<key>`: the
  draft is keyed by content (`editor-draft.ts`), the in-place save by the
  file's name, so each has its own lock (E2c plan review #6).
- `InPlaceRefusal`, `EditorLock`, `WritableFileHandle`, `PickerWindow`, `PickOutcome`,
  `SaveTarget`.

- `adoptsSavedFile(win, nav): boolean` - whether the first Save of a
  tour without a file asks for one with the save dialog and then keeps
  saving into it (the page's `askSaveFile`): both file dialogs exist
  and the browser is not on Android. Android is told by its client hints
  (`userAgentData.platform`) where it gives them, else by its user agent.
  No feature check can tell what decides it there: a picked file is a
  content URI with no replace in one step, so whether a rewrite can be
  cut short by a closed tab, and whether access survives a reload, needs
  a check on a phone; until then Android keeps the copy.
- `saveFinePrint(win, nav = {})` (W2 of the tour editor plan 2026-10-17-1816) - the
  open dialog's fine print about Save, true for this browser: where
  `showOpenFilePicker` exists (`../file-picker.ts`, the check the setup
  page's line about the editor uses too), a chosen file is saved into itself (and by
  itself after a change) while a tour from a link or the sample is saved
  into the file its first Save asks for where `adoptsSavedFile`, else as
  a new copy; elsewhere Save gives a new copy. It opens with what leaves
  the computer (W6): the tour file stays, the map comes from
  OpenStreetMap (it said "nothing is uploaded", which hid the tiles).

## Invariants & assumptions & assumptions

- The permission is asked FIRST, while the picker's activation holds; the
  file's reads come after (E2b plan review #8).
- The check before a write and the write are not one step: another
  program writing during ours is not caught (named in the plan).
- The baseline's bytes are read at open: a `File` from disk becomes
  unreadable once the file changes.
- The lock's prefix is a sibling of the recordings' (`.../tour-viewer/`),
  so their housekeeping never counts it. Keyed by the file's NAME: two
  different files of one name in two tabs collide, and the second tab is
  told and may edit anyway. Without Web Locks, or when the request fails,
  it grants (nothing to coordinate with; refusing would only stop saving).

## Examples

```ts
const picked = await pickTourFile(window as unknown as PickerWindow);
if (picked.kind === "picked" && picked.writable) {
  const target = await createSaveTarget(picked.handle, picked.file);
  await target.write(rebuilt); // throws InPlaceRefusal when refused
}
```

## Tests

`save-target.test.ts` on fake handles: the permission before the read, the
refusals that still open, the write and its own baseline, a changed file
refused and not written, a touched file accepted, a gone file, a failed
write keeping the baseline, and the lock (granted, refused, released,
without Web Locks); the save dialog opened before `pickSaveFile` returns,
cancelled only by a dismissal, unavailable without one or on any other
refusal; `isSame` by the browser's answer, else by the name; `isSameFile`
by the handle's answer, and by the name without a handle or with one that
cannot tell; `adoptsSavedFile` on a desktop, on Android by its user agent
and by its client hints, and without either dialog, and the fine print's
words for each. The page's e2e (`playwright-tests/editor.spec.js`)
writes a real origin-private file through it.
