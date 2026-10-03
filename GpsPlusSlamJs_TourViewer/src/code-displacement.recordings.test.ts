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
 * Measured (2026-10-02; 209 unique walks, 11.2 h, median walk 2.7 min):
 * on 6 166 cross-day pairs of 42 reference points (the real unmoved case,
 * name collisions removed without GPS) the persisted authoring offset reads
 * p90 5.1 m, p99 12.9 m, and the viewer's rigid fit false-alarms 3 of 2 380
 * pairs within 120 s at a 20 m floor (2 of 37 points). Reported accuracy
 * makes `correctionBoundM` 23-27 m (p10-median), so the coupled bound
 * hides the floor. The results doc in the primary repo carries the tables;
 * walks longer than 5 minutes are barely covered, and |D| grows with time
 * since the scan.
 */
import crypto from "node:crypto";
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
  CODE_MOVE_RULE,
  displacementEstimate,
  displacementSamples,
  EMPTY_DISPLACEMENT_STATS,
  pinCode,
  type CodePin,
  type DisplacementEstimator,
  type CodeMoveRule,
  type DisplacementEstimate,
  type DisplacementStats,
} from "./code-displacement.js";
import {
  CODE_TURN_RULE,
  judgeCodeMove,
  MOVED_CODE_FIT_WINDOW_S,
  type CodeTurnRule,
} from "./moved-code-rule.js";
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
  /** The catch-all folder: a recording also filed in a labelled folder is
   *  one walk, and takes that folder's label. */
  readonly generic?: boolean;
}

const DEFAULT_CORPUS: readonly CorpusDir[] = [
  { dir: `${PRIMARY}/TestDataJs`, place: "outdoor", generic: true },
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

interface CorpusZip {
  readonly zip: string;
  readonly place: Place;
  readonly key: string;
  readonly generic: boolean;
}

/**
 * One entry per recording CONTENT. The same bytes filed in two folders are
 * one walk: replayed twice they would double its fixes, pair it with itself
 * as a "cross-session" pair at zero offset, and weigh it twice in every
 * share. The labelled (non-generic) copy wins, keeping its environment
 * label; between two labelled copies, the first. Order is kept.
 */
function dedupeByContent<T extends { key: string; generic: boolean }>(
  entries: readonly T[],
  digestOf: (entry: T) => string,
): { kept: T[]; dropped: { key: string; keptAs: string }[] } {
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    const d = digestOf(e);
    groups.set(d, [...(groups.get(d) ?? []), e]);
  }
  const winners = new Set<T>();
  const dropped: { key: string; keptAs: string }[] = [];
  for (const group of groups.values()) {
    const winner = group.find((e) => !e.generic) ?? group[0]!;
    winners.add(winner);
    for (const e of group)
      if (e !== winner) dropped.push({ key: e.key, keptAs: winner.key });
  }
  return { kept: entries.filter((e) => winners.has(e)), dropped };
}

/** Content digests: sha256 only for files whose size another file shares
 *  (byte-identical files have equal sizes), so 11 GB are not all read. */
function contentDigests(zips: readonly string[]): Map<string, string> {
  const sizes = new Map(zips.map((z) => [z, fs.statSync(z).size]));
  const bySize = new Map<number, number>();
  for (const s of sizes.values()) bySize.set(s, (bySize.get(s) ?? 0) + 1);
  return new Map(
    zips.map((z) => {
      const size = sizes.get(z)!;
      return [
        z,
        bySize.get(size)! > 1
          ? `sha256:${crypto.createHash("sha256").update(fs.readFileSync(z)).digest("hex")}`
          : `unique:${z}`,
      ];
    }),
  );
}

