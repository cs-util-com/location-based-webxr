/**
 * The page-side log of the creator's AR visits (authoring plan
 * 2026-09-28-0953 §3.3 and §7 #4, milestone M3b): each visit's GPS track
 * and fused path, and each code as that visit measured it.
 *
 * WHY A PAGE-SIDE LOG. The store's GPS track, odometry and alignment are
 * wiped at every AR exit (`teardownArSessionState`), before any summary
 * could read them. So the settle - which already runs while the store
 * still holds the visit (`ar-entry.ts` calls it first) - copies what the
 * summary needs into one entry per visit, and the creator setup writes
 * that entry into the draft (one key per visit), so a reload keeps it.
 *
 * WHAT A VISIT STORES FOR A CODE is what the M3a results ask for
 * (`2026-10-01-0354-code-estimate-across-visits-results.md`, "What the
 * draft must store"): the code's geo through THAT visit's own end-of-visit
 * alignment WITHOUT the code correction (each visit is one independent
 * GPS estimate; a corrected one would just repeat the stored pose), the
 * visit's median GPS accuracy and its walked baseline, a visit id that
 * survives a reload, and the time. `combineCodeVisits` reads them back
 * through {@link codeVisitPoses}.
 *
 * @see visit-log.ts.md
 */

import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { parseGeoPose } from "gps-plus-slam-app-framework/ar/qr/geo-pose";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  GPS_POINT_SOURCE_DEVICE,
  gpsPointSourceOf,
  type LatLong,
  type Matrix4,
} from "gps-plus-slam-app-framework/core";
import { computeFusedPath } from "gps-plus-slam-app-framework/utils/fused-path";
import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";

import type { CodeVisitPose } from "./code-visit-combine.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";

/**
 * The smallest spacing (m) between two stored points of a path. GPS
 * arrives at about 1 Hz with 3-15 m accuracy, so points closer than a
 * metre say nothing about where the creator walked that the GPS noise does
 * not drown, and the fused path's sub-metre wiggles are below a pixel at
 * the summary's framing (zoom 17-18 is 0.6-1.2 m per pixel at 47°N). A
 * 20-minute walk at 1 m/s keeps about 1,200 points per path. Standing
 * still thins the fused path (odometry) to almost nothing, but NOT the raw
 * track: GPS noise often moves a fix by more than a metre from one second
 * to the next, so most standing fixes can be kept, and
 * {@link VISIT_PATH_MAX_POINTS} is what bounds a long stand. What would
 * reverse it: a summary that is
 * zoomed in to inspect the fused path around a corner at sub-metre
 * detail (then 0.25 m), which this screen does not offer.
 */
export const VISIT_PATH_SPACING_M = 1;

/**
 * The most points one path of one visit keeps; past it the thinned path
 * is sampled evenly (first and last kept). A cap on the draft file, not a
 * look: 1,000 points of `[lat, lng, accuracy]` are about 30 kB, so even an
 * hour's walk stays a small write at the settle. It bites only past about
 * a kilometre of walking in one visit.
 */
export const VISIT_PATH_MAX_POINTS = 1000;

/** The stored shape's version; a file of another version is skipped. */
const VISIT_LOG_VERSION = 1;

/** One point of a visit's raw GPS track. */
interface VisitGpsPoint {
  readonly lat: number;
  readonly lng: number;
  /** The fix's reported horizontal accuracy (m), when it had one. */
  readonly accuracy?: number;
}

/** One point of a visit's fused path. */
interface VisitPathPoint {
  readonly lat: number;
  readonly lng: number;
}

/** A code as one visit measured it. */
interface VisitCode {
  readonly levelId: string;
  /** Through the visit's own end-of-visit alignment, NOT code-corrected. */
  readonly geo: QrGeoPose;
  /** The pose THIS visit's settle saved for the code (re-minted from its
   *  measurement), when it saved one: how the summary finds the visit a
   *  stored pose came from, to grade what visitors get (M3a/M3b review
   *  #2). Absent for a visit that only saw the code. */
  readonly savedGeo?: QrGeoPose;
  /** THE MOVE BOUNDARY (authoring plan §3.6, M5b; §7j #12): this visit
   *  moved the code - the author answered "Use the new spot" - so earlier
   *  visits describe the old spot and {@link codeVisitPoses} reads only
   *  from the latest such visit on. Absent otherwise (never false). */
  readonly moved?: true;
}

