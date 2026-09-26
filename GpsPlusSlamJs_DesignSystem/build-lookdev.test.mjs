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