function corpusZips(): {
  kept: CorpusZip[];
  dropped: { key: string; keptAs: string }[];
} {
  const out: CorpusZip[] = [];
  for (const { dir, place, generic } of corpus()) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".zip")) continue;
      const tag = path.basename(dir).replace(/[^A-Za-z0-9-]/g, "_");
      out.push({
        zip: path.join(dir, f),
        place,
        key: `${tag}__${f.replace(/\.zip$/, "")}`,
        generic: generic === true,
      });
    }
  }
  const digests = contentDigests(out.map((z) => z.zip));
  return dedupeByContent(out, (z) => digests.get(z.zip)!);
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
      const zips = corpusZips().kept.filter((_, k) => k % n === i);
      for (const z of zips) {
        const out = cachePath(z.key);
        if (fs.existsSync(out)) continue;
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
          `D20R-REPLAY ${z.key} era=${String(walk.era)} fixes=${walk.fixes?.length ?? 0} marks=${walk.marks?.length ?? 0} ${walk.skipped ?? ""}\n`,
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
// - the corpus is deduplicated by content (a recording filed in TestDataJs
//   and in a labelled folder is one walk, with the labelled place); walks
//   with fewer than MIN_FIXES device fixes are excluded and counted;
// - virtual codes every VIRTUAL_STEP_S of a walk from the mint gate on
//   (MINT_GATE_FIXES fixes), judged on the fixes AFTER the scan only, for at
//   most HORIZON_S. They share the walk's own GPS error with their saved
//   pose, so their false alarms are a LOWER BOUND of the cross-session case;
// - the rule's evidence gate (minSpanS 0/30/60/120 s, minSpreadM
//   0/2/5/10 m; swept on the virtual codes), floor 8-30 m (swept), the
//   bound either the floor alone or max(floor, correctionBoundM(device
//   median accuracy, saved accuracy, factor 3, default 5 m)) as
//   `judgeCodeDisplacement` computes it (both reported);
// - a move is injected as the saved pose shifted by -move (the poster now
//   sits `move` away from where it was saved), 4 bearings; for the rigid fit
//   a move adds exactly to the estimate and a turn goes to its yaw only,
//   which the sweep re-checks on real data before relying on it;
// - cross-session pairs: two walks' marks of the same named reference point.
//   Name collisions are found WITHOUT GPS first (COLLISION_RULE, swept): a
//   name marked at spots more than withinWalkM apart within one walk names
//   several spots (the name is dropped); and for two walks sharing points,
//   a point whose odometry distances to the other shared points disagree
//   between the walks (more than pairAbsM + pairRel x the distance) for
//   most of them is a different spot in one of the two (that walk pair's
//   pairs of it are dropped). Then a raw-GPS identity cutoff (60 m leads;
//   15 / 25 / 60 / 1000 m swept side by side, because a tight cutoff also
//   drops the largest genuine GPS disagreements);
// - the floor tables rest on CROSS-DAY pairs (two walks on different UTC
//   days), split by whether the saving mark was SETTLED_S or more into its
//   walk; same-day pairs are reported for reference;
// - every share is given as k/n with a one-sided 95 % upper bound (exact
//   binomial) and weighted by point (or walk): pairs and draws are not
//   independent, points and walks are the effective sample;
// - heading: the reference for "true" is each qualified walk's FINAL
//   alignment (odometry extent >= 20/30/50 m, swept; at least 120 fixes);
//   the compass bearing is magnetic (declination not removed: it shows as
//   the median session offset). A stored heading always comes from ANOTHER
//   walk than the visit's observation.
// ---------------------------------------------------------------------------

const MIN_FIXES = 60;
const VIRTUAL_STEP_S = 60;
const HORIZON_S = 1200;
const CHECKPOINTS_S = [30, 60, 120, 300, 600, 1200] as const;
const FA_HORIZONS_S = [120, 300] as const;
const FLOORS_M = [8, 10, 12, 15, 20, 25, 30] as const;
const DETECTION_FLOORS_M = [12, 15, 20, 25, 30] as const;
const COUPLED_FLOORS_M = [8, 20, 30] as const;
const COUPLED_DETECTION_FLOORS_M = [20, 30] as const;
const SPANS_S = [0, 30, 60, 120] as const;
const SPREADS_M = [0, 2, 5, 10] as const;
const MOVES_M = [5, 10, 15, 20, 30] as const;
const MOVE_BEARINGS_DEG = [0, 90, 180, 270] as const;
const TURNS_DEG = [0, 90, 180] as const;
const HEADING_TS_DEG = [30, 45, 60, 90] as const;
const PAIR_MAX_RAW_M = 60;
/** Swept side by side, the lead first: a stricter identity test drops the
 *  largest genuine GPS disagreements along with any collision left. */
const PAIR_MAX_RAW_SWEEP_M = [60, 25, 15, 1000] as const;
const HEADING_MIN_EXTENT_M = [20, 30, 50] as const;
const MINT_GATE_FIXES = 3;
const SHIPPED_GATE = { minSpanS: 60, minSpreadM: 2 } as const;
/** A saved pose minted this long into its walk counts as settled. */
const SETTLED_S = 60;
/** Lowered correction-refusal bounds measured for D1 (report only). */
const REFUSAL_BOUNDS_M = [12, 15, 20] as const;

/** How a name collision is told apart from GPS error without GPS. */
interface CollisionRule {
  /** One name marked further apart than this within ONE walk (odometry)
   *  names several spots. Within-walk repeats of one spot measure 0.1-3.4 m
   *  in this corpus, the smallest multi-spot name 21.5 m. */
  readonly withinWalkM: number;
  /** Two walks' odometry distances between two shared points disagree
   *  beyond pairAbsM + pairRel x the distance (odometry drift grows with
   *  distance; agreeing distances measure median 0.8 m, p90 2.5 m). */
  readonly pairAbsM: number;
  readonly pairRel: number;
}

const COLLISION_RULE: CollisionRule = {
  withinWalkM: 10,
  pairAbsM: 10,
  pairRel: 0.05,
};
const COLLISION_RULE_SWEEP: readonly CollisionRule[] = [
  COLLISION_RULE,
  { withinWalkM: 5, pairAbsM: 5, pairRel: 0.02 },
  { withinWalkM: 20, pairAbsM: 20, pairRel: 0.1 },
  { withinWalkM: 10, pairAbsM: 5, pairRel: 0.05 },
  { withinWalkM: 10, pairAbsM: 20, pairRel: 0.05 },
];

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

/**
 * One-sided 95 % upper bound of a binomial share, exact (Clopper-Pearson):
 * the p at which k or fewer successes in n have probability 5 %. For k = 0
 * it is 1 - 0.05^(1/n), about 3 / n (the rule of three).
 */
function upper95(k: number, n: number): number {
  if (!(n > 0) || k < 0) return Number.NaN;
  if (k >= n) return 1;
  const cdf = (p: number): number => {
    let total = 0;
    let logTerm = n * Math.log1p(-p);
    const logOdds = Math.log(p) - Math.log1p(-p);
    for (let i = 0; i <= k; i += 1) {
      total += Math.exp(logTerm);
      logTerm += Math.log((n - i) / (i + 1)) + logOdds;
    }
    return total;
  };
  let lo = k / n;
  let hi = 1;
  for (let it = 0; it < 60; it += 1) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > 0.05) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** "k/n p% (ub u%)" with the one-sided 95 % upper bound. */
function kOfN(k: number, n: number): string {
  return n === 0
    ? "0/0"
    : `${k}/${n} ${pct(k, n)}% (ub ${r1(100 * upper95(k, n))}%)`;
}

/** One binary outcome, the unit it belongs to (a point or a walk: the
 *  effective sample) and the walks it involves. */
interface Outcome {
  readonly hit: boolean;
  readonly unit: string;
  readonly walks: readonly string[];
}

/**
 * A share three ways: over all outcomes (pairs, codes, draws; k/n with its
 * bound, which overstates the sample when outcomes share a unit), weighted
 * by unit (each unit's outcomes share one unit of weight), and units with
 * any hit (k/n over the effective sample, with its bound). `withAny` off
 * for detection, where "any of four bearings" is not a question.
 */
function rate(
  outcomes: readonly Outcome[],
  unitName: "points" | "walks",
  withAny = true,
): Record<string, string> {
  const per = new Map<string, { k: number; n: number }>();
  const walksAll = new Set<string>();
  const walksHit = new Set<string>();
  let k = 0;
  for (const o of outcomes) {
    const u = per.get(o.unit) ?? { k: 0, n: 0 };
    u.n += 1;
    if (o.hit) {
      u.k += 1;
      k += 1;
      for (const w of o.walks) walksHit.add(w);
    }
    per.set(o.unit, u);
    for (const w of o.walks) walksAll.add(w);
  }
  const units = [...per.values()];
  const weighted =
    units.length === 0
      ? Number.NaN
      : units.reduce((a, u) => a + u.k / u.n, 0) / units.length;
  const out: Record<string, string> = {
    all: kOfN(k, outcomes.length),
    [`${unitName}Weighted`]: `${r1(100 * weighted)}% (${units.length} ${unitName})`,
  };
  if (withAny) {
    out[`${unitName}WithAny`] = kOfN(
      units.filter((u) => u.k > 0).length,
      units.length,
    );
    if (unitName === "points")
      out["walksWithAny"] = `${walksHit.size}/${walksAll.size}`;
  }
  return out;
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
 *  saved. A published alignment whose bearing is off by +e saves a code
 *  exactly as `displaced(true, [0, 0], e)` would (rotation-wise). */
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
 * large, so with it coupled the floor rarely matters); `coupled` -
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

/** The trace's value at the last fix at or before `s` (NaN: none). */
function lastAtOrBefore(tr: Trace, values: readonly number[], s: number) {
  let v = Number.NaN;
  for (let k = 0; k < tr.tS.length && tr.tS[k]! <= s; k += 1) v = values[k]!;
  return v;
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

/** The UTC day of a walk, from its file name; null when it has none. */
function dayOf(walkKey: string): string | null {
  return /(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}utc$/.exec(walkKey)?.[1] ?? null;
}

interface PairResult {
  readonly key: string;
  readonly walkA: string;
  readonly walkB: string;
  /** The two walks were recorded on different UTC days. */
  readonly crossDay: boolean;
  /** Seconds from A's first fix to the saving mark. */
  readonly savedSinceStartS: number;
  /** Reported accuracy (m) of the fix at each mark. */
  readonly accA: number | null;
  readonly accB: number | null;
  readonly offsetAtSightingM: number;
  readonly offsetPersisted20sM: number;
  readonly offsetFinalM: number;
  /** The shipped correction-refusal bound for this visit and saved code. */
  readonly shippedBoundM: number;
  readonly rawGpsM: number;
  /** The rigid fit over every fix of the visit (the recalibration). */
  readonly all: Trace;
  /** The rigid fit over the fixes stamped at most `windowS` seconds before
   *  the sighting, and every one after it (the viewer's bounded fit, M5c
   *  review H2); computed on demand. */
  readonly windowed: (windowS: number) => Trace;
}

function fixIndexAt(fixes: readonly WalkFix[], tMs: number): number {
  let k = -1;
  for (let i = 0; i < fixes.length && fixes[i]!.t <= tMs; i += 1) k = i;
  return k;
}

const horizontal = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

type Obs = { readonly w: Walk; readonly m: WalkMark };

/** One ordered pair: A saved the point, B sees it. Null when unusable. No
 *  identity test here: the raw-GPS distance is carried and filtered on. */
function pairResult(A: Obs, B: Obs): PairResult | null {
  const faIdx = fixIndexAt(A.w.fixes!, A.m.t);
  const fa = A.w.fixes![faIdx];
  const fbIdx = fixIndexAt(B.w.fixes!, B.m.t);
  const fb = B.w.fixes![fbIdx];
  if (fa === undefined || fb === undefined) return null;
  const zeroA = A.w.zero!;
  const zeroB = B.w.zero!;
  const rawGpsM = horizontal(
    nueToOtherZero([fa.g[0], 0, fa.g[1]], zeroA, zeroB),
    [fb.g[0], 0, fb.g[1]],
  );
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
  const storedAccM = accMedian(A.w.fixes!, faIdx);
  const base = {
    fixes: B.w.fixes!,
    scanMs: B.m.t,
    pin,
    estimator: CODE_MOVE_ESTIMATOR,
    storedAccM,
  };
  const dayA = dayOf(A.w.key);
  const dayB = dayOf(B.w.key);
  return {
    key: A.m.key,
    walkA: A.w.key,
    walkB: B.w.key,
    crossDay: dayA !== null && dayB !== null && dayA !== dayB,
    savedSinceStartS: (A.m.t - A.w.fixes![0]!.t) / 1000,
    accA: fa.acc,
    accB: fb.acc,
    offsetAtSightingM: horizontal(seenB.position, stored.position),
    offsetPersisted20sM: persisted,
    offsetFinalM: horizontal(seenFinal.position, stored.position),
    shippedBoundM: correctionBoundM(
      accMedian(B.w.fixes!, B.w.fixes!.length - 1),
      storedAccM,
    ),
    rawGpsM,
    all: traceOf({ ...base, fromIdx: 0 }),
    windowed: (windowS: number) => {
      const fixes = B.w.fixes!;
      let fromIdx = 0;
      while (
        fromIdx < fixes.length &&
        fixes[fromIdx]!.t < B.m.t - windowS * 1000
      )
        fromIdx += 1;
      return traceOf({ ...base, fromIdx });
    },
  };
}

/** The marks the pairs are built from: with an alignment, past the mint
 *  gate, on a walk with a zero. */
function usableMarks(walks: readonly Walk[]): Obs[] {
  return walks.flatMap((w) =>
    w.zero === undefined
      ? []
      : (w.marks ?? [])
          .filter((m) => m.a !== null && m.fixesBefore >= MINT_GATE_FIXES)
          .map((m) => ({ w, m })),
  );
}

/** Every ordered pair of two walks' marks of one name, unfiltered. */
function allPairs(walks: readonly Walk[]): PairResult[] {
  const byKey = new Map<string, Obs[]>();
  for (const o of usableMarks(walks))
    byKey.set(o.m.key, [...(byKey.get(o.m.key) ?? []), o]);
  const pairs: PairResult[] = [];
  for (const list of byKey.values()) {
    if (new Set(list.map((o) => o.w.key)).size < 2) continue;
    for (const A of list)
      for (const B of list) {
        if (A.w.key === B.w.key) continue;
        const r = pairResult(A, B);
        if (r !== null) pairs.push(r);
      }
  }
  return pairs;
}

/** A mark's horizontal odometry position (north, east) in its own walk. */
interface MarkSite {
  readonly key: string;
  readonly walk: string;
  readonly n: number;
  readonly e: number;
}

const pairId = (a: string, b: string, key: string): string =>
  a < b ? `${a}|${b}|${key}` : `${b}|${a}|${key}`;

/**
 * Name collisions found WITHOUT GPS (see COLLISION_RULE): `ambiguous` names
 * label several spots within one walk; `inconsistent` holds pairId(walkA,
 * walkB, name) where that name's odometry distances to the other points
 * both walks marked disagree for MORE than half of them. With exactly two
 * shared points that disagree, both are flagged: odometry cannot tell
 * which one moved. With one shared point there is nothing to compare.
 */
function nameCollisions(
  sites: readonly MarkSite[],
  rule: CollisionRule,
): { ambiguous: Set<string>; inconsistent: Set<string> } {
  const byWalk = new Map<string, Map<string, MarkSite[]>>();
  for (const s of sites) {
    const keys = byWalk.get(s.walk) ?? new Map<string, MarkSite[]>();
    keys.set(s.key, [...(keys.get(s.key) ?? []), s]);
    byWalk.set(s.walk, keys);
  }
  const ambiguous = new Set<string>();
  const centres = new Map<string, Map<string, readonly [number, number]>>();
  for (const [walk, keys] of byWalk) {
    const c = new Map<string, readonly [number, number]>();
    for (const [key, list] of keys) {
      for (const a of list)
        for (const b of list)
          if (Math.hypot(a.n - b.n, a.e - b.e) > rule.withinWalkM)
            ambiguous.add(key);
      c.set(key, [
        list.reduce((x, s) => x + s.n, 0) / list.length,
        list.reduce((x, s) => x + s.e, 0) / list.length,
      ]);
    }
    centres.set(walk, c);
  }
  const inconsistent = new Set<string>();
  const walks = [...centres.keys()].sort();
  const dist = (p: readonly [number, number], q: readonly [number, number]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]);
  for (let i = 0; i < walks.length; i += 1) {
    const A = centres.get(walks[i]!)!;
    for (let j = i + 1; j < walks.length; j += 1) {
      const B = centres.get(walks[j]!)!;
      const shared = [...A.keys()].filter((k) => B.has(k) && !ambiguous.has(k));
      if (shared.length < 2) continue;
      for (const P of shared) {
        let disagree = 0;
        for (const Q of shared) {
          if (Q === P) continue;
          const dA = dist(A.get(P)!, A.get(Q)!);
          const dB = dist(B.get(P)!, B.get(Q)!);
          if (
            Math.abs(dA - dB) >
            rule.pairAbsM + rule.pairRel * Math.max(dA, dB)
          )
            disagree += 1;
        }
        if (disagree > (shared.length - 1) / 2)
          inconsistent.add(pairId(walks[i]!, walks[j]!, P));
      }
    }
  }
  return { ambiguous, inconsistent };
}

function markSites(walks: readonly Walk[]): MarkSite[] {
  return usableMarks(walks).map(({ w, m }) => {
    const o = nueOdom(m.position);
    return { key: m.key, walk: w.key, n: o[0], e: o[2] };
  });
}

/** The pairs a collision verdict keeps, and what it dropped. */
function withoutCollisions(
  pairs: readonly PairResult[],
  collisions: { ambiguous: Set<string>; inconsistent: Set<string> },
): { kept: PairResult[]; ambiguous: number; inconsistent: number } {
  let ambiguous = 0;
  let inconsistent = 0;
  const kept = pairs.filter((p) => {
    if (collisions.ambiguous.has(p.key)) {
      ambiguous += 1;
      return false;
    }
    if (collisions.inconsistent.has(pairId(p.walkA, p.walkB, p.key))) {
      inconsistent += 1;
      return false;
    }
    return true;
  });
  return { kept, ambiguous, inconsistent };
}

const pairOutcome = (p: PairResult, hit: boolean): Outcome => ({
  hit,
  unit: p.key,
  walks: [p.walkA, p.walkB],
});

/** False alarms of one rule, within each horizon and over the whole
 *  session (up to HORIZON_S): "within h" counts only traces lasting h. */
function faCounts(
  traces: readonly Trace[],
  outcomeOf: (i: number, hit: boolean) => Outcome,
  unitName: "points" | "walks",
  rule: { gate: Gate; floorM: number; mode: BoundMode },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const firsts = traces.map((tr) =>
    firstMoved(tr, rule.gate, rule.floorM, [0, 0], rule.mode),
  );
  for (const h of [...FA_HORIZONS_S, Number.POSITIVE_INFINITY]) {
    const outs: Outcome[] = [];
    traces.forEach((tr, i) => {
      if (Number.isFinite(h) && !covers(tr, h)) return;
      outs.push(
        outcomeOf(
          i,
          Number.isFinite(h) ? firsts[i]! <= h : Number.isFinite(firsts[i]!),
        ),
      );
    });
    out[Number.isFinite(h) ? `fa${h}` : "faAny"] = rate(outs, unitName);
  }
  return out;
}

function falseAlarmRows(
  label: string,
  traces: readonly Trace[],
  outcomeOf: (i: number, hit: boolean) => Outcome,
  unitName: "points" | "walks",
  gates: readonly Gate[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const gate of gates)
    for (const floorM of FLOORS_M)
      rows.push({
        set: label,
        ...gate,
        floorM,
        bound: "floor",
        ...faCounts(traces, outcomeOf, unitName, {
          gate,
          floorM,
          mode: "floor",
        }),
      });
  for (const floorM of COUPLED_FLOORS_M)
    rows.push({
      set: label,
      ...SHIPPED_GATE,
      floorM,
      bound: "coupled",
      ...faCounts(traces, outcomeOf, unitName, {
        gate: SHIPPED_GATE,
        floorM,
        mode: "coupled",
      }),
    });
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

/** Detection of injected moves at the shipped gate: per horizon h, the
 *  share of traces (x 4 move bearings) lasting h that read `moved` within
 *  h ("Any": over the whole visit), floor-only and coupled. */
function detectionRows(
  label: string,
  traces: readonly Trace[],
  outcomeOf: (i: number, hit: boolean) => Outcome,
  unitName: "points" | "walks",
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const modes: [BoundMode, readonly number[]][] = [
    ["floor", DETECTION_FLOORS_M],
    ["coupled", COUPLED_DETECTION_FLOORS_M],
  ];
  for (const [mode, floors] of modes)
    for (const floorM of floors)
      for (const moveM of MOVES_M) {
        const row: Record<string, unknown> = {
          set: label,
          floorM,
          bound: mode,
          moveM,
        };
        const times = traces.map((tr) =>
          MOVE_BEARINGS_DEG.map((b) =>
            firstMoved(tr, SHIPPED_GATE, floorM, bearingMove(moveM, b), mode),
          ),
        );
        for (const h of [60, 120, 300, Number.POSITIVE_INFINITY]) {
          const outs: Outcome[] = [];
          traces.forEach((tr, i) => {
            if (Number.isFinite(h) && !covers(tr, h)) return;
            // `t` is Infinity for a move never read as moved, and
            // Infinity <= Infinity: the "Any" column needs the finite test.
            for (const t of times[i]!)
              outs.push(outcomeOf(i, Number.isFinite(t) && t <= h));
          });
          const r = rate(outs, unitName, false);
          row[Number.isFinite(h) ? `det${h}` : "detAny"] =
            `${r["all"]!}; ${r[`${unitName}Weighted`]!}`;
        }
        row["medianS"] = r1(
          quantile(times.flat().filter(Number.isFinite), 0.5),
        );
        rows.push(row);
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

function walkMinutes(w: Walk): number {
  const f = w.fixes ?? [];
  return f.length > 1 ? (f[f.length - 1]!.t - f[0]!.t) / 60_000 : 0;
}

const PLACES = ["outdoor", "indoor", "mixed", "other"] as const;
const byPlace = (ws: readonly Walk[]) =>
  Object.fromEntries(
    PLACES.map((p) => [p, ws.filter((w) => w.place === p).length]),
  );

function sweepData(input: {
  all: readonly Walk[];
  walks: readonly Walk[];
  dropped: readonly { key: string; keptAs: string }[];
  missing: number;
}): void {
  const { all, walks, dropped, missing } = input;
  const skipped: Record<string, number> = {};
  for (const w of all)
    if (w.skipped !== undefined)
      skipped[w.skipped] = (skipped[w.skipped] ?? 0) + 1;
  const short = all.filter(
    (w) => w.skipped === undefined && (w.fixes?.length ?? 0) < MIN_FIXES,
  );
  const compassWalks = walks.filter((w) =>
    (w.fixes ?? []).some((f) => f.compass !== null),
  );
  emit("data (unique recordings: the corpus deduplicated by content)", [
    {
      duplicatesDropped: dropped.map((d) => `${d.key} = ${d.keptAs}`),
      uniqueCached: all.length,
      notInCache: missing,
      skipped,
      [`excludedUnder${MIN_FIXES}Fixes`]: {
        n: short.length,
        byPlace: byPlace(short),
        keys: short.map((w) => w.key),
      },
      used: walks.length,
      byPlace: byPlace(walks),
      withCompass: byPlace(compassWalks),
      fixes: walks.reduce((a, w) => a + (w.fixes?.length ?? 0), 0),
      marks: walks.reduce((a, w) => a + (w.marks?.length ?? 0), 0),
      walkMinutes: summary(walks.map(walkMinutes)),
      walkMedianAccuracyM: summary(
        walks.map(
          (w) =>
            accMedian(w.fixes ?? [], (w.fixes?.length ?? 1) - 1) ?? Number.NaN,
        ),
      ),
      hours: r1(walks.reduce((a, w) => a + walkMinutes(w), 0) / 60),
    },
  ]);
}

/** The virtual codes (a LOWER BOUND: same walk, no cross-session bias).
 *  Returns the sign s with which a turn of the saved pose reaches the
 *  rigid fit's yaw (yaw changes by s x turn), measured on real walks. */
function sweepVirtual(walks: readonly Walk[], cases: readonly Case[]): number {
  const walkOutcome =
    (cs: readonly Case[]) =>
    (i: number, hit: boolean): Outcome => ({
      hit,
      unit: cs[i]!.walk,
      walks: [cs[i]!.walk],
    });
  for (const place of ["outdoor", "indoor", "mixed"] as const) {
    const cs = cases.filter((c) => c.place === place);
    if (cs.length === 0) continue;
    const ungated = cs.map((c) => atCheckpoints(c.rigid, false));
    const gated = cs.map((c) => atCheckpoints(c.rigid, true));
    const residual = cs.flatMap((c) =>
      c.residual === undefined ? [] : [atCheckpoints(c.residual, false)],
    );
    emit(
      `virtual unmoved codes (LOWER BOUND), ${place}: rigid |D| (m) by seconds since the scan (${cs.length} codes on ${new Set(cs.map((c) => c.walk)).size} walks)`,
      CHECKPOINTS_S.map((s, i) => ({
        sinceScanS: s,
        ungated: summary(ungated.map((r) => r[i]!)),
        gated60s2m: summary(gated.map((r) => r[i]!)),
        residual20: summary(residual.map((r) => r[i]!)),
      })),
    );
    emit(
      `virtual unmoved codes (LOWER BOUND), ${place}: false alarms within 120 / 300 s and over the whole walk`,
      falseAlarmRows(
        `virtual-${place}`,
        cs.map((c) => c.rigid),
        walkOutcome(cs),
        "walks",
        place === "outdoor" ? ALL_GATES : [SHIPPED_GATE],
      ),
    );
  }

  const outdoor = cases.filter((c) => c.place === "outdoor");
  for (const [label, ok] of [
    [
      `saved < ${SETTLED_S} s into the walk`,
      (c: Case) => c.scanSinceStartS < SETTLED_S,
    ],
    [
      `saved >= ${SETTLED_S} s into the walk`,
      (c: Case) => c.scanSinceStartS >= SETTLED_S,
    ],
  ] as const) {
    const cs = outdoor.filter(ok);
    emit(
      `virtual outdoor codes (LOWER BOUND) ${label}: |D| at 120 s and false alarms (shipped gate) (${cs.length} codes, ${new Set(cs.map((c) => c.walk)).size} walks)`,
      [
        { at120: summary(cs.map((c) => atCheckpoints(c.rigid, true)[2]!)) },
        ...falseAlarmRows(
          "virtual-outdoor",
          cs.map((c) => c.rigid),
          walkOutcome(cs),
          "walks",
          [SHIPPED_GATE],
        ),
      ],
    );
  }

  // The coupled bound's size: correctionBoundM at 120 s, per walk (median
  // over its codes), across walks.
  const perWalk = new Map<string, number[]>();
  for (const c of outdoor) {
    const b = lastAtOrBefore(c.rigid, c.rigid.bound, 120);
    if (Number.isFinite(b))
      perWalk.set(c.walk, [...(perWalk.get(c.walk) ?? []), b]);
  }
  const walkBounds = [...perWalk.values()].map((v) => quantile(v, 0.5));
  emit(
    "correctionBoundM at 120 s (factor 3, default 5 m), virtual outdoor codes: per-walk median, across walks",
    [
      {
        walks: walkBounds.length,
        p10: r1(quantile(walkBounds, 0.1)),
        p25: r1(quantile(walkBounds, 0.25)),
        median: r1(quantile(walkBounds, 0.5)),
        p75: r1(quantile(walkBounds, 0.75)),
        p90: r1(quantile(walkBounds, 0.9)),
        min: r1(quantile(walkBounds, 0)),
      },
    ],
  );

  // What the detection arm relies on, re-checked on real data: for the
  // rigid fit an unturned move adds exactly at every fix; a turned one adds
  // exactly and puts the turn into the yaw wherever a turn is fitted
  // (spread >= the estimator's 2 m), i.e. wherever the shipped gate can
  // decide. The sign of that yaw change is measured here for the heading
  // channel's cross-walk draw.
  let worstShift = 0;
  let worstTurnedShift = 0;
  let worstYaw = 0;
  const signs = new Set<number>();
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
      const dYaw = wrap180(t90.yaw[k]! - c.rigid.yaw[k]!);
      worstYaw = Math.max(worstYaw, Math.abs(Math.abs(dYaw) - 90));
      signs.add(Math.sign(dYaw));
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
        yawSignOfTurn: [...signs],
      },
    ],
  );
  expect(worstShift).toBeLessThan(1e-6);
  expect(worstTurnedShift).toBeLessThan(1e-6);
  expect(worstYaw).toBeLessThan(1e-6);
  expect(signs.size).toBe(1);

  emit(
    "virtual outdoor codes (LOWER BOUND): detection on real noise (rigid; turn-invariant), shipped gate, k/n over codes x 4 bearings; walk-weighted",
    detectionRows(
      "virtual-outdoor",
      outdoor.map((c) => c.rigid),
      walkOutcome(outdoor),
      "walks",
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
          residual20: kOfN(hit, trs.length),
          rigid: kOfN(rigidHit, withResidual.length),
        };
      }),
    ),
  );
  return [...signs][0] ?? 1;
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

