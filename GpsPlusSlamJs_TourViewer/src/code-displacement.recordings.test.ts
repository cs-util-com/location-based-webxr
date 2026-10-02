/**
 * D20 recalibration on REAL recordings (authoring plan 2026-09-28-0953
 * §3.6, §7l, §7m; results doc 2026-10-01-2040-moved-code-detection-results):
 * the moved-code estimators of `code-displacement.ts` and the authoring
 * prompt's offset, run on the device fixes of real Recorder walks instead of
 * M5a's synthetic Gauss-Markov model, plus a heading channel.
 *
 * Why this file matters: M5a's floors (viewer 30 m, prompt 20 m) rest on a
 * noise model the owner judged far too pessimistic ("the fused pose
 * converted back into GPS space is much more accurate than 30 m"). Here an
 * UNMOVED code is placed on real walks and the estimators' readings are the
 * false-alarm distribution itself - no noise model at all.
 *
 * OPT-IN, two phases (the default run only checks the harness frames):
 * - `D20_REAL=replay` replays every era-4+ Recorder zip of the corpus
 *   through the Tour Viewer's own store (`createTourViewerStore`, its default
 *   configuration: the recorded configuration toggles are NOT dispatched, so
 *   the alignment is the one the viewer would have published from that
 *   walk) and caches, per device fix, the fix and its odometry (through the
 *   production `displacementSamples`), the alignment published after it and
 *   the compass's AR-north bearing; per reference-point mark, the mark's AR
 *   pose and the alignment in effect. `D20_REAL_SHARD=i/n` splits the corpus.
 * - `D20_REAL=sweep` reads the cache and prints the tables (`D20R {...}`
 *   lines and a report file in the cache directory).
 *
 * Corpus: `D20_REAL_CORPUS` (default: the primary repo's `TestDataJs`, the
 * Investigation's main outdoor corpus, plus the labelled indoor and compass
 * sets of `TestDataJs-Other` and this repo's example recordings). Eras 1-3
 * would need the Recorder's migration (not a dependency of this package);
 * they are skipped and counted, as `replay-session.ts` documents for any
 * framework consumer. Recordings are only ever read through the loader:
 * nothing is unzipped by hand.
 *
 * Measured (2026-10-02; 215 walks, 11.7 h, median walk 2.8 min): the rigid
 * fit reads an unmoved code at 2-5 m (median) and 6-9 m (p90) within
 * 300 s of the scan; reported accuracy (median 5.1 m) makes
 * `correctionBoundM` about 26 m, so the coupled bound hides the floor.
 * Cross-session reference-point pairs (the real unmoved case): persisted
 * offset p90 5.3 m, p99 11 m. The results doc in the primary repo carries
 * the tables and the recommended floors; walks longer than 5 minutes are
 * barely covered, and |D| grows with time since the scan.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  arNorthBearingDeg,
  bearingDeltaDeg,
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type LatLong,
  type Quaternion,
  type Vector3,
} from "gps-plus-slam-app-framework/core";
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import {
  loadActionsFromZip,
  loadSessionMetadata,
} from "gps-plus-slam-app-framework/storage/zip-reader";

import {
  addDisplacementSample,
  CODE_MOVE_ESTIMATOR,
  displacementEstimate,
  displacementSamples,
  EMPTY_DISPLACEMENT_STATS,
  pinCode,
  type CodePin,
  type DisplacementEstimator,
  type DisplacementStats,
} from "./code-displacement.js";
import { alignmentNorthBearingDeg, fitGaussMarkov } from "./gps-noise-fit.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { throughAlignment, type NuePose } from "./visit-anchoring.js";
import { correctionBoundM } from "./visit-settle.js";

// ---------------------------------------------------------------------------
// Corpus and cache
// ---------------------------------------------------------------------------

const MODE = process.env.D20_REAL;
/** The primary repo, a sibling of this repo (or of its worktree). */
const PRIMARY =
  process.env.D20_REAL_PRIMARY ??
  path.resolve(import.meta.dirname, "../../../gps-plus-slam");
const CACHE_DIR =
  process.env.D20_REAL_CACHE ?? path.join(os.tmpdir(), "d20-real-walks");

/** Where a recording was taken, by the folder it is filed in (the
 *  Investigation's filing rule, GpsPlusSlamJs_Docs 2026-07-28-1903). */
type Place = "outdoor" | "indoor" | "mixed" | "other";

interface CorpusDir {
  readonly dir: string;
  readonly place: Place;
}

const DEFAULT_CORPUS: readonly CorpusDir[] = [
  { dir: `${PRIMARY}/TestDataJs`, place: "outdoor" },
  {
    dir: `${PRIMARY}/TestDataJs-Other/compass-tests/outdoor-straight-lines`,
    place: "outdoor",
  },
  { dir: `${PRIMARY}/TestDataJs-Other/indoor-mall-walks`, place: "indoor" },
  {
    dir: `${PRIMARY}/TestDataJs-Other/indoor-plus-loop-closure`,
    place: "indoor",
  },
  {
    dir: `${PRIMARY}/TestDataJs-Other/compass-tests/indoor-bad-gps-no-movement`,
    place: "indoor",
  },
  {
    dir: `${PRIMARY}/TestDataJs-Other/compass-tests/device-inhouse-stable`,
    place: "indoor",
  },
  {
    dir: `${PRIMARY}/TestDataJs-Other/outdoor-indoor-outdoor`,
    place: "mixed",
  },
  { dir: "../GpsPlusSlamJs_ExampleRecordings", place: "outdoor" },
];

function corpus(): CorpusDir[] {
  const custom = process.env.D20_REAL_CORPUS;
  if (custom !== undefined) {
    return custom.split(";").map((entry) => {
      const [dir, place] = entry.split("=");
      return { dir: dir!, place: (place as Place | undefined) ?? "other" };
    });
  }
  return [...DEFAULT_CORPUS];
}

