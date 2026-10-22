/**
 * The visitor's radar, as data (visitor walk W4 build plan 2026-10-21-1105,
 * M3, §1.2, §1.3): heading-up and centred on the visitor, a square-root
 * distance scale out to the range, the scale rings, north, the view cone,
 * a blip per station in the list's glyph language, the arc on the rim for
 * a focus outside the view, and the visitor's own mark by precision -
 * "shown, not told". Pure: `walk-radar.ts` draws it on a canvas.
 *
 * It reads two geometries and decides which: the live one (this tick's
 * bearings, distances and camera heading) while a position is trusted,
 * the last judged snapshot while it is not (`'none'`, tracking lost), so
 * a frozen radar never reads the live position. The stations' states are
 * always the live ones: a skip made in the list shows at once.
 *
 * @see walk-radar-model.ts.md
 */

import type { TourOrder } from "gps-plus-slam-app-framework/ar/tour-stations";
import { bearingDeltaDeg } from "gps-plus-slam-app-framework/utils/bearing-degrees";
import { formatDistance } from "gps-plus-slam-app-framework/utils/format-distance";

import type { WalkChipKind } from "./visitor-guide-slice.js";
import type { WalkRowState } from "./walk-sheet-model.js";

/**
 * W4's fixed range, m (square-root scale): the range before any station
 * distance is known. The radar ships the ADAPTIVE range
 * (`walkRadarAdaptiveRangeM`), which the overlap sweep
 * (`walk-radar-model.sweep.test.ts`) ranked above 150, 300 and 600 m;
 * the sidecar has the verdict.
 */
export const WALK_RADAR_RANGE_M = 300;

/** W4's camera before the XR camera's projection is known: its VERTICAL
 *  field of view (three.js `fov`), 64° on a screen taller than wide and
 *  44° otherwise; the cone is the horizontal one at the screen's aspect. */
const WALK_RADAR_FALLBACK_VFOV_DEG = { portrait: 64, landscape: 44 };

/** The blips' radii, px (W4): the focus, the others, a "later" one. */
const WALK_BLIP_PX = { focus: 8.5, other: 6.5, later: 3.5 };

/** The GPS blur's smallest radius, px (W4). */
const BLUR_MIN_PX = 7;
/** A station beyond the range sits on the rim less this, px (W4). */
const RIM_INSET_PX = 8;
/** A distance ring without a heading is at least this wide, px (W4). */
const DISTANCE_RING_MIN_PX = 6;
/** The radar's rim is this far inside its box, px (W4). */
const RIM_MARGIN_PX = 4;

/** One geometry: every station's bearing (degrees from north) and
 *  horizontal distance (m) from the visitor, and the camera's heading
 *  (degrees from north; null without a heading). */
export interface WalkRadarGeometry {
  readonly bearings: ReadonlyMap<string, number>;
  readonly distances: ReadonlyMap<string, number>;
  readonly headingDeg: number | null;
}

export interface WalkRadarStation {
  readonly id: string;
  /** Its 1-based place in the tour. */
  readonly number: number;
  /** The list's look for it (`walk-sheet-model.ts`). */
  readonly state: WalkRowState;
}

export interface WalkRadarInput {
  readonly stations: readonly WalkRadarStation[];
  readonly order: TourOrder;
  readonly kind: WalkChipKind;
  /** The position's accuracy, m (GPS and too weak); null otherwise. */
  readonly accuracyM: number | null;
  /** This tick's geometry; null without a measurement. */
  readonly live: WalkRadarGeometry | null;
  /** The last judged geometry, read only while the radar is frozen. */
  readonly snapshot: WalkRadarGeometry | null;
  /** The camera's horizontal field of view (`walkRadarFovDeg`). */
  readonly fovDeg: number;
  readonly sizePx: number;
  /** Default `WALK_RADAR_RANGE_M`. */
  readonly rangeM?: number;
}

type WalkBlipLook = "focus" | "left" | "found" | "skipped" | "later";

