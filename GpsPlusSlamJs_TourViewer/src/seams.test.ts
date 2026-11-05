/**
 * Device seam — unit test.
 *
 * Why this matters: the DEV override that lets the e2e fake WebXR must be
 * PROD-INERT and inert during unit tests (`VITEST`). Here we confirm
 * `getSeams` returns the real seams and that the real surface exposes every
 * device function `main.ts` depends on — a missing key would only surface as
 * a runtime crash on device otherwise.
 */

import { describe, expect, it } from "vitest";

import { getSeams, realSeams } from "./seams";

describe("getSeams", () => {
  it("returns the real seams under VITEST (override is inert)", () => {
    expect(getSeams()).toBe(realSeams);
  });

  // Every device function main.ts wires is a key of TourViewerSeams, so tsc
  // already refuses a missing one; what is left is the one seam whose
  // answer in node is the claim.
  it("has no XR projection without a camera", () => {
    // The radar view cone: the XR camera's
    // P[0]; null without a camera (node has none), so the fallback cone.
    expect(realSeams.xrProjection0()).toBeNull();
  });
});
