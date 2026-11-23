/**
 * The `?qrperf=1` instrument's hooks in the viewer pipeline: the QR
 * controller is built with the instrument's timed front end and solve.
 */
import { describe, expect, it, vi } from "vitest";
import type { QrTrackingControllerConfig } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";

import { createQrPerfReport } from "./qr-perf-report.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";

const captured = vi.hoisted(() => ({
  configs: [] as QrTrackingControllerConfig[],
}));
vi.mock("gps-plus-slam-app-framework/ar/qr/qr-tracking-controller", () => ({
  createQrTrackingController: (config: QrTrackingControllerConfig) => {
    captured.configs.push(config);
    return {
      offerFrame: () => undefined,
      isBusy: () => false,
      status: "idle",
      reset: () => undefined,
      dispose: () => undefined,
    };
  },
}));

function pipeline(qrPerf?: ReturnType<typeof createQrPerfReport>) {
  captured.configs.length = 0;
  const seams = {
    schedule: () => () => undefined,
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: () => Promise.resolve(null),
    }),
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => null,
  } as unknown as TourViewerSeams;
  const placement = createViewerPlacement({
    ctx: createTourViewerSession(),
    mode: "visitor",
    arStore: createTourViewerStore(),
    arController: { getState: () => ({ status: "running" }) } as never,
    seams,
    errorBox: { textContent: "" } as HTMLElement,
    escapeButton: {
      hidden: true,
      addEventListener: () => undefined,
    } as unknown as HTMLButtonElement,
    hooks: createUnwiredHooks(),
    ...(qrPerf === undefined ? {} : { qrPerf }),
  });
  placement.startViewerPipeline();
  const config = captured.configs[0];
  if (config === undefined) throw new Error("no controller was built");
  return config;
}

const IMAGE = { width: 1, height: 1, data: new Uint8ClampedArray(4) };

describe("the viewer pipeline under ?qrperf=1", () => {
  // Why this test matters: the report's detect and solve figures are only
  // real if the controller runs the instrument's wrapped calls, not the
  // bare seams.
  it("builds the controller on the instrument's front end and solve", async () => {
    const report = createQrPerfReport({ now: () => 0 });
    const config = pipeline(report);
    await config.frontEnd.detect(IMAGE);
    config.solvePose({} as never);
    const text = report.text();
    expect(text).toContain("captures 0  detects 1  hits 0");
    expect(text).toMatch(/^solve .*\(n 1\)$/m);
  });

  // Why this test matters: without the flag the pipeline runs on the seams
  // untouched, so a visitor pays nothing.
  it("without the instrument the controller's front end is the seam's", async () => {
    const config = pipeline();
    expect(config.frontEnd.kind).toBe("barcode-detector");
    await expect(config.frontEnd.detect(IMAGE)).resolves.toBeNull();
  });
});
