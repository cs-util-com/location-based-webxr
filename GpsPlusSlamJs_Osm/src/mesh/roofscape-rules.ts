/**
 * The invented roofscape's decisions, all pure: which untagged building gets
 * an invented roof, which is refused one by its class, its size or its
 * neighbourhood, how high each stands, which of its walls stand against a
 * neighbour's, and which wing ends take a gable. No geometry beyond rings and
 * no three.js; `invented-roofs.ts` turns these answers into roofs.
 *
 * TAGS ALWAYS WIN. Every rule here applies only to a building the map says
 * nothing about; any roof, height-of-roof, floating or part tag keeps the
 * library's own building exactly as before (`keepReason`).
 *
 * NEVER A PLACE NAME. A flat-roofed district is recognised from the tags
 * around a building (`neighbourhoodPriors`), so the rule is the same in a town
 * nobody has looked at.
 *
 * STABLE. Every invented value is a pure function of the feature key
 * (`mixedUnit`), so a reload, a second phone and a moved window draw the same
 * house the same way.
 *
 * @see roofscape-rules.ts.md
 */

import type { OsmTags } from "../model/osm-feature.js";
import {
  DEFAULT_LEVEL_HEIGHT_M,
  parseLengthMetres,
} from "./building-heights.js";
import type { EnuPoint } from "./enu.js";
import { mixedUnit } from "./stable-jitter.js";

/** The parameters of the invented roofscape, each named where it is used. */
export interface RoofscapeParams {
  /** A building whose tags state a height above this keeps its flat top. */
  readonly heightLimitM: number;
  /** Corners nearer than this to the line past them are dropped. */
  readonly simplifyToleranceM: number;
  /** Share of the houses with gable ends; the rest are hipped. */
  readonly gableShare: number;
  /** A gable end's wall length, shortest and longest. */
  readonly gableMinM: number;
  readonly gableMaxM: number;
  /** The slope as rise over run: about 32 to 42 degrees. */
  readonly tanMin: number;
  readonly tanMax: number;
  /** A wide house flattens to this slope first, about 20 degrees. */
  readonly tanFloor: number;
  /** The slope of a church or chapel, about 50 degrees. */
  readonly sacredTan: number;
  /** A roof never rises more than this; past it the top is flat. */
  readonly maxRiseM: number;
  /** Two walls closer than this count as one shared wall. */
  readonly sharedGapM: number;
  /** Share of a wall another building's wall must cover to be shared. */
  readonly sharedMinShare: number;
  /** How far a slope reaches past its wall. */
  readonly overhangM: number;
  /** How far around a building its neighbourhood reaches, centre to centre. */
  readonly priorRadiusM: number;
  /** Tagged roofs, or outlines, a neighbourhood needs before it counts. */
  readonly priorMinEvidence: number;
  /** Share of the tagged roofs nearby that must be flat to invent none. */
  readonly flatShareMin: number;
  /** Three storeys: a stated height from here up counts as tall. */
  readonly tallM: number;
  /** Share of the outlines nearby that must be tall, with no roof tags. */
  readonly tallShareMin: number;
  /** A footprint larger than this is a hall, a block or a mall: no roof. */
  readonly largeFootprintM2: number;
}

/**
 * The defaults the owner chose the prototype with. The large-footprint net
 * sits above 2 369 m2, where it began to flatten Meggen's village centre.
 */
export const ROOFSCAPE_DEFAULTS: RoofscapeParams = Object.freeze({
  heightLimitM: 14,
  simplifyToleranceM: 0.05,
  gableShare: 0.72,
  gableMinM: 3,
  gableMaxM: 16,
  tanMin: 0.62,
  tanMax: 0.9,
  tanFloor: 0.36,
  sacredTan: 1.2,
  maxRiseM: 5.5,
  sharedGapM: 0.4,
  sharedMinShare: 0.5,
  overhangM: 0.32,
  priorRadiusM: 200,
  priorMinEvidence: 5,
  flatShareMin: 0.5,
  tallM: 9,
  tallShareMin: 0.5,
  largeFootprintM2: 2500,
});

