/**
 * Global vitest setup for the recorder.
 *
 * jsdom's `Blob` has `arrayBuffer()` and `text()` but no `stream()`, and
 * `@zip.js/zip.js` 2.9+ reads a `BlobReader`'s source through
 * `blob.stream()` (2.8 sliced and called `arrayBuffer()`). Every browser
 * has `Blob.prototype.stream`, so production is untouched; the jsdom test
 * files that push a Blob through the framework's zip export failed with
 * "sourceBlob.stream is not a function" the day zip.js moved to 2.11
 * (dependency sweep 2026-09-07). The polyfill is guarded so a jsdom that
 * gains `stream()` — or the node environment, whose Blob has it — wins.
 * Setup files run inside each test file's own environment, which is why
 * the guard is evaluated here and not at config time.
 *
 * It reads through `slice()` in 64 KB chunks, never through the blob's own
 * `arrayBuffer()`: a browser's `stream()` does not buffer the whole blob
 * either, and `recording-discovery.test.ts` spies on a file's
 * `arrayBuffer` to prove the scanner never loads a recording whole.
 */
// A module, not a script: `isolatedModules` rejects a global script file.
// (A Node 26 storage shim lived here between r657 and r659; Vitest 5's jsdom
// environment restores the storage globals itself - harness-majors plan M1.)
export {};

if (
  typeof Blob !== 'undefined' &&
  typeof (Blob.prototype as { stream?: unknown }).stream !== 'function'
) {
  const CHUNK = 65_536;
  Object.defineProperty(Blob.prototype, 'stream', {
    configurable: true,
    writable: true,
    value: function stream(this: Blob): ReadableStream<Uint8Array> {
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          if (offset >= this.size) {
            controller.close();
            return;
          }
          const end = Math.min(offset + CHUNK, this.size);
          const chunk = await this.slice(offset, end).arrayBuffer();
          offset = end;
          controller.enqueue(new Uint8Array(chunk));
        },
      });
    },
  });
}
