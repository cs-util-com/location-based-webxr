/**
 * What the summary after Finish shows (authoring plan 2026-09-28-0953 §1
 * item 5, §3.3, milestone M3b): every AR visit's walk, each code with its
 * position, facing line, uncertainty ring and verdict, and the placed pins
 * and photos. PURE: it is exactly the data the map view hands to Leaflet
 * and the list renders, so it is tested without a map.
 *
 * THE REFERENCE RULE IS NOT CHANGED HERE (D10b; re-estimating at Finish is
 * an open owner question, M3a Q4): the stored pose is the code's position
 * and what visitors get, so ITS grade is the primary verdict - from the
 * visit that saved it (M3a/M3b review #2). The combined estimate of the
 * visits (`combineCodeVisits`) is graded apart, as what the visits now
 * suggest, and drawn next to the stored pose only where the two differ by
 * more than the estimate's own predicted error (review #7).
 *
 * @see summary-model.ts.md
 */

import { rotateVectorByQuaternion } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type LatLong,
} from "gps-plus-slam-app-framework/core";

import {
  combineCodeVisits,
  type CodeVisitPose,
  type CombinedCodePose,
} from "./code-visit-combine.js";
import {
  codeVerdict,
  verdictWithoutNumbers,
  type CodeVerdict,
} from "./code-verdict.js";
import { rotationFromHeading } from "./content-placement.js";
import { codeVisitPoses, type VisitLogEntry } from "./visit-log.js";

/** A facing line is a quarter of the drawn area's diagonal: at the framed
 *  zoom the map is about that wide, so the line reads at a glance without
 *  crossing half the walk. */
const FACING_LINE_SHARE = 0.25;
/** ...but never shorter than this (m): 20 px at zoom 18 at 47°N. */
export const FACING_LINE_MIN_M = 8;
/** ...nor longer (m), so a long walk does not draw a street-long line. */
export const FACING_LINE_MAX_M = 40;
/**
 * A code whose face is within this many degrees of lying flat (or of
 * facing straight down) gets no facing line: its horizontal direction is
 * mostly pose noise. 15 degrees leaves about a quarter of the face normal
 * horizontal; a wall poster is far from it either way.
 */
const FLAT_CODE_DEG = 15;
/**
 * The combined estimate is drawn beside the stored pose only when it lies
 * further away than its OWN predicted horizontal error (the ring) - a
 * smaller difference is what two measurements of an unmoved code show on
 * GPS noise alone (M3a/M3b review #7) - and never below this floor (m):
 * below it the two marks overlap at the framed zoom (0.4-1.2 m per pixel).
 * The sidecar says what would reverse the 1 x multiple.
 */
export const DIFFERS_FLOOR_M = 0.5;
/** ...or turned further than its predicted heading error, and never below
 *  this floor (degrees): a 2 degree turn moves the end of an 8-40 m facing
 *  line by 0.3-1.4 m, about a pixel. */
const DIFFERS_FLOOR_DEG = 2;
/** Two geo poses are the same saved pose within this (degrees of lat/lon,
 *  about 1 cm; m of altitude): the level file and the visit log hold the
 *  same numbers, written by JSON at full precision. */
const SAME_POSE_DEG = 1e-7;
const SAME_POSE_ALT_M = 0.01;

export interface MapPoint {
  readonly lat: number;
  readonly lng: number;
}

/** A code's mark: where, and the bearing its printed face looks toward. */
export interface CodeMark extends MapPoint {
  /** Degrees clockwise from North; null for a code lying (nearly) flat. */
  readonly facingDeg: number | null;
  /** From the mark along `facingDeg`; null without a facing. */
  readonly facingLine: readonly [MapPoint, MapPoint] | null;
}

