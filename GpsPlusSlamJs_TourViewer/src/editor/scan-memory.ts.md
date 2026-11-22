# scan-memory.ts

## Purpose

The scan shown beside a tour in the desktop editor, remembered in this
browser: a scan picked through the browser's file picker is kept as its
**file handle**, keyed by the tour's id, in IndexedDB. Where the file is,
never its bytes; never in the tour zip. Reopening that tour offers "Show
the scan again", which asks to read the file again in that click and adds
it as the first add did.

## Public API

- `type ScanHandle` - a picked file's handle with Chromium's
  `requestPermission` (the framework's `WritableFileHandle`).
- `interface HandleStore` - `get`, `put`, `delete` by string key; may
  reject.
- `indexedDbHandleStore(factory: IDBFactory | undefined): HandleStore | null`
  - database `tour-editor-scans`, object store `scans`, through
    `indexedDbKeyValueStore` (`../key-value-db.ts`). Null without IndexedDB.
- `createScanMemory(store: HandleStore | null): ScanMemory`
  - `remember(tourId, handle)` - stores the handle itself; reads nothing of
    the file.
  - `recall(tourId)` - the handle, or null: none stored, a store that
    failed, or a stored value that is no file handle (`kind: "file"`, a
    string `name`, a `getFile` function).
  - `forget(tourId)`.
  - A null, undefined or empty tour id remembers, recalls and forgets
    nothing: a tour without an id has no key of its own. Never rejects.
- `reopenScan(handle): Promise<ReopenedScan>` - `requestPermission({ mode:
"read" })` first (call it in the click, before any other await), then
  `getFile()`.
  - `file` - read.
  - `denied` - a permission not granted, a permission call that throws, or
    a read refused (`NotAllowedError`, `SecurityError`).
  - `gone` - `NotFoundError`: moved, renamed or deleted since.
  - `failed` - anything else, with its message.
  - A handle without `requestPermission` is read as it is. Never rejects.
- `SHOW_SCAN_AGAIN_LABELS` - `idle` "Show the scan again", `busy` "Opening
  the scan…".
- `scanRememberedLine(name)` - the offer's line.
- `runShowScanAgain(button, name, deps): Promise<ShowScanAgainResult>` - the
  offer's button (the async-UI rule): off and "Opening the scan…" while
  `deps.reopen()` and `deps.add(file)` run, back to its words on every end.
  - `done` - added, or `add` gave null (the tour changed meanwhile; the
    offer went with the old tour's toasts).
  - `failed` with `line` and `keepOffer`:
    - gone: `deps.forget()` is called and `keepOffer` is false;
    - denied, a failed read, a refused add (`notAddedLine`), or a throw:
      `keepOffer` is true, so the creator can try again.
  - Never rejects.

## Invariants and assumptions

- No bytes of the scan are stored by this module: the handle is what is
  kept, and IndexedDB serialises a `FileSystemFileHandle` as a handle.
- The memory is a convenience: a private window, blocked storage or a
  failing store reads as "nothing remembered", never as an error.
- The page (`edit-main.ts`) decides WHAT is remembered: a scan added with
  a handle (picked through `pickScanFile`, or the tour picker) is
  remembered for that tour; a scan added without one (dropped, or from a
  file input) forgets the one remembered before, so "again" never means an
  older scan than the last one shown.
- Only Chromium has handles to store; elsewhere the pickers fall back to
  file inputs and nothing is remembered.

## Example

```ts
const memory = createScanMemory(indexedDbHandleStore(indexedDB));
await memory.remember(tourId, handle); // after the scan was added
const kept = await memory.recall(tourId); // after the tour reopened
if (kept !== null) {
  // in the click:
  const result = await runShowScanAgain(button, kept.name, {
    reopen: () => reopenScan(kept),
    add: (file) => addScan(file),
    forget: () => void memory.forget(tourId),
  });
}
```

## Tests

- `scan-memory.test.ts` - the memory on a Map-backed and a failing store
  (handle kept as itself, no read; no key without a tour id; untrusted
  stored values; a property over remember/forget sequences), `reopenScan`
  on fake handles (permission before the read, denied, gone, failed), and
  `runShowScanAgain` (busy state seen by its deps, back to idle on every
  end, the lines, forget only when gone).
- `scan-memory.test.ts`, `indexedDbHandleStore` - the adapter on a small
  hand-written IndexedDB stand-in: its database and one-time upgrade, one
  open for many calls, a failed open tried again, a blocked open and a
  failed transaction rejecting, and a named database listing its keys
  (`indexedDbKeyValueStore`, tested here beside the stand-in).
- `playwright-tests/editor.spec.js`, "remembers a scan picked in the
  picker by tour id ..." - the whole flow across reloads (picked, shown,
  offered, shown again, then deleted and said gone) on a stand-in store
  set as `window.__tourEditorScanStore` in the dev server. Not the real
  IndexedDB: a real file handle read back from IndexedDB crashes
  chrome-headless-shell and Playwright's Chromium (installed Chrome reads
  it fine), so no CI browser can hold that round trip.