/** Pair-weighted and point-weighted quantiles of one pair quantity. */
function bothWeights(
  pairs: readonly PairResult[],
  pick: (p: PairResult) => number,
  qs: readonly (readonly [string, number])[] = [
    ["median", 0.5],
    ["p90", 0.9],
    ["p99", 0.99],
  ],
): Record<string, unknown> {
  const per = new Map<string, number>();
  for (const p of pairs) per.set(p.key, (per.get(p.key) ?? 0) + 1);
  const values = pairs.map(pick);
  const weights = pairs.map((p) => 1 / per.get(p.key)!);
  return {
    pairWeighted: Object.fromEntries(
      qs.map(([k, q]) => [k, r1(quantile(values, q))]),
    ),
    pointWeighted: Object.fromEntries(
      qs.map(([k, q]) => [k, r1(weightedQuantile(values, weights, q))]),
    ),
    max: r1(quantile(values, 1)),
  };
}

const describePairs = (pairs: readonly PairResult[]) => ({
  pairs: pairs.length,
  points: new Set(pairs.map((p) => p.key)).size,
  walks: new Set(pairs.flatMap((p) => [p.walkA, p.walkB])).size,
});

/** The collision rule swept: how many pairs each verdict drops, and how
 *  many >12 m (20 s persisted) pairs survive it at the 60 m cutoff. */