export interface WalkRadarBlip {
  readonly id: string;
  readonly number: number;
  readonly look: WalkBlipLook;
  /** Its centre in the radar's CSS px, and its radius. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly alpha: number;
  /** Beyond the range: held on the rim. */
  readonly clamped: boolean;
}

type WalkRadarVisitor =
  | { readonly kind: "pin" }
  | {
      readonly kind: "blur";
      readonly tone: "gps" | "weak";
      readonly r: number;
    }
  | { readonly kind: "unknown" }
  | { readonly kind: "pending" };

export interface WalkRadarModel {
  /** `live`, `frozen` (grey, the snapshot's geometry) or `pending`. */
  readonly mode: "live" | "frozen" | "pending";
  /** The range drawn, m (the rings and the scale). */
  readonly rangeM: number;
  readonly centre: number;
  readonly rimR: number;
  readonly rings: readonly {
    readonly r: number;
    readonly label: string | null;
  }[];
  /** North's angle on the canvas, radians clockwise from up; null
   *  without a heading. */
  readonly north: number | null;
  /** The view cone's half width, radians, centred on up; null without a
   *  heading and while frozen. */
  readonly cone: number | null;
  readonly visitor: WalkRadarVisitor;
  readonly blips: readonly WalkRadarBlip[];
  /** Without a heading: how far each station still to find is, not which
   *  way. */
  readonly distanceRings: readonly {
    readonly id: string;
    readonly r: number;
    readonly focus: boolean;
  }[];
  /** The focus outside the view: its angle on the rim, radians clockwise
   *  from up; null otherwise. */
  readonly rimArc: number | null;
}

/** Whole metres, as the line writes them. */
function metres(m: number): string {
  return formatDistance(m, { metreDecimals: 0 });
}

/** The chip's words (§1.3, W4). A missing accuracy is left out, never
 *  invented. */
export function walkPrecisionChip(
  kind: WalkChipKind,
  accuracyM: number | null,
): string {
  const about =
    accuracyM !== null && Number.isFinite(accuracyM) && accuracyM >= 0
      ? `about ${metres(accuracyM)}`
      : null;
  switch (kind) {
    case "code":
      // The code's internal 1 m is never shown (precision plan P-D2).
      return "Placed by a code";
    case "gps":
      return about === null ? "GPS" : `GPS - ${about}`;
    case "weak":
      return about === null ? "GPS - too weak" : `GPS - ${about}, too weak`;
    case "none":
      return "Position unknown";
    case "pending":
      return "Finding your position…";
    case "lost":
      return "Paused - tracking lost";
  }
}

/**
 * The camera's horizontal field of view, degrees: `2 atan(1 / P[0])` of
 * the XR view camera's projection matrix (three.js `elements[0]`); before
 * there is one, or for a value that is no camera's, W4's camera
 * (`WALK_RADAR_FALLBACK_VFOV_DEG`) at the screen's `aspect` (width over
 * height; one that is no positive finite number reads as square).
 */
export function walkRadarFovDeg(
  projection0: number | null | undefined,
  aspect: number,
): number {
  if (
    typeof projection0 === "number" &&
    Number.isFinite(projection0) &&
    projection0 > 0
  ) {
    return (2 * Math.atan(1 / projection0) * 180) / Math.PI;
  }
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const vDeg =
    a < 1
      ? WALK_RADAR_FALLBACK_VFOV_DEG.portrait
      : WALK_RADAR_FALLBACK_VFOV_DEG.landscape;
  return (2 * Math.atan(Math.tan((vDeg * Math.PI) / 360) * a) * 180) / Math.PI;
}

/** The largest of 1, 2, 2.5, 5 times a power of ten not above `x`. */
function roundDown(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const f of [5, 2.5, 2, 1]) {
    if (f * p <= x * (1 + 1e-9)) return f * p;
  }
  return p;
}

/**
 * The scale rings: round distances near a twelfth and a third of the
 * range (W4's 25 m and 100 m at 300 m), the outer one labelled.
 */