export interface SummaryCode {
  readonly levelId: string;
  /** "The code", or "Code 1", "Code 2"... when the tour has several. */
  readonly label: string;
  /** The stored pose: what visitors get. Null for a code the tour does
   *  not store yet (only measured). */
  readonly reference:
    | (CodeMark & {
        /** Its own predicted horizontal error, from the visit that saved
         *  it (m); null when no visit this device kept saved it. */
        readonly ringM: number | null;
      })
    | null;
  /** The visits' combined estimate; null when no visit measured it. */
  readonly combined:
    | (CodeMark & {
        /** The predicted horizontal error: the ring's radius (m). */
        readonly ringM: number;
        /** Drawn as a second mark (it differs from the reference by more
         *  than its predicted error, or there is no reference). */
        readonly shown: boolean;
        /** Its distance (m) and turn (degrees) from the reference; null
         *  without a reference. */
        readonly offsetM: number | null;
        readonly offsetDeg: number | null;
      })
    | null;
  /** PRIMARY: what visitors get - the stored pose's grade ("unknown"
   *  when no visit this device kept saved it, "not-saved" without one). */
  readonly verdict: CodeVerdict;
  /** SECONDARY: what the visits now suggest - the combined estimate's
   *  grade; null when no visit measured the code. */
  readonly estimateVerdict: CodeVerdict | null;
  /** The numbers behind both verdicts, one plain line each. */
  readonly details: readonly string[];
}

interface SummaryTrack {
  readonly visitId: string;
  readonly gps: readonly (MapPoint & { readonly accuracy?: number })[];
  readonly fused: readonly MapPoint[];
}

interface SummaryObject extends MapPoint {
  readonly id: string;
  readonly kind: "pin" | "photo";
  readonly label: string;
}

export interface SummaryModel {
  readonly tracks: readonly SummaryTrack[];
  readonly codes: readonly SummaryCode[];
  readonly objects: readonly SummaryObject[];
  /** Everything drawn, for framing the view. */
  readonly fitPoints: readonly MapPoint[];
}

export interface SummaryInput {
  readonly visits: readonly VisitLogEntry[];
  /** The codes' stored poses, in the numbering every label uses
   *  (`creator-codes.ts` `numbering`, M5b; a null geo: a level without a
   *  pose). */
  readonly references: readonly {
    readonly levelId: string;
    readonly geo: QrGeoPose | null;
  }[];
  /** The tour's objects as the zip now carries them. */
  readonly objects: readonly TourObject[];
}

const RAD = Math.PI / 180;

const finite = (...values: number[]): boolean => values.every(Number.isFinite);

