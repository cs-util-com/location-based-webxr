/**
 * The `?qrperf` instrument: wraps the demo's capture, detect and solve with
 * timings, optionally runs a zxing comparison on the same frame, and renders a
 * screenshot-readable report. See qrperf-instrument.ts.md.
 */

import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import { createFusedTally, fusedLines } from "./fused-tally.js";
import type { SizeState } from "./motion-tally.js";
import {
  createOrderChainTally,
  type OrderChainSummary,
} from "./order-chain-tally.js";
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
import {
  createPoseQuality,
  type PoseQualitySample,
  type PoseQualitySummary,
} from "./pose-quality.js";

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
  /** The capture interval the demo runs at, ms (shown in the report). */
  intervalMs?: number;
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
  /**
   * The demo's fused pose after a lock (M3b b5), tallied for the report;
   * `size` is the code's size state then (plan §30's switch log).
   */
  onFused(result: QrFusedPose, size?: SizeState): void;
  /** One NEW fused/motion evaluation's cost, ms (plan §30). */
  onFusedCost(ms: number): void;
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
  "fused",
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

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

function isFiniteTuple(v: unknown, length: number): boolean {
  return (
    Array.isArray(v) &&
    v.length === length &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

function isPoints(v: unknown): v is Point[] {
  return (
    Array.isArray(v) &&
    v.length >= 4 &&
    v.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        Number.isFinite((p as Point).x) &&
        Number.isFinite((p as Point).y),
    )
  );
}

/** The solved world rotation and reprojection error, or null for any other shape. */
function readSolution(
  out: unknown,
): { rotation: Quat; reprojectionErrorPx: number } | null {
  if (typeof out !== "object" || out === null) return null;
  const o = out as {
    qrPoseWorld?: { rotation?: unknown };
    reprojectionErrorPx?: unknown;
  };
  const rotation = o.qrPoseWorld?.rotation;
  if (!isFiniteTuple(rotation, 4)) return null;
  if (typeof o.reprojectionErrorPx !== "number") return null;
  return {
    rotation: rotation as Quat,
    reprojectionErrorPx: o.reprojectionErrorPx,
  };
}

/** The corners and camera pose a solve was given, or null for any other shape. */
function readSolveInput(
  input: unknown,
): { corners: Point[]; position: Vec3; rotation: Quat } | null {
  if (typeof input !== "object" || input === null) return null;
  const i = input as {
    imagePoints?: unknown;
    cameraPose?: { position?: unknown; rotation?: unknown };
  };
  const camera = i.cameraPose;
  if (!isPoints(i.imagePoints)) return null;
  if (!isFiniteTuple(camera?.position, 3)) return null;
  if (!isFiniteTuple(camera?.rotation, 4)) return null;
  return {
    corners: i.imagePoints,
    position: camera!.position as Vec3,
    rotation: camera!.rotation as Quat,
  };
}

/**
 * Read a solve's input and output defensively: the wrapper is generic, so a
 * solve of another shape (or a failed one) yields `null`, never a throw.
 */
function readSolve(
  text: string,
  input: unknown,
  out: unknown,
  atMs: number,
): PoseQualitySample | null {
  const solution = readSolution(out);
  const given = readSolveInput(input);
  if (!solution || !given) return null;
  return {
    text,
    qrRotationWorld: solution.rotation,
    corners: given.corners,
    cameraPosition: given.position,
    cameraRotation: given.rotation,
    reprojectionErrorPx: solution.reprojectionErrorPx,
    atMs,
  };
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The chained corner order's audit and unsure runs (plan §42 S4). */
function chainLine(c: OrderChainSummary): string {
  const r = c.unsureRuns;
  return `corner order chain audit agree ${c.audit.agree} | disagree ${c.audit.disagree} | reject ${c.audit.reject} || unsure runs 1/2-4/5-8/9+ ${r.r1}/${r.r2to4}/${r.r5to8}/${r.r9plus}`;
}

/** Corner-order sources and the big jumps' classes (plan §39 F0b). */
function orderLine(q: PoseQualitySummary): string {
  const o = q.orderSources;
  const b = q.bigJumps;
  const pairs = Object.entries(b.sources)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  return `corner order: finder ${o.finder} | memory ${o.memory} | native ${o.native} | unknown ${o.unknown} || big jumps: relabel ${b.relabel}, normal change ${b.normalChange}${pairs ? ` (${pairs})` : ""}`;
}

/** The pose-quality lines (QR near-frontal pose plan 2026-09-23-2314, M1). */
function poseLines(q: PoseQualitySummary): string[] {
  if (q.reprojectionPx.n === 0) {
    return [
      "pose: no solves yet (the demo solves once a depth-measured size exists)",
    ];
  }
  const { strict, loose } = q.stillJitterPx;
  const e = q.wallElevationDeg;
  return [
    `pose jumps (${q.pairs} pairs) p50 ${fmt(q.jumpDeg.p50)} p95 ${fmt(q.jumpDeg.p95)} max ${fmt(q.jumpDeg.max)} deg | >3/5/10 ${pct(q.jumpShare.over3)}/${pct(q.jumpShare.over5)}/${pct(q.jumpShare.over10)} | >60 ${q.jumpsOver60}`,
    `still jitter px: 2mm/0.1deg n ${strict.n} p50 ${fmt(strict.p50)} p95 ${fmt(strict.p95)} | 5mm/0.3deg n ${loose.n} p50 ${fmt(loose.p50)} p95 ${fmt(loose.p95)}`,
    `reproj px p50 ${fmt(q.reprojectionPx.p50)} p95 ${fmt(q.reprojectionPx.p95)} (n ${q.reprojectionPx.n})`,
    `wall normal elevation |p50| ${fmt(e.p50Abs)} |p95| ${fmt(e.p95Abs)} mean ${fmt(e.meanSigned)} deg (n ${e.n})`,
    orderLine(q),
  ];
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
  const pose = createPoseQuality();
  const fused = createFusedTally();
  /** Solves attempted and accepted (a null result failed, e.g. the 4 px gate). */
  const solves = { accepted: 0, attempted: 0 };
  /** The text of the latest detection; the solve that follows is its frame's. */
  let lastText: string | null = null;
  const orderChain = createOrderChainTally();
  /** The corner-order source of the detection `lastText` came from (plan §39 F0b). */
  let lastOrderSource: QrDetection["orderSource"];

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
        lastText = result?.text ?? null;
        lastOrderSource = result?.orderSource;
        if (result) orderChain.add(result);
        await compareWithZxing(image, result);
        return result;
      };
    },
    wrapSolve(solve) {
      return (...args) => {
        const t0 = now();
        const out = solve(...args);
        timings.record("solve", now() - t0);
        solves.attempted += 1;
        if (out !== null && out !== undefined) solves.accepted += 1;
        const sample =
          lastText === null ? null : readSolve(lastText, args[0], out, t0);
        if (sample)
          pose.add(
            lastOrderSource
              ? { ...sample, orderSource: lastOrderSource }
              : sample,
          );
        return out;
      };
    },
    onFused(result, size) {
      fused.add(result, now(), size);
    },
    onFusedCost(ms) {
      timings.record("fused", ms);
    },
    snapshot: () => timings.snapshot(now()),
    cornerOrder: () => tally.summary(),
    report() {
      const snap = timings.snapshot(now());
      const variant = options.baseline ? "BASELINE (pre-fix)" : "post-fix";
      const lines = [
        `QRPERF ${options.mode} | ${variant} | ${frameSize || "no capture yet"}${options.intervalMs === undefined ? "" : ` | interval ${options.intervalMs} ms`}`,
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
      lines.push(
        `solves accepted ${solves.accepted} / ${solves.attempted}`,
        ...poseLines(pose.summary()),
        ...fusedLines(fused.summary()),
        chainLine(orderChain.summary()),
      );
      if (options.mode === "zxing") lines.push(...zxingLines());
      return lines;
    },
    json() {
      return JSON.stringify({
        mode: options.mode,
        baseline: options.baseline,
        frameSize,
        intervalMs: options.intervalMs ?? null,
        ...timings.snapshot(now()),
        pose: pose.summary(),
        solves,
        fused: fused.summary(),
        zxingSets: sets,
        zxingLoadMs: options.zxing?.loadMs() ?? null,
        cornerOrder: tally.summary(),
        cornerOrderChain: orderChain.summary(),
      });
    },
  };
}
