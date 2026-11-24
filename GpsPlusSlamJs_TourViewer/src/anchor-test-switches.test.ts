import { describe, expect, it } from "vitest";
import {
  ANCHOR_SWITCHES_OFF,
  anchorTestSwitchesFromSearch,
} from "./anchor-test-switches.js";

// Why: the field test runs from the deployed preview, so the jump and the
// deferral switch must work in a production build; and because a visitor
// link may carry anything, they must never act without `?debug=1`.
describe("anchorTestSwitchesFromSearch", () => {
  it("reads the jump and the deferral switch with debug=1", () => {
    expect(
      anchorTestSwitchesFromSearch("?debug=1&devWorldJumpM=2&anchors=0"),
    ).toEqual({
      devJump: { metres: 2, degrees: 0, periodS: 10 },
      deferAnchors: false,
    });
    expect(
      anchorTestSwitchesFromSearch("?debug=true&devWorldJumpDeg=5&anchors=ab"),
    ).toEqual({
      devJump: { metres: 0, degrees: 5, periodS: 10 },
      deferAnchors: "ab",
    });
    expect(anchorTestSwitchesFromSearch("?debug=1")).toEqual(
      ANCHOR_SWITCHES_OFF,
    );
  });

  it("is off without debug=1, whatever else the address says", () => {
    for (const search of [
      "?devWorldJumpM=2&anchors=0",
      "?debug=0&devWorldJumpDeg=5&anchors=ab",
      "?debug=yes&anchors=0",
      "",
    ]) {
      expect(anchorTestSwitchesFromSearch(search)).toEqual(ANCHOR_SWITCHES_OFF);
    }
    expect(anchorTestSwitchesFromSearch(undefined)).toEqual(
      ANCHOR_SWITCHES_OFF,
    );
  });
});