/** Classes that never take a pitched roof: they keep the library's box. */
const NEVER_PITCHED = new Set([
  "roof",
  "parking",
  "garages",
  "carport",
  "kiosk",
  "ruins",
  "construction",
  "grandstand",
  "stadium",
  "greenhouse",
  "bunker",
  "container",
  "tent",
  "service",
]);
const SMALL = new Set(["garage", "shed", "hut", "cabin"]);
const LARGE = new Set([
  "apartments",
  "residential",
  "dormitory",
  "hotel",
  "office",
  "university",
  "school",
]);
const SACRED = new Set(["church", "chapel"]);
/** Classes that are flat-roofed nearly everywhere: no invented roof. */
const FLAT_CLASSES = new Set([
  "commercial",
  "retail",
  "industrial",
  "warehouse",
  "supermarket",
]);

/** Why a building keeps the library's own volume. */
export type KeepReason =
  | "part"
  | "below surface"
  | "parts"
  | "tagged roof"
  | "floating"
  | "no roof by class"
  | "tall";

/** What the data around a building says about roofs. */
export interface NeighbourhoodPrior {
  /** False where the neighbourhood reads as flat-roofed. */
  readonly pitched: boolean;
  /** "pitched roofs nearby", "flat roofs nearby", "tall neighbourhood" or "no evidence". */
  readonly why: string;
  /** The stated heights of the outlines nearby, ascending. */
  readonly heights: readonly number[];
}

/** One building or part as the prior sees it. */
export interface PriorEntry {
  readonly key: string;
  readonly tags: OsmTags;
  /** The footprint's centre. */
  readonly at: EnuPoint;
  /** For a part: the outline it stands in, which votes for it. */
  readonly outlineKey?: string;
}

/** A wall of some building, for `sharedWalls`. */
export interface OwnedSegment {
  readonly a: EnuPoint;
  readonly b: EnuPoint;
  readonly owner: string;
}

const isPart = (tags: OsmTags): boolean => {
  const part = tags["building:part"];
  return part !== undefined && part !== "no";
};

/** The height a tag states, without a roof; undefined when none does. */
function taggedHeightM(tags: OsmTags): number | undefined {
  const height = parseLengthMetres(tags["height"]);
  if (height !== undefined && height > 0) return height;
  const levels = Number(tags["building:levels"]);
  return Number.isFinite(levels) && levels > 0
    ? levels * DEFAULT_LEVEL_HEIGHT_M
    : undefined;
}

/**
 * Why a building stays exactly as the library builds it, or undefined when it
 * gets an invented roof. `hasParts`: an outline with `building:part` volumes
 * inside it, which replace it.
 */
export function keepReason(
  tags: OsmTags,
  context: {
    readonly hasParts: boolean;
    readonly belowSurface: boolean;
    readonly heightLimitM: number;
  },
): KeepReason | undefined {
  if (isPart(tags)) return "part";
  if (context.belowSurface) return "below surface";
  if (context.hasParts) return "parts";
  if (tags["roof:shape"] !== undefined) return "tagged roof";
  if (tags["roof:height"] !== undefined || tags["roof:levels"] !== undefined) {
    return "tagged roof";
  }
  if ((parseLengthMetres(tags["min_height"]) ?? 0) > 0) return "floating";
  if (Number(tags["building:min_level"]) > 0) return "floating";
  if (NEVER_PITCHED.has(tags["building"] ?? "")) return "no roof by class";
  const height = taggedHeightM(tags);
  return height !== undefined && height > context.heightLimitM
    ? "tall"
    : undefined;
}

const between = (key: string, salt: string, low: number, high: number) =>
  low + mixedUnit(key, `roofscape-${salt}`) * (high - low);

/** True for the classes whose invented roof is steep and always granted. */
export function isSacred(tags: OsmTags): boolean {
  return SACRED.has(tags["building"] ?? "");
}

/**
 * An invented building's wall height: the tag's if there is one, else seeded
 * by class and size (a shed 2.5-3.1 m, a small house 3-3.8 m, a house 5-6.2
 * m, a church 6.5-8.5 m, apartments or over 450 m2 8-10.5 m).
 */
