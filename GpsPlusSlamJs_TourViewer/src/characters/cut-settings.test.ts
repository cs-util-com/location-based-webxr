import { describe, expect, it } from "vitest";

import { CUT_SETTINGS, cutSettingsOf } from "./cut-settings.js";

// Why this test matters: every page and Worker message reaches the cut
// through `cutSettingsOf`; a slider value that is NaN, a string or out of
// range must fall back to the default rather than break the flood fill.
describe("cutSettingsOf", () => {
  it("returns the defaults for anything that is not an object", () => {
    expect(cutSettingsOf(undefined)).toEqual(CUT_SETTINGS);
    expect(cutSettingsOf(null)).toEqual(CUT_SETTINGS);
    expect(cutSettingsOf("whiteTol=10")).toEqual(CUT_SETTINGS);
  });

  it("takes a finite value inside its range", () => {
    expect(cutSettingsOf({ whiteTol: 12 }).whiteTol).toBe(12);
    expect(cutSettingsOf({ whiteTol: 0 }).whiteTol).toBe(0);
  });

  it("falls back to the default for a value out of range or not a number", () => {
    expect(cutSettingsOf({ whiteTol: -1 }).whiteTol).toBe(
      CUT_SETTINGS.whiteTol,
    );
    expect(cutSettingsOf({ whiteTol: 999 }).whiteTol).toBe(
      CUT_SETTINGS.whiteTol,
    );
    expect(cutSettingsOf({ whiteTol: Number.NaN }).whiteTol).toBe(
      CUT_SETTINGS.whiteTol,
    );
    expect(cutSettingsOf({ whiteTol: "40" }).whiteTol).toBe(
      CUT_SETTINGS.whiteTol,
    );
  });

  it("drops keys it does not know", () => {
    expect(cutSettingsOf({ extra: 1 })).not.toHaveProperty("extra");
  });

  // Why this test matters: the shadow pass is a switch; a slider page or a
  // stored choice could hand in "false" or 0, which must not silently turn
  // the pass off or on.
  it("takes a switch only as a boolean", () => {
    expect(cutSettingsOf({ shadowOn: false }).shadowOn).toBe(false);
    expect(cutSettingsOf({ shadowOn: "false" }).shadowOn).toBe(true);
    expect(cutSettingsOf({ shadowOn: 0 }).shadowOn).toBe(true);
    expect(cutSettingsOf({ islandMin: true }).islandMin).toBe(
      CUT_SETTINGS.islandMin,
    );
  });
});