function corpusZips(): { zip: string; place: Place; key: string }[] {
  const out: { zip: string; place: Place; key: string }[] = [];
  for (const { dir, place } of corpus()) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".zip")) continue;
      const tag = path.basename(dir).replace(/[^A-Za-z0-9-]/g, "_");
      out.push({
        zip: path.join(dir, f),
        place,
        key: `${tag}__${f.replace(/\.zip$/, "")}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cached walk
// ---------------------------------------------------------------------------

/** One device fix of a replayed walk. */
interface WalkFix {
  /** Fix time (epoch ms). */
  readonly t: number;
  /** Device fix, metres from the zero: north, east. */
  readonly g: readonly [number, number];
  /** Its odometry partner, odometry-NUE: north, up, east. */
  readonly o: readonly [number, number, number];
  /** Reported horizontal accuracy (m), or null. */
  readonly acc: number | null;
  /** The alignment published after this fix (column-major), or null. */
  readonly a: readonly number[] | null;
  /** Magnetic bearing of the AR north axis from the compass and the AR
   *  pose (core `arNorthBearingDeg`), portrait readings only; or null. */
  readonly compass: number | null;
}

/** One reference-point mark: a physically fixed spot the walker marked. */
interface WalkMark {
  /** The point's identity: its name when the walker gave one, else its id. */
  readonly key: string;
  readonly t: number;
  /** The mark's AR pose (raw WebXR). */
  readonly position: Vector3;
  readonly rotation: Quaternion;
  /** The alignment in effect when the mark was taken, or null. */
  readonly a: readonly number[] | null;
  /** Device fixes recorded before the mark (the mint gate counts them). */
  readonly fixesBefore: number;
}

interface Walk {
  readonly key: string;
  readonly place: Place;
  readonly era: number | null;
  readonly skipped?: string;
  readonly zero?: LatLong;
  readonly fixes?: readonly WalkFix[];
  readonly marks?: readonly WalkMark[];
  readonly actionTypes?: Record<string, number>;
  readonly portraitShare?: number;
}

/** The data actions replayed into the viewer store. Configuration toggles
 *  (`gpsData/set*Enabled`, compass modes, overrides) are deliberately left
 *  out so the solve is the viewer's own default. */
const REPLAYED = new Set([
  "gpsData/setZeroPos",
  "gpsData/recordGpsEvent",
  "gpsData/recordGpsEventBatch",
  "gpsData/odometryTrackingRestarted",
  "gpsData/arLoopClosureDetected",
  "gpsData/resetGpsSessionData",
]);

interface RecordedEvent {
  readonly odomRotation?: unknown;
  readonly rawAbsoluteOrientation?: {
    readonly quaternion?: unknown;
    readonly screenAngleDeg?: unknown;
  };
}

const isQuat = (v: unknown): v is Quaternion =>
  Array.isArray(v) &&
  v.length === 4 &&
  v.every((x) => typeof x === "number" && Number.isFinite(x));
const isVec3 = (v: unknown): v is Vector3 =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((x) => typeof x === "number" && Number.isFinite(x));

/** The compass's AR-north bearing of one recorded event; null without a
 *  portrait reading (a landscape reading's device frame differs from the
 *  AR viewer frame by the screen angle, which is not reconstructed here). */
function eventCompass(event: RecordedEvent): {
  bearing: number | null;
  portrait: boolean | null;
} {
  const ao = event.rawAbsoluteOrientation;
  if (ao === undefined || !isQuat(ao.quaternion) || !isQuat(event.odomRotation))
    return { bearing: null, portrait: null };
  if (ao.screenAngleDeg !== 0) return { bearing: null, portrait: false };
  return {
    bearing: arNorthBearingDeg(ao.quaternion, event.odomRotation),
    portrait: true,
  };
}

const round = (v: number, digits = 1e6): number =>
  Math.round(v * digits) / digits;

async function replayWalk(input: {
  zip: string;
  place: Place;
  key: string;
}): Promise<Walk> {
  const bytes = new Uint8Array(fs.readFileSync(input.zip));
  const meta = await loadSessionMetadata(bytes);
  const era =
    meta !== null && typeof meta["odomCoordVersion"] === "number"
      ? meta["odomCoordVersion"]
      : null;
  // The Recorder's migration rewrites eras 1-3 (`recording-migration.ts`):
  // era 2 stored NUE positions, eras 1 and 3 a `gpsPoint` field instead of
  // `rawGpsPoint`. Those are skipped. A recording without a version is read
  // only when its fixes already carry the current `rawGpsPoint`.
  if (era !== null && era < 4) {
    return {
      key: input.key,
      place: input.place,
      era,
      skipped: "era<4 needs the Recorder migration",
    };
  }
  const actions = await loadActionsFromZip(bytes, 64 * 1024 * 1024);
  const firstFix = actions.find(
    ({ action }) => action.type === "gpsData/recordGpsEvent",
  );
  if (
    era === null &&
    (firstFix === undefined ||
      typeof (firstFix.action.payload as { rawGpsPoint?: unknown })
        .rawGpsPoint !== "object")
  ) {
    return {
      key: input.key,
      place: input.place,
      era,
      skipped: "no version and no rawGpsPoint: needs the Recorder migration",
    };
  }
  const store = createTourViewerStore();
  const fixes: WalkFix[] = [];
  const marks: WalkMark[] = [];
  const actionTypes: Record<string, number> = {};
  let portrait = 0;
  let withCompass = 0;
  for (const { action } of actions) {
    actionTypes[action.type] = (actionTypes[action.type] ?? 0) + 1;
    if (
      action.type === "refPoints/addRefPointEntry" ||
      action.type === "gpsData/markReferencePoint"
    ) {
      const p = action.payload as {
        id?: unknown;
        name?: unknown;
        timestamp?: unknown;
        position?: unknown;
        rotation?: unknown;
      };
      if (
        typeof p.id === "string" &&
        typeof p.timestamp === "number" &&
        isVec3(p.position) &&
        isQuat(p.rotation)
      ) {
        const a = selectAlignmentMatrix(store.getState());
        marks.push({
          key:
            typeof p.name === "string" && p.name.trim() !== ""
              ? `name:${p.name.trim().toLowerCase()}`
              : `id:${p.id}`,
          t: p.timestamp,
          position: p.position,
          rotation: p.rotation,
          a: a === null ? null : Array.from(a, (v) => round(v, 1e9)),
          fixesBefore: fixes.length,
        });
      }
      continue;
    }
    if (!REPLAYED.has(action.type)) continue;
    const before = selectGpsPositions(store.getState()).length;
    try {
      store.dispatch(action);
    } catch {
      continue;
    }
    const state = store.getState();
    const gps = selectGpsPositions(state);
    if (gps.length <= before) continue;
    const odom = selectOdometryPositions(state);
    const zero = selectZeroReference(state);
    const a = selectAlignmentMatrix(state);
    const events: RecordedEvent[] =
      action.type === "gpsData/recordGpsEventBatch"
        ? ((action.payload as { events?: RecordedEvent[] }).events ?? [])
        : [action.payload as RecordedEvent];
    for (let i = before; i < gps.length; i += 1) {
      const [sample] = displacementSamples({
        gpsPositions: [gps[i]!],
        odometryPositions: [odom[i]!],
        zero,
      });
      if (sample === undefined) continue;
      const o = odom[i]!;
      const { bearing, portrait: isPortrait } = eventCompass(
        events[i - before] ?? {},
      );
      if (isPortrait !== null) withCompass += 1;
      if (isPortrait === true) portrait += 1;
      fixes.push({
        t: sample.tMs,
        g: [round(sample.gps[0]), round(sample.gps[1])],
        o: [round(o[0]), round(o[1]), round(o[2])],
        acc: sample.accuracyM ?? null,
        a: a === null ? null : Array.from(a, (v) => round(v, 1e9)),
        compass: bearing === null ? null : round(bearing),
      });
    }
  }
  const zero = selectZeroReference(store.getState());
  return {
    key: input.key,
    place: input.place,
    era,
    ...(zero === null ? { skipped: "no zero" } : { zero }),
    fixes,
    marks,
    actionTypes,
    portraitShare: withCompass === 0 ? Number.NaN : portrait / withCompass,
  };
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function shardOf(): { i: number; n: number } {
  const [i, n] = (process.env.D20_REAL_SHARD ?? "0/1").split("/").map(Number);
  return { i: i ?? 0, n: n ?? 1 };
}

describe.runIf(MODE === "replay")("D20 real walks: replay to cache", () => {
  it(
    "replays every era-4+ recording of the corpus into the cache",
    async () => {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const { i, n } = shardOf();
      const zips = corpusZips().filter((_, k) => k % n === i);
      for (const z of zips) {
        const out = cachePath(z.key);
        if (fs.existsSync(out)) continue;
        const t0 = performance.now();
        let walk: Walk;
        try {
          walk = await replayWalk(z);
        } catch (e) {
          walk = {
            key: z.key,
            place: z.place,
            era: null,
            skipped: `load error: ${String(e).slice(0, 200)}`,
          };
        }
        fs.writeFileSync(out, JSON.stringify(walk));
        process.stdout.write(
          `D20R-REPLAY ${z.key} era=${String(walk.era)} fixes=${walk.fixes?.length ?? 0} marks=${walk.marks?.length ?? 0} ${walk.skipped ?? ""} ${Math.round(performance.now() - t0)}ms\n`,
        );
      }
      expect(zips.length).toBeGreaterThan(0);
    },
    6 * 3600_000,
  );
});

// ---------------------------------------------------------------------------
// The sweep (D20_REAL=sweep): everything below reads the cache only.
//
// Parameters (declared; swept where marked):
// - virtual codes every VIRTUAL_STEP_S of a walk from the mint gate on
//   (MINT_GATE_FIXES fixes), judged on the fixes AFTER the scan only (the
//   walk's earlier fixes made the alignment that saved the code), for at
//   most HORIZON_S;
// - the rule's evidence gate (minSpanS 0/30/60/120 s, minSpreadM
//   0/2/5/10 m; swept), floor 8-30 m (swept), the bound
//   max(floor, correctionBoundM(device median accuracy, saved accuracy,
//   factor 3, default 5 m)) as `judgeCodeDisplacement` computes it;
// - a move is injected as the saved pose shifted by -move (the poster now
//   sits `move` away from where it was saved), 4 bearings; for the rigid fit
//   a move adds exactly to the estimate and a turn does not reach it, which
//   the sweep re-checks on real data before relying on it;
// - cross-session pairs: two walks' marks of the same named reference point
//   (raw-GPS marks more than PAIR_MAX_RAW_M apart are treated as a name
//   collision and dropped, counted);
// - heading: the reference for "true" is each qualified walk's FINAL
//   alignment (odometry extent >= 20/30/50 m, swept; at least 120 fixes);
//   the compass bearing is magnetic (declination not removed: it shows as
//   the median session offset).
// ---------------------------------------------------------------------------

const VIRTUAL_STEP_S = 60;
const HORIZON_S = 1200;
const CHECKPOINTS_S = [30, 60, 120, 300, 600, 1200] as const;
const FA_HORIZONS_S = [120, 300, 600, 1200] as const;
const FLOORS_M = [8, 10, 12, 15, 20, 25, 30] as const;
const SPANS_S = [0, 30, 60, 120] as const;
const SPREADS_M = [0, 2, 5, 10] as const;
const MOVES_M = [5, 10, 15, 20, 30] as const;
const MOVE_BEARINGS_DEG = [0, 90, 180, 270] as const;
const TURNS_DEG = [0, 90, 180] as const;
const HEADING_TS_DEG = [30, 45, 60, 90] as const;
const PAIR_MAX_RAW_M = 60;
/** Swept: a stricter identity test drops more name collisions and, with
 *  them, the largest genuine GPS disagreements (both are in the tail). */
const PAIR_MAX_RAW_SWEEP_M = [15, 25, 60] as const;
const HEADING_MIN_EXTENT_M = [20, 30, 50] as const;
const MINT_GATE_FIXES = 3;
const SHIPPED_GATE = { minSpanS: 60, minSpreadM: 2 } as const;

const RESIDUAL_20: DisplacementEstimator = { kind: "residual", radiusM: 20 };

function loadWalks(): Walk[] {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map(
      (f) =>
        JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), "utf8")) as Walk,
    );
}

function quantile(values: readonly number[], q: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return Number.NaN;
  const pos = (finite.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return finite[lo]! + (finite[hi]! - finite[lo]!) * (pos - lo);
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const pct = (k: number, n: number): number =>
  n === 0 ? Number.NaN : Math.round((1000 * k) / n) / 10;

function summary(values: readonly number[]): Record<string, number> {
  return {
    n: values.filter(Number.isFinite).length,
    median: r1(quantile(values, 0.5)),
    p90: r1(quantile(values, 0.9)),
    p99: r1(quantile(values, 0.99)),
    max: r1(quantile(values, 1)),
  };
}

const REPORT: string[] = [];
function emit(title: string, rows: readonly Record<string, unknown>[]): void {
  const block = [`## ${title}`, ...rows.map((r) => JSON.stringify(r))];
  REPORT.push(...block, "");
  process.stdout.write(`${block.map((l) => `D20R ${l}`).join("\n")}\n`);
}

const IDENTITY_Q: Quaternion = [0, 0, 0, 1];
const poseAt = (
  o: readonly number[],
  rotation: Quaternion = IDENTITY_Q,
): NuePose => ({
  position: [o[0]!, o[1]!, o[2]!],
  rotation,
});

/** Raw WebXR position to odometry-NUE (north, up, east). */
const nueOdom = (p: Vector3): [number, number, number] => [-p[2], p[1], p[0]];

/** A saved pose moved by -move (north, east) and turned by -turn about Up:
 *  the poster now sits `move` from, and `turn` turned against, where it was
 *  saved. */
function displaced(
  stored: NuePose,
  move: readonly [number, number],
  turnDeg: number,
): NuePose {
  const h = (-turnDeg * Math.PI) / 360;
  const s = Math.sin(h);
  const c = Math.cos(h);
  const [x, y, z, w] = stored.rotation;
  // (0, s, 0, c) * (x, y, z, w): a turn about +Y (Up in NUE) first.
  const rotation: Quaternion = [
    c * x + s * z,
    c * y + s * w,
    c * z - s * x,
    c * w - s * y,
  ];
  return {
    position: [
      stored.position[0] - move[0],
      stored.position[1],
      stored.position[2] - move[1],
    ],
    rotation,
  };
}

/** One estimator's view of a code after every fix from the scan on. */
interface Trace {
  readonly tS: number[];
  readonly dn: number[];
  readonly de: number[];
  readonly span: number[];
  readonly spread: number[];
  readonly yaw: number[];
  readonly bound: number[];
}

function sortedInsert(arr: number[], v: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, v);
}

