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
