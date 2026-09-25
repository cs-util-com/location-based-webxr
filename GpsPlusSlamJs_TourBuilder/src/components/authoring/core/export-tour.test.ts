import { describe, expect, it } from "vitest";

import type { AuthoringSliceState } from "../../../store/authoring-slice.js";
import { TourValidationError } from "../../../store/validate-tour.js";
import { buildValidatedExport } from "./export-tour.js";

/**
 * Why this matters: a draft must not be able to export something the schema
 * itself would reject — this reuses component 3's own validator (the load-time
 * gate every viewer runs) so authoring and viewing agree on "valid" by
 * construction, rather than re-implementing the invariants a second time.
 */

const VALID_DRAFT: AuthoringSliceState = {
  name: "Castle Walk",
  description: "",
  assets: [],
  waypoints: [
    {
      id: "wp-1",
      position: { lat: 50.7753, lon: 6.0839 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: {},
    },
  ],
  breadcrumb: [{ lat: 50.7753, lon: 6.0839 }],
};

describe("buildValidatedExport", () => {
  it("round-trips a valid draft through validateTour untouched", () => {
    const tour = buildValidatedExport({ authoring: VALID_DRAFT });
    expect(tour.name).toBe("Castle Walk");
    expect(tour.waypoints).toHaveLength(1);
    expect(tour.breadcrumb).toEqual(VALID_DRAFT.breadcrumb);
  });

  it("propagates the validator's error for an invalid draft instead of exporting partial data", () => {
    const invalid: AuthoringSliceState = {
      ...VALID_DRAFT,
      waypoints: [
        {
          ...VALID_DRAFT.waypoints[0]!,
          // activeRadius > prefetchRadius violates contract invariant 5.
          prefetchRadius: 5,
          activeRadius: 25,
        },
      ],
    };
    expect(() => buildValidatedExport({ authoring: invalid })).toThrow(
      TourValidationError,
    );
  });
});