/** One AR visit, as the summary needs it after the store forgot it. */
export interface VisitLogEntry {
  /** Unique across page loads (`newVisitId`). */
  readonly visitId: string;
  /** When the visit was settled (epoch ms). */
  readonly atMs: number;
  /** The median reported accuracy of the visit's device fixes (m), or
   *  null when no fix reported one. */
  readonly gpsAccuracyM: number | null;
  /** The largest horizontal extent of the visit's walk (m), from its
   *  odometry: the baseline of the M3a heading model. */
  readonly baselineM: number;
  /** The raw device fixes, thinned. */
  readonly gps: readonly VisitGpsPoint[];
  /** The odometry through the alignment the visit's objects settled
   *  through, thinned; empty without an alignment. */
  readonly fused: readonly VisitPathPoint[];
  readonly codes: readonly VisitCode[];
}

/** A visit id: this page load's random id plus the visit's generation.
 *  `arSessionGeneration` alone restarts at 0 on every load. */
export function newVisitId(pageId: string, generation: number): string {
  return `${pageId}-${String(generation)}`;
}

// ---------------------------------------------------------------------------
// Building an entry from the store, at the settle
// ---------------------------------------------------------------------------

/** The store's GPS point, as far as this module reads it. */
interface VisitGpsFix {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
  readonly latLongAccuracy?: unknown;
  /** The fix's own time (epoch ms); read by {@link deviceSamples} only. */
  readonly timestamp?: unknown;
  readonly source?: string;
}

export interface VisitLogInput {
  readonly visitId: string;
  readonly atMs: number;
  /** `selectGpsPositions` - paired index for index with the odometry. */
  readonly gpsPositions: readonly VisitGpsFix[];
  /** `selectOdometryPositions` (odometry NUE). */
  readonly odometryPositions: readonly (readonly number[])[];
  /** The store's alignment at the visit's end: what the codes go through. */
  readonly alignment: ArrayLike<number> | null;
  /** The alignment the visit's objects settled through (the code-corrected
   *  one when the settle corrected): what the fused path goes through, so
   *  the pins sit on it. */
  readonly pathAlignment: ArrayLike<number> | null;
  readonly zero: LatLong | null;
  /** The store's accuracy median, used when no device fix reports one. */
  readonly storeAccuracyM?: number | null;
  /** The codes the visit saw: raw WebXR poses of its odometry, oldest
   *  first - a code named twice keeps its LAST look. */
  readonly codes: readonly {
    readonly levelId: string;
    readonly odomPose: Pose;
  }[];
  /** The pose the visit's settle saved for a code, when it saved one. */
  readonly saved?: { readonly levelId: string; readonly geo: QrGeoPose } | null;
  /** The codes this visit moved to a new spot (the move boundary). */
  readonly moved?: readonly string[];
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** 16 finite numbers as the core's matrix type, or null. */
function readAlignment(alignment: ArrayLike<number> | null): Matrix4 | null {
  if (alignment === null || alignment.length !== 16) return null;
  const values = Array.from(alignment);
  return values.every(isFiniteNumber) ? (values as unknown as Matrix4) : null;
}

/** Metres between two lat/lng points (equirectangular: exact enough for a
 *  spacing threshold over a walk). */
function latLngDistanceM(a: VisitPathPoint, b: VisitPathPoint): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const x = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return R * Math.hypot(x, y);
}

/**
 * Keep the first point, every point at least `spacingM` from the last kept
 * one, and the last point; then, past `maxPoints`, an even sample with the
 * first and last kept. Always a subset, in order.
 */
