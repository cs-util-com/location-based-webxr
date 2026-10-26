/**
 * The film's `?debug=1` parts, for measuring on a phone: the readout text
 * (renderer, pixel ratio and quality, scene build time, the film's time,
 * the live frame percentiles and the whole run's frames over 50 and
 * 100 ms) and quality knobs read from the page's address
 * (`film-dpr`, `film-shadows`, `film-eye`, `film-aa`), so one phone can
 * compare settings without a new build.
 *
 * Pure: text and settings in, text and settings out.
 *
 * @see film-debug.ts.md
 */
import type { SceneQuality } from "./film-scene.js";

/** The highest pixel ratio a knob may ask for (phones reach 3). */
const MAX_DPR = 3;

function flag(value: string | null): boolean | null {
  if (value === "0") return false;
  if (value === "1") return true;
  return null;
}

/**
 * `base` with the address's knobs applied: `film-dpr` (a pixel ratio cap
 * above 0, at most 3), `film-shadows`, `film-eye` (the phone screen's 3D
 * pass) and `film-aa` (antialiasing), each `0` or `1`. A knob it cannot
 * read is ignored.
 */
export function debugQuality(search: string, base: SceneQuality): SceneQuality {
  const q = new URLSearchParams(search);
  const dprText = q.get("film-dpr");
  const dpr = dprText === null || dprText === "" ? Number.NaN : Number(dprText);
  return {
    pixelRatioCap:
      Number.isFinite(dpr) && dpr > 0 && dpr <= MAX_DPR
        ? dpr
        : base.pixelRatioCap,
    shadows: flag(q.get("film-shadows")) ?? base.shadows,
    eyePass: flag(q.get("film-eye")) ?? base.eyePass,
    antialias: flag(q.get("film-aa")) ?? base.antialias,
  };
}

export interface ReadoutInput {
  readonly renderer: "3d" | "floor";
  readonly quality: SceneQuality;
  /** The pixel ratio the renderer draws at. */
  readonly dpr: number;
  readonly status: string;
  readonly t: number;
  readonly totalS: number;
  /** The last frames' percentiles, ms (null before the first). */
  readonly live: {
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
  } | null;
  /** The whole run's frames, counted while it played. */
  readonly run: {
    readonly count: number;
    readonly over50: number;
    readonly over100: number;
  };
  /** The longest scene build so far, ms (0: none yet). */
  readonly buildMs: number;
}

/** The whole run's frame count and its frames over 50 and 100 ms. */
export type RunCounts = ReadoutInput["run"];

/**
 * Counts every frame of a run (the live ring keeps only the last few
 * hundred). `push` ignores a non-finite or negative interval; "over" is
 * strictly over.
 */
export function createRunCounts(): {
  push(ms: number): void;
  counts(): RunCounts;
} {
  let count = 0;
  let over50 = 0;
  let over100 = 0;
  return {
    push(ms) {
      if (!(Number.isFinite(ms) && ms >= 0)) return;
      count += 1;
      if (ms > 50) over50 += 1;
      if (ms > 100) over100 += 1;
    },
    counts: () => ({ count, over50, over100 }),
  };
}

const ms = (v: number) => v.toFixed(1);

/** The readout, one fact a line. */
export function filmReadout(i: ReadoutInput): string {
  const head: string[] = [i.renderer];
  if (i.renderer === "3d") {
    head.push(`dpr ${String(Math.round(i.dpr * 100) / 100)}`);
    const on = [
      i.quality.shadows ? "shadows" : "",
      i.quality.eyePass ? "eye" : "",
      i.quality.antialias ? "aa" : "",
    ].filter((s) => s !== "");
    if (on.length > 0) head.push(on.join(" "));
  }
  if (i.buildMs > 0) head.push(`build ${String(Math.round(i.buildMs))} ms`);
  const lines = [
    head.join(", "),
    `${i.status} ${i.t.toFixed(1)} / ${i.totalS.toFixed(1)} s`,
  ];
  if (i.live) {
    lines.push(
      `p50 ${ms(i.live.p50)} p95 ${ms(i.live.p95)} max ${ms(i.live.max)} ms`,
    );
  }
  if (i.run.count > 0) {
    lines.push(
      `${String(i.run.count)} frames: ${String(i.run.over50)} over 50 ms, ${String(i.run.over100)} over 100`,
    );
  }
  return lines.join("\n");
}
