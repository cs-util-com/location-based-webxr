/**
 * The look-dev smoke's default pins (round-3 plan 2026-09-27-0532 §8).
 *
 * Why this test matters: every look-dev smoke boots through these pins, so
 * a page default can change without changing what an unrelated test
 * measures. A pin that overrides a key the test named, or a malformed hash,
 * would silently change every test's scene at once.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pinnedHash, SMOKE_PINS } from "./smoke-pins.mjs";

describe("pinnedHash", () => {
  it("appends every pin the hash does not name", () => {
    const out = new URLSearchParams(pinnedHash("preset=noon"));
    assert.equal(out.get("preset"), "noon");
    for (const [key, value] of Object.entries(SMOKE_PINS)) {
      assert.equal(out.get(key), value, key);
    }
  });

  it("never overrides a key the test named, even with an empty value", () => {
    const out = new URLSearchParams(pinnedHash("shadows=1&city="));
    assert.equal(out.get("shadows"), "1");
    assert.equal(out.get("city"), "");
    assert.equal(out.getAll("city").length, 1);
  });

  it("handles an empty hash and stray separators", () => {
    const empty = new URLSearchParams(pinnedHash(""));
    assert.equal(empty.get("city"), SMOKE_PINS.city);
    const stray = new URLSearchParams(pinnedHash("&preset=noon&"));
    assert.equal(stray.get("preset"), "noon");
    assert.equal(stray.get("catalog"), SMOKE_PINS.catalog);
  });

  it("pins the plain scene the tests were measured on", () => {
    assert.deepEqual(SMOKE_PINS, {
      city: "0",
      shadows: "0",
      catalog: "0",
      cloudMode: "dome",
      ao: "0",
      varied: "0",
    });
  });
});