export function thinPath<T>(
  points: readonly T[],
  distanceM: (a: T, b: T) => number,
  spacingM = VISIT_PATH_SPACING_M,
  maxPoints = VISIT_PATH_MAX_POINTS,
): T[] {
  const first = points[0];
  if (first === undefined) return [];
  const kept: T[] = [first];
  let last = first;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i]!;
    if (distanceM(last, p) >= spacingM) {
      kept.push(p);
      last = p;
    }
  }
  // The walk's end is where the summary should show it ended.
  const end = points[points.length - 1]!;
  if (points.length > 1 && last !== end) kept.push(end);
  const cap = Math.max(2, Math.floor(maxPoints));
  if (kept.length <= cap) return kept;
  const out: T[] = [];
  for (let k = 0; k < cap; k += 1) {
    out.push(kept[Math.round((k * (kept.length - 1)) / (cap - 1))]!);
  }
  return out;
}

/** The largest horizontal (North/East) distance between two points (m). */
export function maxHorizontalExtentM(
  positions: readonly (readonly number[])[],
): number {
  let worst = 0;
  for (let i = 0; i < positions.length; i += 1) {
    const a = positions[i]!;
    for (let j = i + 1; j < positions.length; j += 1) {
      const b = positions[j]!;
      worst = Math.max(worst, Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!));
    }
  }
  return worst;
}

/** A readable point (finite, in range), with its accuracy when that is
 *  a positive number; null otherwise. The store's fixes and the draft's
 *  points go through this one check. */
function gpsPoint(
  lat: unknown,
  lng: unknown,
  accuracy: unknown,
): VisitGpsPoint | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return isFiniteNumber(accuracy) && accuracy > 0
    ? { lat, lng, accuracy }
    : { lat, lng };
}

function finitePosition(p: readonly number[]): boolean {
  return p.length >= 3 && [p[0], p[1], p[2]].every(isFiniteNumber);
}

/**
 * The device fixes with readable coordinates, and their odometry partners
 * (index for index), synthetic code votes left out: a vote's odometry is
 * the code's corner, not where the creator stood. The ONE device-only
 * filter over the store's GPS history; the moved-code estimators
 * (`code-displacement.ts`) read through it too, which is why a fix's own
 * time comes along (`timestampMs`, when finite).
 */
export function deviceSamples(
  input: Pick<VisitLogInput, "gpsPositions" | "odometryPositions">,
): {
  fix: VisitGpsPoint;
  odom: readonly number[] | null;
  timestampMs?: number;
}[] {
  const paired = input.gpsPositions.length === input.odometryPositions.length;
  return input.gpsPositions.flatMap((p, i) => {
    if (gpsPointSourceOf(p) !== GPS_POINT_SOURCE_DEVICE) return [];
    const fix = gpsPoint(p.latitude, p.longitude, p.latLongAccuracy);
    if (fix === null) return [];
    const odom = paired ? (input.odometryPositions[i] ?? null) : null;
    const sample = {
      fix,
      odom: odom !== null && finitePosition(odom) ? odom : null,
    };
    return [
      isFiniteNumber(p.timestamp)
        ? { ...sample, timestampMs: p.timestamp }
        : sample,
    ];
  });
}

/** A code's geo through `alignment`, or null when it cannot be minted. */
function codeGeo(
  odomPose: Pose,
  alignment: Matrix4,
  zero: LatLong,
): QrGeoPose | null {
  const world = throughAlignment(odomNueFromWebXr(odomPose), alignment);
  if (world === null) return null;
  try {
    return mintQrGeoPose({
      worldNuePosition: {
        x: world.position[0],
        y: world.position[1],
        z: world.position[2],
      },
      worldNueRotation: [...world.rotation],
      zero,
    });
  } catch {
    return null;
  }
}

/** The median reported accuracy of the fixes, else the store's, else
 *  null. */
function visitAccuracyM(
  fixes: readonly VisitGpsPoint[],
  storeAccuracyM: number | null | undefined,
): number | null {
  const accuracies = fixes.flatMap((f) =>
    f.accuracy === undefined ? [] : [f.accuracy],
  );
  if (accuracies.length > 0) return interpolatingMedian(accuracies);
  return isFiniteNumber(storeAccuracyM) && storeAccuracyM > 0
    ? storeAccuracyM
    : null;
}

/**
 * The log entry of one visit, from the store as the settle reads it.
 * Defensive: the store is external data here. Unreadable fixes, odometry
 * of the wrong length, a missing or non-finite alignment and codes that
 * cannot be minted are left out, never repaired.
 */
