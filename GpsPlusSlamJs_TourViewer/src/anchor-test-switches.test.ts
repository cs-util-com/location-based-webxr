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
      anchorTestSwitchesFromSearch("?qr=x&debug=1&devWorldJumpM=2&anchors=0"),
    ).toEqual({
      devJump: { metres: 2, degrees: 0, periodS: 10 },
      deferAnchors: false,
    });
    expect(
      anchorTestSwitchesFromSearch(
        "?qr=x&debug=true&devWorldJumpDeg=5&anchors=ab",
      ),
    ).toEqual({
      devJump: { metres: 0, degrees: 5, periodS: 10 },
      deferAnchors: "ab",
    });
    expect(anchorTestSwitchesFromSearch("?qr=x&debug=1")).toEqual(
      ANCHOR_SWITCHES_OFF,
    );
  });

  // Why: the jump is folded into the world group and a creator's captures
  // read world positions, so a creator on debug=1 with a jump would save
  // shifted pins and code poses into the tour. A visitor's page (a ?qr=
  // launch) is the only place the field test runs.
  it("is off on a creator's page, debug=1 or not", () => {
    for (const search of [
      "?debug=1&devWorldJumpM=2&anchors=0",
      "?debug=true&devWorldJumpDeg=5&anchors=ab",
    ]) {
      expect(anchorTestSwitchesFromSearch(search)).toEqual(ANCHOR_SWITCHES_OFF);
    }
  });

  it("is off without debug=1, whatever else the address says", () => {
    for (const search of [
      "?qr=x&devWorldJumpM=2&anchors=0",
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