function sweepCollisionRule(
  walks: readonly Walk[],
  every: readonly PairResult[],
): void {
  const sites = markSites(walks);
  emit(
    "name collisions found without GPS, the rule swept (pairs at the 60 m cutoff after removal; tail = persisted offset > 12 m)",
    COLLISION_RULE_SWEEP.map((rule) => {
      const c = nameCollisions(sites, rule);
      const { kept, ambiguous, inconsistent } = withoutCollisions(every, c);
      const main = kept.filter((p) => p.rawGpsM <= PAIR_MAX_RAW_M);
      const tail = main.filter((p) => p.offsetPersisted20sM > 12);
      return {
        ...rule,
        ambiguousNames: [...c.ambiguous].sort(),
        inconsistentWalkPairPoints: c.inconsistent.size,
        droppedAmbiguousPairs: ambiguous,
        droppedInconsistentPairs: inconsistent,
        ...describePairs(main),
        tailPairs: tail.length,
        tailPoints: [...new Set(tail.map((p) => p.key))].sort(),
      };
    }),
  );
}

/** The pair verdicts across the raw-GPS identity cutoff, side by side, on
 *  cross-day pairs after the GPS-free collision removal. */
function sweepPairCutoffs(clean: readonly PairResult[]): void {
  const rows: Record<string, unknown>[] = [];
  for (const maxRawM of PAIR_MAX_RAW_SWEEP_M) {
    const cross = clean.filter((p) => p.crossDay);
    const kept = cross.filter((p) => p.rawGpsM <= maxRawM);
    const droppedRaw = cross
      .filter((p) => p.rawGpsM > maxRawM)
      .map((p) => p.rawGpsM);
    const row: Record<string, unknown> = {
      maxRawM,
      ...describePairs(kept),
      droppedByCutoff: droppedRaw.length,
      droppedPoints: new Set(
        cross.filter((p) => p.rawGpsM > maxRawM).map((p) => p.key),
      ).size,
      closestDroppedRawM: r1(quantile(droppedRaw, 0)),
      persisted: bothWeights(kept, (p) => p.offsetPersisted20sM),
    };
    for (const floorM of [12, 15, 20])
      row[`prompt${floorM}`] = rate(
        kept.map((p) => pairOutcome(p, p.offsetPersisted20sM > floorM)),
        "points",
      );
    for (const floorM of [15, 20]) {
      const trs = kept.filter((p) => covers(p.all, 120));
      row[`viewerFa120_${floorM}`] = rate(
        trs.map((p) =>
          pairOutcome(p, firstMoved(p.all, SHIPPED_GATE, floorM) <= 120),
        ),
        "points",
      );
    }
    row["viewerFaAny_20"] = rate(
      kept.map((p) =>
        pairOutcome(p, Number.isFinite(firstMoved(p.all, SHIPPED_GATE, 20))),
      ),
      "points",
    );
    rows.push(row);
  }
  emit(
    "cross-day pairs across the raw-GPS identity cutoff, after the GPS-free collision removal (60 m leads): offsets, prompt rate and viewer false alarms",
    rows,
  );
}

