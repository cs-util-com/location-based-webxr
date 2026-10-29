/**
 * The globe lab's ready signal.
 *
 * Why this file matters: every lab smoke and the design system's page test
 * wait for `window.__globeLab.ready` and then use the page at once, so
 * `ready` must mean that start() is done, including the parts it loads on
 * demand. The frame-hitch recorder (`#perf=1`) is imported after the test
 * API is published; while `ready` was set together with the API, a test
 * could see `ready` several seconds before the recorder's Run button
 * existed (measured 5-19 s locally under SwiftShader), and CI failed the
 * page test on that race. The lab's start() runs only in a browser, so this
 * test checks the order in its source: the API is published not ready, and
 * `ready` is set after the recorder is wired, as the last step of start().
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./globe-lab.js", import.meta.url), "utf8");

describe("the globe lab's ready signal", () => {
  it("publishes the test API not ready", () => {
    const api = source.indexOf("window.__globeLab = {");
    assert.ok(api > 0, "the test API is published");
    const head = source.slice(api, api + 200);
    assert.match(head, /ready: false,/);
    assert.doesNotMatch(head, /ready: true/);
  });

  it("sets ready once, after the recorder is wired, at the end of start()", () => {
    const sets = [...source.matchAll(/window\.__globeLab\.ready = true;/g)];
    assert.equal(sets.length, 1);
    const ready = sets[0].index;
    const recorder = source.indexOf("window.__globeLab.perf = perf.api;");
    assert.ok(recorder > 0, "the recorder is wired");
    assert.ok(ready > recorder, "ready comes after the recorder");
    const end = source.indexOf("\nstart().catch(");
    assert.match(
      source.slice(ready, end),
      /^window\.__globeLab\.ready = true;\s*}\s*$/,
    );
  });
});
