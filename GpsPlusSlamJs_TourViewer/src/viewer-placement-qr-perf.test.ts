/**
 * The `?qrperf=1` instrument's hooks in the viewer pipeline: the QR
 * controller is built with the instrument's timed front end and solve.
 * Also the decode stamp the tracker capture gate's burst reads.
 */
import { describe, expect, it, vi } from "vitest";
import type { QrTrackingControllerConfig } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";

import { createQrPerfReport } from "./qr-perf-report.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
  endQrPipeline,
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
  return pipelineWith({ ...(qrPerf === undefined ? {} : { qrPerf }) }).config;
}

function pipelineWith(o: {
  qrPerf?: ReturnType<typeof createQrPerfReport>;
  decoded?: unknown;
  /** The front end's detect; default one resolving with `decoded`. */
  detect?: () => Promise<unknown>;
  now?: () => number;
}) {
  captured.configs.length = 0;
  const ctx = createTourViewerSession();
  const seams = {
    schedule: () => () => undefined,
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: o.detect ?? (() => Promise.resolve(o.decoded ?? null)),
    }),
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => null,
  } as unknown as TourViewerSeams;
  const placement = createViewerPlacement({
    ctx,
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
    ...(o.qrPerf === undefined ? {} : { qrPerf: o.qrPerf }),
    ...(o.now === undefined ? {} : { now: o.now }),
  });
  placement.startViewerPipeline();
  const config = captured.configs[0];
  if (config === undefined) throw new Error("no controller was built");
  return { config, ctx };
}

const IMAGE = { width: 1, height: 1, data: new Uint8ClampedArray(4) };

const CODE = {
  text: "https://example.test/level.json",
  corners: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
};

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

  // Why this test matters: the capture gate's burst opens on a decode,
  // before any lock; a decode the session never stamped would leave the
  // decodes a lock needs at 1 Hz. An empty frame stamps nothing, and the
  // stamp ends with the pipeline. The instrument wraps the stamped front
  // end, so both see every decode.
  it("stamps the newest decode on the session, lock or not", async () => {
    const code = {
      text: "https://example.test/level.json",
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    };
    const empty = pipelineWith({ now: () => 1_234 });
    await empty.config.frontEnd.detect(IMAGE);
    expect(empty.ctx.qrDecodeAtMs).toBeNull();
    const report = createQrPerfReport({ now: () => 0 });
    const hit = pipelineWith({
      decoded: code,
      now: () => 1_234,
      qrPerf: report,
    });
    await hit.config.frontEnd.detect(IMAGE);
    expect(hit.ctx.qrDecodeAtMs).toBe(1_234);
    expect(report.text()).toContain("hits 1");
    endQrPipeline(hit.ctx);
    expect(hit.ctx.qrDecodeAtMs).toBeNull();
  });

  // Why this test matters: a detect still in flight when the pipeline ends
  // must not stamp the ended session; a stamp then would open the next
  // session's burst for a decode it never made.
  it("a decode that resolves after the pipeline ended stamps nothing", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const pending = pipelineWith({
      detect: () =>
        new Promise((r) => {
          resolve = r;
        }),
      now: () => 1_234,
    });
    const detecting = pending.config.frontEnd.detect(IMAGE);
    endQrPipeline(pending.ctx);
    resolve(CODE);
    await expect(detecting).resolves.toBe(CODE);
    expect(pending.ctx.qrDecodeAtMs).toBeNull();
  });

  // Why this test matters: a code the session already knows it cannot use
  // (no level in this tour, no print size, ignored by the moved-code check)
  // must not keep the capture gate's burst open while it stays in view; a
  // code not resolved yet may be the tour's and still stamps, and so does
  // a usable one.
  it("stamps a decode only for a code that may be the tour's", async () => {
    const stampFor = async (
      setUp: (ctx: ReturnType<typeof pipelineWith>["ctx"]) => void,
    ) => {
      const p = pipelineWith({ decoded: CODE, now: () => 1_234 });
      setUp(p.ctx);
      await p.config.frontEnd.detect(IMAGE);
      return p.ctx.qrDecodeAtMs;
    };
    const usable = {
      version: 1,
      qr: {
        physicalSizeM: 0.2,
        geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
      },
    } as const;
    expect(await stampFor(() => undefined)).toBe(1_234);
    expect(
      await stampFor((ctx) => ctx.levelByText.set(CODE.text, usable)),
    ).toBe(1_234);
    expect(
      await stampFor((ctx) => ctx.levelByText.set(CODE.text, null)),
    ).toBeNull();
    expect(
      await stampFor((ctx) =>
        ctx.levelByText.set(CODE.text, { version: 1, qr: {} }),
      ),
    ).toBeNull();
    expect(
      await stampFor((ctx) => {
        ctx.levelByText.set(CODE.text, usable);
        ctx.levelIdByText.set(CODE.text, "level-1");
        ctx.ignoredCodes.set("level-1", { text: CODE.text, vetoSpreadM: 9 });
      }),
    ).toBeNull();
  });

  // Why this test matters: without the flag the pipeline runs on the seams
  // untouched, so a visitor pays nothing.
  it("without the instrument the controller's front end is the seam's", async () => {
    const config = pipeline();
    expect(config.frontEnd.kind).toBe("barcode-detector");
    await expect(config.frontEnd.detect(IMAGE)).resolves.toBeNull();
  });
});
