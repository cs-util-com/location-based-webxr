/**
 * The material catalog's entries and validator (W5 plan 2026-09-26-0549,
 * M1), under Node's own runner (the design system has no vitest).
 *
 * Why this test matters: the catalog grows to 130-170 entries written by
 * several subagents in parallel. What breaks silently at that size: two
 * entries with one id (the second is unreachable), a custom shader without
 * its own program cache key (every entry from that factory draws with the
 * first one's program), a grey sphere nobody can tell from its neighbour
 * (the owner asked for colour), and a label too long to read. The page
 * never reports these; this test does.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CATALOG } from "./index.js";
import {
  CATEGORIES,
  LABEL_MAX,
  luminance,
  validateCatalog,
} from "./validate.js";

const entry = (overrides = {}) => ({
  id: "test-entry",
  category: "standard",
  name: "A test entry",
  label: "Test",
  material: { type: "MeshStandardMaterial", params: { color: 0x336699 } },
  features: [],
  costNotes: "",
  arSafe: "unmeasured",
  ...overrides,
});

describe("the catalog as shipped", () => {
  it("is valid", () => {
    assert.deepEqual(validateCatalog(CATALOG), []);
  });

  it("has the M1 categories and at least the old swatches' 12 spheres", () => {
    const categories = new Set(CATALOG.map((e) => e.category));
    for (const c of ["standard", "classic", "toon"]) {
      assert.ok(categories.has(c), `missing category ${c}`);
    }
    assert.ok(CATALOG.filter((e) => e.category === "standard").length >= 12);
    for (const c of categories) assert.ok(CATEGORIES.includes(c));
  });
});

describe("validateCatalog", () => {
  it("accepts a minimal valid entry", () => {
    assert.deepEqual(validateCatalog([entry()]), []);
  });

  it("names a duplicate id", () => {
    const problems = validateCatalog([entry(), entry()]);
    assert.deepEqual(problems, ["test-entry: duplicate id"]);
  });

  it("refuses ids that are not kebab-case, unknown categories and types", () => {
    const problems = validateCatalog([
      entry({ id: "Bad_Id" }),
      entry({ id: "b", category: "nope" }),
      entry({
        id: "c",
        material: { type: "MeshFancyMaterial", params: { color: 0x336699 } },
      }),
    ]);
    assert.equal(problems.length, 3);
    assert.match(problems[0], /kebab-case/);
    assert.match(problems[1], /unknown category/);
    assert.match(problems[2], /unknown material type/);
  });

  it("needs a name, a label no longer than the limit, features and cost notes", () => {
    const problems = validateCatalog([
      entry({ id: "a", name: "" }),
      entry({ id: "b", label: "x".repeat(LABEL_MAX + 1) }),
      entry({ id: "c", features: "pbr" }),
      entry({ id: "d", costNotes: undefined }),
    ]);
    assert.equal(problems.length, 4);
  });

  // The owner's request: coloured spheres. Near-white reads as the old grey.
  it("refuses a missing or near-white base colour", () => {
    const problems = validateCatalog([
      entry({
        id: "a",
        material: { type: "MeshStandardMaterial", params: {} },
      }),
      entry({
        id: "b",
        material: { type: "MeshStandardMaterial", params: { color: 0xf0f0f0 } },
      }),
    ]);
    assert.equal(problems.length, 2);
    assert.match(problems[1], /white/);
    assert.ok(luminance(0xf0f0f0) > 0.85 && luminance(0xc0392b) < 0.85);
  });

  // three shares one program between materials whose onBeforeCompile source
  // is equal; two entries from one factory with different parameters then
  // draw with the first one's shader.
  it("needs every custom shader to carry its own cache key", () => {
    const make = () => ({});
    const problems = validateCatalog([
      entry({ id: "a", make, color: 0x336699, material: undefined }),
      entry({
        id: "b",
        make,
        color: 0x336699,
        cacheKey: "k1",
        material: undefined,
      }),
      entry({
        id: "c",
        make,
        color: 0x336699,
        cacheKey: "k1",
        material: undefined,
      }),
    ]);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /cacheKey/);
    assert.match(problems[1], /also used by b/);
  });

  it("refuses something that is not an array", () => {
    assert.deepEqual(validateCatalog({}), ["the catalog must be an array"]);
  });
});
