/**
 * Rule-key tests.
 *
 * Why these tests matter:
 * The rule key is the join between OSM data and the scoring table, and its
 * failure mode is silent: a wrong separator makes every lookup miss, every
 * feature score 1 (the multiplicative identity), and the whole index look like
 * "no rules matched here" rather than like a bug. The first test below pins the
 * separator against the values actually observed in the published sheet on
 * 2026-07-28, which is the only reason we know `_` and not `=` is correct —
 * the plan's prose says `=`.
 *
 * @see osm-tags.ts.md
 */

import { describe, it, expect } from "vitest";
import {
  RULE_KEY_SEPARATOR,
  toRuleKey,
  toRuleKeys,
  splitRuleKeyForDiagnostics,
} from "./osm-tags.js";

describe("the rule key format", () => {
  it("joins with an underscore, matching the published sheet and the C# reference", () => {
    expect(RULE_KEY_SEPARATOR).toBe("_");
    expect(toRuleKey("surface", "sand")).toBe("surface_sand");
  });

  it.each([
    // These exact ids were read out of the live sheet on 2026-07-28 and are the
    // same values the C# test oracle pins. If this test fails, the sheet's key
    // convention changed and every rule lookup in the package is broken.
    ["surface", "sand", "surface_sand"],
    ["natural", "beach", "natural_beach"],
    ["landuse", "grass", "landuse_grass"],
    ["landuse", "farmland", "landuse_farmland"],
    ["building", "house", "building_house"],
    ["wheelchair", "yes", "wheelchair_yes"],
    ["barrier", "fence", "barrier_fence"],
  ])("%s=%s -> %s", (key, value, expected) => {
    expect(toRuleKey(key, value)).toBe(expected);
  });

  it("does NOT normalise case, whitespace or units", () => {
    // The rule table is keyed on raw OSM values and the long tail is the point.
    // "Helpfully" normalising here would break exact matches such as
    // surface=sand while silently creating new ones.
    expect(toRuleKey("Surface", "Sand")).toBe("Surface_Sand");
    expect(toRuleKey("width", " 3 m")).toBe("width_ 3 m");
  });

  it("handles keys and values that themselves contain underscores", () => {
    expect(toRuleKey("public_transport", "platform")).toBe(
      "public_transport_platform",
    );
    expect(toRuleKey("building", "semidetached_house")).toBe(
      "building_semidetached_house",
    );
  });
});

describe("toRuleKeys", () => {
  it("produces one key per tag, in insertion order", () => {
    expect(
      toRuleKeys({ surface: "sand", natural: "beach", wheelchair: "yes" }),
    ).toEqual(["surface_sand", "natural_beach", "wheelchair_yes"]);
  });

  it("is empty for an untagged feature", () => {
    expect(toRuleKeys({})).toEqual([]);
  });
});

describe("splitRuleKeyForDiagnostics", () => {
  it("inverts the simple case", () => {
    expect(splitRuleKeyForDiagnostics("surface_sand")).toEqual({
      key: "surface",
      value: "sand",
    });
  });

  it("is ADMITTEDLY WRONG for keys containing underscores — hence the name", () => {
    // Documents the known limitation rather than pretending it does not exist:
    // `key_value` is not uniquely invertible because both halves may contain
    // the separator. This is why the function must never be used to round-trip
    // a key back into a tag, only to make a diagnostic message readable.
    expect(splitRuleKeyForDiagnostics("public_transport_platform")).toEqual({
      key: "public",
      value: "transport_platform",
    });
  });

  it.each(["nosplit", "_leading", "trailing_", ""])(
    "returns undefined for the unsplittable input %o",
    (input) => {
      expect(splitRuleKeyForDiagnostics(input)).toBeUndefined();
    },
  );
});