function traceOf(input: {
  fixes: readonly WalkFix[];
  /** First fix folded into the estimate. */
  fromIdx: number;
  /** The scan: evaluation starts at the first fix at or after this time. */
  scanMs: number;
  pin: CodePin;
  estimator: DisplacementEstimator;
  storedAccM: number | null;
}): Trace {
  const out: Trace = {
    tS: [],
    dn: [],
    de: [],
    span: [],
    spread: [],
    yaw: [],
    bound: [],
  };
  let stats: DisplacementStats = EMPTY_DISPLACEMENT_STATS;
  const accs: number[] = [];
  for (let i = input.fromIdx; i < input.fixes.length; i += 1) {
    const f = input.fixes[i]!;
    const tS = (f.t - input.scanMs) / 1000;
    if (tS > HORIZON_S) break;
    stats = addDisplacementSample(stats, input.pin, input.estimator, {
      tMs: f.t,
      gps: f.g,
      odom: [f.o[0], f.o[2]],
    });
    if (f.acc !== null && Number.isFinite(f.acc)) sortedInsert(accs, f.acc);
    if (tS < 0) continue;
    const est = displacementEstimate(stats, input.estimator);
    if (est === null) continue;
    const med = accs.length === 0 ? null : accs[accs.length >> 1]!;
    out.tS.push(tS);
    out.dn.push(est.displacementM[0]);
    out.de.push(est.displacementM[1]);
    out.span.push(est.spanS);
    out.spread.push(est.spreadM);
    out.yaw.push(est.yawDeg);
    out.bound.push(
      correctionBoundM(med, input.storedAccM, {
        accuracyFactor: 3,
        defaultAccuracyM: 5,
      }),
    );
  }
  return out;
}

type Gate = { readonly minSpanS: number; readonly minSpreadM: number };

/**
 * Which bound a verdict uses: `floor` - the floor alone (the question the
 * recalibration answers: real reported accuracies make `correctionBoundM`
 * 26-50 m, so with it coupled the floor rarely matters); `coupled` -
 * max(floor, correctionBoundM(...)) exactly as `judgeCodeDisplacement`.
 */
type BoundMode = "floor" | "coupled";

/** Seconds after the scan of the first `moved`; Infinity when never. */
function firstMoved(
  tr: Trace,
  gate: Gate,
  floorM: number,
  move: readonly [number, number] = [0, 0],
  mode: BoundMode = "floor",
): number {
  for (let k = 0; k < tr.tS.length; k += 1) {
    if (!(tr.span[k]! >= gate.minSpanS) || !(tr.spread[k]! >= gate.minSpreadM))
      continue;
    const m = Math.hypot(tr.dn[k]! + move[0], tr.de[k]! + move[1]);
    const bound = mode === "floor" ? floorM : Math.max(floorM, tr.bound[k]!);
    if (m > bound) return tr.tS[k]!;
  }
  return Number.POSITIVE_INFINITY;
}

const covers = (tr: Trace, s: number): boolean => {
  const last = tr.tS[tr.tS.length - 1];
  return last !== undefined && last >= s * 0.9;
};

/** |D| at the last fix at or before each checkpoint, gated or not (NaN:
 *  the walk ends before it, or no gated estimate yet). */
function atCheckpoints(tr: Trace, gated: boolean): number[] {
  return CHECKPOINTS_S.map((c) => {
    if (!covers(tr, c)) return Number.NaN;
    let v = Number.NaN;
    for (let k = 0; k < tr.tS.length && tr.tS[k]! <= c; k += 1) {
      const ok =
        !gated ||
        (tr.span[k]! >= SHIPPED_GATE.minSpanS &&
          tr.spread[k]! >= SHIPPED_GATE.minSpreadM);
      v = ok ? Math.hypot(tr.dn[k]!, tr.de[k]!) : Number.NaN;
    }
    return v;
  });
}