/** What the >12 m tail looks like, per point: which walk it comes from. */
function sweepTail(main: readonly PairResult[]): void {
  const tail = main.filter((p) => p.offsetPersisted20sM > 12);
  const byKey = new Map<string, PairResult[]>();
  for (const p of tail) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  const rows = [...byKey.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, ps]) => {
      const count = new Map<string, number>();
      for (const p of ps)
        for (const w of [p.walkA, p.walkB])
          count.set(w, (count.get(w) ?? 0) + 1);
      const [oddWalk, inTail] = [...count.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]!;
      const pointPairs = main.filter((p) => p.key === key);
      const withOdd = pointPairs.filter(
        (p) => p.walkA === oddWalk || p.walkB === oddWalk,
      );
      const withoutOdd = pointPairs.filter(
        (p) => p.walkA !== oddWalk && p.walkB !== oddWalk,
      );
      return {
        key,
        tailPairs: ps.length,
        pointPairs: pointPairs.length,
        crossDay: ps.filter((p) => p.crossDay).length,
        oddWalk,
        oddWalkInTailPairs: `${inTail}/${ps.length}`,
        oddWalkPairsInTail: `${withOdd.filter((p) => p.offsetPersisted20sM > 12).length}/${withOdd.length}`,
        persistedWithOddMedian: r1(
          quantile(
            withOdd.map((p) => p.offsetPersisted20sM),
            0.5,
          ),
        ),
        persistedWithoutOdd: summary(
          withoutOdd.map((p) => p.offsetPersisted20sM),
        ),
        rawGpsMedian: r1(
          quantile(
            ps.map((p) => p.rawGpsM),
            0.5,
          ),
        ),
        accAtMarks: summary(
          ps.flatMap((p) => [p.accA ?? Number.NaN, p.accB ?? Number.NaN]),
        ),
        savedSinceStartS: summary(ps.map((p) => p.savedSinceStartS)),
      };
    });
  emit(
    `cross-session pairs, the tail after the GPS-free collision removal at the 60 m cutoff: persisted offset > 12 m (${tail.length} ordered pairs of ${main.length}, ${byKey.size} points); per point, the walk most often involved`,
    rows,
  );
}

function sweepPairs(walks: readonly Walk[]): PairResult[] {
  const every = allPairs(walks);
  sweepCollisionRule(walks, every);
  const collisions = nameCollisions(markSites(walks), COLLISION_RULE);
  const {
    kept: clean,
    ambiguous,
    inconsistent,
  } = withoutCollisions(every, collisions);
  sweepPairCutoffs(clean);
  const main = clean.filter((p) => p.rawGpsM <= PAIR_MAX_RAW_M);
  sweepTail(main);

  const cross = main.filter((p) => p.crossDay);
  const sets: [string, PairResult[]][] = [
    ["cross-day", cross],
    [
      `cross-day, saved >= ${SETTLED_S} s into its walk`,
      cross.filter((p) => p.savedSinceStartS >= SETTLED_S),
    ],
    [
      `cross-day, saved < ${SETTLED_S} s into its walk`,
      cross.filter((p) => p.savedSinceStartS < SETTLED_S),
    ],
    ["same-day (reference)", main.filter((p) => !p.crossDay)],
  ];
  emit(
    `cross-session pairs (60 m cutoff after the GPS-free collision removal: ${ambiguous} pairs of ambiguous names and ${inconsistent} inconsistent pairs dropped first): the sets`,
    sets.map(([label, ps]) => ({ set: label, ...describePairs(ps) })),
  );
  emit(
    "cross-session pairs: unmoved offsets (m), pair- and point-weighted",
    sets.flatMap(([label, ps]) =>
      (
        [
          ["at the sighting", (p: PairResult) => p.offsetAtSightingM],
          [
            "persisted 20 s (the prompt)",
            (p: PairResult) => p.offsetPersisted20sM,
          ],
          [
            "through the visit's final alignment (the settle)",
            (p: PairResult) => p.offsetFinalM,
          ],
          ["raw GPS of the two marks", (p: PairResult) => p.rawGpsM],
        ] as const
      ).map(([what, pick]) => ({ set: label, what, ...bothWeights(ps, pick) })),
    ),
  );
  emit(
    "cross-day pairs, every fix of the visit (the viewer): rigid |D| (m) at the shipped gate by seconds since the sighting",
    CHECKPOINTS_S.map((s, i) => {
      const at = cross.map((p) => atCheckpoints(p.all, true)[i]!);
      const per = new Map<string, number>();
      cross.forEach((p, k) => {
        if (Number.isFinite(at[k]!)) per.set(p.key, (per.get(p.key) ?? 0) + 1);
      });
      return {
        sinceSightingS: s,
        pairWeighted: summary(at),
        pointWeighted: {
          median: r1(
            weightedQuantile(
              at,
              cross.map((p) => 1 / (per.get(p.key) ?? 1)),
              0.5,
            ),
          ),
          p90: r1(
            weightedQuantile(
              at,
              cross.map((p) => 1 / (per.get(p.key) ?? 1)),
              0.9,
            ),
          ),
        },
      };
    }),
  );
  for (const [label, ps] of sets) {
    emit(
      `pairs ${label}, the viewer (every fix of the visit): false alarms within 120 / 300 s and over the whole visit`,
      falseAlarmRows(
        label,
        ps.map((p) => p.all),
        (i, hit) => pairOutcome(ps[i]!, hit),
        "points",
        [SHIPPED_GATE],
      ),
    );
  }
  emit(
    "cross-day pairs, the viewer: detection on real noise, k/n over pairs x 4 bearings; point-weighted",
    detectionRows(
      "cross-day",
      cross.map((p) => p.all),
      (i, hit) => pairOutcome(cross[i]!, hit),
      "points",
    ),
  );
  emit(
    "authoring prompt (20 s-persistent offset > floor): unmoved prompted, by set",
    sets.flatMap(([label, ps]) =>
      FLOORS_M.map((floorM) => ({
        set: label,
        floorM,
        ...rate(
          ps.map((p) => pairOutcome(p, p.offsetPersisted20sM > floorM)),
          "points",
        ),
      })),
    ),
  );
  emit(
    "authoring prompt on cross-day pairs: moved prompted (8 move bearings against the offset), pair- and point-weighted",
    FLOORS_M.map((floorM) => {
      const row: Record<string, unknown> = { floorM };
      for (const moveM of MOVES_M) {
        const outs: Outcome[] = [];
        for (const p of cross)
          for (let b = 0; b < 8; b += 1) {
            const ang = (b * Math.PI) / 4;
            outs.push(
              pairOutcome(
                p,
                Math.hypot(
                  p.offsetPersisted20sM + moveM * Math.cos(ang),
                  moveM * Math.sin(ang),
                ) > floorM,
              ),
            );
          }
        const r = rate(outs, "points", false);
        row[`move${moveM}`] = `${r["all"]!}; ${r["pointsWeighted"]!}`;
      }
      return row;
    }),
  );
  sweepRefusal(sets);
  return cross;
}