export function buildVisitLogEntry(input: VisitLogInput): VisitLogEntry {
  const samples = deviceSamples(input);
  const gpsAccuracyM = visitAccuracyM(
    samples.map((s) => s.fix),
    input.storeAccuracyM,
  );
  const odometry = samples.flatMap((s) => (s.odom === null ? [] : [s.odom]));
  const nueDistance = (a: readonly number[], b: readonly number[]): number =>
    Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);
  const thinnedOdometry = thinPath(odometry, nueDistance);
  const alignment = readAlignment(input.alignment);
  const pathAlignment = readAlignment(input.pathAlignment);
  const zero = input.zero;
  const fused =
    pathAlignment === null || zero === null
      ? []
      : computeFusedPath({
          odometryPositions: thinnedOdometry.map(
            (p) => [p[0]!, p[1]!, p[2]!] as const,
          ),
          alignmentMatrix: pathAlignment,
          zeroRef: zero,
        }).map((p) => ({ lat: p.lat, lng: p.lng }));
  const codes: VisitCode[] = [];
  if (alignment !== null && zero !== null) {
    // The LAST look per code (M3a/M3b review #8): the measuring visit names
    // its code at the tap and again at its latest stable sighting, and the
    // M3a spike measured each visit by its last look.
    const last = new Map<string, Pose>();
    for (const code of input.codes) last.set(code.levelId, code.odomPose);
    for (const [levelId, odomPose] of last) {
      const geo = codeGeo(odomPose, alignment, zero);
      if (geo === null) continue;
      const saved = input.saved;
      const code: VisitCode =
        saved != null && saved.levelId === levelId
          ? { levelId, geo, savedGeo: saved.geo }
          : { levelId, geo };
      codes.push(
        input.moved?.includes(levelId) === true
          ? { ...code, moved: true }
          : code,
      );
    }
  }
  return {
    visitId: input.visitId,
    atMs: input.atMs,
    gpsAccuracyM,
    // Over the thinned path: a subset, so at most 2 x the spacing short of
    // the full track's extent - the conservative side for the heading
    // model, and an O(n²) over hundreds rather than thousands of points.
    baselineM: maxHorizontalExtentM(thinnedOdometry),
    gps: thinPath(
      samples.map((s) => s.fix),
      latLngDistanceM,
    ),
    fused,
    codes,
  };
}

/**
 * The poses `combineCodeVisits` combines for `levelId`: one per visit that
 * measured it, from the latest visit that MOVED the code on (the move
 * boundary; `entries` oldest first, as `VisitLog.entries` lists them). A
 * visit without an accuracy hands a NaN, which the combiner skips as
 * unusable rather than trusting it.
 */
export function codeVisitPoses(
  entries: readonly VisitLogEntry[],
  levelId: string,
): CodeVisitPose[] {
  let boundary = 0;
  entries.forEach((entry, i) => {
    if (entry.codes.some((c) => c.levelId === levelId && c.moved === true)) {
      boundary = i;
    }
  });
  return entries.slice(boundary).flatMap((entry) =>
    entry.codes
      .filter((c) => c.levelId === levelId)
      .map((c) => ({
        geo: c.geo,
        gpsAccuracyM: entry.gpsAccuracyM ?? Number.NaN,
        baselineM: entry.baselineM,
      })),
  );
}

// ---------------------------------------------------------------------------
// The draft file: compact JSON, read back defensively
// ---------------------------------------------------------------------------

/** Round to `digits` decimals (7 for degrees is about 1 cm). */
const round = (v: number, digits: number): number =>
  Math.round(v * 10 ** digits) / 10 ** digits;

/** The entry as its draft file holds it: points as small arrays. */
export function serializeVisitLogEntry(entry: VisitLogEntry): string {
  return JSON.stringify({
    version: VISIT_LOG_VERSION,
    visitId: entry.visitId,
    atMs: entry.atMs,
    gpsAccuracyM: entry.gpsAccuracyM,
    baselineM: round(entry.baselineM, 2),
    gps: entry.gps.map((p) =>
      p.accuracy === undefined
        ? [round(p.lat, 7), round(p.lng, 7)]
        : [round(p.lat, 7), round(p.lng, 7), round(p.accuracy, 1)],
    ),
    fused: entry.fused.map((p) => [round(p.lat, 7), round(p.lng, 7)]),
    codes: entry.codes,
  });
}