function readablePoint(p: { lat: number; lng: number }): boolean {
  return (
    finite(p.lat, p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  );
}

/** The bearing the printed face looks toward, or null for a flat code.
 *  The face's normal is the code's local +Z (`qr-gps-vote.ts`); for a
 *  heading-only level that is `headingDeg + 90`. */
export function facingBearingDeg(geo: QrGeoPose): number | null {
  const rotation =
    geo.rotation ??
    (geo.headingDeg === undefined ? null : rotationFromHeading(geo.headingDeg));
  if (rotation === null || !finite(...rotation)) return null;
  const [north, , east] = rotateVectorByQuaternion(rotation, [0, 0, 1]);
  if (Math.hypot(north, east) < Math.sin(FLAT_CODE_DEG * RAD)) return null;
  const deg = Math.atan2(east, north) / RAD;
  return (deg + 360) % 360;
}

/** `from` moved `metres` along `bearingDeg`. */
function along(from: MapPoint, bearingDeg: number, metres: number): MapPoint {
  const ll = calcGpsCoords({ lat: from.lat, lon: from.lng }, [
    metres * Math.cos(bearingDeg * RAD),
    0,
    metres * Math.sin(bearingDeg * RAD),
  ]);
  return { lat: ll.lat, lng: ll.lon };
}

/** North/East metres of `p` from `zero`. */
function northEast(zero: LatLong, p: MapPoint): [number, number] {
  const nue = calcRelativeCoordsInMeters(
    zero,
    { lat: p.lat, lon: p.lng },
    0,
    0,
  );
  return [nue[0], nue[2]];
}

function mark(geo: QrGeoPose, lineM: number): CodeMark | null {
  const point = { lat: geo.lat, lng: geo.lon };
  if (!readablePoint(point)) return null;
  const facingDeg = facingBearingDeg(geo);
  return {
    ...point,
    facingDeg,
    facingLine:
      facingDeg === null ? null : [point, along(point, facingDeg, lineM)],
  };
}

/** The smallest turn between two bearings (degrees). */
function turnDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** A code's name in labels: "The code" alone, else "Code N" by the
 *  numbering (`creator-codes.ts` `numbering`). */
export function codeLabel(index: number, count: number): string {
  return count === 1 ? "The code" : `Code ${String(index + 1)}`;
}

const metres = (v: number): string => `${v.toFixed(1)} m`;
const degrees = (v: number): string => `${v.toFixed(0)} degrees`;

function visitsLabel(n: NonNullable<CodeVerdict["numbers"]>): string {
  const visits = `${String(n.visitCount)} ${n.visitCount === 1 ? "visit" : "visits"}`;
  return n.positionVisitCount < n.visitCount
    ? `${visits} (the best ${String(n.positionVisitCount)} for the position)`
    : visits;
}

/** What visitors get: the stored pose's grade and why. */
function storedLines(stored: CodeVerdict): string[] {
  const lines = [`What visitors get: ${stored.text}.`];
  const n = stored.numbers;
  if (stored.kind === "unknown") {
    lines.push(
      "The saved position was measured before the visits this device kept, so its error is not known here.",
    );
  } else if (stored.kind === "not-saved") {
    lines.push(
      "The tour stores no position for this code, so visitors do not get it placed.",
    );
  } else if (n !== null) {
    lines.push(
      `The saved position came from 1 visit: expected within ${metres(n.predictedHorizontalM)} and ${degrees(n.predictedHeadingDeg)} (GPS ${metres(n.bestAccuracyM)}, walk ${metres(n.longestWalkM)}).`,
    );
    if (stored.kind !== "good") {
      lines.push(
        "Visitors keep this position until a better one replaces it: see the code in AR, then walk farther - the position improves on its own once the walk is long enough for the GPS accuracy.",
      );
    }
  }
  return lines;
}

/** What the visits now suggest: the combined estimate's grade and why. */
function estimateLines(
  estimate: CodeVerdict | null,
  combined: SummaryCode["combined"],
): string[] {
  const n = estimate?.numbers ?? null;
  if (estimate === null || n === null) {
    return [
      "What your visits now suggest: nothing yet - no AR visit on this device measured this code.",
    ];
  }
  const lines = [
    `What your visits now suggest: ${estimate.text}.`,
    `${visitsLabel(n)}: expected within ${metres(n.predictedHorizontalM)} and ${degrees(n.predictedHeadingDeg)}.`,
    `Best GPS ${metres(n.bestAccuracyM)}, longest walk ${metres(n.longestWalkM)}.`,
  ];
  if (n.visitCount > 1) {
    lines.push(
      `The visits disagree by up to ${metres(n.maxOffsetM)} and ${degrees(n.maxHeadingOffsetDeg)}.`,
    );
  }
  if (estimate.walkM !== null) {
    lines.push(
      `Walk about ${estimate.walkM.toFixed(0)} m away from the code and back in one visit.`,
    );
  }
  if (combined?.offsetM != null) {
    lines.push(
      `The visits' estimate is ${metres(combined.offsetM)}${combined.offsetDeg === null ? "" : ` and ${degrees(combined.offsetDeg)}`} from the saved position; the saved position stays.`,
    );
  }
  return lines;
}

function detailLines(
  stored: CodeVerdict,
  estimate: CodeVerdict | null,
  combined: SummaryCode["combined"],
): string[] {
  return [
    ...storedLines(stored),
    ...estimateLines(estimate, combined),
    "These limits are provisional (tested on simulated walks only).",
  ];
}

/** The drawn area's diagonal (m) over `points`. */
function diagonalM(points: readonly MapPoint[]): number {
  const first = points[0];
  if (first === undefined) return 0;
  const zero = { lat: first.lat, lon: first.lng };
  let minN = 0;
  let maxN = 0;
  let minE = 0;
  let maxE = 0;
  for (const p of points) {
    const [n, e] = northEast(zero, p);
    minN = Math.min(minN, n);
    maxN = Math.max(maxN, n);
    minE = Math.min(minE, e);
    maxE = Math.max(maxE, e);
  }
  return Math.hypot(maxN - minN, maxE - minE);
}

function summaryObject(object: TourObject): SummaryObject | null {
  const point = { lat: object.geo.lat, lng: object.geo.lon };
  if (!readablePoint(point)) return null;
  const label =
    object.kind === "pin"
      ? object.label
      : object.label !== undefined && object.label.trim().length > 0
        ? object.label
        : "Photo";
  return { id: object.id, kind: object.kind, label, ...point };
}

/** The levels to show, the references first, then any level only the
 *  visits know, each once. */
function levelIds(input: SummaryInput): string[] {
  const ids: string[] = [];
  for (const r of input.references) {
    if (!ids.includes(r.levelId)) ids.push(r.levelId);
  }
  for (const visit of input.visits) {
    for (const code of visit.codes) {
      if (!ids.includes(code.levelId)) ids.push(code.levelId);
    }
  }
  return ids;
}

/** Build the summary. Unreadable coordinates are left out, never drawn. */
export function buildSummaryModel(input: SummaryInput): SummaryModel {
  const tracks = input.visits.map((v) => ({
    visitId: v.visitId,
    gps: v.gps.filter(readablePoint),
    fused: v.fused.filter(readablePoint),
  }));
  const objects = input.objects.flatMap((o) => {
    const s = summaryObject(o);
    return s === null ? [] : [s];
  });
  const ids = levelIds(input);
  const references = new Map(
    input.references.map((r) => [r.levelId, r.geo] as const),
  );
  // What the codes are drawn over, for the facing line's length.
  const base: MapPoint[] = [
    ...tracks.flatMap((t) => [...t.gps, ...t.fused]),
    ...objects,
    ...ids.flatMap((id) => {
      const geo = references.get(id);
      return geo == null ? [] : [{ lat: geo.lat, lng: geo.lon }];
    }),
  ].filter(readablePoint);
  const lineM = Math.min(
    FACING_LINE_MAX_M,
    Math.max(FACING_LINE_MIN_M, FACING_LINE_SHARE * diagonalM(base)),
  );

  const codes = ids.map((levelId, index): SummaryCode => {
    const poses = codeVisitPoses(input.visits, levelId);
    const estimate = combineCodeVisits(poses);
    const estimateVerdict =
      estimate === null ? null : codeVerdict(poses, estimate);
    const { reference, verdict } = storedSide(
      input.visits,
      levelId,
      references.get(levelId) ?? null,
      lineM,
    );
    const combined = combinedMark(estimate, reference, lineM);
    return {
      levelId,
      label: codeLabel(index, ids.length),
      reference,
      combined,
      verdict,
      estimateVerdict,
      details: detailLines(verdict, estimateVerdict, combined),
    };
  });

  const fitPoints: MapPoint[] = [...base];
  const ring = (c: MapPoint, r: number): MapPoint[] =>
    [0, 90, 180, 270].map((bearing) => along(c, bearing, r));
  for (const code of codes) {
    for (const m of [code.reference, code.combined]) {
      if (m === null) continue;
      fitPoints.push(m, ...(m.facingLine ?? []));
      if (m.ringM !== null) fitPoints.push(...ring(m, m.ringM));
    }
  }
  return {
    tracks,
    codes,
    objects,
    fitPoints: fitPoints.filter(readablePoint),
  };
}

/** How far (m) and how much of a turn (degrees) `m` lies from the
 *  reference; null parts where either has none. */
function offsetFrom(
  reference: CodeMark | null,
  m: CodeMark,
): { offsetM: number | null; offsetDeg: number | null } {
  if (reference === null) return { offsetM: null, offsetDeg: null };
  const [n, e] = northEast({ lat: reference.lat, lon: reference.lng }, m);
  return {
    offsetM: Math.hypot(n, e),
    offsetDeg:
      reference.facingDeg === null || m.facingDeg === null
        ? null
        : turnDeg(reference.facingDeg, m.facingDeg),
  };
}

/** The stored pose's mark, its own ring and its verdict - what visitors
 *  get: "not-saved" without a readable stored pose, "unknown" when no kept
 *  visit saved it. */
function storedSide(
  visits: readonly VisitLogEntry[],
  levelId: string,
  refGeo: QrGeoPose | null,
  lineM: number,
): { reference: SummaryCode["reference"]; verdict: CodeVerdict } {
  const refMark = refGeo === null ? null : mark(refGeo, lineM);
  if (refGeo === null || refMark === null) {
    return { reference: null, verdict: verdictWithoutNumbers("not-saved") };
  }
  const stored = storedGrade(visits, levelId, refGeo);
  return {
    reference: { ...refMark, ringM: stored?.ringM ?? null },
    verdict: stored?.verdict ?? verdictWithoutNumbers("unknown"),
  };
}

/** Whether two geo poses are the same saved pose (see SAME_POSE_DEG). */
function samePose(a: QrGeoPose, b: QrGeoPose): boolean {
  return (
    Math.abs(a.lat - b.lat) <= SAME_POSE_DEG &&
    Math.abs(a.lon - b.lon) <= SAME_POSE_DEG &&
    Math.abs(a.alt - b.alt) <= SAME_POSE_ALT_M
  );
}

/**
 * The stored pose's own grade (M3a/M3b review #2): from the LATEST visit
 * whose settle saved exactly this pose, graded as one saved pose
 * (`averaging: false`). Null when no visit this device kept saved it - a
 * hosted pose, or one replaced elsewhere since.
 */
function storedGrade(
  visits: readonly VisitLogEntry[],
  levelId: string,
  refGeo: QrGeoPose,
): { verdict: CodeVerdict; ringM: number } | null {
  for (let i = visits.length - 1; i >= 0; i -= 1) {
    const entry = visits[i]!;
    const saved = entry.codes.find(
      (c) =>
        c.levelId === levelId &&
        c.savedGeo !== undefined &&
        samePose(c.savedGeo, refGeo),
    );
    if (saved === undefined) continue;
    const source: CodeVisitPose[] = [
      {
        geo: refGeo,
        gpsAccuracyM: entry.gpsAccuracyM ?? Number.NaN,
        baselineM: entry.baselineM,
      },
    ];
    const graded: CombinedCodePose | null = combineCodeVisits(source);
    if (graded === null) return null;
    return {
      verdict: codeVerdict(source, graded, { averaging: false }),
      ringM: graded.predictedHorizontalM,
    };
  }
  return null;
}

function combinedMark(
  estimate: CombinedCodePose | null,
  reference: CodeMark | null,
  lineM: number,
): SummaryCode["combined"] {
  if (estimate === null) return null;
  const m = mark(estimate.geo, lineM);
  if (m === null) return null;
  const { offsetM, offsetDeg } = offsetFrom(reference, m);
  const shown =
    reference === null ||
    (offsetM ?? 0) > Math.max(DIFFERS_FLOOR_M, estimate.predictedHorizontalM) ||
    (offsetDeg ?? 0) >
      Math.max(DIFFERS_FLOOR_DEG, estimate.predictedHeadingDeg);
  return {
    ...m,
    ringM: estimate.predictedHorizontalM,
    shown,
    offsetM: shown ? offsetM : null,
    offsetDeg: shown ? offsetDeg : null,
  };
}