/**
 * D1, measured and reported only: if the authoring settle's correction
 * refusal bound (`correctionBoundM`, about 2 x the prompt's numbers today)
 * were lowered, how many UNMOVED visits would refuse the code and follow
 * GPS instead? The settle compares the code seen through the visit's
 * final alignment with its stored pose, so that offset is the reading.
 * Only the horizontal part: a reference-point mark's rotation is the
 * phone's pose when the walker marked it, not a fixed facing, so the
 * refusal's yaw part has no reading on these pairs.
 */
function sweepRefusal(sets: readonly [string, PairResult[]][]): void {
  const rows: Record<string, unknown>[] = [];
  for (const [label, ps] of sets.slice(0, 3)) {
    for (const boundM of [...REFUSAL_BOUNDS_M, "shipped"] as const) {
      rows.push({
        set: label,
        boundM,
        ...rate(
          ps.map((p) =>
            pairOutcome(
              p,
              p.offsetFinalM >
                (boundM === "shipped" ? p.shippedBoundM : boundM),
            ),
          ),
          "points",
        ),
      });
    }
    rows.push({
      set: label,
      what: "the shipped bound itself (m)",
      ...bothWeights(ps, (p) => p.shippedBoundM, [
        ["p10", 0.1],
        ["p25", 0.25],
        ["median", 0.5],
      ]),
    });
  }
  emit(
    "D1 (report only): unmoved visits whose settle would refuse the code and follow GPS, at lowered correction bounds (offset through the visit's final alignment > bound)",
    rows,
  );
}

function sweepNoiseModel(walks: readonly Walk[]): void {
  for (const minExtent of [30, 100]) {
    const used = walks.filter(
      (w) => w.place === "outdoor" && extentM(w.fixes!) >= minExtent,
    );
    const series = used
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
      `Gauss-Markov fit to device-fix residuals against each walk's final alignment (${series.length} outdoor walks, extent >= ${minExtent} m); a few-minute walk cannot see tau above about a minute (gps-noise-fit.ts.md), so these are lower bounds`,
      [
        {
          walkMinutes: summary(
            series.map((s) => (s[s.length - 1]!.tMs - s[0]!.tMs) / 60_000),
          ),
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
  turnSign: number,
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
          beyond30: kOfN(
            offsets.filter((o) => Math.abs(o) > 30).length,
            offsets.length,
          ),
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
            // Draws are not the sample: these walks are.
            mintWalks: mints.filter((a) => a.length > 0).length,
            scanWalks: scans.filter((a) => a.length > 0).length,
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
    "heading channel: |stored - observed| > T, 4000 cross-session draws (stored = the mint's published alignment from one walk, observed from another)",
    channelRows,
  );

  sweepYawChannel(walks, qualified, outdoorCases, turnSign);

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
        const row: Record<string, unknown> = {
          floorM,
          T: Number.isFinite(T) ? T : "off",
          fa: rate(
            cov.map((c, i) => ({
              hit: posFa[i]! || Math.abs(head[i]!) > T,
              unit: c.walk,
              walks: [c.walk],
            })),
            "walks",
          ),
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
            row[`m${moveM}t${turn}`] = `${k}/${n} ${pct(k, n)}%`;
          }
        }
        combined.push(row);
      }
    }
    emit(
      `combined rule, outdoor virtual codes whose walk lasts ${h} s (${cov.length} codes, ${new Set(cov.map((c) => c.walk)).size} walks; heading draws from ${outdoorErrs.length} walks): moved if rigid |D| > floor (shipped gate, floor only, within ${h} s) OR compass heading |diff| > T at the scan; detection by move m and turn t`,
      combined,
    );
  }
}

/**
 * The rigid fit's yaw as a turn check, with the stored heading from
 * ANOTHER walk. A virtual code's yaw reading on its own walk is
 * s x (published heading error at the scan - the fit's own heading error),
 * both errors from the SAME walk's GPS and so correlated: that reading is
 * optimistic. Substituting another walk's published heading error for the
 * first term (s measured by `sweepVirtual`) gives the cross-session
 * reading; one seeded draw per code from a pool of other walks.
 */
function sweepYawChannel(
  walks: readonly Walk[],
  qualified: readonly Walk[],
  outdoorCases: readonly Case[],
  turnSign: number,
): void {
  const errsOf = new Map(
    walks
      .filter((w) => w.place === "outdoor")
      .map((w) => [w.key, headingErrors(w)] as const),
  );
  const poolWalks = qualified.filter((w) => w.place === "outdoor");
  const poolOf = (keep: (tS: number) => boolean) =>
    poolWalks.map((w) => {
      const e = errsOf.get(w.key);
      return e === null || e === undefined
        ? []
        : finiteOf(e.published.filter((_, i) => keep(e.tS[i]!)));
    });
  const pools = {
    settled: poolOf((tS) => tS >= SETTLED_S),
    early: poolOf((tS) => tS < SETTLED_S),
  };
  const rows: Record<string, unknown>[] = [];
  for (const h of [120, 300]) {
    const decided = outdoorCases.flatMap((c) => {
      if (!covers(c.rigid, h)) return [];
      let v = Number.NaN;
      for (let k = 0; k < c.rigid.tS.length && c.rigid.tS[k]! <= h; k += 1)
        if (c.rigid.span[k]! >= 60 && c.rigid.spread[k]! >= 2)
          v = c.rigid.yaw[k]!;
      const pubSame = errsOf.get(c.walk)?.published[c.scanIdx] ?? Number.NaN;
      return Number.isFinite(v) && Number.isFinite(pubSame)
        ? [{ c, v, pubSame }]
        : [];
    });
    // The decomposition's check: if the same-walk reading is s x (stored
    // heading error - the fit's), it correlates positively with s x the
    // stored heading error.
    const xs = decided.map((x) => turnSign * x.pubSame);
    const ys = decided.map((x) => x.v);
    const mean = (a: readonly number[]) =>
      a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    xs.forEach((x, i) => {
      sxy += (x - mx) * (ys[i]! - my);
      sxx += (x - mx) ** 2;
      syy += (ys[i]! - my) ** 2;
    });
    rows.push({
      atS: h,
      check: "corr(same-walk yaw, s x published heading error at the scan)",
      codes: decided.length,
      corr: Math.round((100 * sxy) / Math.sqrt(sxx * syy)) / 100,
    });
    const variants: [string, (x: (typeof decided)[number]) => number][] = [];
    variants.push([
      "same walk (optimistic), code saved >= 60 s in",
      (x) => (x.c.scanSinceStartS >= SETTLED_S ? x.v : Number.NaN),
    ]);
    variants.push([
      "same walk (optimistic), code saved < 60 s in",
      (x) => (x.c.scanSinceStartS < SETTLED_S ? x.v : Number.NaN),
    ]);
    for (const kind of ["settled", "early"] as const) {
      const pool = pools[kind];
      const candidates = pool.flatMap((a, k) => (a.length > 0 ? [k] : []));
      const rnd = seeded(kind === "settled" ? 41 + h : 43 + h);
      variants.push([
        `cross-walk: stored heading from another walk's alignment ${kind === "settled" ? ">=" : "<"} 60 s into it (${candidates.length} walks)`,
        (x) => {
          for (let tries = 0; tries < 50; tries += 1) {
            const k = candidates[Math.floor(rnd() * candidates.length)];
            if (k === undefined) return Number.NaN;
            if (poolWalks[k]!.key === x.c.walk) continue;
            const a = pool[k]!;
            const other = a[Math.floor(rnd() * a.length)]!;
            return wrap180(x.v - turnSign * x.pubSame + turnSign * other);
          }
          return Number.NaN;
        },
      ]);
    }
    for (const [label, read] of variants) {
      const readings = decided
        .map((x) => ({ c: x.c, r: read(x) }))
        .filter((x) => Number.isFinite(x.r));
      const row: Record<string, unknown> = {
        atS: h,
        stored: label,
        codes: readings.length,
        walks: new Set(readings.map((x) => x.c.walk)).size,
        yawAbs: summary(readings.map((x) => Math.abs(x.r))),
      };
      for (const T of HEADING_TS_DEG) {
        row[`fa${T}`] = rate(
          readings.map((x) => ({
            hit: Math.abs(x.r) > T,
            unit: x.c.walk,
            walks: [x.c.walk],
          })),
          "walks",
        );
        // A 90 degree turn either way.
        const det = readings.flatMap((x) => [
          Math.abs(wrap180(x.r + 90)) > T,
          Math.abs(wrap180(x.r - 90)) > T,
        ]);
        row[`det90_${T}`] = kOfN(det.filter(Boolean).length, det.length);
      }
      rows.push(row);
    }
  }
  emit(
    "the rigid fit's yaw (GPS path) as a turn check, virtual outdoor codes (span >= 60 s, spread >= 2 m): same-walk stored heading vs a stored heading drawn from another walk",
    rows,
  );
}

