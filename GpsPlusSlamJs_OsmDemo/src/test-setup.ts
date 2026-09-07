/**
 * Global vitest setup for the OSM demo: the Node 26 storage shim for the
 * jsdom-annotated test files.
 *
 * Node 26 made the global `localStorage` accessor THROW a `DOMException`
 * when no `--localstorage-file` is given, and vitest 4's jsdom environment
 * then leaves the global `localStorage` as a plain `undefined` - with
 * `window` being the global itself, so there is no jsdom storage left to
 * borrow. `ar-hud.test.ts` and `ar-mode.test.ts` were the first reds here
 * under Node 26 (harness-majors plan M0, 2026-09-07). The shim builds the
 * storages from a fresh JSDOM at the environment's URL and installs its
 * `Storage` class as the global one as well, so spies on `Storage.prototype`
 * intercept the very objects in use. Reading the global is itself what
 * throws on a bare Node 26, hence the try; the node environment has no
 * `window` and is untouched.
 *
 * A COPY of the recorder's `src/test-setup.ts` shim, deliberately (DEC-H3 in
 * the root CLAUDE.md): this package consumes the PUBLISHED framework, so a
 * shared test utility only becomes reachable with the framework's next
 * release - the filed follow-up moves both copies there.
 *
 * @see test-setup.ts.md
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
      "function"
    );
  } catch {
    return false;
  }
}
if (typeof window !== "undefined" && !usableGlobalStorage()) {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("", { url: location.href });
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  };
  define("Storage", dom.window.Storage);
  define("localStorage", dom.window.localStorage);
  define("sessionStorage", dom.window.sessionStorage);
}