/** One virtual code: a case the tables are built from. */
interface Case {
  readonly walk: string;
  readonly place: Place;
  readonly scanIdx: number;
  /** Seconds from the walk's first fix to the virtual scan. */
  readonly scanSinceStartS: number;
  readonly rigid: Trace;
  /** On every 4th code: the residual estimator, unmoved and with a 20 m
   *  move at bearing 90 per turn (it is not turn-invariant). */
  readonly residual?: Trace;
  readonly residualTurned?: Partial<Record<number, Trace>>;
}

function accMedian(fixes: readonly WalkFix[], upTo: number): number | null {
  const a = fixes
    .slice(0, upTo + 1)
    .map((f) => f.acc)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return a.length === 0 ? null : quantile(a, 0.5);
}

/** The pin and saved pose of a virtual code at fix `s` of a walk. */
function virtualCode(
  f: WalkFix,
): { code: NuePose; stored: NuePose; pin: CodePin } | null {
  if (f.a === null) return null;
  const code = poseAt(f.o);
  const stored = throughAlignment(code, f.a);
  const pin = stored === null ? null : pinCode(code, stored);
  return stored === null || pin === null ? null : { code, stored, pin };
}

/** Virtual unmoved codes on one walk (single session). */
function virtualCases(w: Walk): Case[] {
  const fixes = w.fixes ?? [];
  const out: Case[] = [];
  let nextMs = Number.NEGATIVE_INFINITY;
  for (let s = MINT_GATE_FIXES; s < fixes.length - 1; s += 1) {
    const f = fixes[s]!;
    if (f.t < nextMs) continue;
    const v = virtualCode(f);
    if (v === null) continue;
    nextMs = f.t + VIRTUAL_STEP_S * 1000;
    const base = {
      fixes,
      fromIdx: s + 1,
      scanMs: f.t,
      storedAccM: accMedian(fixes, s),
    };
    const rigid = traceOf({
      ...base,
      pin: v.pin,
      estimator: CODE_MOVE_ESTIMATOR,
    });
    if (rigid.tS.length === 0) continue;
    const c: Case = {
      walk: w.key,
      place: w.place,
      scanIdx: s,
      scanSinceStartS: (f.t - fixes[0]!.t) / 1000,
      rigid,
    };
    if (out.length % 4 !== 0) {
      out.push(c);
      continue;
    }
    const residualTurned: Partial<Record<number, Trace>> = {};
    for (const turn of TURNS_DEG) {
      const p = pinCode(v.code, displaced(v.stored, [0, 20], turn));
      if (p !== null)
        residualTurned[turn] = traceOf({
          ...base,
          pin: p,
          estimator: RESIDUAL_20,
        });
    }
    out.push({
      ...c,
      residualTurned,
      residual: traceOf({ ...base, pin: v.pin, estimator: RESIDUAL_20 }),
    });
  }
  return out;
}

function nueToOtherZero(
  position: readonly number[],
  from: LatLong,
  to: LatLong,
): [number, number, number] {
  const geo = calcGpsCoords(from, [position[0]!, position[1]!, position[2]!]);
  const nue = calcRelativeCoordsInMeters(to, geo, 0, 0);
  return [nue[0], position[1]!, nue[2]];
}

interface PairResult {
  readonly key: string;
  readonly walkA: string;
  readonly walkB: string;
  /** Reported accuracy (m) of the fix at each mark. */
  readonly accA: number | null;
  readonly accB: number | null;
  readonly offsetAtSightingM: number;
  readonly offsetPersisted20sM: number;
  readonly offsetFinalM: number;
  readonly rawGpsM: number;
  readonly all: Trace;
  readonly post: Trace;
}

function fixIndexAt(fixes: readonly WalkFix[], tMs: number): number {
  let k = -1;
  for (let i = 0; i < fixes.length && fixes[i]!.t <= tMs; i += 1) k = i;
  return k;
}

const horizontal = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

type Obs = { readonly w: Walk; readonly m: WalkMark };

/** One ordered pair: A saved the point, B sees it. Null when unusable;
 *  "collision" when the two marks' raw GPS are too far apart to be one
 *  physical spot. */
function pairResult(
  A: Obs,
  B: Obs,
  maxRawM: number,
): PairResult | "collision" | null {
  const fa = A.w.fixes![fixIndexAt(A.w.fixes!, A.m.t)];
  const fbIdx = fixIndexAt(B.w.fixes!, B.m.t);
  const fb = B.w.fixes![fbIdx];
  if (fa === undefined || fb === undefined) return null;
  const zeroA = A.w.zero!;
  const zeroB = B.w.zero!;
  const rawGpsM = horizontal(
    nueToOtherZero([fa.g[0], 0, fa.g[1]], zeroA, zeroB),
    [fb.g[0], 0, fb.g[1]],
  );
  if (rawGpsM > maxRawM) return "collision";
  const storedA = throughAlignment(
    poseAt(nueOdom(A.m.position), A.m.rotation),
    A.m.a!,
  );
  if (storedA === null) return null;
  const codeB = poseAt(nueOdom(B.m.position), B.m.rotation);
  const stored: NuePose = {
    position: nueToOtherZero(storedA.position, zeroA, zeroB),
    rotation: storedA.rotation,
  };
  const pin = pinCode(codeB, stored);
  const seenB = throughAlignment(codeB, B.m.a!);
  const finalB = B.w.fixes![B.w.fixes!.length - 1]?.a ?? null;
  const seenFinal = finalB === null ? null : throughAlignment(codeB, finalB);
  if (pin === null || seenB === null || seenFinal === null) return null;
  let persisted = horizontal(seenB.position, stored.position);
  for (let i = fbIdx + 1; i < B.w.fixes!.length; i += 1) {
    const f = B.w.fixes![i]!;
    if (f.t > B.m.t + 20_000) break;
    const seen = f.a === null ? null : throughAlignment(codeB, f.a);
    if (seen !== null)
      persisted = Math.min(
        persisted,
        horizontal(seen.position, stored.position),
      );
  }
  const base = {
    fixes: B.w.fixes!,
    scanMs: B.m.t,
    pin,
    estimator: CODE_MOVE_ESTIMATOR,
    storedAccM: accMedian(A.w.fixes!, fixIndexAt(A.w.fixes!, A.m.t)),
  };
  return {
    key: A.m.key,
    walkA: A.w.key,
    walkB: B.w.key,
    accA: fa.acc,
    accB: fb.acc,
    offsetAtSightingM: horizontal(seenB.position, stored.position),
    offsetPersisted20sM: persisted,
    offsetFinalM: horizontal(seenFinal.position, stored.position),
    rawGpsM,
    all: traceOf({ ...base, fromIdx: 0 }),
    post: traceOf({ ...base, fromIdx: fbIdx + 1 }),
  };
}

function crossSessionPairs(
  walks: readonly Walk[],
  maxRawM: number = PAIR_MAX_RAW_M,
): {
  pairs: PairResult[];
  collisions: number;
  keys: number;
} {
  const byKey = new Map<string, Obs[]>();
  for (const w of walks) {
    if (w.zero === undefined) continue;
    for (const m of w.marks ?? []) {
      if (m.a === null || m.fixesBefore < MINT_GATE_FIXES) continue;
      byKey.set(m.key, [...(byKey.get(m.key) ?? []), { w, m }]);
    }
  }
  const pairs: PairResult[] = [];
  let collisions = 0;
  let keys = 0;
  for (const list of byKey.values()) {
    if (new Set(list.map((o) => o.w.key)).size < 2) continue;
    keys += 1;
    for (const A of list) {
      for (const B of list) {
        if (A.w.key === B.w.key) continue;
        const r = pairResult(A, B, maxRawM);
        if (r === "collision") collisions += 1;
        else if (r !== null) pairs.push(r);
      }
    }
  }
  return { pairs, collisions, keys };
}

