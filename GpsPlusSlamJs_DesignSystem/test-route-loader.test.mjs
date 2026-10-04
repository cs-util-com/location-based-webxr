/**
 * The node test loader that resolves the dev server's TypeScript routes.
 *
 * Why this test matters: the terrain lab's pure modules import the Globe
 * package's sky level by its page path (`/globe/sky-level.js`), the one
 * implementation both labs read (DEC-H3). The browser gets it from the
 * dev server's route table; `node --test` gets it from this loader, which
 * reads the SAME table. If the loader drifted from the table, the unit
 * tests would load a different file than the page does, or none at all.
 *
 * `test:unit` runs every file with `--import ./test-route-loader.mjs`, so
 * this file runs under the hook it tests.
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defaultRoutes } from "./serve-routes.mjs";
import { routeUrl, siblingSourceUrl } from "./test-route-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const routes = defaultRoutes(join(here, ".."));
const globeSource = (name) =>
  pathToFileURL(join(here, "..", "GpsPlusSlamJs_Globe", "src", name)).href;

describe("routeUrl", () => {
  it("maps a TypeScript route's .js path to its source, as the server does", () => {
    assert.equal(
      routeUrl("/globe/sky-level.js", routes),
      globeSource("sky-level.ts"),
    );
  });

  it("leaves relative, bare, protocol-relative and unrouted paths alone", () => {
    assert.equal(routeUrl("./terrain-sun.js", routes), null);
    assert.equal(routeUrl("three", routes), null);
    assert.equal(routeUrl("//globe/sky-level.js", routes), null);
    assert.equal(routeUrl("/labs/terrain/terrain-sun.js", routes), null);
  });

  it("leaves a route that is not TypeScript to the server", () => {
    assert.equal(routeUrl("/vendor/three/build/three.module.js", routes), null);
  });

  it("refuses what the server refuses", () => {
    assert.equal(routeUrl("/globe/../package.json", routes), null);
  });
});

describe("siblingSourceUrl", () => {
  // A routed TypeScript module imports its siblings as `./x.js`, as the
  // server serves them; node does not rewrite that to `.ts`. Inside a
  // TypeScript route's directory the hook does, so a shared module can
  // import the package's own helpers instead of copying them.
  it("maps a sibling .js of a routed TypeScript module to its .ts", () => {
    assert.equal(
      siblingSourceUrl(
        "./globe-camera.js",
        globeSource("sky-level.ts"),
        routes,
      ),
      globeSource("globe-camera.ts"),
    );
  });

  it("leaves a relative import outside the routes, a bare one and a missing file alone", () => {
    const lab = pathToFileURL(
      join(here, "labs", "terrain", "terrain-sun.js"),
    ).href;
    assert.equal(siblingSourceUrl("./terrain-styles.js", lab, routes), null);
    assert.equal(
      siblingSourceUrl("three", globeSource("sky-level.ts"), routes),
      null,
    );
    assert.equal(
      siblingSourceUrl(
        "./no-such-module.js",
        globeSource("sky-level.ts"),
        routes,
      ),
      null,
    );
  });
});

describe("the registered hook", () => {
  it("resolves a page path to the Globe package's source", () => {
    assert.equal(
      import.meta.resolve("/globe/sky-level.js"),
      globeSource("sky-level.ts"),
    );
  });

  it("loads it: the shared sky level, with its frozen parameters", async () => {
    const { SKY_FILL, skyLevel } = await import("/globe/sky-level.js");
    assert.equal(SKY_FILL.floor, 0.5);
    assert.equal(skyLevel(0), 0.5);
  });
});
