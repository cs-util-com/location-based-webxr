/**
 * The worker view (`/w/`, serve-routes.mjs) in a real browser worker.
 *
 * WHY (globe city plan 2026-10-05-0040 §12.4 R1): the globe's city is built
 * in a worker from the Osm library, whose modules import `h3-js` by its bare
 * name. Import maps do not apply inside a worker, so through the plain route
 * the library cannot load there at all; the unit tests prove the rewrite as
 * text, this proves a browser accepts the rewritten graph. The plain route
 * is the negative control: if it ever loaded, the probe could not tell a
 * working view from a check that sees nothing.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

/** Loads `url` as a module worker; "loaded", or the error event's message. */
async function loadWorker(page, url) {
  return page.evaluate(
    (src) =>
      new Promise((resolve) => {
        const worker = new Worker(src, { type: "module" });
        const done = (outcome) => {
          worker.terminate();
          resolve(outcome);
        };
        worker.addEventListener("error", (e) =>
          done(`error: ${e.message || "failed to load"}`),
        );
        // A module worker that fails to fetch or link fires `error` at once;
        // the library's graph is a few hundred modules, loaded well inside
        // this window on SwiftShader.
        setTimeout(() => done("loaded"), 8_000);
      }),
    url,
  );
}

test("the Osm library loads in a worker through the worker view, not through the plain route", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, "spinMs=0&turnMs=0&relief=0");
  const view = await loadWorker(page, "/w/osm-lib/index.js");
  const plain = await loadWorker(page, "/osm-lib/index.js");
  console.log(`worker view: ${view}; plain route: ${plain}`);
  expect(errors).toEqual([]);
  expect(view).toBe("loaded");
  expect(plain).toMatch(/^error/);
});
