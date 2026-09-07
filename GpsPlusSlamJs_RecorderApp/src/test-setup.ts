/**
 * Global vitest setup for the recorder.
 *
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
/**
 * Node 26 made the global `localStorage` accessor THROW a `DOMException`
 * when no `--localstorage-file` is given (before 25 it was absent, in 25 an
 * empty object). Under vitest 4's jsdom environment that leaves the global
 * `localStorage` as a plain `undefined` value - and `window` IS the global
 * there, so there is no jsdom storage left to borrow. The six help-section
 * persistence tests in `src/ui/hud.test.ts` failed on `localStorage.clear`
 * the first time CI ran under 26 (PR #431), and a portable Node 26.8.1
 * reproduced it. The shim builds the storages from a fresh JSDOM at the
 * environment's URL and installs its `Storage` class as the global one as
 * well, so the tests' spies on `Storage.prototype` intercept the very
 * objects in use. Reading the global is itself what throws on a bare Node
 * 26, hence the try; the node environment has no `window` and is untouched.
 */
// A module (so top-level await is legal) that imports jsdom ONLY on the
// branch that needs it: a static import would load jsdom for every one of
// the package's node-environment files too (measured: the OSM demo's unit
// stage went from 25 s to 52 s with the static form).
export {};

function usableGlobalStorage(): boolean {
  try {
    return (
      typeof (globalThis as { localStorage?: Storage }).localStorage?.clear ===
      'function'
    );
  } catch {
    return false;
  }
}
if (typeof window !== 'undefined' && !usableGlobalStorage()) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('', { url: location.href });
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  };
  define('Storage', dom.window.Storage);
  define('localStorage', dom.window.localStorage);
  define('sessionStorage', dom.window.sessionStorage);
}

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
