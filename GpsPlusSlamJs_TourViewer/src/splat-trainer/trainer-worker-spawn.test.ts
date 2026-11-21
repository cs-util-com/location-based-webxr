import { describe, expect, it } from "vitest";

import { SHIM_IMPORT_KEY } from "./splat-js.js";
import { workerShimSource } from "./trainer-worker-spawn.js";

describe("workerShimSource", () => {
  // Why: the shim is the module the worker starts from; an address with a
  // quote in it must stay one string, never become code.
  it("imports exactly the given address", () => {
    expect(workerShimSource("https://a.test/w.js?x=1")).toContain(
      'import "https://a.test/w.js?x=1";\n',
    );
    expect(workerShimSource('https://a.test/"x".js')).toContain(
      'import "https://a.test/\\"x\\".js";\n',
    );
  });

  // Why: the worker loads Splat.js only through this importer, and an
  // import() takes its referrer policy from the module it is written in.
  // Written in the blob: module, the request names no page; written in a
  // module this site serves, it sent this page's address to the CDN as the Referer (seen in
  // the browser test of the GPU trainer).
  it("leaves an import() written in the shim itself under the shared key", () => {
    const src = workerShimSource("https://a.test/w.js");
    expect(
      src.startsWith(
        `globalThis[${JSON.stringify(SHIM_IMPORT_KEY)}] = (u) => import(u);\n`,
      ),
    ).toBe(true);
  });
});
