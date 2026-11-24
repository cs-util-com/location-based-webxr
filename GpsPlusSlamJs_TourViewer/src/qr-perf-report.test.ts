import { describe, expect, it, vi } from "vitest";
import type { QrFrontEnd } from "gps-plus-slam-app-framework/ar/qr/qr-frontend";

import {
  QR_PERF_WINDOW,
  createQrPerfReport,
  qrPerfEnabled,
} from "./qr-perf-report.js";

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

const P = { x: 0, y: 0 };
const IMAGE = { width: 2, height: 2, data: new Uint8ClampedArray(16) };

function lineOf(text: string, prefix: string): string {
  const line = text.split("\n").find((l) => l.startsWith(prefix));
  if (line === undefined) throw new Error(`no line ${prefix} in\n${text}`);
  return line;
}

describe("qrPerfEnabled", () => {
  // Why this test matters: the instrument costs nothing unless asked for;
  // only an explicit flag turns it on.
  it("is on only for ?qrperf=1", () => {
    expect(qrPerfEnabled("?qrperf=1")).toBe(true);
    expect(qrPerfEnabled("?qr=abc&debug=1&qrperf=1")).toBe(true);
    expect(qrPerfEnabled("?qrperf=0")).toBe(false);
    expect(qrPerfEnabled("?qrperf")).toBe(false);
    expect(qrPerfEnabled("")).toBe(false);
  });
});