export function inventedEaveHeightM(
  tags: OsmTags,
  areaM2: number,
  key: string,
): number {
  const tagged = taggedHeightM(tags);
  if (tagged !== undefined) return tagged;
  const building = tags["building"] ?? "";
  if (SMALL.has(building) || areaM2 < 35) return between(key, "eave", 2.5, 3.1);
  if (SACRED.has(building)) return between(key, "eave", 6.5, 8.5);
  if (LARGE.has(building) || areaM2 > 450) {
    return between(key, "eave", 8, 10.5);
  }
  if (areaM2 < 70) return between(key, "eave", 3, 3.8);
  return between(key, "eave", 5, 6.2);
}

/** The value at share `q` of an ascending list, interpolated. */
function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  const a = sorted[low] ?? 0;
  const b = sorted[high] ?? a;
  return a + (b - a) * (at - low);
}

/**
 * A refused building's height: the tag's; else, in a flat-roofed
 * neighbourhood that states enough heights, a seeded value between its
 * neighbours' quartiles (an untagged block among 20-30 m blocks must not get a
 * house's height); else the invented eave.
 */
export function refusedHeightM(
  tags: OsmTags,
  areaM2: number,
  key: string,
  prior: NeighbourhoodPrior | undefined,
  params: RoofscapeParams,
): number {
  const tagged = taggedHeightM(tags);
  if (tagged !== undefined) return tagged;
  if (
    prior !== undefined &&
    !prior.pitched &&
    prior.heights.length >= params.priorMinEvidence
  ) {
    return between(
      key,
      "eave",
      quantile(prior.heights, 0.25),
      quantile(prior.heights, 0.75),
    );
  }
  return inventedEaveHeightM(tags, areaM2, key);
}

/**
 * Why a building that could take an invented roof gets a flat lid instead,
 * or undefined when it gets the roof. A church or chapel keeps its roof in any
 * neighbourhood and at any size.
 */
export function inventedRoofRefusal(
  tags: OsmTags,
  areaM2: number,
  prior: NeighbourhoodPrior | undefined,
  params: RoofscapeParams,
): string | undefined {
  if (isSacred(tags)) return undefined;
  if (FLAT_CLASSES.has(tags["building"] ?? "")) return "flat by class";
  if (areaM2 > params.largeFootprintM2) return "large footprint";
  if (prior !== undefined && !prior.pitched) return prior.why;
  return undefined;
}

interface PriorPoint {
  readonly key: string;
  readonly at: EnuPoint;
  roof: string | undefined;
  readonly outline: boolean;
  readonly height: number | undefined;
}

/**
 * One building, one roof vote: the tagged parts of an outline that has no
 * roof tag of its own vote through it, flat when at least half are flat, and
 * then stop voting. Without this one church's four tagged parts would decide a
 * whole neighbourhood. A part with no outline keeps its own vote.
 */
function collapsePartVotes(
  points: readonly PriorPoint[],
  entries: readonly PriorEntry[],
): void {
  const byKey = new Map(points.map((p) => [p.key, p]));
  const tally = new Map<PriorPoint, { flat: number; other: number }>();
  entries.forEach((entry, i) => {
    const part = points[i];
    if (part === undefined || part.roof === undefined) return;
    if (!isPart(entry.tags) || entry.outlineKey === undefined) return;
    const owner = byKey.get(entry.outlineKey);
    if (owner === undefined || !owner.outline) return;
    const counts = tally.get(owner) ?? { flat: 0, other: 0 };
    if (part.roof === "flat") counts.flat += 1;
    else counts.other += 1;
    tally.set(owner, counts);
    part.roof = undefined;
  });
  for (const [owner, { flat, other }] of tally) {
    owner.roof ??= flat >= other ? "flat" : "pitched";
  }
}

