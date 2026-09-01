/**
 * The package's one median.
 *
 * Why this test matters: the even-length rule is a CONTRACT, not an
 * implementation detail — averaging the two middles returns a value that was
 * never observed, which is right for continuous quantities (DEM elevations,
 * affordance scores) and wrong for picking a representative real sample. Two
 * copies of this function used to live in the package under the same name;
 * pinning the rule here is what stops the next copy from quietly choosing
 * the other one.
 *
 * Moved here verbatim from `elevation/elevation-provider.test.ts` when the
 * implementation moved, plus the non-mutation case the sidecar promises.
 */
import { describe, expect, it } from "vitest";

import { median } from "./median.js";

describe("median", () => {
  it("is the middle of an odd sample", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middles of an even sample", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is undefined for no samples, not 0", () => {
    expect(median([])).toBeUndefined();
  });

  it("ignores input order", () => {
    expect(median([5, 1, 9, 3, 7])).toBe(median([9, 7, 5, 3, 1]));
  });

  it("does not reorder the caller's array", () => {
    // It sorts a copy. A caller that medians a list it still needs in
    // arrival order (region scores, per-cell samples) must not be surprised.
    const values = [5, 1, 9];
    median(values);
    expect(values).toEqual([5, 1, 9]);
  });
});
