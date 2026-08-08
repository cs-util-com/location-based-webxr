/**
 * Where a mapped gate opens a barrier (DEC-R12-1, DEC-R12-7).
 *
 * WHY THIS EXISTS. The eighth testing session reported ways and roads crossing
 * barriers with the barrier drawn straight through, and offered a hypothesis:
 * maybe the OSM way really ends and a new one begins after the path. Reading the
 * code ruled that out — each barrier is drawn from its own geometry and nothing
 * joins one way to another, so two ways with a real gap between them already
 * produce two bands with a real gap between them. Where the demo shows an
 * unbroken barrier across a way, OSM says the barrier is continuous there.
 *
 * SO THE QUESTION IS WHEN WE MAY CUT, AND THE ANSWER IS AS NARROW AS POSSIBLE.
 * Cutting wherever a way crosses was measured and rejected: `retaining_wall` is
 * the largest crossing kind at two of six sites, and a road crossing one in plan
 * is normally running above or below the embankment it holds up. The `layer` tag
 * that would separate those cases is absent at three of six sites. An invented
 * opening lets an agent walk through a wall that is really there, which is the
 * louder failure — so a gap opens ONLY where OSM explicitly maps a gate or an
 * entrance NODE on the barrier's own way.
 *
 * "ON THE WAY" IS EXACT COORDINATE IDENTITY, not node-id membership, and that is
 * a property of the model rather than a compromise: `OsmWay` carries inlined
 * geometry and explicitly no node references, because `out geom` exists to avoid
 * resolving them. It works because Overpass emits the same node's coordinates
 * identically wherever they appear — the same fact `positionsEqual` relies on for
 * ring stitching. An epsilon here would be exactly the "plausible-but-wrong"
 * match that docstring warns against: a gate NEAR a wall it is not part of.
 *
 * WHAT IT COSTS, MEASURED: over the eight-site corpus this cuts 13 of Cologne's
 * 60 solid barriers, 8 of Heidelberg's 53, 12 of Sylt's 65, 10 of Westminster's
 * 73, 2 of Tower Bridge's 9, 1 of Manhattan's 41 — and NOTHING at Berlin or
 * Tokyo, which map no gate on any barrier at all. Paths will still meet unbroken
 * walls in places; the rule fails towards a solid barrier, which reads as OSM
 * tagging rather than as a pathfinding defect.
 *
 * @see barrier-gates.ts.md
 */

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";

/**
 * `barrier` values on a NODE that open the barrier they sit on (DEC-R12-7).
 *
 * EVERY VALUE IS SOMETHING A PERSON WALKS THROUGH. `barrier=bollard` is
 * deliberately absent: it is street furniture that happens to share a vertex,
 * and measuring it over the corpus bought exactly one extra opening while being
 * the one candidate that could invent a hole in a real wall.
 *
 * `barrier=entrance` is the strongest member rather than a marginal one — it is
 * the tag that means literally "a gap in a barrier", so leaving it out would
 * exclude the value that states this rule's own premise.
 */
const GATE_BARRIERS = new Set([
  "gate",
  "lift_gate",
  "swing_gate",
  "kissing_gate",
  "stile",
  "cycle_barrier",
  "entrance",
]);

/**
 * How much barrier a gate removes, metres, centred on the node.
 *
 * A DECISION, NOT A MEASUREMENT — OSM does not say how wide a gate is, exactly
 * as it does not say how tall a wall is (DEC-R11-2 settled that one the same
 * way). Five metres is a typical mapped vehicle gate, and the value is bounded
 * from BELOW by something sharper than typicality: a gap narrower than the
 * spacing of neighbouring res-13 cell centres (~6 m) is one the pathfinder
 * cannot use, because blocking is a property of the STEP between two cell
 * centres and every such step would still cross a band. A gap that is drawn and
 * unusable is the worst of both outcomes — a visible opening the agent walks
 * around. `barrier-gates.property.test.ts` states that as "a step through the
 * gate exists", which is the claim that actually matters.
 */
export const GATE_GAP_M = 5;

/** The positions at which barriers open. Built once per feature set. */
export interface GateOpenings {
  /** Whether a barrier vertex at exactly this position is a gate. */
  opensAt(position: LatLng): boolean;
  /** How many openings were found — for tests and diagnostics. */
  readonly size: number;
}

/**
 * A key for exact coordinate identity.
 *
 * `-0` and `0` stringify identically, so the two zeroes cannot split a key —
 * which matters because they compare equal everywhere else in this package.
 */
function key(position: LatLng): string {
  return `${position.lat},${position.lng}`;
}

/** No gates. The behaviour before DEC-R12-1: every barrier is continuous. */
export const NO_GATES: GateOpenings = {
  opensAt: () => false,
  size: 0,
};

/**
 * The gate and entrance NODES in `features`.
 *
 * NODES ONLY. A gap is a point on a barrier; a `barrier=gate` mapped as a way is
 * a gate drawn as a line — an obstacle-shaped thing in its own right — and
 * treating its vertices as openings would cut the wall it is attached to.
 */
