/**
 * The `?qrperf` instrument: wraps the demo's capture, detect and solve with
 * timings, optionally runs a zxing comparison on the same frame, and renders a
 * screenshot-readable report. See qrperf-instrument.ts.md.
 */

import type { CaptureTiming } from "gps-plus-slam-app-framework/ar/camera-blit-capture";
import type { QrDetection, RgbaImage } from "gps-plus-slam-app-framework/ar";
import {
  createPipelineTimings,
  type PipelineSnapshot,
  type StageSummary,
} from "./pipeline-timings.js";
import {
  cornerPermutation,
  createCornerOrderTally,
  maxCornerDistance,
  rollBin,
  type Point,
  type RollBinTally,
} from "./corner-compare.js";
import type { QrPerfParams } from "./qrperf-params.js";

export type ZxingOptionSet = "default" | "fast";

/** A zxing decode of one frame, injected so unit tests need no WASM. */
export interface ZxingProbe {
  decode(
    image: RgbaImage,
    set: ZxingOptionSet,
  ): Promise<{
    ms: number;
    result: { corners: Point[]; rotationDeg: number } | null;
    /** The frame was not decodable input (e.g. malformed buffer); not an attempt. */
    skipped?: boolean;
  }>;
  /** One-off WASM load + instantiate time, ms; null until loaded. */
  loadMs(): number | null;
}

export interface QrPerfInstrumentOptions extends QrPerfParams {
  now?: () => number;
  zxing?: ZxingProbe;
}

export interface QrPerfInstrument {
  onCaptureTiming(timing: CaptureTiming): void;
  onXrFrame(dtSec: number): void;
  /** Baseline (pre-fix) runs only: the per-decode pixel copy that M3 removed. */
  onPixelCopy(ms: number): void;
  wrapDetect(
    detect: (image: RgbaImage) => Promise<QrDetection | null>,
  ): (image: RgbaImage) => Promise<QrDetection | null>;
  wrapSolve<A extends unknown[], R>(
    solve: (...args: A) => R,
  ): (...args: A) => R;
  snapshot(): PipelineSnapshot;
  cornerOrder(): Record<number, RollBinTally>;
  report(): string[];
  json(): string;
}

/** Same-frame hit counts for one zxing option set. */
interface SetTally {
  frames: number;
  native: number;
  zxing: number;
  both: number;
}

const STAGE_ORDER = [
  "blit+readback",
  "flip-copy",
  "pixel-copy",
  "detect",
  "solve",
  "zxing-default",
  "zxing-fast",
  "corner-dist",
  "xr-frame",
];

/** ~30-60 s of frame intervals, so the p95 and long-frame counts mean something. */
const XR_FRAME_WINDOW = 1800;

function fmt(ms: number): string {
  return Number.isFinite(ms) ? ms.toFixed(1) : "-";
}

/** Events per second over the last 10 s, plus the frames the busy scheduler dropped. */
function ratesLine(r: Record<string, number>): string {
  const capture = r.capture ?? 0;
  const detect = r.detect ?? 0;
  return `per s (last 10 s): capture ${fmt(capture)}  detect ${fmt(detect)}  hit ${fmt(r.hit ?? 0)}  dropped (busy) ${fmt(Math.max(0, capture - detect))}`;
}

function totalsLine(t: Record<string, number>): string {
  return `since start: captures ${t.capture ?? 0}  detects ${t.detect ?? 0}  hits ${t.hit ?? 0}`;
}

function stageLine(name: string, s: StageSummary): string {
  return `${name.padEnd(14)} med ${fmt(s.median)}  p95 ${fmt(s.p95)}  max ${fmt(s.max)} ms  (n ${s.n})`;
}

function setLine(name: ZxingOptionSet, t: SetTally): string {
  return `${name}: frames ${t.frames}  native ${t.native}  zxing ${t.zxing}  both ${t.both}`;
}