/** First `moved` per trace for one rule, over the traces' own lengths. */
function faCounts(
  traces: readonly Trace[],
  walksOf: readonly string[],
  rule: { gate: Gate; floorM: number; mode: BoundMode },
): Record<string, string> {
  const out: Record<string, string> = {};
  const firsts = traces.map((tr) =>
    firstMoved(tr, rule.gate, rule.floorM, [0, 0], rule.mode),
  );
  for (const h of [...FA_HORIZONS_S, Number.POSITIVE_INFINITY]) {
    let n = 0;
    let k = 0;
    const hit = new Set<string>();
    const seen = new Set<string>();
    traces.forEach((tr, i) => {
      // "within h" counts only codes whose walk lasts h; "any" counts every
      // code over whatever its walk offers (up to HORIZON_S).
      if (Number.isFinite(h) && !covers(tr, h)) return;
      n += 1;
      seen.add(walksOf[i]!);
      if (Number.isFinite(h) ? firsts[i]! <= h : Number.isFinite(firsts[i]!)) {
        k += 1;
        hit.add(walksOf[i]!);
      }
    });
    out[Number.isFinite(h) ? `fa${h}` : "faAny"] =
      `${pct(k, n)}% (${k}/${n}; walks ${hit.size}/${seen.size})`;
  }
  return out;
}

function falseAlarmRows(
  label: string,
  traces: readonly Trace[],
  walksOf: readonly string[],
  gates: readonly Gate[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const gate of gates) {
    for (const floorM of FLOORS_M) {
      rows.push({
        set: label,
        ...gate,
        floorM,
        bound: "floor",
        ...faCounts(traces, walksOf, { gate, floorM, mode: "floor" }),
      });
    }
  }
  // The shipped coupling, for comparison, at the shipped gate.
  for (const floorM of [8, 20, 30]) {
    rows.push({
      set: label,
      ...SHIPPED_GATE,
      floorM,
      bound: "coupled",
      ...faCounts(traces, walksOf, {
        gate: SHIPPED_GATE,
        floorM,
        mode: "coupled",
      }),
    });
  }
  return rows;
}

const ALL_GATES: readonly Gate[] = [
  ...SPANS_S.map((minSpanS) => ({ minSpanS, minSpreadM: 2 })),
  ...SPREADS_M.filter((m) => m !== 2).map((minSpreadM) => ({
    minSpanS: 60,
    minSpreadM,
  })),
];

function bearingMove(moveM: number, bearingDeg: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  return [moveM * Math.cos(rad), moveM * Math.sin(rad)];
}

/** Detection of injected moves: per horizon h, the share of codes (x 4
 *  move bearings) whose walk lasts h that read `moved` within h. */
function detectionRows(
  label: string,
  traces: readonly Trace[],
  gates: readonly Gate[],
  mode: BoundMode = "floor",
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const gate of gates) {
    for (const floorM of FLOORS_M) {
      for (const moveM of MOVES_M) {
        const row: Record<string, unknown> = {
          set: label,
          ...gate,
          floorM,
          bound: mode,
          moveM,
        };
        const all: number[] = [];
        for (const tr of traces) {
          for (const b of MOVE_BEARINGS_DEG) {
            all.push(firstMoved(tr, gate, floorM, bearingMove(moveM, b), mode));
          }
        }
        for (const h of [60, 120, 300, 600]) {
          const idx = traces.flatMap((tr, i) => (covers(tr, h) ? [i] : []));
          const times = idx.flatMap((i) =>
            MOVE_BEARINGS_DEG.map(
              (_, j) => all[i * MOVE_BEARINGS_DEG.length + j]!,
            ),
          );
          row[`det${h}`] =
            `${pct(times.filter((t) => t <= h).length, times.length)} (n ${times.length})`;
        }
        row["medianS"] = r1(quantile(all.filter(Number.isFinite), 0.5));
        rows.push(row);
      }
    }
  }
  return rows;
}

/** The odometry's horizontal extent of a walk (m): the largest distance of
 *  a fix's odometry from the walk's first. */
function extentM(fixes: readonly WalkFix[]): number {
  const o0 = fixes[0]?.o;
  if (o0 === undefined) return 0;
  let best = 0;
  for (const f of fixes)
    best = Math.max(best, Math.hypot(f.o[0] - o0[0], f.o[2] - o0[2]));
  return best;
}

interface HeadingErrors {
  /** Compass bearing minus the final alignment's, per fix (NaN: none). */
  readonly compass: number[];
  /** Published alignment's bearing minus the final's, per fix. */
  readonly published: number[];
  /** Seconds since the walk's first fix. */
  readonly tS: number[];
}

function headingErrors(w: Walk): HeadingErrors | null {
  const fixes = w.fixes ?? [];
  const last = fixes[fixes.length - 1]?.a ?? null;
  const ref = last === null ? null : alignmentNorthBearingDeg(last);
  if (ref === null) return null;
  const out: HeadingErrors = { compass: [], published: [], tS: [] };
  for (const f of fixes) {
    const pb = f.a === null ? null : alignmentNorthBearingDeg(f.a);
    out.compass.push(
      f.compass === null ? Number.NaN : bearingDeltaDeg(f.compass, ref),
    );
    out.published.push(pb === null ? Number.NaN : bearingDeltaDeg(pb, ref));
    out.tS.push((f.t - fixes[0]!.t) / 1000);
  }
  return out;
}

/** Seeded uniform [0, 1) (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

const finiteOf = (arr: readonly number[]): number[] =>
  arr.filter(Number.isFinite);

/** Cross-session heading-channel errors: the mint's published heading
 *  error from one walk minus the scan's observed error from ANOTHER walk
 *  (both against their own final alignments); seeded draws. Index k of
 *  both pools is the same walk. */
function channelDraws(
  mintPool: readonly number[][],
  scanPool: readonly number[][],
  draws: number,
  seed: number,
): number[] {
  const mints = mintPool.flatMap((a, k) => (a.length > 0 ? [k] : []));
  const scans = scanPool.flatMap((a, k) => (a.length > 0 ? [k] : []));
  if (mints.length === 0 || scans.length === 0) return [];
  if (scans.length === 1 && mints.length === 1 && scans[0] === mints[0])
    return [];
  const rnd = seeded(seed);
  const pick = (arr: readonly number[]): number =>
    arr[Math.floor(rnd() * arr.length)]!;
  const out: number[] = [];
  while (out.length < draws) {
    const i = mints[Math.floor(rnd() * mints.length)]!;
    const j = scans[Math.floor(rnd() * scans.length)]!;
    if (i === j) continue;
    out.push(wrap180(pick(mintPool[i]!) - pick(scanPool[j]!)));
  }
  return out;
}

function sweepData(all: readonly Walk[], walks: readonly Walk[]): void {
  const skipped: Record<string, number> = {};
  for (const w of all)
    if (w.skipped !== undefined)
      skipped[w.skipped] = (skipped[w.skipped] ?? 0) + 1;
  const compassWalks = walks.filter((w) =>
    (w.fixes ?? []).some((f) => f.compass !== null),
  );
  const byPlace = (ws: readonly Walk[]) =>
    Object.fromEntries(
      (["outdoor", "indoor", "mixed", "other"] as const).map((p) => [
        p,
        ws.filter((w) => w.place === p).length,
      ]),
    );
  emit("data", [
    {
      cached: all.length,
      used: walks.length,
      skipped,
      byPlace: byPlace(walks),
      withCompass: byPlace(compassWalks),
      fixes: walks.reduce((a, w) => a + (w.fixes?.length ?? 0), 0),
      marks: walks.reduce((a, w) => a + (w.marks?.length ?? 0), 0),
      walkMinutes: summary(
        walks.map((w) => {
          const f = w.fixes ?? [];
          return f.length > 1 ? (f[f.length - 1]!.t - f[0]!.t) / 60_000 : 0;
        }),
      ),
      walkMedianAccuracyM: summary(
        walks.map(
          (w) =>
            accMedian(w.fixes ?? [], (w.fixes?.length ?? 1) - 1) ?? Number.NaN,
        ),
      ),
      hours: r1(
        walks.reduce((a, w) => {
          const f = w.fixes ?? [];
          return a + (f.length > 1 ? f[f.length - 1]!.t - f[0]!.t : 0);
        }, 0) / 3_600_000,
      ),
    },
  ]);
}

