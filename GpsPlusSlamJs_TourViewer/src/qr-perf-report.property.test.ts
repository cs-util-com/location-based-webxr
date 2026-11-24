import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { QR_PERF_FRAME_WINDOW, createQrPerfReport } from "./qr-perf-report.js";

function counts(text: string): { n: number; overHalf: number; over2: number } {
  const frame = /^xr-frame .*\(n (\d+)\)$/m.exec(text);
  const long = /^long frames .*: (\d+) \/ (\d+)$/m.exec(text);
  if (long === null) throw new Error(text);
  return {
    n: frame === null ? 0 : Number(frame[1]),
    overHalf: Number(long[1]),
    over2: Number(long[2]),
  };
}

describe("qr perf report: long frames", () => {
  // Why this test matters: the long-frame figure is read on a phone to
  // judge the capture's stalls; for any intervals it must be a nested
  // count (every frame over 2x is over 1.5x) within the kept window.
  it("counts nest within the kept frames", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -0.1, max: 0.5, noNaN: false }), {
          maxLength: 300,
        }),
        (dts) => {
          const report = createQrPerfReport({ now: () => 0 });
          for (const dt of dts) report.onXrFrame(dt);
          const c = counts(report.text());
          const kept = dts.filter((dt) => dt > 0).length;
          expect(c.n).toBe(Math.min(kept, QR_PERF_FRAME_WINDOW));
          expect(c.over2).toBeLessThanOrEqual(c.overHalf);
          expect(c.overHalf).toBeLessThanOrEqual(c.n);
        },
      ),
    );
  });
});
