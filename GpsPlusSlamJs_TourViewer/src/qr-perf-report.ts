/**
 * The Tour Viewer's `?qrperf=1` instrument: what one QR capture costs on
 * this app's path (the blit and its readback, the CPU flip, detect's wall
 * time, the solve) and how often an XR frame runs long. Its report is a
 * section of the visitor's `?debug=1` Copy log. A diagnostic buffer, not
 * app state: it lives beside the store, like the Copy log's other
 * sections.
 *
 * @see qr-perf-report.ts.md
 */

import type { CaptureTiming } from "gps-plus-slam-app-framework/ar/camera-blit-capture";
import type { QrFrontEnd } from "gps-plus-slam-app-framework/ar/qr/qr-frontend";
import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";
import { nearestRankPercentile } from "gps-plus-slam-app-framework/utils/percentile";

/** Samples kept per stage: 30 s at the 8 Hz capture cadence. */
export const QR_PERF_WINDOW = 240;
/** XR frame intervals kept: about 30 s at 60 fps, so the long-frame
 *  counts mean something. */
export const QR_PERF_FRAME_WINDOW = 1800;

const STAGES = ["blit+readback", "flip", "detect", "solve", "xr-frame"];

/** Whether the address asks for the instrument (`?qrperf=1`). */
export function qrPerfEnabled(search: string): boolean {
  return new URLSearchParams(search).get("qrperf") === "1";
}

export interface QrPerfReport {
  /** The capture's own timing (`startCameraFrameCapture`'s hook). */
  onCaptureTiming(timing: CaptureTiming): void;
  /** One XR frame's interval, in seconds (the frame loop's `dt`). */
  onXrFrame(dtSec: number): void;
  /** The front end with detect's wall time and hits counted. */
  wrapFrontEnd(frontEnd: QrFrontEnd): QrFrontEnd;
  /** The solve, timed in place. */
  wrapSolve<A extends unknown[], R>(
    solve: (...args: A) => R,
  ): (...args: A) => R;
  /** The report, one line per figure (the Copy log's section). */
  text(): string;
  /** Empties every buffer and count (the Copy log clears after a copy). */
  clear(): void;
}

function fmt(ms: number): string {
  return ms.toFixed(1);
}

export function createQrPerfReport(
  options: { now?: () => number; intervalMs?: number } = {},
): QrPerfReport {
  const now = options.now ?? (() => performance.now());
  const stages = new Map<string, number[]>();
  const counts = { captures: 0, detects: 0, hits: 0 };
  let frameSize = "";

  function record(stage: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const limit = stage === "xr-frame" ? QR_PERF_FRAME_WINDOW : QR_PERF_WINDOW;
    const xs = stages.get(stage) ?? [];
    xs.push(ms);
    if (xs.length > limit) xs.splice(0, xs.length - limit);
    stages.set(stage, xs);
  }

  function stageLine(name: string, xs: readonly number[]): string {
    return `${name.padEnd(14)} med ${fmt(interpolatingMedian(xs))}  p95 ${fmt(nearestRankPercentile(xs, 0.95))}  max ${fmt(Math.max(...xs))} ms  (n ${String(xs.length)})`;
  }

  function longFrames(): string {
    const frames = stages.get("xr-frame") ?? [];
    // No frames: nothing to count (the median of none is 0).
    const medianMs = interpolatingMedian(frames);
    const over = (k: number) => frames.filter((ms) => ms > k * medianMs).length;
    return `long frames (>1.5x / >2x median): ${String(over(1.5))} / ${String(over(2))}`;
  }

  return {
    onCaptureTiming(t) {
      counts.captures += 1;
      frameSize = `${String(t.width)}x${String(t.height)}`;
      record("blit+readback", t.blitReadbackMs);
      record("flip", t.flipCopyMs);
      record("capture-total", t.blitReadbackMs + t.flipCopyMs);
    },
    onXrFrame(dtSec) {
      if (dtSec > 0) record("xr-frame", dtSec * 1000);
    },
    wrapFrontEnd(frontEnd) {
      return {
        kind: frontEnd.kind,
        detect: async (image) => {
          const t0 = now();
          counts.detects += 1;
          try {
            const result = await frontEnd.detect(image);
            if (result !== null) counts.hits += 1;
            return result;
          } finally {
            record("detect", now() - t0);
          }
        },
        ...(frontEnd.dispose === undefined
          ? {}
          : { dispose: () => frontEnd.dispose?.() }),
      };
    },
    wrapSolve(solve) {
      return (...args) => {
        const t0 = now();
        try {
          return solve(...args);
        } finally {
          record("solve", now() - t0);
        }
      };
    },
    text() {
      const header = [
        "QRPERF tour viewer",
        frameSize === "" ? "no capture yet" : frameSize,
        ...(options.intervalMs === undefined
          ? []
          : [`interval ${String(options.intervalMs)} ms`]),
      ].join(" | ");
      const lines = [
        header,
        `captures ${String(counts.captures)}  detects ${String(counts.detects)}  hits ${String(counts.hits)}`,
      ];
      const total = stages.get("capture-total");
      if (total !== undefined) {
        lines.push(
          `capture main-thread ms per capture: med ${fmt(interpolatingMedian(total))}  max ${fmt(Math.max(...total))}`,
        );
      }
      for (const name of STAGES) {
        const xs = stages.get(name);
        if (xs !== undefined) lines.push(stageLine(name, xs));
      }
      lines.push(longFrames());
      return lines.join("\n");
    },
    clear() {
      stages.clear();
      counts.captures = 0;
      counts.detects = 0;
      counts.hits = 0;
      frameSize = "";
    },
  };
}
