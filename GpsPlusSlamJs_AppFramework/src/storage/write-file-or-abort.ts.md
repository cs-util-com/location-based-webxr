# write-file-or-abort.ts

## Purpose

The one correct way to write a File System Access API file handle. Wraps the
`createWritable()` → `write()` → `close()` lifecycle so the **failure** path
cannot be got wrong.

## Public API

- `writeFileOrAbort(fileHandle: FileSystemFileHandle, data: WritableFileData): Promise<void>`
  - Success: writes, then `close()` — which atomically swaps the temp over the original.
  - Failure: `abort()`s the stream, then rethrows the **original** error.
  - Throws the underlying write/close error. A non-`Error` throw is normalized to an `Error` (using its string value when it is one) so callers can rely on `instanceof Error`.
- `type WritableFileData` — `string | Blob | BufferSource`.

## Invariants & assumptions

- **`abort()`, never `close()`, on failure.** `createWritable()` writes to a temp file and commits it on `close()`. Calling `close()` after a failed `write()` therefore **commits the partial result over a previously good file**. Only `abort()` discards it.
- **The stream must always be finalized.** Doing neither leaks the handle's lock, so every later write to the same handle fails — surfacing as corruption in an unrelated operation much later.
- **An abort that itself throws is swallowed.** The write error is the useful diagnostic and must not be masked by a secondary failure.
- **`createWritable()` failing is not caught** — there is no stream to abort yet, so the error simply propagates.
- **Not OPFS-specific**, despite `opfs-storage.ts` being where this logic originally lived. It works on any `FileSystemFileHandle`, including the external directory handles the recorder obtains from `showDirectoryPicker()`.

## Why it is shared

Both failure modes above are silent, and the pattern was hand-rolled in four
places (framework `opfs-storage.ts`, recorder `ref-point-loader.ts`,
`coverage-backfill.ts`, `scenario-zip-export.ts`). The fourth copy had already
lost its abort guard entirely — a failed scenario-ZIP export committed a partial
zip over the user's previous export and leaked the lock. That is the drift a
copied pattern predicts, and the reason this is a module rather than a
convention.

## Examples

```ts
import { writeFileOrAbort } from 'gps-plus-slam-app-framework/storage/write-file-or-abort';

const fileHandle = await dirHandle.getFileHandle('session.json', {
  create: true,
});
await writeFileOrAbort(fileHandle, JSON.stringify(session, null, 2));

// Blobs work the same way.
await writeFileOrAbort(exportHandle, zipBlob);
```

## Tests

`write-file-or-abort.test.ts` — drives a writable-stream double and asserts the
lifecycle, weighted to the failure path: close-on-success with no abort; abort
**and no close** when `write()` rejects; abort when `close()` itself rejects;
the original error surviving an abort that also throws; non-`Error` throws
normalized; and a `createWritable()` rejection propagating untouched.

Indirect coverage: `opfs-storage.test.ts` (three call sites), and the recorder's
`ref-point-loader`, `coverage-backfill` and `scenario-zip-export` suites.

## Build note

Listed explicitly in `config/tsdown.config.ts`. The recorder deep-imports
`gps-plus-slam-app-framework/storage/write-file-or-abort`, and a module missing
from that entry list is invisible to unit tests and typecheck (vitest resolves
the workspace link to source) but 404s in a real browser. See
`2026-04-29-recorder-e2e-import-resolution-failure.md`.