export function gateOpenings(features: Iterable<OsmFeature>): GateOpenings {
  const positions = new Set<string>();

  for (const feature of features) {
    if (feature.type !== "node") continue;
    const tags = feature.tags;
    const barrier = tags["barrier"];
    const opens =
      (barrier !== undefined && GATE_BARRIERS.has(barrier)) ||
      tags["entrance"] !== undefined;
    if (opens) positions.add(key(feature.position));
  }

  return {
    opensAt: (position) => positions.has(key(position)),
    size: positions.size,
  };
}

/**
 * `line`, with a {@link GATE_GAP_M} opening removed around every gate on it.
 *
 * Returns the surviving pieces in order, each with at least two points. A line
 * with no gate comes back unchanged (as the single-element list), and a line
 * short enough to be swallowed by its own gate comes back empty — a two-metre
 * fence stub with a gate on it is a gate, not a fence.
 *
 * OVERLAPPING GAPS MERGE. Two gate nodes a metre apart are one gateway mapped
 * twice, and cutting each separately would leave a sliver of wall between them
 * narrower than the barrier is thick.
 */
export function splitAtGates(
  line: readonly LatLng[],
  gates: GateOpenings,
): readonly (readonly LatLng[])[] {
  if (line.length < 2) return [];
  // The common case by a wide margin: most barriers have no gate, and at two of
  // the eight corpus sites NO barrier does.
  if (gates.size === 0) return [line];

  // MEASURED IN A FRAME ANCHORED AT THE LINE'S OWN FIRST VERTEX, exactly as
  // `nav/obstacles.ts` anchors thickness: metres are unavoidable here, and an
  // anchor belonging to the feature rather than to the current view means
  // nothing about this moves when the user does.
  const frame = enuFrameAt(line[0]!);
  const enu = line.map((position) => frame.toEnu(position));

  /** Cumulative distance along the line, in metres, per vertex. */
  const along: number[] = [0];
  for (let i = 1; i < enu.length; i++) {
    const a = enu[i - 1]!;
    const b = enu[i]!;
    along.push(along[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = along[along.length - 1]!;
  if (!(total > 0)) return [];

  const cuts = mergedCuts(line, gates, along);
  if (cuts.length === 0) return [line];

  const parts: LatLng[][] = [];
  let from = 0;
  for (const [start, end] of cuts) {
    if (start > from) parts.push(slice(line, along, from, start));
    from = end;
  }
  if (from < total) parts.push(slice(line, along, from, total));

  // A piece shorter than the barrier is thick is not a barrier; and a piece of
  // one point cannot be drawn or indexed at all.
  return parts.filter((part) => part.length >= 2);
}

/**
 * The intervals of `line` a gate removes, merged and in order.
 *
 * Gate positions are found by exact vertex match, which is what "on the barrier's
 * own way" means — see the file header for why that is identity rather than
 * proximity.
 */
function mergedCuts(
  line: readonly LatLng[],
  gates: GateOpenings,
  along: readonly number[],
): readonly (readonly [number, number])[] {
  const half = GATE_GAP_M / 2;
  const raw: [number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    if (!gates.opensAt(line[i]!)) continue;
    raw.push([along[i]! - half, along[i]! + half]);
  }
  if (raw.length === 0) return [];

  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [raw[0]!];
  for (const interval of raw.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push(interval);
  }
  return merged;
}

/** The sub-polyline between two distances along `line`, ends interpolated. */
function slice(
  line: readonly LatLng[],
  along: readonly number[],
  from: number,
  to: number,
): LatLng[] {
  const points: LatLng[] = [at(line, along, from)];
  for (let i = 0; i < line.length; i++) {
    const d = along[i]!;
    if (d > from && d < to) points.push(line[i]!);
  }
  points.push(at(line, along, to));
  return points;
}

/**
 * The position `distance` metres along `line`.
 *
 * INTERPOLATED IN LAT/LNG rather than in the metric frame, because at segment
 * scale the two agree to far below the precision OSM carries — and this way a
 * retained vertex is the ORIGINAL value rather than a round-trip through ENU,
 * which is what keeps exact coordinate identity working for any gate further
 * along the same line.
 */
function at(
  line: readonly LatLng[],
  along: readonly number[],
  distance: number,
): LatLng {
  if (distance <= 0) return line[0]!;
  const last = line.length - 1;
  if (distance >= along[last]!) return line[last]!;

  for (let i = 0; i + 1 < line.length; i++) {
    const start = along[i]!;
    const end = along[i + 1]!;
    if (distance > end) continue;
    // A repeated node makes a zero-length segment; taking its start point is
    // correct and avoids a division by zero.
    const span = end - start;
    const t = span > 0 ? (distance - start) / span : 0;
    const a = line[i]!;
    const b = line[i + 1]!;
    return {
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    };
  }
  return line[last]!;
}