/**
 * What the data around each building says about roofs, from tags alone: a map
 * from key to its prior. Tagged roof shapes nearby (one vote per building)
 * decide first: mostly flat means no invented roof. Where too few roofs are
 * tagged, a neighbourhood whose outlines mostly state a height of three
 * storeys or more reads as flat-roofed too. Otherwise nothing is known and
 * roofs are invented. The neighbourhood is every centre within
 * `priorRadiusM`, found through a grid of that cell size, so the cost grows
 * with the density, not with the square of the count. The answer does not
 * depend on the order of `entries`.
 */
export function neighbourhoodPriors(
  entries: readonly PriorEntry[],
  params: RoofscapeParams,
): Map<string, NeighbourhoodPrior> {
  const points: PriorPoint[] = entries.map((entry) => {
    const part = isPart(entry.tags);
    return {
      key: entry.key,
      at: entry.at,
      roof: entry.tags["roof:shape"],
      outline: entry.tags["building"] !== undefined && !part,
      height: part ? undefined : taggedHeightM(entry.tags),
    };
  });
  collapsePartVotes(points, entries);

  const radius = params.priorRadiusM;
  const cellOf = (v: number) => Math.floor(v / radius);
  const grid = new Map<string, PriorPoint[]>();
  for (const p of points) {
    if (!Number.isFinite(p.at.x) || !Number.isFinite(p.at.y)) continue;
    const cell = `${cellOf(p.at.x)},${cellOf(p.at.y)}`;
    const list = grid.get(cell);
    if (list === undefined) grid.set(cell, [p]);
    else list.push(p);
  }

  const priors = new Map<string, NeighbourhoodPrior>();
  for (const self of points) {
    let roofs = 0;
    let flat = 0;
    let outlines = 0;
    let tall = 0;
    const heights: number[] = [];
    const cx = cellOf(self.at.x);
    const cy = cellOf(self.at.y);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const other of grid.get(`${gx},${gy}`) ?? []) {
          const dx = other.at.x - self.at.x;
          const dy = other.at.y - self.at.y;
          if (dx * dx + dy * dy > radius * radius) continue;
          if (other.roof !== undefined) {
            roofs += 1;
            if (other.roof === "flat") flat += 1;
          }
          if (!other.outline) continue;
          outlines += 1;
          if (other.height !== undefined) {
            heights.push(other.height);
            if (other.height >= params.tallM) tall += 1;
          }
        }
      }
    }
    heights.sort((a, b) => a - b);
    let pitched = true;
    let why = "no evidence";
    if (roofs >= params.priorMinEvidence) {
      pitched = flat / roofs < params.flatShareMin;
      why = pitched ? "pitched roofs nearby" : "flat roofs nearby";
    } else if (
      outlines >= params.priorMinEvidence &&
      tall / outlines >= params.tallShareMin
    ) {
      pitched = false;
      why = "tall neighbourhood";
    }
    priors.set(self.key, { pitched, why, heights });
  }
  return priors;
}

function pointLineGap(p: EnuPoint, a: EnuPoint, b: EnuPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

/**
 * Drops, one at a time, the corner nearest the line past it while that is
 * nearer than `toleranceM`; never below a triangle.
 */
export function simplifyRing(
  ring: readonly EnuPoint[],
  toleranceM: number,
): EnuPoint[] {
  const out = [...ring];
  while (out.length > 3) {
    let weakest = -1;
    let gap = toleranceM;
    out.forEach((p, i) => {
      const a = out[(i + out.length - 1) % out.length] as EnuPoint;
      const b = out[(i + 1) % out.length] as EnuPoint;
      const g = pointLineGap(p, a, b);
      if (g < gap) {
        gap = g;
        weakest = i;
      }
    });
    if (weakest < 0) break;
    out.splice(weakest, 1);
  }
  return out;
}

/**
 * For each wall of `ring` (wall i runs from corner i to i+1): does another
 * building's wall run along it, within `sharedGapM`, over at least
 * `sharedMinShare` of its length?
 */
export function sharedWalls(
  ring: readonly EnuPoint[],
  owner: string,
  segments: readonly OwnedSegment[],
  params: Pick<RoofscapeParams, "sharedGapM" | "sharedMinShare">,
): boolean[] {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length] as EnuPoint;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return false;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    let covered = 0;
    for (const s of segments) {
      if (s.owner === owner) continue;
      const sx = s.b.x - s.a.x;
      const sy = s.b.y - s.a.y;
      const sLength = Math.hypot(sx, sy);
      if (sLength === 0) continue;
      // Not parallel within about 11 degrees: not the same wall.
      if (Math.abs(dx * sy - dy * sx) / sLength > 0.2) continue;
      const u0 = (s.a.x - a.x) * dx + (s.a.y - a.y) * dy;
      const u1 = (s.b.x - a.x) * dx + (s.b.y - a.y) * dy;
      const from = Math.max(0, Math.min(u0, u1));
      const to = Math.min(length, Math.max(u0, u1));
      if (to <= from) continue;
      const mid = (from + to) / 2;
      const q = { x: a.x + dx * mid, y: a.y + dy * mid };
      if (pointLineGap(q, s.a, s.b) > params.sharedGapM) continue;
      covered += to - from;
    }
    return covered >= length * params.sharedMinShare;
  });
}

