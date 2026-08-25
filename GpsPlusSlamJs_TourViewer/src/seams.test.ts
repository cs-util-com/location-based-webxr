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

  it("exposes every device function main.ts wires", () => {
    expect(typeof realSeams.controllerDeps).toBe("object");
    expect(typeof realSeams.getArWorldGroup).toBe("function");
    expect(typeof realSeams.enableArWorldGroupAlignment).toBe("function");
    expect(typeof realSeams.startCameraFrameCapture).toBe("function");
    expect(typeof realSeams.stopCameraFrameCapture).toBe("function");
    expect(typeof realSeams.createQrFrontEnd).toBe("function");
    expect(typeof realSeams.solveQrPose).toBe("function");
    expect(typeof realSeams.getCameraPose).toBe("function");
    expect(typeof realSeams.getIntrinsics).toBe("function");
  });
});