// ---------------------------------------------------------------------------
// M5c: the viewer rule AS SHIPPED (`moved-code-rule.ts` `judgeCodeMove`,
// called per fix exactly as the viewer's check calls it), first crossing.
// Since the owner's decision of 2026-10-02 the rule has ONE turn check: the
// rigid fit's yaw (the code's heading in GPS world space) beyond
// `settledYawDeg`, only for a save whose alignment had solved
// `settledAlignmentSamples` fixes, and only past the position rule's
// evidence gate; no compass, no fallback.
//
// Parameters (declared; swept where marked):
// - the position half on the cross-day pairs: the check's horizon after the
//   scan (120 / 300 / 600 s / the whole visit, swept), the shipped floor and
//   gate, the shipped fit window (`MOVED_CODE_FIT_WINDOW_S`, 300 s before the
//   sighting), and that window itself swept (120 / 300 / 600 s / unbounded)
//   within 120 and 300 s. Two denominators: every pair (a visit that ends early simply stops
//   being checked), and only the pairs whose visit lasts the horizon. The
//   pairs carry NO heading truth - a reference mark's rotation is the phone's
//   pose when it was marked, not a printed code's facing, so two days' marks
//   of one spot differ by however the phone was held (a first run that
//   applied the turn check to them read 1,694 of 6,166 pairs "turned"). The
//   turn check is therefore measured on the virtual codes below, and the
//   whole rule's false alarms are at most the sum of the two halves;
// - the turn check alone on the outdoor virtual codes, the saved heading
//   drawn from ANOTHER walk's published alignment (as `sweepYawChannel`),
//   split by the fix count its alignment had solved
//   (`settledAlignmentSamples` 60 / 120 / 180, swept) with T 30 / 45 / 60
//   (swept); an early save runs no turn check (shown: 0 by construction);
//   per-fix FIRST crossing within 120 / 300 s, which is what the viewer acts
//   on; the same two denominators (every code with a draw, and the codes
//   whose walk lasts the window).
// ---------------------------------------------------------------------------

const SHIPPED_HORIZONS_S = [120, 300, 600, Number.POSITIVE_INFINITY] as const;
/** The fit window before the sighting (M5c review H2), swept. */
const FIT_WINDOWS_S = [120, 300, 600, Number.POSITIVE_INFINITY] as const;
const SETTLED_SAMPLES_SWEEP = [60, 120, 180] as const;
const SETTLED_YAW_SWEEP_DEG = [30, 45, 60] as const;

/** A trace's estimate at fix `k`, a move and a heading offset added (the
 *  rigid fit: a move adds exactly, a turn reaches the yaw only). */
function estimateAt(
  tr: Trace,
  k: number,
  move: readonly [number, number] = [0, 0],
  yawDeltaDeg = 0,
): DisplacementEstimate {
  const dn = tr.dn[k]! + move[0];
  const de = tr.de[k]! + move[1];
  return {
    displacementM: [dn, de],
    magnitudeM: Math.hypot(dn, de),
    spanS: tr.span[k]!,
    spreadM: tr.spread[k]!,
    samples: 0,
    yawDeg: wrap180(tr.yaw[k]! + yawDeltaDeg),
  };
}

/** The shipped rule's first `moved` within `h` seconds of the scan, and
 *  what decided it; null: never. */
function firstShipped(
  tr: Trace,
  h: number,
  settled: boolean,
  rules: { move: CodeMoveRule; turn: CodeTurnRule },
  move: readonly [number, number] = [0, 0],
  yawDeltaDeg = 0,
): { tS: number; by: "position" | "turn" } | null {
  for (let k = 0; k < tr.tS.length && tr.tS[k]! <= h; k += 1) {
    const j = judgeCodeMove(
      { settled, estimate: estimateAt(tr, k, move, yawDeltaDeg) },
      rules,
    );
    if (j.verdict === "moved" && j.decidedBy !== null)
      return { tS: tr.tS[k]!, by: j.decidedBy };
  }
  return null;
}

const SHIPPED = { move: CODE_MOVE_RULE, turn: CODE_TURN_RULE } as const;
/** The turn check alone: a floor no position reaches. */
const turnOnly = (turn: CodeTurnRule) => ({
  move: { ...CODE_MOVE_RULE, floorM: Number.POSITIVE_INFINITY },
  turn,
});

function sweepShippedRule(
  walks: readonly Walk[],
  cross: readonly PairResult[],
  outdoorCases: readonly Case[],
  turnSign: number,
): void {
  // Position only: the marks carry no code heading (see above).
  const settled = false; // no turn check: position only
  const posTable = (
    trOf: (p: PairResult) => Trace,
    horizons: readonly number[],
  ) =>
    horizons.map((h) => {
      const traces = cross.map(trOf);
      const covered = cross
        .map((p, i) => ({ p, tr: traces[i]! }))
        .filter((x) => !Number.isFinite(h) || covers(x.tr, h));
      const all = cross.map((p, i) => ({ p, tr: traces[i]! }));
      type X = (typeof all)[number];
      const fa = (xs: readonly X[]) =>
        rate(
          xs.map((x) =>
            pairOutcome(x.p, firstShipped(x.tr, h, settled, SHIPPED) !== null),
          ),
          "points",
        );
      const det = (xs: readonly X[], moveM: number) =>
        rate(
          xs.flatMap((x) =>
            MOVE_BEARINGS_DEG.map((b) =>
              pairOutcome(
                x.p,
                firstShipped(
                  x.tr,
                  h,
                  settled,
                  SHIPPED,
                  bearingMove(moveM, b),
                ) !== null,
              ),
            ),
          ),
          "points",
          false,
        );
      return {
        horizonS: Number.isFinite(h) ? h : "whole visit",
        pairs: `${String(covered.length)} covered of ${String(cross.length)}`,
        faAll: fa(all),
        faCovered: fa(covered),
        det20All: det(all, 20),
        det20Covered: det(covered, 20),
        det30All: det(all, 30),
        det30Covered: det(covered, 30),
      };
    });
  emit(
    `M5c fit window (H2) on cross-day pairs: the rigid fit over the fixes stamped at most W s before the sighting; position half, within h; "all": every pair; "covered": pairs whose visit lasts h`,
    FIT_WINDOWS_S.flatMap((w) =>
      posTable(
        (p) => (Number.isFinite(w) ? p.windowed(w) : p.all),
        [120, 300],
      ).map((row) => ({
        windowS: Number.isFinite(w) ? w : "unbounded",
        ...row,
      })),
    ),
  );
  emit(
    `M5c shipped rule, position half on cross-day pairs (fit window ${String(MOVED_CODE_FIT_WINDOW_S)} s before the sighting): unmoved pairs read moved within the check's horizon h, and 20 / 30 m moves caught (4 bearings). "all": every pair; "covered": pairs whose visit lasts h`,
    posTable((p) => p.windowed(MOVED_CODE_FIT_WINDOW_S), SHIPPED_HORIZONS_S),
  );

  // The turn check alone on the outdoor virtual codes.
  const errsOf = new Map(
    walks
      .filter((w) => w.place === "outdoor")
      .map((w) => [w.key, headingErrors(w)] as const),
  );
  const poolWalks = walks.filter(
    (w) =>
      w.place === "outdoor" &&
      w.fixes!.length >= 120 &&
      extentM(w.fixes!) >= 30,
  );
  const poolOf = (keep: (i: number) => boolean) =>
    poolWalks.map((w) => {
      const e = errsOf.get(w.key);
      return e == null ? [] : finiteOf(e.published.filter((_, i) => keep(i)));
    });
  const rows: Record<string, unknown>[] = [];
  for (const nSettled of SETTLED_SAMPLES_SWEEP) {
    for (const kind of ["settled", "early"] as const) {
      const pool = poolOf((i) => (kind === "settled") === i >= nSettled);
      const candidates = pool.flatMap((a, k) => (a.length > 0 ? [k] : []));
      const rnd = seeded(kind === "settled" ? 71 + nSettled : 73 + nSettled);
      // One draw per code, shared by every variant below.
      const draws = outdoorCases.map((c) => {
        const pubSame = errsOf.get(c.walk)?.published[c.scanIdx];
        if (pubSame === undefined || !Number.isFinite(pubSame))
          return Number.NaN;
        for (let tries = 0; tries < 50; tries += 1) {
          const k = candidates[Math.floor(rnd() * candidates.length)];
          if (k === undefined) return Number.NaN;
          if (poolWalks[k]!.key === c.walk) continue;
          const a = pool[k]!;
          const other = a[Math.floor(rnd() * a.length)]!;
          return -turnSign * pubSame + turnSign * other;
        }
        return Number.NaN;
      });
      const variants =
        kind === "settled"
          ? SETTLED_YAW_SWEEP_DEG.map((T) => ({
              label: `turn check T=${String(T)}`,
              turn: {
                ...CODE_TURN_RULE,
                settledYawDeg: T,
                settledAlignmentSamples: nSettled,
              },
              settled: true,
            }))
          : [
              {
                label: "early save: no turn check (shipped)",
                turn: CODE_TURN_RULE,
                settled: false,
              },
            ];
      const drawn = outdoorCases
        .map((c, i) => ({ c, d: draws[i]! }))
        .filter((x) => Number.isFinite(x.d));
      for (const h of [120, 300]) {
        const cov = drawn.filter((x) => covers(x.c.rigid, h));
        for (const v of variants) {
          const hitAt = (x: (typeof drawn)[number], extra: number) =>
            firstShipped(
              x.c.rigid,
              h,
              v.settled,
              turnOnly(v.turn),
              [0, 0],
              x.d + extra,
            ) !== null;
          const fa = (xs: typeof drawn) =>
            rate(
              xs.map((x) => ({
                hit: hitAt(x, 0),
                unit: x.c.walk,
                walks: [x.c.walk],
              })),
              "walks",
            );
          const det = (xs: typeof drawn, turn: number) => {
            const hits = xs.flatMap((x) =>
              turn === 180
                ? [hitAt(x, 180)]
                : [hitAt(x, turn), hitAt(x, -turn)],
            );
            return kOfN(hits.filter(Boolean).length, hits.length);
          };
          rows.push({
            settledSamples: nSettled,
            savedFrom: kind,
            withinS: h,
            rule: v.label,
            codes: `${String(cov.length)} covered of ${String(drawn.length)}`,
            faAll: fa(drawn),
            faCovered: fa(cov),
            det90All: det(drawn, 90),
            det90Covered: det(cov, 90),
            det180All: det(drawn, 180),
            det180Covered: det(cov, 180),
          });
        }
      }
    }
  }
  emit(
    "M5c shipped rule (no compass), the turn check alone on outdoor virtual codes (saved heading from ANOTHER walk; settled = that alignment had solved >= N fixes): first crossing within h; all = every code with a draw, covered = codes whose walk lasts h",
    rows,
  );
}