export function walkRadarRings(
  rangeM: number,
): { m: number; label: string | null }[] {
  const inner = roundDown(rangeM / 12);
  const outer = roundDown(rangeM / 3);
  return [
    { m: inner, label: null },
    { m: outer, label: metres(outer) },
  ];
}

/**
 * The adaptive range's rule (plan §5), shipped by the overlap sweep
 * (`walk-radar-model.sweep.test.ts`; the sidecar has the verdict): the
 * distance to the k-th nearest station still to find, times `factor`,
 * rounded UP to a step of 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a
 * power of ten (so the scale rings stay round), clamped to 10-600 m. It
 * grows at once (a station would otherwise sit on the rim) and shrinks
 * only once the raw range is below `shrinkBelow` of the shown one, so
 * GPS jitter at a step's edge does not make the scale breathe.
 */
export interface WalkRadarAdaptiveRule {
  readonly k: number;
  readonly factor: number;
  readonly minM: number;
  readonly maxM: number;
  readonly shrinkBelow: number;
}

/** k 2, factor 1.2, floor 10 m: the sweep's plateau of least overlap
 *  (k 2-3, factor 1.1-1.35, floor 5-15 m; the sidecar has the table). */
const WALK_RADAR_ADAPTIVE: WalkRadarAdaptiveRule = {
  k: 2,
  factor: 1.2,
  minM: 10,
  maxM: 600,
  shrinkBelow: 0.65,
};

const RANGE_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

/** The smallest step at least `x`. */
function stepUp(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const f of RANGE_STEPS) {
    if (f * p >= x * (1 - 1e-9)) return f * p;
  }
  return 10 * p;
}

/**
 * The radar's range now, m, from the distances of the stations still to
 * find and the range shown last (null at the start). With none to find
 * (or no finite distance) the range shown last stays, else
 * `WALK_RADAR_RANGE_M`. `options` override the shipped rule (the sweep).
 */
export function walkRadarAdaptiveRangeM(
  unfoundDistancesM: readonly number[],
  previousM: number | null,
  options: Partial<WalkRadarAdaptiveRule> = {},
): number {
  const rule = { ...WALK_RADAR_ADAPTIVE, ...options };
  const sorted = unfoundDistancesM
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  const kept =
    previousM !== null && Number.isFinite(previousM) && previousM > 0
      ? previousM
      : null;
  if (sorted.length === 0) return kept ?? WALK_RADAR_RANGE_M;
  const kth =
    sorted[Math.min(Math.max(1, Math.floor(rule.k)), sorted.length) - 1]!;
  const raw = Math.min(rule.maxM, Math.max(rule.minM, kth * rule.factor));
  if (kept !== null && raw <= kept && raw >= kept * rule.shrinkBelow) {
    return kept;
  }
  return Math.min(rule.maxM, Math.max(rule.minM, stepUp(raw)));
}

const RAD = Math.PI / 180;

/** Whether the radar may name a focus (§1.9 R-2, forward-compatible):
 *  not while the guide shows no distance in an any-order tour with a
 *  choice of two or more stations, and never frozen. */
function focusShown(input: WalkRadarInput, frozen: boolean): boolean {
  if (frozen) return false;
  const noDistance =
    input.kind === "weak" ||
    input.kind === "pending" ||
    input.kind === "none" ||
    input.kind === "lost";
  const unfound = input.stations.filter(
    (s) => s.state === "next" || s.state === "left",
  ).length;
  return !(noDistance && input.order === "any" && unfound >= 2);
}

function lookOf(state: WalkRowState, focus: boolean): WalkBlipLook {
  switch (state) {
    case "next":
      return focus ? "focus" : "left";
    case "left":
      return "left";
    case "found":
    case "here":
      return "found";
    case "skipped":
      return "skipped";
    case "later":
      return "later";
  }
}

