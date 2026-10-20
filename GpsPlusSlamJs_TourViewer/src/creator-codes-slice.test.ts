/**
 * `onlyCreatorCodesChanged`: the test the page's store subscribers use to
 * skip a dispatch that moved the creator's code state alone.
 *
 * Why these tests matter (r902 review #1): the sightings dispatch about
 * once per stable QR frame, and the subscribers that skip them re-run the
 * readout and the placement on every other dispatch. A wrong answer either
 * way is silent: "true" for a dispatch that also moved another slice
 * leaves the readout or the placement stale, "false" for a codes-only one
 * brings back the per-frame cost. The property pins the rule over every
 * subset of changed slices.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  creatorCodesReducer,
  onlyCreatorCodesChanged,
} from "./creator-codes-slice.js";

const ROOT_KEYS = ["gpsData", "tourDocument", "visitorGuide"] as const;

function root(): Record<string, unknown> & {
  creatorCodes: ReturnType<typeof creatorCodesReducer>;
} {
  return {
    gpsData: { at: 0 },
    tourDocument: { at: 0 },
    visitorGuide: { at: 0 },
    creatorCodes: creatorCodesReducer(undefined, { type: "init" }),
  };
}

describe("onlyCreatorCodesChanged", () => {
  it("is true exactly when the creator's code state moved and no other slice did", () => {
    fc.assert(
      fc.property(
        fc.subarray([...ROOT_KEYS]),
        fc.boolean(),
        (moved, codesMoved) => {
          const before = root();
          const after = { ...before };
          for (const key of moved) after[key] = { at: 1 };
          if (codesMoved) {
            after.creatorCodes = { ...before.creatorCodes };
          }
          expect(onlyCreatorCodesChanged(before, after)).toBe(
            codesMoved && moved.length === 0,
          );
        },
      ),
    );
  });

  it("is false for the same state: a dispatch no reducer answered still reaches the subscriber", () => {
    const state = root();
    expect(onlyCreatorCodesChanged(state, state)).toBe(false);
  });

  it("is false when a slice appeared or went, whatever the codes did", () => {
    const before = root();
    const after: Record<string, unknown> & {
      creatorCodes: typeof before.creatorCodes;
    } = { ...before, creatorCodes: { ...before.creatorCodes } };
    after["added"] = {};
    expect(onlyCreatorCodesChanged(before, after)).toBe(false);
  });
});