describe("createQrPerfReport", () => {
  // Why this test matters: the capture's two costs (the GPU readback with
  // its blit, and the CPU flip) are what step 2 must remove; each needs
  // its own median and tail in the report.
  it("reports the capture's readback and flip per capture", () => {
    const c = clock();
    const report = createQrPerfReport({ now: c.now, intervalMs: 125 });
    for (const [readback, flip] of [
      [10, 6],
      [12, 7],
      [11, 5],
    ] as const) {
      report.onCaptureTiming({
        blitReadbackMs: readback,
        flipCopyMs: flip,
        width: 640,
        height: 480,
      });
      c.advance(125);
    }
    const text = report.text();
    expect(lineOf(text, "QRPERF")).toBe(
      "QRPERF tour viewer | 640x480 | interval 125 ms",
    );
    expect(lineOf(text, "blit+readback")).toMatch(
      /med 11\.0 {2}p95 12\.0 {2}max 12\.0 ms {2}\(n 3\)/,
    );
    expect(lineOf(text, "flip")).toMatch(/med 6\.0 .*\(n 3\)/);
    expect(lineOf(text, "captures")).toBe("captures 3  detects 0  hits 0");
    // Readback plus flip per capture: 16, 19, 16 ms.
    expect(lineOf(text, "capture main-thread")).toBe(
      "capture main-thread ms per capture: med 16.0  max 19.0",
    );
  });

  // Why this test matters: detect runs asynchronously in BarcodeDetector;
  // its wall time (call to result) and the hit count are what decide
  // whether a worker could gain anything.
  it("times detect's wall time and counts hits through the wrapped front end", async () => {
    const c = clock();
    const dispose = vi.fn();
    let hit = false;
    const inner: QrFrontEnd = {
      kind: "barcode-detector",
      detect: () => {
        c.advance(30);
        return Promise.resolve(
          hit ? { text: "a", corners: [P, P, P, P] } : null,
        );
      },
      dispose,
    };
    const report = createQrPerfReport({ now: c.now });
    const wrapped = report.wrapFrontEnd(inner);
    expect(wrapped.kind).toBe("barcode-detector");
    await wrapped.detect(IMAGE);
    hit = true;
    const result = await wrapped.detect(IMAGE);
    expect(result?.text).toBe("a");
    wrapped.dispose?.();
    expect(dispose).toHaveBeenCalledTimes(1);
    const text = report.text();
    expect(lineOf(text, "detect")).toMatch(/med 30\.0 .*\(n 2\)/);
    expect(lineOf(text, "captures")).toBe("captures 0  detects 2  hits 1");
  });

  // Why this test matters: a failed detect is still a detect that cost
  // time; the instrument must not swallow the error the controller
  // handles.
  it("times a failed detect and rethrows its error", async () => {
    const c = clock();
    const report = createQrPerfReport({ now: c.now });
    const wrapped = report.wrapFrontEnd({
      kind: "barcode-detector",
      detect: () => {
        c.advance(5);
        return Promise.reject(new Error("boom"));
      },
    });
    await expect(wrapped.detect(IMAGE)).rejects.toThrow("boom");
    expect(lineOf(report.text(), "detect")).toMatch(/med 5\.0 .*\(n 1\)/);
  });

  // Why this test matters: the solve is timed in place, returning the
  // solver's own result untouched.
  it("times the solve and returns its result", () => {
    const c = clock();
    const report = createQrPerfReport({ now: c.now });
    const solve = report.wrapSolve((x: number) => {
      c.advance(0.5);
      return x * 2;
    });
    expect(solve(21)).toBe(42);
    expect(lineOf(report.text(), "solve")).toMatch(/med 0\.5 .*\(n 1\)/);
  });

  // Why this test matters: long frames are relative to the session's own
  // median, so a 30 fps and a 60 fps phone are judged alike.
  it("counts long XR frames against their median", () => {
    const report = createQrPerfReport({ now: () => 0 });
    for (let i = 0; i < 8; i += 1) report.onXrFrame(1 / 60);
    report.onXrFrame(0.03); // 1.8x
    report.onXrFrame(0.05); // 3x
    report.onXrFrame(0); // no interval: ignored
    report.onXrFrame(Number.NaN);
    const text = report.text();
    expect(lineOf(text, "xr-frame")).toMatch(/\(n 10\)/);
    expect(lineOf(text, "long frames")).toBe(
      "long frames (>1.5x / >2x median): 2 / 1",
    );
  });

  // Why this test matters: a non-finite or negative timing (a clock
  // glitch) must not poison the medians.
  it("ignores timings that are not finite and >= 0", () => {
    const report = createQrPerfReport({ now: () => 0 });
    report.onCaptureTiming({
      blitReadbackMs: Number.NaN,
      flipCopyMs: -1,
      width: 1,
      height: 1,
    });
    const text = report.text();
    expect(text).not.toMatch(/^blit\+readback/m);
    expect(text).not.toMatch(/^flip/m);
    expect(lineOf(text, "captures")).toBe("captures 1  detects 0  hits 0");
  });

  // Why this test matters: the report rides along the Copy log, which
  // clears its sections after a copy; each copy then covers its own
  // stretch of the walk.
  it("clears everything", () => {
    const report = createQrPerfReport({ now: () => 0 });
    report.onCaptureTiming({
      blitReadbackMs: 1,
      flipCopyMs: 1,
      width: 4,
      height: 4,
    });
    report.onXrFrame(0.02);
    report.clear();
    const text = report.text();
    expect(lineOf(text, "QRPERF")).toBe("QRPERF tour viewer | no capture yet");
    expect(lineOf(text, "captures")).toBe("captures 0  detects 0  hits 0");
    expect(text).not.toMatch(/^xr-frame/m);
  });

  // Why this test matters: a detect in flight when the Copy log clears
  // belongs to the stretch already copied. Counted after the clear it
  // would show a hit without its detect and a detect time from before.
  it("drops a detect that started before clear()", async () => {
    const c = clock();
    const report = createQrPerfReport({ now: c.now });
    let resolve: (v: unknown) => void = () => {};
    const frontEnd = {
      kind: "test",
      detect: () =>
        new Promise((r) => {
          resolve = r;
        }),
    } as unknown as QrFrontEnd;
    const pending = report.wrapFrontEnd(frontEnd).detect(IMAGE);
    c.advance(30);
    report.clear();
    resolve({ points: [P, P, P, P] });
    await pending;
    const text = report.text();
    expect(lineOf(text, "captures")).toBe("captures 0  detects 0  hits 0");
    expect(text).not.toMatch(/^detect/m);
  });

  // Why this test matters: a long walk must not grow the buffers without
  // bound; each stage keeps its newest samples only.
  it("keeps a bounded window per stage", () => {
    const report = createQrPerfReport({ now: () => 0 });
    for (let i = 0; i < QR_PERF_WINDOW + 50; i += 1) {
      report.onCaptureTiming({
        blitReadbackMs: i < 50 ? 1000 : 1,
        flipCopyMs: 1,
        width: 1,
        height: 1,
      });
    }
    const line = lineOf(report.text(), "blit+readback");
    expect(line).toContain(`(n ${QR_PERF_WINDOW})`);
    expect(line).toContain("max 1.0");
  });
});