function sweepVirtual(walks: readonly Walk[], cases: readonly Case[]): void {
  for (const place of ["outdoor", "indoor", "mixed"] as const) {
    const cs = cases.filter((c) => c.place === place);
    if (cs.length === 0) continue;
    const ungated = cs.map((c) => atCheckpoints(c.rigid, false));
    const gated = cs.map((c) => atCheckpoints(c.rigid, true));
    const residual = cs.flatMap((c) =>
      c.residual === undefined ? [] : [atCheckpoints(c.residual, false)],
    );
    emit(
      `virtual unmoved codes, ${place}: rigid |D| (m) by seconds since the scan (${cs.length} codes on ${new Set(cs.map((c) => c.walk)).size} walks)`,
      CHECKPOINTS_S.map((s, i) => ({
        sinceScanS: s,
        ungated: summary(ungated.map((r) => r[i]!)),
        gated60s2m: summary(gated.map((r) => r[i]!)),
        residual20: summary(residual.map((r) => r[i]!)),
      })),
    );
    emit(
      `virtual unmoved codes, ${place}: false alarms within N s (share of codes; walks with any)`,
      falseAlarmRows(
        `virtual-${place}`,
        cs.map((c) => c.rigid),
        cs.map((c) => c.walk),
        place === "outdoor" ? ALL_GATES : [SHIPPED_GATE],
      ),
    );
  }

  const outdoorAll = cases.filter((c) => c.place === "outdoor");
  for (const [label, ok] of [
    ["minted < 60 s into the walk", (c: Case) => c.scanSinceStartS < 60],
    ["minted >= 60 s into the walk", (c: Case) => c.scanSinceStartS >= 60],
  ] as const) {
    const cs = outdoorAll.filter(ok);
    emit(
      `virtual outdoor codes ${label}: false alarms (shipped gate) and |D| at 120 s (${cs.length} codes)`,
      [
        { at120: summary(cs.map((c) => atCheckpoints(c.rigid, true)[2]!)) },
        ...falseAlarmRows(
          "virtual-outdoor",
          cs.map((c) => c.rigid),
          cs.map((c) => c.walk),
          [SHIPPED_GATE],
        ).filter((r) => r["bound"] === "floor"),
      ],
    );
  }

  // What the detection arm relies on, re-checked on real data: for the
  // rigid fit an unturned move adds exactly at every fix; a turned one adds
  // exactly and puts the turn into the yaw wherever a turn is fitted
  // (spread >= the estimator's 2 m), i.e. wherever the shipped gate can
  // decide. Gates below 2 m of spread therefore report unturned moves.
  const outdoor = cases.filter((c) => c.place === "outdoor");
  let worstShift = 0;
  let worstTurnedShift = 0;
  let worstYaw = 0;
  for (const c of outdoor.slice(0, 60)) {
    const fixes = walks.find((x) => x.key === c.walk)!.fixes!;
    const f = fixes[c.scanIdx]!;
    const v = virtualCode(f)!;
    const base = {
      fixes,
      fromIdx: c.scanIdx + 1,
      scanMs: f.t,
      storedAccM: null,
      estimator: CODE_MOVE_ESTIMATOR,
    };
    const moved = (turn: number) =>
      traceOf({
        ...base,
        pin: pinCode(v.code, displaced(v.stored, [7, -12], turn))!,
      });
    const t0 = moved(0);
    const t90 = moved(90);
    for (let k = 0; k < c.rigid.tS.length; k += 1) {
      const shift = (t: Trace) =>
        Math.hypot(
          t.dn[k]! - c.rigid.dn[k]! - 7,
          t.de[k]! - c.rigid.de[k]! + 12,
        );
      worstShift = Math.max(worstShift, shift(t0));
      if (c.rigid.spread[k]! < 2) continue;
      worstTurnedShift = Math.max(worstTurnedShift, shift(t90));
      worstYaw = Math.max(
        worstYaw,
        Math.abs(Math.abs(wrap180(t90.yaw[k]! - c.rigid.yaw[k]!)) - 90),
      );
    }
  }
  emit(
    "rigid fit on real data: a 7/-12 m move adds exactly; turned 90 degrees, it still adds exactly and the turn goes to the yaw (spread >= 2 m)",
    [
      {
        codes: Math.min(60, outdoor.length),
        worstShiftErrorM: worstShift,
        worstTurnedShiftErrorM: worstTurnedShift,
        worstYawErrorDeg: worstYaw,
      },
    ],
  );
  expect(worstShift).toBeLessThan(1e-6);
  expect(worstTurnedShift).toBeLessThan(1e-6);
  expect(worstYaw).toBeLessThan(1e-6);

  emit(
    "virtual outdoor codes: detection on real noise (rigid; turn-invariant), % of codes x 4 bearings",
    detectionRows(
      "virtual-outdoor",
      outdoor.map((c) => c.rigid),
      ALL_GATES,
    ),
  );
  const withResidual = outdoor.filter(
    (c) => c.residualTurned !== undefined && covers(c.rigid, 120),
  );
  emit(
    `virtual outdoor codes: residual R=20 vs rigid, 20 m move at bearing 90, by turn (shipped gate, within 120 s; ${withResidual.length} codes)`,
    TURNS_DEG.flatMap((turn) =>
      [15, 20, 30].map((floorM) => {
        const trs = withResidual.flatMap((c) => {
          const t = c.residualTurned![turn];
          return t === undefined ? [] : [t];
        });
        const hit = trs.filter(
          (t) => firstMoved(t, SHIPPED_GATE, floorM) <= 120,
        ).length;
        const rigidHit = withResidual.filter(
          (c) => firstMoved(c.rigid, SHIPPED_GATE, floorM, [0, 20]) <= 120,
        ).length;
        return {
          turn,
          floorM,
          residual20: pct(hit, trs.length),
          rigid: pct(rigidHit, withResidual.length),
        };
      }),
    ),
  );
}

/** Quantile of values each carrying a weight (a point's pairs share one
 *  unit of weight, so a point marked 38 times does not dominate). */
