import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ANCHOR_SWITCHES_OFF,
  anchorTestSwitchesFromSearch,
} from "./anchor-test-switches.js";

describe("anchorTestSwitchesFromSearch (property)", () => {
  // Why: the "never without debug" rule must hold for any address, not
  // only the addresses the unit test names.
  it("never switches anything on for an address without a debug flag", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 12 }),
          fc.oneof(
            fc.constantFrom("0", "ab", "AB", "2", "-5", "1e3"),
            fc.string({ maxLength: 6 }),
          ),
        ),
        (params) => {
          const query = new URLSearchParams(params);
          query.delete("debug");
          const result = anchorTestSwitchesFromSearch(`?${query.toString()}`);
          expect(result).toEqual(ANCHOR_SWITCHES_OFF);
        },
      ),
    );
  });
});
