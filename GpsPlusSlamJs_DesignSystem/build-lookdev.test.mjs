/**
 * Tests for the look-dev page's deploy builder.
 *
 * Why this file matters: the deployed page (PR previews at /lookdev/, how
 * the owner opens it on a phone) is assembled by crawling imports, not by a
 * bundler. A missed file is a 404 that shows up as a blank canvas on a phone,
 * and a missed prefix rewrite points at the site root, where nothing lives.
 * Neither would fail any other gate, so this builds the real page into a
 * temp directory and checks what a browser would fetch.
 */
import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { buildLookdev, discoverEntries } from "./build-lookdev.mjs";

/** Writes `files` ({ relativePath: text }) under a fresh temp directory. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "lookdev-fixture-"));
  for (const [rel, text] of Object.entries(files)) {
    const file = join(root, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

// WHY (programme plan 2026-09-26-0539, DEC-PRG-2): prototypes are published
// as small lab pages beside the main page. Several workstreams add labs in
// parallel, so the builder DISCOVERS them from the folder rather than from a
// list each of them would have to edit.
describe("discoverEntries", () => {
  it("lists the main page first, then every lab with an index page, sorted", () => {
    const root = fixture({
      "3d/index.html": "<title>Main</title>",
      "labs/water/index.html": "<title>Water</title>",
      "labs/clouds-above/index.html": "<title>Clouds</title>",
      "labs/notes-only/README.md": "no page here",
    });
    try {
      assert.deepEqual(discoverEntries(root), [
        "/3d/index.html",
        "/labs/clouds-above/index.html",
        "/labs/water/index.html",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Globe round-5 §3.3: a lab can carry a second page (the terrain lab's
  // colour comparison, compare.html) that must reach the preview too.
  it("lists a lab's further pages after its index page, sorted", () => {
    const root = fixture({
      "labs/terrain/index.html": "<title>Terrain</title>",
      "labs/terrain/compare.html": "<title>Compare</title>",
      "labs/terrain/a-notes.md": "not a page",
      "labs/water/index.html": "<title>Water</title>",
      "labs/sketch/only.html": "<title>No index: not a lab</title>",
    });
    try {
      assert.deepEqual(discoverEntries(root), [
        "/labs/terrain/index.html",
        "/labs/terrain/compare.html",
        "/labs/water/index.html",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("works without any labs", () => {
    const root = fixture({ "3d/index.html": "<title>Main</title>" });
    try {
      assert.deepEqual(discoverEntries(root), ["/3d/index.html"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// WHY: a lab is deployed exactly like the main page (its modules crawled,
// its stylesheets copied), and the landing index names every page, so the
// owner can open each prototype on a phone from one link.
describe("buildLookdev with a lab", () => {
  let root;
  let out;
  let files;
  before(() => {
    root = fixture({
      "3d/index.html":
        '<title>Main page</title><link rel="stylesheet" href="./main.css" />' +
        '<script type="module" src="./main.js"></script>',
      "3d/main.css": "body{}",
      "3d/main.js": 'import "./helper.js";\n',
      "3d/helper.js": "export {};\n",
      "labs/water/index.html":
        '<title>Water lab</title><link rel="stylesheet" href="./water.css" />' +
        '<script type="module" src="./water.js"></script>',
      "labs/water/water.css": "body{}",
      "labs/water/water.js": 'import "./waves.js";\n',
      "labs/water/waves.js": "export {};\n",
    });
    out = mkdtempSync(join(tmpdir(), "lookdev-out-"));
    files = buildLookdev({ outDir: out, base: "/lookdev/", packageRoot: root });
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it("crawls each entry's modules and copies its linked stylesheets", () => {
    for (const rel of [
      "3d/index.html",
      "3d/main.css",
      "3d/helper.js",
      "labs/water/index.html",
      "labs/water/water.css",
      "labs/water/waves.js",
    ]) {
      assert.ok(files.includes(rel), rel);
    }
  });

  it("lists every page by its title on the landing index", () => {
    const index = readFileSync(join(out, "index.html"), "utf8");
    assert.match(index, /href="\.\/3d\/"[^>]*>Main page</);
    assert.match(index, /href="\.\/labs\/water\/"[^>]*>Water lab</);
    // A list, not the old redirect: a redirect would hide the labs.
    assert.doesNotMatch(index, /http-equiv="refresh"/);
  });
});

describe("buildLookdev", () => {
  let out;
  let files;
  before(() => {
    out = mkdtempSync(join(tmpdir(), "lookdev-"));
    files = buildLookdev({ outDir: out, base: "/lookdev/" });
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  const read = (rel) => readFileSync(join(out, rel), "utf8");

  it("emits the page, its styles and its entry", () => {
    for (const rel of [
      "3d/index.html",
      "3d/lookdev.css",
      "3d/lookdev.js",
      "3d/panel.js",
      "design.css",
    ]) {
      assert.ok(existsSync(join(out, rel)), rel);
    }
  });

  // three's module build imports ./three.core.js; OrbitControls comes
  // through the import map. All must be crawled, or the page dies on load.
  // (three's Sky.js was here while the page carried OsmDemo's Preetham sky
  // as a baseline; that was retired in M3.)
  it("follows the import graph into three and its addons", () => {
    for (const rel of [
      "vendor/three/build/three.module.js",
      "vendor/three/build/three.core.js",
      "vendor/three/examples/jsm/controls/OrbitControls.js",
    ]) {
      assert.ok(existsSync(join(out, rel)), rel);
    }
  });

  // The framework's TypeScript is emitted as plain JavaScript, types gone.
  it("emits the framework's atmosphere as stripped JavaScript", () => {
    const source = read("fw/visualization/atmosphere/sky-atmosphere.js");
    assert.doesNotMatch(source, /^export interface /m);
    assert.match(source, /export class SkyAtmosphere/);
    assert.ok(existsSync(join(out, "fw/utils/clamp01.js")));
    assert.ok(existsSync(join(out, "osm/sun-position.js")));
  });

  // Every absolute prefix now sits under the base, in the import map and in
  // every module; a bare "/fw/" would resolve to the site root.
  it("rewrites every absolute prefix under the base", () => {
    const html = read("3d/index.html");
    assert.match(
      html,
      /"three": "\/lookdev\/vendor\/three\/build\/three\.module\.js"/,
    );
    for (const rel of files.filter(
      (f) => f.endsWith(".js") || f.endsWith(".html"),
    )) {
      assert.doesNotMatch(read(rel), /["'](\/fw\/|\/osm\/|\/vendor\/)/, rel);
    }
  });

  it("never writes outside the output directory", () => {
    for (const rel of files)
      assert.ok(!rel.startsWith("..") && !rel.startsWith("/"), rel);
  });

  it("gives the base a landing index that opens the page", () => {
    assert.match(read("index.html"), /3d\//);
  });
});

// WHY (globe plan 2026-09-26-0539 §7.1, W7 M0): the globe lab serves a new
// package's source, its vendored library and its imagery through new routes.
// Three things a crawl alone cannot do, each a blank or broken phone page if
// missed: rebase EVERY route's prefix (not a hard-coded list), copy runtime
// assets that are fetched rather than imported, and ship a library's
// LICENSE beside its chunks (Apache-2.0 §4(a): the chunks carry no header).
describe("buildLookdev with custom routes", () => {
  let root;
  let extra;
  let assets;
  let unused;
  let lib;
  let out;
  let files;
  const BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  before(() => {
    root = fixture({
      "labs/globe/index.html":
        "<title>Globe lab</title>" +
        '<script type="importmap">{"imports":{"lib":"/vendor/lib/index.js"}}</script>' +
        '<script type="module" src="./globe.js"></script>',
      "labs/globe/globe.js":
        'import "/extra/helper.js";\nimport "lib";\n' +
        'export const TILE = "/assets/tiles/0/0.jpg";\n',
    });
    extra = fixture({ "helper.js": 'export const H = "/extra/data.json";\n' });
    assets = fixture({ "README.md": "provenance" });
    mkdirSync(join(assets, "tiles", "0"), { recursive: true });
    writeFileSync(join(assets, "tiles", "0", "0.jpg"), BYTES);
    unused = fixture({ "big.bin": "never referenced" });
    lib = fixture({
      "index.js": 'import "./chunk-a1b2.js";\n',
      "chunk-a1b2.js": "export {};\n",
      LICENSE: "Apache License 2.0",
    });
    out = mkdtempSync(join(tmpdir(), "lookdev-routes-"));
    files = buildLookdev({
      outDir: out,
      base: "/lookdev/",
      packageRoot: root,
      routes: [
        { prefix: "/extra/", dir: extra, typescript: false },
        { prefix: "/assets/", dir: assets, typescript: false, copyAll: true },
        { prefix: "/unused/", dir: unused, typescript: false, copyAll: true },
        {
          prefix: "/vendor/lib/",
          dir: lib,
          typescript: false,
          notice: "LICENSE",
        },
      ],
    });
  });
  after(() => {
    for (const dir of [root, extra, assets, unused, lib, out]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const read = (rel) => readFileSync(join(out, rel), "utf8");

  it("rebases every route's prefix, not only the built-in ones", () => {
    assert.match(read("labs/globe/globe.js"), /"\/lookdev\/extra\/helper\.js"/);
    assert.match(read("labs/globe/globe.js"), /"\/lookdev\/assets\/tiles/);
    assert.match(read("extra/helper.js"), /"\/lookdev\/extra\/data\.json"/);
    assert.match(read("labs/globe/index.html"), /"\/lookdev\/vendor\/lib\//);
    for (const rel of files.filter((f) => /\.(js|html)$/.test(f))) {
      assert.doesNotMatch(read(rel), /["']\/(extra|assets|vendor)\//, rel);
    }
  });

  it("copies a copyAll route that is referenced, byte for byte", () => {
    assert.ok(files.includes("assets/tiles/0/0.jpg"));
    assert.ok(files.includes("assets/README.md"));
    assert.deepEqual(readFileSync(join(out, "assets/tiles/0/0.jpg")), BYTES);
  });

  it("copies nothing from a copyAll route nobody references", () => {
    assert.ok(!files.some((f) => f.startsWith("unused/")));
  });

  it("ships a route's notice file beside the chunks it emitted", () => {
    assert.ok(files.includes("vendor/lib/chunk-a1b2.js"));
    assert.ok(files.includes("vendor/lib/LICENSE"));
    assert.equal(read("vendor/lib/LICENSE"), "Apache License 2.0");
  });
});

// WHY (terrain plan 2026-09-27-0605 §9, review finding 3): the terrain lab
// decodes tiles in a module Worker. A Worker is not an `import`, so the
// crawl never saw it, and the preview served the page without its worker:
// a 404 that shows as an endless "Computing relief" on the phone. Import
// maps do not apply inside a worker, so a bare specifier there must fail
// the BUILD, not the phone.
describe("buildLookdev with a module Worker", () => {
  const BYTES = Buffer.from([0, 1, 2, 250, 251, 252]);
  let root;
  let extra;
  let out;
  let files;
  before(() => {
    root = fixture({
      "labs/relief/index.html":
        "<title>Relief lab</title>" +
        '<script type="importmap">{"imports":{"lib":"/extra/lib.js"}}</script>' +
        '<script type="module" src="./relief.js"></script>',
      "labs/relief/relief.js":
        'import "lib";\n' +
        "const w = new Worker(\n" +
        '  new URL("./relief-worker.js", import.meta.url),\n' +
        '  { type: "module" },\n' +
        ");\n" +
        "const s = new Worker('/labs/relief/string-worker.js');\n" +
        'export const DATA = new URL("./data.bin", import.meta.url);\n',
      "labs/relief/relief-worker.js":
        'import { H } from "/extra/helper.js";\nimport "./maths.js";\n',
      "labs/relief/maths.js": "export {};\n",
      "labs/relief/string-worker.js": "export {};\n",
    });
    writeFileSync(join(root, "labs", "relief", "data.bin"), BYTES);
    extra = fixture({
      "helper.js": "export const H = 1;\n",
      "lib.js": "export {};\n",
    });
    out = mkdtempSync(join(tmpdir(), "lookdev-worker-"));
    files = buildLookdev({
      outDir: out,
      base: "/lookdev/",
      packageRoot: root,
      routes: [{ prefix: "/extra/", dir: extra, typescript: false }],
    });
  });
  after(() => {
    for (const dir of [root, extra, out]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("crawls a Worker named by new URL(..., import.meta.url) and its imports", () => {
    for (const rel of [
      "labs/relief/relief-worker.js",
      "labs/relief/maths.js",
      "extra/helper.js",
    ]) {
      assert.ok(files.includes(rel), rel);
    }
  });

  it("crawls a Worker named by a plain string", () => {
    assert.ok(files.includes("labs/relief/string-worker.js"));
  });

  it("rebases the worker's route imports under the base", () => {
    const worker = readFileSync(
      join(out, "labs/relief/relief-worker.js"),
      "utf8",
    );
    assert.match(worker, /"\/lookdev\/extra\/helper\.js"/);
  });

  it("copies a non-module new URL(...) asset byte for byte", () => {
    assert.deepEqual(readFileSync(join(out, "labs/relief/data.bin")), BYTES);
  });

  it("refuses a bare specifier inside a Worker (no import map there)", () => {
    const bad = fixture({
      "labs/bad/index.html":
        "<title>Bad</title>" +
        '<script type="importmap">{"imports":{"lib":"/extra/lib.js"}}</script>' +
        '<script type="module" src="./bad.js"></script>',
      "labs/bad/bad.js":
        'new Worker(new URL("./w.js", import.meta.url), { type: "module" });\n',
      "labs/bad/w.js": 'import "lib";\n',
    });
    const badOut = mkdtempSync(join(tmpdir(), "lookdev-bad-"));
    try {
      assert.throws(
        () =>
          buildLookdev({
            outDir: badOut,
            base: "/lookdev/",
            packageRoot: bad,
            routes: [{ prefix: "/extra/", dir: extra, typescript: false }],
          }),
        /"lib".*worker/i,
      );
    } finally {
      rmSync(bad, { recursive: true, force: true });
      rmSync(badOut, { recursive: true, force: true });
    }
  });
});

// WHY (globe plan 2026-09-26-0539 §8, the builder review points): the real
// globe lab must deploy as a CLOSED graph (the library's hashed chunks are
// found by the crawl, not listed anywhere), with the library's LICENSE
// beside them, and the globe package's TypeScript stripped and rebased.
describe("buildLookdev with the real globe lab", () => {
  let out;
  let files;
  before(() => {
    out = mkdtempSync(join(tmpdir(), "lookdev-globe-"));
    files = buildLookdev({ outDir: out, base: "/lookdev/" });
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  it("emits the lab, the globe source and the library's chunks and LICENSE", () => {
    for (const rel of [
      "labs/globe/index.html",
      "labs/globe/globe-lab.js",
      "globe/globe-surface.js",
      "globe/vendor/generated-surface-plugin.js",
      "vendor/3d-tiles-renderer/build/index.js",
      "vendor/3d-tiles-renderer/build/index.plugins.js",
      "vendor/3d-tiles-renderer/LICENSE",
      "vendor/three/LICENSE",
    ]) {
      assert.ok(files.includes(rel), rel);
    }
    const chunks = files.filter((f) =>
      /^vendor\/3d-tiles-renderer\/build\/(renderer|plugins)-/.test(f),
    );
    assert.ok(chunks.length >= 2, `hashed chunks crawled: ${chunks}`);
  });

  it("strips the globe's TypeScript and rebases every prefix", () => {
    const surface = readFileSync(join(out, "globe/globe-surface.js"), "utf8");
    assert.doesNotMatch(surface, /^export interface /m);
    assert.match(surface, /export function createGlobeSurface/);
    for (const rel of files.filter((f) =>
      /^(labs\/globe|globe)\/.*\.(js|html)$/.test(f),
    )) {
      const text = readFileSync(join(out, rel), "utf8");
      assert.doesNotMatch(text, /["']\/(globe|globe-assets|vendor)\//, rel);
    }
  });
});

// WHY (terrain plan 2026-09-27-0605 §9 findings 2 and 3): the real terrain
// lab deploys as a CLOSED graph: its worker (reached by `new Worker`, not an
// import), the Osm library through `/osm-lib/` and OsmDemo's heightfield
// through `/osm/`, all stripped and rebased. A missed one is a lab that
// stays on "Computing relief..." on the phone.
describe("buildLookdev with the real terrain lab", () => {
  let out;
  let files;
  before(() => {
    out = mkdtempSync(join(tmpdir(), "lookdev-terrain-"));
    files = buildLookdev({ outDir: out, base: "/lookdev/" });
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  it("emits the lab, its worker and the served Osm modules", () => {
    for (const rel of [
      "labs/terrain/index.html",
      "labs/terrain/terrain-lab.js",
      "labs/terrain/terrain-worker.js",
      "labs/terrain/terrain-pipeline.js",
      "labs/terrain/terrain-mosaic.js",
      "labs/terrain/terrain-precompute.js",
      "osm-lib/elevation/terrarium.js",
      "osm-lib/source/compose-signals.js",
      "osm-lib/source/in-flight-requests.js",
      "osm-lib/mesh/enu.js",
      "osm/heightfield.js",
      "osm/terrain-texture.js",
      // Style C's far field (T2): the globe's source registry and the
      // imagery it names (the Blue Ridge's level-5 tile, the level it
      // reads since review 2026-10-01 m7).
      "labs/terrain/terrain-far-field.js",
      "labs/terrain/terrain-styles.js",
      "globe/globe-sources.js",
      "globe-assets/blue-marble-4326/5/17/9.webp",
      // The GPS place's pin (T3): the framework's locate behaviour.
      "fw/utils/locate-state.js",
    ]) {
      assert.ok(files.includes(rel), rel);
    }
  });

  it("strips the served TypeScript and rebases every prefix", () => {
    const terrarium = readFileSync(
      join(out, "osm-lib/elevation/terrarium.js"),
      "utf8",
    );
    assert.doesNotMatch(terrarium, /^export interface /m);
    assert.match(terrarium, /export function browserPngDecoder/);
    for (const rel of files.filter((f) =>
      /^(labs\/terrain|osm-lib|globe)\/.*\.(js|html)$/.test(f),
    )) {
      const text = readFileSync(join(out, rel), "utf8");
      assert.doesNotMatch(
        text,
        /["']\/(osm-lib|osm|vendor|globe|globe-assets)\//,
        rel,
      );
    }
  });

  // The fixtures are for the smoke only: fetched from the network in
  // production, so nothing references them and nothing copies them.
  it("does not ship the smoke's fixture tiles", () => {
    assert.ok(!files.some((f) => f.startsWith("labs/terrain/fixtures/")));
  });
});

// WHY (round-5 plan 2026-10-01-0945 §3.6): the globe's arrival prefetch is
// OsmDemo's TypeScript (`/osm/arrival-prefetch.js`) with the Osm library,
// the framework's OPFS store and H3 underneath it, imported by a lab that
// is not wired yet. This probe page carries the import map the wiring
// note asks the globe lab to add, and the build must close its graph: an
// extensionless import, a parameter property the type stripper refuses, or
// an unmapped bare name each fail here, instead of as a globe lab whose
// module graph never loads (the 2026-10-01 lab-import follow-up). The
// framework logger (and with it Sentry) must stay out of the graph.
describe("buildLookdev with the arrival prefetch's import map", () => {
  const IMPORT_MAP = {
    imports: {
      "h3-js": "/vendor/h3-js/dist/browser/h3-js.es.js",
      "gps-plus-slam-osm": "/osm-lib/index.js",
      "gps-plus-slam-app-framework/osm-bridge": "/fw/osm-bridge/index.js",
    },
  };
  let root;
  let out;
  let files;
  before(() => {
    root = fixture({
      "labs/probe/index.html": [
        "<!doctype html><title>Probe</title>",
        `<script type="importmap">${JSON.stringify(IMPORT_MAP)}</script>`,
        '<script type="module" src="./probe.js"></script>',
      ].join("\n"),
      "labs/probe/probe.js": [
        'import { startArrivalPrefetch } from "/osm/arrival-prefetch.js";',
        'import { startPace, stepPace } from "/globe/flight-pace.js";',
        "export { startArrivalPrefetch, startPace, stepPace };",
      ].join("\n"),
    });
    out = mkdtempSync(join(tmpdir(), "lookdev-prefetch-"));
    files = buildLookdev({ outDir: out, base: "/lookdev/", packageRoot: root });
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it("closes the graph: OsmDemo, the Osm library, the store, H3, the pace", () => {
    for (const rel of [
      "osm/arrival-prefetch.js",
      "osm/arrival-plan.js",
      "osm/arrival-progress.js",
      "osm/osm-tile-cache.js",
      "osm/dem-provider.js",
      "osm/terrain-field.js",
      "osm-lib/index.js",
      "osm-lib/source/caching-source.js",
      "osm-lib/source/overpass-source.js",
      "osm-lib/elevation/caching-tile-fetch.js",
      "fw/osm-bridge/index.js",
      "fw/osm-bridge/opfs-osm-blob-store.js",
      "fw/storage/write-file-or-abort.js",
      "vendor/h3-js/dist/browser/h3-js.es.js",
      "vendor/h3-js/LICENSE",
      "globe/flight-pace.js",
    ]) {
      assert.ok(files.includes(rel), rel);
    }
  });

  it("keeps the framework logger, and Sentry with it, out of the graph", () => {
    assert.ok(!files.includes("fw/utils/logger.js"));
    assert.ok(!files.some((f) => f.includes("sentry")));
  });
});

// WHY (round-5 plan 2026-10-01-0945 §3.6, its milestone review): the
// arrival prefetch's graph (the Osm library, about 1.1 MB of source, and
// h3-js, 0.55 MB) must load at the pin press, not at the globe's boot. So
// the lab loads it with a dynamic `import("...")`, which the deploy must
// still ship (followed like a static import), and which the boot graph,
// the static imports alone, must never include.
describe("buildLookdev and dynamic imports", () => {
  let root;
  let out;
  before(() => {
    root = fixture({
      "labs/lazy/index.html": [
        "<!doctype html><title>Lazy</title>",
        '<script type="module" src="./lazy.js"></script>',
      ].join("\n"),
      "labs/lazy/lazy.js": [
        'import { now } from "./eager.js";',
        '// A comment naming import("./not-shipped.js") is not an import,',
        '/** nor is a JSDoc type: @type {import("./types-only.js").T} */',
        'const url = "https://example.test/"; // and a URL is not a comment',
        "export async function later() {",
        '  return (await import("./deferred.js")).value + now + url;',
        "}",
      ].join("\n"),
      "labs/lazy/eager.js": "export const now = 1;",
      "labs/lazy/deferred.js":
        'import { more } from "./deferred-dep.js";\nexport const value = more;',
      "labs/lazy/deferred-dep.js": "export const more = 2;",
    });
    out = mkdtempSync(join(tmpdir(), "lookdev-lazy-"));
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it("ships a dynamically imported module and its graph", () => {
    const files = buildLookdev({
      outDir: join(out, "all"),
      base: "/lookdev/",
      packageRoot: root,
    });
    for (const rel of [
      "labs/lazy/eager.js",
      "labs/lazy/deferred.js",
      "labs/lazy/deferred-dep.js",
    ]) {
      assert.ok(files.includes(rel), rel);
    }
  });

  // A commented `import("x")` is not an import: the files named above do
  // not exist, so following them would fail the build.
  it("ignores an import() inside a comment", () => {
    const files = buildLookdev({
      outDir: join(out, "comments"),
      base: "/lookdev/",
      packageRoot: root,
    });
    assert.ok(!files.some((f) => f.includes("not-shipped")));
    assert.ok(!files.some((f) => f.includes("types-only")));
  });

  it("leaves it out of the boot graph when dynamic imports are not followed", () => {
    const files = buildLookdev({
      outDir: join(out, "boot"),
      base: "/lookdev/",
      packageRoot: root,
      followDynamic: false,
    });
    assert.ok(files.includes("labs/lazy/eager.js"));
    assert.ok(!files.includes("labs/lazy/deferred.js"));
    assert.ok(!files.includes("labs/lazy/deferred-dep.js"));
  });
});

// WHY: the globe lab's BOOT graph (its static imports) must not pull in the
// arrival prefetch's dependencies. A later edit that imports
// `/osm/arrival-prefetch.js` statically, or anything else that reaches the
// Osm library or H3, makes every globe load pay about 1.7 MB of modules
// before the first frame, and nothing else would report it.
describe("the globe lab's boot graph", () => {
  let out;
  let files;
  before(() => {
    out = mkdtempSync(join(tmpdir(), "lookdev-globe-boot-"));
    files = buildLookdev({
      outDir: out,
      base: "/lookdev/",
      entries: ["/labs/globe/index.html"],
      followDynamic: false,
    });
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  it("is the globe lab's own graph (the probe is not vacuous)", () => {
    assert.ok(files.includes("labs/globe/globe-lab.js"));
    assert.ok(files.includes("globe/globe-surface.js"));
  });

  it("includes neither the Osm library nor h3-js nor the prefetch", () => {
    const offenders = files.filter(
      (f) =>
        f.startsWith("osm-lib/") ||
        f.startsWith("vendor/h3-js/") ||
        f.startsWith("osm/arrival-"),
    );
    assert.deepEqual(offenders, []);
  });
});
