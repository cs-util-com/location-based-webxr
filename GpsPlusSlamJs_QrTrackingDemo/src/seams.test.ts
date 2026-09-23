/**
 * Device seam — unit test.
 *
 * Why this matters: the DEV override that lets the e2e fake WebXR must be
 * PROD-INERT and inert during unit tests (`VITEST`). Here we confirm `getSeams`
 * returns the real seams and that the real surface exposes every device function
 * `main.ts` depends on — a missing key would only surface as a runtime crash on
 * device otherwise.
 */

import { describe, it, expect, vi } from "vitest";
import { getSeams, realSeams } from "./seams";

describe("getSeams", () => {
  it("returns the real seams under VITEST (override is inert)", () => {
    expect(getSeams()).toBe(realSeams);
  });

  it("exposes every device function main.ts wires", () => {
    expect(typeof realSeams.checkSupport).toBe("function");
    expect(typeof realSeams.initAR).toBe("function");
    expect(typeof realSeams.endARSession).toBe("function");
    expect(typeof realSeams.getArWorldGroup).toBe("function");
    expect(typeof realSeams.createDetect).toBe("function");
    expect(typeof realSeams.getDepthContext).toBe("function");
    expect(typeof realSeams.startFrameSource).toBe("function");
  });
});

/**
 * Why these tests matter (QR perf plan 2026-09-23, M3 / DEC-Q7): the
 * `?qrperf=1&baseline=1` A/B run must reproduce the PRE-fix pixel handling -
 * a full copy of the frame per decode - while the normal path hands the owned
 * buffer over as-is. Both run in the same build, so the phone measures the
 * difference directly. Node has no BarcodeDetector or ImageData; stubs stand
 * in and prove which array reaches the detector.
 */
describe("realSeams.createDetect pixel handling", () => {
  class ImageDataStub {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }

  function withDetector(run: (seen: unknown[]) => Promise<void>) {
    const seen: unknown[] = [];
    class BarcodeDetectorStub {
      detect(source: unknown) {
        seen.push(source);
        return Promise.resolve([]);
      }
    }
    vi.stubGlobal("ImageData", ImageDataStub);
    vi.stubGlobal("BarcodeDetector", BarcodeDetectorStub);
    return run(seen).finally(() => vi.unstubAllGlobals());
  }

  const image = () => ({
    data: new Uint8ClampedArray(2 * 2 * 4),
    width: 2,
    height: 2,
  });

  it("hands the owned frame buffer to the detector without copying", () =>
    withDetector(async (seen) => {
      const frame = image();
      await realSeams.createDetect()(frame);
      expect((seen[0] as ImageDataStub).data).toBe(frame.data);
    }));

  it("copies the frame per decode in the baseline (pre-fix) mode", () =>
    withDetector(async (seen) => {
      const frame = image();
      await realSeams.createDetect({ copyPixels: true })(frame);
      const handed = (seen[0] as ImageDataStub).data;
      expect(handed).not.toBe(frame.data);
      expect(Array.from(handed)).toEqual(Array.from(frame.data));
    }));
});
