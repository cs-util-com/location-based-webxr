/**
 * Tests for the design-system dev server's route table.
 *
 * Why this file matters: the 3D look-dev page imports the framework's
 * TypeScript SOURCE through this server (plan 2026-09-23-0048 §4.1), and the
 * server binds 0.0.0.0 for phone rounds on the LAN. Two things must hold:
 * every page import resolves to the right file (a wrong mapping is a 404 the
 * page reports as a blank canvas), and no request escapes the three
 * directories it is allowed to read. Run by `node --test` (no dependencies).
 */
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { describe, it } from "node:test";

import { contentType, defaultRoutes, resolveRequest } from "./serve-routes.mjs";

const PACKAGE = join("/repo", "GpsPlusSlamJs_DesignSystem");
const FRAMEWORK_SRC = join("/repo", "GpsPlusSlamJs_AppFramework", "src");
const THREE = join(
  "/repo",
  "GpsPlusSlamJs_AppFramework",
  "node_modules",
  "three",
);
const ROUTES = [
  { prefix: "/fw/", dir: FRAMEWORK_SRC, typescript: true },
  { prefix: "/vendor/three/", dir: THREE, typescript: false },
];
const resolve = (path) =>
  resolveRequest(path, { packageRoot: PACKAGE, routes: ROUTES });

describe("resolveRequest", () => {
  // The HUD catalog must keep opening at "/" exactly as before the 3D page.
  it("serves the package index at the root", () => {
    assert.deepEqual(resolve("/"), {
      kind: "file",
      file: join(PACKAGE, "index.html"),
      typescript: false,
    });
  });

  // "/3d/" is how the look-dev page is opened on a phone.
  it("serves a directory's index.html", () => {
    assert.equal(resolve("/3d/").file, join(PACKAGE, "3d", "index.html"));
  });

  // The page asks for `.js`, which is the specifier the framework's own
  // sources use for their siblings, and gets the `.ts` source, type-stripped.
  it("maps a framework .js request to its .ts source", () => {
    assert.deepEqual(
      resolve("/fw/visualization/atmosphere/atmosphere-model.js"),
      {
        kind: "file",
        file: join(
          FRAMEWORK_SRC,
          "visualization",
          "atmosphere",
          "atmosphere-model.ts",
        ),
        typescript: true,
      },
    );
  });

  // three is served as-is from the one lockfile-pinned copy.
  it("serves vendored files unchanged", () => {
    assert.deepEqual(resolve("/vendor/three/build/three.module.js"), {
      kind: "file",
      file: join(THREE, "build", "three.module.js"),
      typescript: false,
    });
  });

  // The server binds every interface. A request that climbs out of an
  // allowed directory, however it is spelled, must never reach the disk.
  for (const hostile of [
    "/../secret.txt",
    "/fw/../../secret.js",
    "/fw/%2e%2e/%2e%2e/secret.js",
    "/vendor/three/..%2f..%2fpackage.json",
    "/3d/%00.html",
  ]) {
    it(`refuses an escape attempt: ${hostile}`, () => {
      assert.deepEqual(resolve(hostile), { kind: "forbidden" });
    });
  }
});

// WHY (terrain plan 2026-09-27-0605 §9, review finding 2): the terrain lab
// decodes Terrarium tiles with the Osm LIBRARY's own decoder, so no second
// copy of the 256 m-per-red-step encoding exists. No route reached that
// package before; without this one every lab import 404s, and the lab shows
// a blank canvas on the phone.
describe("defaultRoutes", () => {
  const REPO = join("/repo");
  const resolveDefault = (path) =>
    resolveRequest(path, {
      packageRoot: join(REPO, "GpsPlusSlamJs_DesignSystem"),
      routes: defaultRoutes(REPO),
    });

  it("maps /osm-lib/ to the Osm library's TypeScript source", () => {
    assert.deepEqual(resolveDefault("/osm-lib/elevation/terrarium.js"), {
      kind: "file",
      file: join(REPO, "GpsPlusSlamJs_Osm", "src", "elevation", "terrarium.ts"),
      typescript: true,
    });
  });

  // "/osm-lib/" shares its first letters with OsmDemo's "/osm/"; neither
  // prefix may capture the other's requests.
  it("keeps /osm/ on OsmDemo's source", () => {
    assert.equal(
      resolveDefault("/osm/heightfield.js").file,
      join(REPO, "GpsPlusSlamJs_OsmDemo", "src", "heightfield.ts"),
    );
  });

  it("refuses an escape out of the Osm library", () => {
    assert.deepEqual(resolveDefault("/osm-lib/../package.json"), {
      kind: "forbidden",
    });
  });

  // The Osm library's source imports `h3-js` by its bare name, so a lab that
  // loads it (the globe's arrival prefetch, round-5 plan 2026-10-01-0945
  // §3.6) maps that name here in its import map. Without the route the
  // module graph fails at the first `/osm-lib/` file that needs H3.
  it("serves h3-js's browser ES build unchanged, with its licence", () => {
    const h3 = join(REPO, "GpsPlusSlamJs_Osm", "node_modules", "h3-js");
    assert.deepEqual(resolveDefault("/vendor/h3-js/dist/browser/h3-js.es.js"), {
      kind: "file",
      file: join(h3, "dist", "browser", "h3-js.es.js"),
      typescript: false,
    });
    const route = defaultRoutes(REPO).find(
      (r) => r.prefix === "/vendor/h3-js/",
    );
    assert.equal(route?.notice, "LICENSE");
  });
});

describe("contentType", () => {
  // Chromium refuses a module script served as application/octet-stream, so a
  // missing .js entry looked like a network error on the page.
  it("serves scripts, stripped TypeScript included, as JavaScript", () => {
    assert.equal(
      contentType("a/b.js", false),
      "text/javascript; charset=utf-8",
    );
    assert.equal(contentType("a/b.ts", true), "text/javascript; charset=utf-8");
  });

  // The globe's imagery (W7): an image served as octet-stream still decodes
  // in an <img>, but a texture loader that sniffs the type may refuse it.
  it("serves the globe's imagery as images", () => {
    assert.equal(contentType("t/0.jpg", false), "image/jpeg");
    assert.equal(contentType("t/0.jpeg", false), "image/jpeg");
    assert.equal(contentType("t/0.webp", false), "image/webp");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    assert.equal(contentType("a/b.bin", false), "application/octet-stream");
  });
});