function readPoint(value: unknown): VisitGpsPoint | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lat, lng, accuracy] = value as unknown[];
  return gpsPoint(lat, lng, accuracy);
}

/** The entry's scalar fields, or null when one does not read. */
function readHeader(
  r: Record<string, unknown>,
): Pick<
  VisitLogEntry,
  "visitId" | "atMs" | "gpsAccuracyM" | "baselineM"
> | null {
  const { visitId, atMs, gpsAccuracyM, baselineM } = r;
  if (r["version"] !== VISIT_LOG_VERSION) return null;
  if (typeof visitId !== "string" || visitId.length === 0) return null;
  if (!isFiniteNumber(atMs) || !isFiniteNumber(baselineM) || baselineM < 0) {
    return null;
  }
  const accuracy =
    isFiniteNumber(gpsAccuracyM) && gpsAccuracyM > 0 ? gpsAccuracyM : null;
  return { visitId, atMs, gpsAccuracyM: accuracy, baselineM };
}

/** A geo pose validated by the framework's one geo-pose parser (the
 *  level's and the manifest's), or null. */
function readGeo(value: unknown): QrGeoPose | null {
  try {
    return parseGeoPose(value, {
      path: "geo",
      fail: (message) => {
        throw new Error(message);
      },
    });
  } catch {
    return null;
  }
}

/** A code record, validated the way a draft object is validated by the
 *  manifest's own rules. An unreadable saved pose costs that field only:
 *  the visit's measurement still counts. */
function readCode(value: unknown): VisitCode | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const levelId = record["levelId"];
  if (typeof levelId !== "string" || levelId.length === 0) return null;
  const geo = readGeo(record["geo"]);
  if (geo === null) return null;
  const savedGeo =
    record["savedGeo"] === undefined ? null : readGeo(record["savedGeo"]);
  const code: VisitCode =
    savedGeo === null ? { levelId, geo } : { levelId, geo, savedGeo };
  return record["moved"] === true ? { ...code, moved: true } : code;
}

/**
 * Read one draft file back. A file that is not this version's entry is
 * skipped (null); within an entry, a point or a code that does not read
 * costs itself, not the visit.
 */
export function parseVisitLogEntry(text: string): VisitLogEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const header = readHeader(r);
  if (header === null) return null;
  const list = (key: string): unknown[] =>
    Array.isArray(r[key]) ? (r[key] as unknown[]) : [];
  return {
    ...header,
    gps: list("gps").flatMap((p) => {
      const point = readPoint(p);
      return point === null ? [] : [point];
    }),
    fused: list("fused").flatMap((p) => {
      const point = readPoint(p);
      return point === null ? [] : [{ lat: point.lat, lng: point.lng }];
    }),
    codes: list("codes").flatMap((c) => {
      const code = readCode(c);
      return code === null ? [] : [code];
    }),
  };
}

// ---------------------------------------------------------------------------
// The in-memory log
// ---------------------------------------------------------------------------

export interface VisitLog {
  /** Record one visit; a visit settled again replaces its entry. */
  record(entry: VisitLogEntry): void;
  /** Add a restored draft's visits; a visit already held is kept (the
   *  live entry is newer than the draft's). */
  restore(entries: readonly VisitLogEntry[]): void;
  /** Every visit, oldest first. */
  entries(): readonly VisitLogEntry[];
  /** The ids held, for "is this file this page's own". */
  ids(): readonly string[];
  /** Forget everything (the tour closed). */
  clear(): void;
}

export function createVisitLog(): VisitLog {
  const byId = new Map<string, VisitLogEntry>();
  return {
    record(entry) {
      byId.set(entry.visitId, entry);
    },
    restore(entries) {
      for (const entry of entries) {
        if (!byId.has(entry.visitId)) byId.set(entry.visitId, entry);
      }
    },
    entries() {
      return [...byId.values()].sort(
        (a, b) => a.atMs - b.atMs || a.visitId.localeCompare(b.visitId),
      );
    },
    ids() {
      return [...byId.keys()];
    },
    clear() {
      byId.clear();
    },
  };
}