export function createQrPerfInstrument(
  options: QrPerfInstrumentOptions,
): QrPerfInstrument {
  const now = options.now ?? (() => performance.now());
  const timings = createPipelineTimings({
    stageWindows: { "xr-frame": XR_FRAME_WINDOW },
  });
  const tally = createCornerOrderTally();
  const sets: Record<ZxingOptionSet, SetTally> = {
    default: { frames: 0, native: 0, zxing: 0, both: 0 },
    fast: { frames: 0, native: 0, zxing: 0, both: 0 },
  };
  let frameSize = "";
  let nextSet: ZxingOptionSet = "default";

  async function compareWithZxing(
    image: RgbaImage,
    native: QrDetection | null,
  ): Promise<void> {
    const probe = options.zxing;
    if (options.mode !== "zxing" || !probe) return;
    const set = nextSet;
    try {
      const { ms, result, skipped } = await probe.decode(image, set);
      if (skipped) return;
      nextSet = set === "default" ? "fast" : "default";
      timings.record(`zxing-${set}`, ms);
      const t = sets[set];
      t.frames += 1;
      if (native) t.native += 1;
      if (result) t.zxing += 1;
      if (!native || !result) return;
      t.both += 1;
      tally.add(
        rollBin(result.rotationDeg),
        cornerPermutation(native.corners, result.corners),
      );
      timings.record(
        "corner-dist",
        maxCornerDistance(native.corners, result.corners),
      );
    } catch {
      // The comparison is diagnostic; a failed zxing call must never touch
      // the native result the demo is running on.
    }
  }

  function zxingLines(): string[] {
    const lines = [
      `zxing load ${fmt(options.zxing?.loadMs() ?? Number.NaN)} ms | same-frame hits since start:`,
      `  ${setLine("default", sets.default)}`,
      `  ${setLine("fast", sets.fast)}`,
      "corner order by roll bin (identity/other):",
    ];
    for (const [bin, t] of Object.entries(tally.summary())) {
      lines.push(
        `  ${bin.padStart(3)} deg: ${t.identity}/${t.other}  [${t.permutations.join(" ")}]`,
      );
    }
    lines.push(
      "note: zxing runs on the main thread here; read rates from ?qrperf=1",
    );
    return lines;
  }

  return {
    onCaptureTiming(t) {
      const at = now();
      timings.record("blit+readback", t.blitReadbackMs);
      timings.record("flip-copy", t.flipCopyMs);
      timings.count("capture", at);
      timings.count("capture-ms", at, t.blitReadbackMs + t.flipCopyMs);
      frameSize = `${t.width}x${t.height}`;
    },
    onPixelCopy(ms) {
      timings.record("pixel-copy", ms);
    },
    onXrFrame(dtSec) {
      if (dtSec > 0) timings.record("xr-frame", dtSec * 1000);
    },
    wrapDetect(detect) {
      return async (image) => {
        const t0 = now();
        timings.count("detect", t0);
        const result = await detect(image);
        const t1 = now();
        timings.record("detect", t1 - t0);
        if (result) timings.count("hit", t1);
        await compareWithZxing(image, result);
        return result;
      };
    },
    wrapSolve(solve) {
      return (...args) => {
        const t0 = now();
        const out = solve(...args);
        timings.record("solve", now() - t0);
        return out;
      };
    },
    snapshot: () => timings.snapshot(now()),
    cornerOrder: () => tally.summary(),
    report() {
      const snap = timings.snapshot(now());
      const variant = options.baseline ? "BASELINE (pre-fix)" : "post-fix";
      const lines = [
        `QRPERF ${options.mode} | ${variant} | ${frameSize || "no capture yet"}`,
        ratesLine(snap.ratesPerSec),
        `capture cost ${fmt(snap.ratesPerSec["capture-ms"] ?? 0)} ms/s (readback + flip, last 10 s)`,
        totalsLine(snap.totals),
      ];
      for (const name of STAGE_ORDER) {
        const s = snap.stages[name];
        if (s) lines.push(stageLine(name, s));
      }
      lines.push(
        `long frames (>1.5x / >2x median): ${snap.longFrames.over1_5x} / ${snap.longFrames.over2x}`,
      );
      if (options.mode === "zxing") lines.push(...zxingLines());
      return lines;
    },
    json() {
      return JSON.stringify({
        mode: options.mode,
        baseline: options.baseline,
        frameSize,
        ...timings.snapshot(now()),
        zxingSets: sets,
        zxingLoadMs: options.zxing?.loadMs() ?? null,
        cornerOrder: tally.summary(),
      });
    },
  };
}
