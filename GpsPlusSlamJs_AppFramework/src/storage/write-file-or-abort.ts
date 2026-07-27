/**
 * The one correct way to write a File System Access API file handle.
 *
 * `createWritable()` opens a writable stream backed by a TEMP file and takes a
 * lock on the handle. `close()` atomically swaps the temp over the original.
 * That makes the failure path load-bearing and easy to get wrong:
 *
 * - Calling `close()` after a failed `write()` **commits the partial result**
 *   over a previously good file. Only `abort()` discards the temp.
 * - Doing neither leaks the lock, so every later write to the same handle
 *   fails — the corruption shows up in an unrelated operation much later.
 *
 * Both mistakes are silent, which is why this is a shared helper rather than a
 * pattern to remember: it was hand-rolled in four places across the framework
 * and the recorder, and the fourth copy had already lost its abort guard.
 *
 * Not OPFS-specific despite `opfs-storage.ts` being its original home — it
 * works on any `FileSystemFileHandle`, including the external directory handles
 * the recorder gets from `showDirectoryPicker()`.
 */

/** Anything `FileSystemWritableFileStream.write()` accepts as a whole-file payload. */
export type WritableFileData = string | Blob | BufferSource;

/**
 * Write `data` to `fileHandle`, aborting the writable stream if anything fails.
 *
 * On success the stream is closed, which atomically swaps the new content over
 * the old. On failure the stream is aborted — discarding the temp and releasing
 * the lock — and the original error is rethrown, so callers see the cause
 * rather than a downstream lock error.
 *
 * @throws the underlying write/close error. A non-`Error` throw is normalized
 * to an `Error` (using its string value when it is one) so callers can rely on
 * `instanceof Error`.
 */
export async function writeFileOrAbort(
  fileHandle: FileSystemFileHandle,
  data: WritableFileData
): Promise<void> {
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error: unknown) {
    // abort() — NOT close() — discards the temp instead of committing it, and
    // finalizes the stream so the handle's lock is released. An abort that
    // itself fails is swallowed: the original write error is the useful
    // diagnostic and must not be masked.
    await writable.abort().catch(() => {});
    throw error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'File write failed');
  }
}