describe.runIf(MODE === "sweep")("D20 real walks: the sweep", () => {
  it(
    "prints the real false-alarm, detection, noise-model and heading tables",
    () => {
      // The core's licensed geo maths (calcGpsCoords for the cross-session
      // pairs) is activated by building a store, as the replay did.
      createTourViewerStore();
      // Deduplicate by content: the corpus must be on disk for this.
      const { kept, dropped } = corpusZips();
      if (kept.length === 0)
        throw new Error(
          "the sweep deduplicates the cache by content and needs the corpus on disk (D20_REAL_PRIMARY / D20_REAL_CORPUS)",
        );
      const keys = new Set(kept.map((z) => z.key));
      const cached = loadWalks();
      const all = cached.filter((w) => keys.has(w.key));
      const walks = all.filter(
        (w) => w.skipped === undefined && (w.fixes?.length ?? 0) >= MIN_FIXES,
      );
      sweepData({
        all,
        walks,
        dropped,
        missing: kept.length - all.length,
      });
      const cases = walks.flatMap((w) => virtualCases(w));
      const turnSign = sweepVirtual(walks, cases);
      const cross = sweepPairs(walks);
      sweepNoiseModel(walks);
      sweepHeading(
        walks,
        cases.filter((c) => c.place === "outdoor"),
        turnSign,
      );
      sweepShippedRule(
        walks,
        cross,
        cases.filter((c) => c.place === "outdoor"),
        turnSign,
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
    expect(dayOf("TestDataJs__2026-08-24_08-02-24utc")).toBe("2026-08-24");
    expect(dayOf("id-without-a-date")).toBeNull();
  });

  // Why this test matters: six recordings sit byte-identical in the
  // catch-all folder and in a labelled one. Replayed twice, each paired with
  // itself as a "cross-session" pair at zero offset and counted twice in
  // every share; and the copy kept decides the walk's environment label.
  it("keeps one entry per content, the labelled copy winning", () => {
    const entries = [
      { key: "generic__a", generic: true, c: "A" },
      { key: "generic__b", generic: true, c: "B" },
      { key: "indoor__a", generic: false, c: "A" },
      { key: "generic__c", generic: true, c: "C" },
      { key: "generic__c2", generic: true, c: "C" },
    ];
    const { kept, dropped } = dedupeByContent(entries, (e) => e.c);
    expect(kept.map((e) => e.key)).toEqual([
      "generic__b",
      "indoor__a",
      "generic__c",
    ]);
    expect(dropped).toEqual([
      { key: "generic__a", keptAs: "indoor__a" },
      { key: "generic__c2", keptAs: "generic__c" },
    ]);
  });

  // Why this test matters: every headline share carries this bound, and a
  // zero count is the common case (no false alarm in n), where the bound is
  // the only honest statement of what was measured.
  it("bounds a binomial share from above, exactly (one-sided 95 %)", () => {
    expect(upper95(0, 100)).toBeCloseTo(1 - 0.05 ** (1 / 100), 6);
    expect(upper95(0, 100)).toBeLessThan(3 / 100);
    // Clopper-Pearson one-sided 95 % for 1 in 10: 0.3942.
    expect(upper95(1, 10)).toBeCloseTo(0.3942, 3);
    expect(upper95(10, 10)).toBe(1);
    expect(upper95(3, 0)).toBeNaN();
    for (let k = 0; k < 20; k += 1)
      expect(upper95(k + 1, 200)).toBeGreaterThan(upper95(k, 200));
    expect(kOfN(0, 100)).toBe("0/100 0% (ub 3%)");
  });

  // Why this test matters: a name collision dropped by its raw-GPS distance
  // would remove exactly the large genuine GPS disagreements the pairs
  // exist to measure. This rule sees only each walk's own odometry: a name
  // marked at two spots in one walk, and a point whose distances to the
  // other shared points disagree between two walks.
  it("finds name collisions from odometry alone", () => {
    const site = (walk: string, key: string, n: number, e: number) => ({
      walk,
      key,
      n,
      e,
    });
    const sites = [
      // Within one walk, "bench" marked 50 m apart: ambiguous everywhere.
      site("W1", "bench", 0, 0),
      site("W1", "bench", 50, 0),
      site("W2", "bench", 3, 0),
      // X and Y share p, q, r; Y's r is placed so its distances to p and q
      // are 40 m and 25 m off X's, while p-q agrees. Each walk's frame
      // is its own (Y is shifted and turned): only distances are compared.
      site("X", "p", 0, 0),
      site("X", "q", 100, 0),
      site("X", "r", 0, 60),
      site("Y", "p", 500, 500),
      site("Y", "q", 500, 600),
      site("Y", "r", 500 + 100, 500),
      // Z and V share only s and t, which disagree: both flagged.
      site("Z", "s", 0, 0),
      site("Z", "t", 30, 0),
      site("V", "s", 0, 0),
      site("V", "t", 80, 0),
      // A repeat of one spot within a walk is not a collision.
      site("V", "u", 10, 10),
      site("V", "u", 11, 10),
    ];
    const c = nameCollisions(sites, COLLISION_RULE);
    expect([...c.ambiguous]).toEqual(["bench"]);
    expect([...c.inconsistent].sort()).toEqual(["V|Z|s", "V|Z|t", "X|Y|r"]);
    // A looser tolerance accepts Y's r (its distance error stays inside).
    const loose = nameCollisions(sites, {
      withinWalkM: 60,
      pairAbsM: 100,
      pairRel: 0,
    });
    expect(loose.ambiguous.size).toBe(0);
    expect(loose.inconsistent.size).toBe(0);
  });
});