const wallLength = (ring: readonly EnuPoint[], i: number): number => {
  const a = ring[i] as EnuPoint;
  const b = ring[(i + 1) % ring.length] as EnuPoint;
  return Math.hypot(b.x - a.x, b.y - a.y);
};

/**
 * Which of the candidate wing ends (walls whose roof face is a triangle) take
 * a gable: not shared, between `gableMinM` and `gableMaxM` long, the longest
 * first, and never two side by side (two neighbouring gables leave a corner
 * with no slope to meet).
 */
export function chooseGableEnds(
  candidates: readonly number[],
  ring: readonly EnuPoint[],
  shared: readonly boolean[],
  params: Pick<RoofscapeParams, "gableMinM" | "gableMaxM">,
): Set<number> {
  const ordered = candidates
    .filter((i) => shared[i] !== true)
    .filter((i) => {
      const length = wallLength(ring, i);
      return length >= params.gableMinM && length <= params.gableMaxM;
    })
    .sort((a, b) => wallLength(ring, b) - wallLength(ring, a) || a - b);
  const chosen = new Set<number>();
  for (const i of ordered) {
    const before = (i + ring.length - 1) % ring.length;
    const after = (i + 1) % ring.length;
    if (!chosen.has(before) && !chosen.has(after)) chosen.add(i);
  }
  return chosen;
}

/**
 * Where a ring's corners go when each wall moves outwards by its own offset
 * (wall i from corner i to i+1; outwards for a counter-clockwise ring), or
 * undefined for a corner that cannot follow: two nearly straight walls with
 * different offsets, or a mitre longer than four times the largest offset.
 */
export function offsetRing(
  ring: readonly EnuPoint[],
  offsets: readonly number[],
): EnuPoint[] | undefined {
  if (offsets.length !== ring.length) return undefined;
  const longest = Math.max(0, ...offsets);
  const normal = (i: number): EnuPoint => {
    const a = ring[i] as EnuPoint;
    const b = ring[(i + 1) % ring.length] as EnuPoint;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.y - a.y) / length, y: (a.x - b.x) / length };
  };
  const out: EnuPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const before = (i + ring.length - 1) % ring.length;
    const n1 = normal(before);
    const n2 = normal(i);
    const d1 = offsets[before] ?? 0;
    const d2 = offsets[i] ?? 0;
    const p = ring[i] as EnuPoint;
    if (![n1.x, n1.y, n2.x, n2.y].every(Number.isFinite)) return undefined;
    const det = n1.x * n2.y - n1.y * n2.x;
    if (Math.abs(det) < 0.02) {
      if (Math.abs(d1 - d2) > 1e-9) return undefined;
      out.push({ x: p.x + n1.x * d1, y: p.y + n1.y * d1 });
      continue;
    }
    const x = (d1 * n2.y - d2 * n1.y) / det;
    const y = (n1.x * d2 - n2.x * d1) / det;
    if (Math.hypot(x, y) > 4 * longest + 1e-9) return undefined;
    out.push({ x: p.x + x, y: p.y + y });
  }
  return out;
}
