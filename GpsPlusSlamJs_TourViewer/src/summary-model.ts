/**
 * What the summary after Finish shows (authoring plan 2026-09-28-0953 §1
 * item 5, §3.3, milestone M3b): every AR visit's walk, each code with its
 * position, facing line, uncertainty ring and verdict, and the placed pins
 * and photos. PURE: it is exactly the data the map view hands to Leaflet
 * and the list renders, so it is tested without a map.
 *
 * THE REFERENCE RULE IS NOT CHANGED HERE (D10b; re-estimating at Finish is
 * an open owner question, M3a Q4): the stored pose is the code's position.
 * The combined estimate of the visits (`combineCodeVisits`) is drawn next
 * to it, as information, only where the two differ.
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

import { combineCodeVisits } from "./code-visit-combine.js";
import { codeVerdict, type CodeVerdict } from "./code-verdict.js";
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
/** The combined estimate is drawn beside the stored pose only when it is
 *  further away than this (m)... Below it the two marks overlap at the
 *  framed zoom (0.4-1.2 m per pixel). */
export const DIFFERS_M = 0.5;
/** ...or turned further than this (degrees). */
const DIFFERS_DEG = 2;

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
  readonly reference: CodeMark | null;
  /** The visits' combined estimate; null when no visit measured it. */
  readonly combined:
    | (CodeMark & {
        /** The predicted horizontal error: the ring's radius (m). */
        readonly ringM: number;
        /** Drawn as a second mark (it differs from the reference, or there
         *  is no reference). */
        readonly shown: boolean;
        /** Its distance (m) and turn (degrees) from the reference; null
         *  without a reference. */
        readonly offsetM: number | null;
        readonly offsetDeg: number | null;
      })
    | null;
  readonly verdict: CodeVerdict;
  /** The numbers behind the verdict, one plain line each. */
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
  /** The codes' stored poses, the level in hand first, then the tour's
   *  other levels (a null geo: a level without a pose). */
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

function codeLabel(index: number, count: number): string {
  return count === 1 ? "The code" : `Code ${String(index + 1)}`;
}

const metres = (v: number): string => `${v.toFixed(1)} m`;
const degrees = (v: number): string => `${v.toFixed(0)} degrees`;

function detailLines(
  verdict: CodeVerdict,
  combined: SummaryCode["combined"],
): string[] {
  const n = verdict.numbers;
  if (n === null) {
    return ["No AR visit on this device measured this code yet."];
  }
  const lines = [
    `${String(n.visitCount)} ${n.visitCount === 1 ? "visit" : "visits"}: expected within ${metres(n.predictedHorizontalM)} and ${degrees(n.predictedHeadingDeg)}.`,
    `Best GPS ${metres(n.bestAccuracyM)}, longest walk ${metres(n.longestWalkM)}.`,
  ];
  if (n.visitCount > 1) {
    lines.push(
      `The visits disagree by up to ${metres(n.maxOffsetM)} and ${degrees(n.maxHeadingOffsetDeg)}.`,
    );
  }
  if (verdict.walkM !== null) {
    lines.push(
      `Walk about ${verdict.walkM.toFixed(0)} m away from the code and back in one visit.`,
    );
  }
  if (combined?.offsetM != null) {
    lines.push(
      `The visits' estimate is ${metres(combined.offsetM)}${combined.offsetDeg === null ? "" : ` and ${degrees(combined.offsetDeg)}`} from the saved position; the saved position stays.`,
    );
  }
  lines.push("These limits are provisional (tested on simulated walks only).");
  return lines;
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
    const verdict = codeVerdict(poses, estimate);
    const refGeo = references.get(levelId) ?? null;
    const reference = refGeo === null ? null : mark(refGeo, lineM);
    const combined = combinedMark(estimate, reference, lineM);
    return {
      levelId,
      label: codeLabel(index, ids.length),
      reference,
      combined,
      verdict,
      details: detailLines(verdict, combined),
    };
  });

  const fitPoints: MapPoint[] = [...base];
  for (const code of codes) {
    for (const m of [code.reference, code.combined]) {
      if (m === null) continue;
      fitPoints.push(m, ...(m.facingLine ?? []));
    }
    if (code.combined !== null) {
      const c = code.combined;
      fitPoints.push(along(c, 0, c.ringM), along(c, 90, c.ringM));
      fitPoints.push(along(c, 180, c.ringM), along(c, 270, c.ringM));
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

function combinedMark(
  estimate: ReturnType<typeof combineCodeVisits>,
  reference: CodeMark | null,
  lineM: number,
): SummaryCode["combined"] {
  if (estimate === null) return null;
  const m = mark(estimate.geo, lineM);
  if (m === null) return null;
  const { offsetM, offsetDeg } = offsetFrom(reference, m);
  const shown =
    reference === null ||
    (offsetM ?? 0) > DIFFERS_M ||
    (offsetDeg ?? 0) > DIFFERS_DEG;
  return {
    ...m,
    ringM: estimate.predictedHorizontalM,
    shown,
    offsetM: shown ? offsetM : null,
    offsetDeg: shown ? offsetDeg : null,
  };
}