function weightedQuantile(
  values: readonly number[],
  weights: readonly number[],
  q: number,
): number {
  const idx = values
    .map((v, i) => [v, weights[i]!] as const)
    .filter(([v]) => Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  const total = idx.reduce((a, [, w]) => a + w, 0);
  let seen = 0;
  for (const [v, w] of idx) {
    seen += w;
    if (seen >= q * total) return v;
  }
  return Number.NaN;
}

function pointWeighted(
  pairs: readonly PairResult[],
  pick: (p: PairResult) => number,
): Record<string, number> {
  const per = new Map<string, number>();
  for (const p of pairs) per.set(p.key, (per.get(p.key) ?? 0) + 1);
  const values = pairs.map(pick);
  const weights = pairs.map((p) => 1 / per.get(p.key)!);
  return Object.fromEntries(
    (
      [
        ["median", 0.5],
        ["p90", 0.9],
        ["p99", 0.99],
      ] as const
    ).map(([k, q]) => [k, r1(weightedQuantile(values, weights, q))]),
  );
}

/** The pair verdicts across the identity cutoff (PAIR_MAX_RAW_SWEEP_M):
 *  the persisted authoring offset and the viewer's false alarms within
 *  120 s (every fix of the visit, shipped gate, floor only). */
function sweepPairCutoffs(walks: readonly Walk[]): void {
  const rows: Record<string, unknown>[] = [];
  for (const maxRawM of PAIR_MAX_RAW_SWEEP_M) {
    const { pairs, collisions, keys } = crossSessionPairs(walks, maxRawM);
    const row: Record<string, unknown> = {
      maxRawM,
      pairs: pairs.length,
      points: keys,
      dropped: collisions,
      persisted: summary(pairs.map((p) => p.offsetPersisted20sM)),
      persistedPointWeighted: pointWeighted(
        pairs,
        (p) => p.offsetPersisted20sM,
      ),
    };
    for (const floorM of [10, 12, 15, 20, 25]) {
      row[`prompt${floorM}`] = pct(
        pairs.filter((p) => p.offsetPersisted20sM > floorM).length,
        pairs.length,
      );
      const trs = pairs.map((p) => p.all).filter((t) => covers(t, 120));
      row[`viewerFa120_${floorM}`] = pct(
        trs.filter((t) => firstMoved(t, SHIPPED_GATE, floorM) <= 120).length,
        trs.length,
      );
    }
    rows.push(row);
  }
  emit(
    "cross-session pairs across the identity cutoff (raw GPS of the two marks within maxRawM): unmoved offsets, prompt rate and viewer false alarms (%) by floor",
    rows,
  );
}

function sweepPairs(walks: readonly Walk[]): void {
  sweepPairCutoffs(walks);
  const { pairs, collisions, keys } = crossSessionPairs(walks);
  const mean = (v: readonly number[]): number =>
    r1(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length));
  emit(
    "cross-session pairs, point-weighted (each point's pairs share one weight)",
    (
      [
        ["offsetAtSightingM", (p: PairResult) => p.offsetAtSightingM],
        ["offsetPersisted20sM", (p: PairResult) => p.offsetPersisted20sM],
        ["offsetFinalM", (p: PairResult) => p.offsetFinalM],
        ["rawGpsM", (p: PairResult) => p.rawGpsM],
      ] as const
    ).map(([what, pick]) => ({ what, ...pointWeighted(pairs, pick) })),
  );
  const tail = pairs
    .filter((p) => p.offsetPersisted20sM > 12)
    .sort((a, b) => b.offsetPersisted20sM - a.offsetPersisted20sM);
  emit(
    `cross-session pairs, the tail: unmoved points offset more than 12 m for 20 s (${tail.length} ordered pairs, ${new Set(tail.map((p) => p.key)).size} points)`,
    tail.slice(0, 25).map((p) => ({
      key: p.key,
      walkA: p.walkA,
      walkB: p.walkB,
      persistedM: r1(p.offsetPersisted20sM),
      finalM: r1(p.offsetFinalM),
      rawGpsM: r1(p.rawGpsM),
      accA: p.accA === null ? null : r1(p.accA),
      accB: p.accB === null ? null : r1(p.accB),
    })),
  );
  emit(
    `cross-session reference-point pairs (${pairs.length} ordered pairs of ${keys} points; ${collisions} dropped as name collisions > ${PAIR_MAX_RAW_M} m)`,
    [
      {
        what: "authoring offset at the sighting (the visit's published alignment vs the saved pose)",
        mean: mean(pairs.map((p) => p.offsetAtSightingM)),
        ...summary(pairs.map((p) => p.offsetAtSightingM)),
      },
      {
        what: "the same, smallest over the 20 s after the sighting (the prompt's persistence)",
        mean: mean(pairs.map((p) => p.offsetPersisted20sM)),
        ...summary(pairs.map((p) => p.offsetPersisted20sM)),
      },
      {
        what: "the same through the visit's FINAL alignment",
        mean: mean(pairs.map((p) => p.offsetFinalM)),
        ...summary(pairs.map((p) => p.offsetFinalM)),
      },
      {
        what: "raw GPS distance of the two marks' fixes",
        mean: mean(pairs.map((p) => p.rawGpsM)),
        ...summary(pairs.map((p) => p.rawGpsM)),
      },
    ],
  );
  for (const [label, pick] of [
    ["every fix of the visit (the viewer)", (p: PairResult) => p.all],
    ["post-sighting fixes only", (p: PairResult) => p.post],
  ] as const) {
    const trs = pairs.map(pick);
    emit(
      `cross-session pairs, ${label}: rigid |D| (m) by seconds since the sighting`,
      CHECKPOINTS_S.map((s, i) => ({
        sinceScanS: s,
        ungated: summary(trs.map((t) => atCheckpoints(t, false)[i]!)),
        gated60s2m: summary(trs.map((t) => atCheckpoints(t, true)[i]!)),
      })),
    );
    emit(
      `cross-session pairs, ${label}: false alarms within N s`,
      falseAlarmRows(
        "pairs",
        trs,
        pairs.map((p) => p.key),
        [SHIPPED_GATE, { minSpanS: 0, minSpreadM: 2 }],
      ),
    );
    emit(
      `cross-session pairs, ${label}: detection on real noise`,
      detectionRows("pairs", trs, [SHIPPED_GATE]),
    );
  }
  emit(
    "authoring prompt on cross-session pairs: share prompted (20 s-persistent offset > floor), unmoved and moved (8 move bearings against the offset)",
    FLOORS_M.map((floorM) => {
      const row: Record<string, unknown> = {
        floorM,
        unmoved: pct(
          pairs.filter((p) => p.offsetPersisted20sM > floorM).length,
          pairs.length,
        ),
      };
      for (const moveM of MOVES_M) {
        let n = 0;
        let k = 0;
        for (const p of pairs) {
          for (let b = 0; b < 8; b += 1) {
            const ang = (b * Math.PI) / 4;
            n += 1;
            if (
              Math.hypot(
                p.offsetPersisted20sM + moveM * Math.cos(ang),
                moveM * Math.sin(ang),
              ) > floorM
            )
              k += 1;
          }
        }
        row[`move${moveM}`] = pct(k, n);
      }
      return row;
    }),
  );
}

function sweepNoiseModel(walks: readonly Walk[]): void {
  for (const minExtent of [30, 100]) {
    const series = walks
      .filter((w) => w.place === "outdoor" && extentM(w.fixes!) >= minExtent)
      .map((w) => {
        const fixes = w.fixes!;
        const last = fixes[fixes.length - 1]!.a;
        if (last === null) return [];
        return fixes.flatMap((f) => {
          const fused = throughAlignment(poseAt(f.o), last);
          return fused === null
            ? []
            : [
                {
                  tMs: f.t,
                  n: f.g[0] - fused.position[0],
                  e: f.g[1] - fused.position[2],
                },
              ];
        });
      })
      .filter((s) => s.length >= 120);
    const perWalk = series
      .map((s) => fitGaussMarkov([s]))
      .filter((f) => f !== null);
    const pooled = fitGaussMarkov(series);
    emit(
      `Gauss-Markov fit to device-fix residuals against each walk's final alignment (${series.length} outdoor walks, extent >= ${minExtent} m)`,
      [
        {
          perWalkSigma: summary(perWalk.map((f) => f.sigmaM)),
          perWalkTau: summary(perWalk.map((f) => f.tauS ?? Number.NaN)),
          censored: perWalk.filter((f) => f.censored).length,
          pooledSigma: r1(pooled?.sigmaM ?? Number.NaN),
          pooledTau: r1(pooled?.tauS ?? Number.NaN),
          pooledRho: Object.fromEntries(
            [10, 30, 60, 120, 300].map((l) => [
              l,
              Math.round(100 * (pooled?.rho[l] ?? Number.NaN)) / 100,
            ]),
          ),
        },
      ],
    );
  }
}

