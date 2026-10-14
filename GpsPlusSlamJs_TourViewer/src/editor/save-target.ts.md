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
    baseline moves only once the write landed.
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

## Invariants & assumptions

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
without Web Locks). The page's e2e (`playwright-tests/editor.spec.js`)
writes a real origin-private file through it.
