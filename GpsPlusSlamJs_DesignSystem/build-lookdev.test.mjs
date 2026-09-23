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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { buildLookdev } from "./build-lookdev.mjs";

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