function sweepHeading(
  walks: readonly Walk[],
  outdoorCases: readonly Case[],
): void {
  for (const minExtent of HEADING_MIN_EXTENT_M) {
    const qualified = walks.filter(
      (w) => w.fixes!.length >= 120 && extentM(w.fixes!) >= minExtent,
    );
    const rows: Record<string, unknown>[] = [];
    for (const place of ["outdoor", "indoor", "mixed"] as const) {
      const errs = qualified
        .filter((w) => w.place === place)
        .map(headingErrors)
        .filter((e) => e !== null);
      const cw = errs.filter((e) => e.compass.some(Number.isFinite));
      const offsets = cw.map((e) => quantile(e.compass, 0.5));
      rows.push({
        minExtentM: minExtent,
        place,
        walks: errs.length,
        compassWalks: cw.length,
        compassErrAbs: summary(
          cw.flatMap((e) => finiteOf(e.compass).map(Math.abs)),
        ),
        sessionOffset: {
          min: r1(Math.min(...offsets)),
          p10: r1(quantile(offsets, 0.1)),
          median: r1(quantile(offsets, 0.5)),
          p90: r1(quantile(offsets, 0.9)),
          max: r1(Math.max(...offsets)),
          beyond30: offsets.filter((o) => Math.abs(o) > 30).length,
        },
        withinWalkAbs: summary(
          cw.flatMap((e) => {
            const med = quantile(e.compass, 0.5);
            return finiteOf(e.compass).map((v) => Math.abs(wrap180(v - med)));
          }),
        ),
        publishedErrAbs: summary(
          errs.flatMap((e) => finiteOf(e.published).map(Math.abs)),
        ),
        publishedErrAbsAfter60s: summary(
          errs.flatMap((e) =>
            finiteOf(e.published.filter((_, i) => e.tS[i]! >= 60)).map(
              Math.abs,
            ),
          ),
        ),
      });
    }
    emit(
      `heading errors (deg) against each walk's final alignment (walks >= 120 fixes, extent >= ${minExtent} m)`,
      rows,
    );
  }

  const qualified = walks.filter(
    (w) => w.fixes!.length >= 120 && extentM(w.fixes!) >= 30,
  );
  const channelRows: Record<string, unknown>[] = [];
  for (const place of ["outdoor", "indoor+mixed"] as const) {
    const pool = qualified
      .filter((w) => (place === "outdoor") === (w.place === "outdoor"))
      .map(headingErrors)
      .filter((e) => e !== null);
    for (const mintAfterS of [0, 60]) {
      const mints = pool.map((e) =>
        finiteOf(e.published.filter((_, i) => e.tS[i]! >= mintAfterS)),
      );
      for (const observed of ["compass", "published"] as const) {
        const scans = pool.map((e) =>
          finiteOf(observed === "compass" ? e.compass : e.published),
        );
        const errs = channelDraws(
          mints,
          scans,
          4000,
          place === "outdoor" ? 11 : 13,
        );
        if (errs.length === 0) continue;
        for (const T of HEADING_TS_DEG) {
          const row: Record<string, unknown> = {
            place,
            mintAfterS,
            observed,
            T,
            fa: pct(errs.filter((e) => Math.abs(e) > T).length, errs.length),
          };
          for (const turn of [45, 90, 180])
            row[`det${turn}`] = pct(
              errs.filter((e) => Math.abs(wrap180(e + turn)) > T).length,
              errs.length,
            );
          row["errAbs"] = summary(errs.map(Math.abs));
          channelRows.push(row);
        }
      }
    }
  }
  emit(
    "heading channel: |stored - observed| > T, cross-session draws (stored = the mint's published alignment)",
    channelRows,
  );

  const yawRows: Record<string, unknown>[] = [];
  for (const [minted, mintedOk] of [
    ["any", () => true],
    ["mint >= 60 s into the walk", (c: Case) => c.scanSinceStartS >= 60],
  ] as const)
    for (const minSpreadM of [2, 10]) {
      for (const h of [120, 300]) {
        const yaws = outdoorCases
          .filter((c) => mintedOk(c) && covers(c.rigid, h))
          .map((c) => {
            let v = Number.NaN;
            for (
              let k = 0;
              k < c.rigid.tS.length && c.rigid.tS[k]! <= h;
              k += 1
            )
              if (c.rigid.span[k]! >= 60 && c.rigid.spread[k]! >= minSpreadM)
                v = c.rigid.yaw[k]!;
            return v;
          })
          .filter(Number.isFinite);
        const row: Record<string, unknown> = {
          minted,
          minSpreadM,
          atS: h,
          decided: yaws.length,
          yawAbs: summary(yaws.map(Math.abs)),
        };
        for (const T of HEADING_TS_DEG) {
          row[`fa${T}`] = pct(
            yaws.filter((y) => Math.abs(y) > T).length,
            yaws.length,
          );
          row[`det90_${T}`] = pct(
            yaws.filter((y) => Math.abs(wrap180(y + 90)) > T).length,
            yaws.length,
          );
        }
        yawRows.push(row);
      }
    }
  emit(
    "the rigid fit's yaw (GPS path) as a heading channel, virtual outdoor codes (span >= 60 s)",
    yawRows,
  );

  // Combined: position (rigid, shipped gate, floor only, within h) OR
  // compass heading at the scan, with an independent cross-session heading
  // draw per code (the two errors come from different sensors; the mint's
  // heading from its published alignment at least 60 s into its walk).
  const outdoorErrs = qualified
    .filter((w) => w.place === "outdoor")
    .map(headingErrors)
    .filter((e) => e !== null);
  for (const h of [120, 300]) {
    const cov = outdoorCases.filter((c) => covers(c.rigid, h));
    const head = channelDraws(
      outdoorErrs.map((e) =>
        finiteOf(e.published.filter((_, i) => e.tS[i]! >= 60)),
      ),
      outdoorErrs.map((e) => finiteOf(e.compass)),
      cov.length,
      29 + h,
    );
    if (head.length !== cov.length) continue;
    const combined: Record<string, unknown>[] = [];
    for (const floorM of [10, 12, 15, 20, 25, 30]) {
      const posFa = cov.map(
        (c) => firstMoved(c.rigid, SHIPPED_GATE, floorM) <= h,
      );
      for (const T of [45, 60, 90, Number.POSITIVE_INFINITY]) {
        const fa = cov.filter(
          (_, i) => posFa[i]! || Math.abs(head[i]!) > T,
        ).length;
        const row: Record<string, unknown> = {
          floorM,
          T: Number.isFinite(T) ? T : "off",
          fa: pct(fa, cov.length),
        };
        for (const moveM of [5, 10, 20, 30]) {
          for (const turn of [0, 90, 180]) {
            let n = 0;
            let k = 0;
            cov.forEach((c, i) => {
              for (const b of MOVE_BEARINGS_DEG) {
                n += 1;
                if (
                  Math.abs(wrap180(head[i]! + turn)) > T ||
                  firstMoved(
                    c.rigid,
                    SHIPPED_GATE,
                    floorM,
                    bearingMove(moveM, b),
                  ) <= h
                )
                  k += 1;
              }
            });
            row[`m${moveM}t${turn}`] = pct(k, n);
          }
        }
        combined.push(row);
      }
    }
    emit(
      `combined rule, outdoor virtual codes whose walk lasts ${h} s (${cov.length}): moved if rigid |D| > floor (shipped gate, floor only, within ${h} s) OR compass heading |diff| > T at the scan; detection % by move m and turn t`,
      combined,
    );
  }
}

describe.runIf(MODE === "sweep")("D20 real walks: the sweep", () => {
  it(
    "prints the real false-alarm, detection, noise-model and heading tables",
    () => {
      // The core's licensed geo maths (calcGpsCoords for the cross-session
      // pairs) is activated by building a store, as the replay did.
      createTourViewerStore();
      const all = loadWalks();
      const walks = all.filter(
        (w) => w.skipped === undefined && (w.fixes?.length ?? 0) >= 60,
      );
      sweepData(all, walks);
      const cases = walks.flatMap((w) => virtualCases(w));
      sweepVirtual(walks, cases);
      sweepPairs(walks);
      sweepNoiseModel(walks);
      sweepHeading(
        walks,
        cases.filter((c) => c.place === "outdoor"),
      );
      fs.writeFileSync(
        path.join(path.dirname(CACHE_DIR), "d20-real-report.txt"),
        REPORT.join("\n"),
      );
      expect(walks.length).toBeGreaterThan(0);
    },
    3 * 3600_000,
  );
});

describe("D20 real-walk harness (default run)", () => {
  // Why this test matters: every cross-session number rests on two frame
  // conversions made here - a raw WebXR mark position into odometry-NUE
  // (the reducer's webxrToNUE: NUE = (-z, y, x)), and a saved pose moved
  // by -move and turned by -turn. A slip in either would read as GPS error
  // or hide a move. (The real-data sweep re-checks the second on recorded
  // walks: a move adds exactly to the rigid fit, a turn reaches its yaw.)
  it("converts marks like the reducer and displaces a saved pose as declared", () => {
    expect(nueOdom([1, 2, -3])).toEqual([3, 2, 1]);
    const stored: NuePose = { position: [10, 1, 20], rotation: IDENTITY_Q };
    const moved = displaced(stored, [3, -4], 90);
    expect(moved.position).toEqual([7, 1, 24]);
    // Turned by -90 degrees about Up (+Y in NUE): (0, sin(-45), 0, cos(-45)).
    expect(moved.rotation[1]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(moved.rotation[3]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(wrap180(270)).toBe(-90);
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
  });
});