/** The radar from the stations, the precision and the two geometries. */
export function walkRadarModel(input: WalkRadarInput): WalkRadarModel {
  const rangeM = input.rangeM ?? WALK_RADAR_RANGE_M;
  if (!(Number.isFinite(input.sizePx) && input.sizePx > 2 * RIM_MARGIN_PX)) {
    throw new RangeError(
      `walk-radar-model: no radar of ${String(input.sizePx)} px`,
    );
  }
  if (!(Number.isFinite(rangeM) && rangeM > 0)) {
    throw new RangeError(`walk-radar-model: no range of ${String(rangeM)} m`);
  }
  const fovDeg =
    Number.isFinite(input.fovDeg) && input.fovDeg > 0
      ? input.fovDeg
      : walkRadarFovDeg(null, 1);
  const centre = input.sizePx / 2;
  const rimR = centre - RIM_MARGIN_PX;
  const scale = (d: number): number =>
    rimR * Math.sqrt(Math.min(Math.max(d, 0), rangeM) / rangeM);
  const rings = walkRadarRings(rangeM).map((ring) => ({
    r: scale(ring.m),
    label: ring.label,
  }));
  const frozen = input.kind === "none" || input.kind === "lost";
  // The frozen radar reads the snapshot and nothing else.
  const geo = frozen ? input.snapshot : input.live;
  const heading = geo?.headingDeg ?? null;
  const north = heading === null ? null : -heading * RAD;
  const empty = {
    rangeM,
    centre,
    rimR,
    rings,
    blips: [],
    distanceRings: [],
    rimArc: null,
  };
  if (input.kind === "pending") {
    return {
      ...empty,
      mode: "pending",
      north,
      cone: null,
      visitor: { kind: "pending" },
    };
  }
  const visitor: WalkRadarVisitor = frozen
    ? { kind: "unknown" }
    : input.kind === "code"
      ? { kind: "pin" }
      : {
          kind: "blur",
          tone: input.kind === "weak" ? "weak" : "gps",
          r: Math.max(BLUR_MIN_PX, scale(input.accuracyM ?? 0)),
        };
  const mode = frozen ? "frozen" : "live";
  if (geo === null) {
    return { ...empty, mode, north: null, cone: null, visitor };
  }
  const withFocus = focusShown(input, frozen);
  if (heading === null) {
    // How far, not which way; found and skipped stations left out.
    const distanceRings = input.stations.flatMap((s) => {
      const d = geo.distances.get(s.id);
      if (d === undefined || !Number.isFinite(d)) return [];
      if (s.state !== "next" && s.state !== "left") return [];
      return [
        {
          id: s.id,
          r: Math.max(DISTANCE_RING_MIN_PX, scale(d)),
          focus: withFocus && s.state === "next",
        },
      ];
    });
    return { ...empty, mode, north: null, cone: null, visitor, distanceRings };
  }
  const half = (fovDeg / 2) * RAD;
  const alpha = input.kind === "weak" ? 0.5 : 1;
  let rimArc: number | null = null;
  const blips: WalkRadarBlip[] = [];
  for (const s of input.stations) {
    const d = geo.distances.get(s.id);
    const bearing = geo.bearings.get(s.id);
    if (d === undefined || bearing === undefined) continue;
    if (!Number.isFinite(d) || !Number.isFinite(bearing)) continue;
    const a = bearingDeltaDeg(bearing, heading) * RAD;
    const full = scale(d);
    const r = Math.min(full, rimR - RIM_INSET_PX);
    const look = lookOf(s.state, withFocus);
    blips.push({
      id: s.id,
      number: s.number,
      look,
      x: centre + Math.sin(a) * r,
      y: centre - Math.cos(a) * r,
      r:
        look === "focus"
          ? WALK_BLIP_PX.focus
          : look === "later"
            ? WALK_BLIP_PX.later
            : WALK_BLIP_PX.other,
      alpha,
      clamped: full > r,
    });
    if (look === "focus" && Math.abs(a) > half) rimArc = a;
  }
  return {
    ...empty,
    mode,
    north,
    // Heading-up: a cone drawn frozen would claim a live view of nothing.
    cone: frozen ? null : half,
    visitor,
    blips,
    rimArc,
  };
}
