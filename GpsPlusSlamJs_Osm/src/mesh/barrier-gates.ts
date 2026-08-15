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
 * WHAT IT COSTS, MEASURED: over the eight-site corpus this cuts 12 of Cologne's
 * 60 solid barriers, 8 of Heidelberg's 53, 12 of Sylt's 65, 10 of Westminster's
 * 73, 2 of Tower Bridge's 9, 1 of Manhattan's 41 — and NOTHING at Berlin or
 * Tokyo, which map no gate on any barrier at all. Paths will still meet unbroken
 * walls in places; the rule fails towards a solid barrier, which reads as OSM
 * tagging rather than as a pathfinding defect.
 *
 * AND ONE NARROW EXTENSION, DEC-A2: a gate node BESIDE a barrier opens it when a
 * routable, surface-level way through that node also crosses it. The Tower of
 * London is the case — the gate ("Groups Entrance to the Tower") sits 0.17 m off
 * the curtain wall and belongs to the footways, not to the wall, so the exact
 * rule above could never fire and the agent could not walk through the gateway.
 * The conjunction is what keeps this from being the proximity match rejected
 * above: each half alone is a rule this file already refuses.
 *
 * ITS MEASURED COST IS ZERO — it changes no barrier at any of the eight sites,
 * and getting there took two corrections that only the per-site counts exposed:
 * a below-surface gate node opened a Cologne retaining wall, and at Sylt one
 * `barrier=wall` corroborated another. Both were false positives. A rule that is
 * a no-op everywhere looks exactly like a rule that works, so the demonstration
 * is `agent-route.tower-gate.test.ts` on real Tower geometry, not the corpus.
 *
 * @see barrier-gates.ts.md
 */

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { isBelowSurface } from "../model/below-surface.js";
import { enuFrameAt, type EnuFrame, type EnuPoint } from "./enu.js";
import { isRoad } from "./roads.js";

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
 * `entrance` values that DENY an entrance rather than describing one.
 *
 * Small on purpose: `entrance=*` is otherwise open-ended (`main`, `yes`,
 * `service`, `exit`, `emergency`, …) and a new value should mean an opening by
 * default. Only an explicit denial is excluded.
 */
const DENIED_ENTRANCES = new Set(["no", "none"]);

/**
 * `highway` values describing a route that does not exist on the ground yet.
 *
 * A VALUE FILTER FOR THE SAME REASON `DENIED_ENTRANCES` IS ONE: a way that OSM
 * says is not built cannot be evidence that people walk through a gate. Kept
 * deliberately tiny — every other `highway` value describes something usable,
 * and a new one should count as a route by default.
 */
const UNBUILT_HIGHWAYS = new Set(["construction", "proposed"]);

/**
 * How much barrier a gate removes, metres, centred on the node.
 *
 * A DECISION BOUNDED BY A MEASUREMENT. OSM does not say how wide a gate is, any
 * more than it says how tall a wall is (DEC-R11-2 settled that one the same way)
 * — but the LOWER bound is not a matter of taste. Blocking is a property of the
 * STEP between two res-13 cell centres, whose spacing is ~6 m, so a narrower gap
 * is one the pathfinder cannot use: drawn, visible, and walked around.
 *
 * SIX, NOT FIVE, and the difference was measured rather than reasoned. Five was
 * chosen first and passed the walkability property at 40 alignments; run at 300
 * it failed roughly one run in four, i.e. about one alignment in twelve hundred
 * had no step through the gate at all. Six passed 1 200 alignments with no
 * failure. A property that is 99.9 % true is a flaky test AND a gate that
 * occasionally does not open, and the second is the one that matters.
 */
export const GATE_GAP_M = 6;

/**
 * How far off a barrier a gate node may sit and still open it (DEC-A2).
 *
 * THE TOLERANCE THAT IS NOT AN EPSILON, and the distinction is the whole reason
 * this constant is defensible where the header above rejects proximity matching.
 * On its own, "a gate within a metre of a wall" IS the plausible-but-wrong match
 * DEC-R12-7 threw out. It is used here only in CONJUNCTION with a way through
 * that gate node crossing the barrier — so the data has said two independent
 * things, and neither is inferred from the other.
 *
 * ONE METRE, sized from the case that motivated it rather than from taste. At
 * the Tower of London the gate node ("Groups Entrance to the Tower") sits
 * **0.17 m** from the curtain wall and the path through it crosses the wall
 * **0.17 m from the node** — the mapper put the gate at the crossing point and
 * attached it to the path rather than to the wall. A gate genuinely belonging to
 * a different fence is metres away, not centimetres, so a sub-metre-to-metre
 * tolerance separates the two cleanly.
 */
export const GATE_ON_BARRIER_M = 1;

/**
 * A gate node with the routable ways running through it (DEC-A2).
 *
 * **EVERY such gate, INCLUDING ones that are exact vertices of a barrier.**
 * Nothing here tests barrier membership — it cannot, because a gate is
 * collected once for the whole feature set while "is it on THIS barrier" is a
 * question per barrier. (Stated explicitly because the opposite — that the
 * collection excludes on-barrier gates — is the intuitive reading, and a wrong
 * one.)
 *
 * The consequence is worth stating rather than hiding: for a gate that IS a
 * vertex of the barrier being split, that barrier is not in `throughWays` (it is
 * not a `highway`), so the DEC-A2 path finds no corroboration and contributes
 * nothing — the exact rule in `opensAt` has already cut there. The two rules
 * therefore do not double-count, and they do not depend on each other.
 *
 * Only gates with at least one through-way are collected: the conjunction
 * cannot be satisfied without one, and pruning here keeps the per-barrier scan
 * proportional to the gates that could actually open something.
 */
interface OffBarrierGate {
  readonly position: LatLng;
  /** Geometries of the ways with a vertex at {@link position}. */
  readonly throughWays: readonly (readonly LatLng[])[];
}

/** The positions at which barriers open. Built once per feature set. */
export interface GateOpenings {
  /** Whether a barrier vertex at exactly this position is a gate. */
  opensAt(position: LatLng): boolean;
  /** How many openings were found — for tests and diagnostics. */
  readonly size: number;
  /**
   * Every gate node that has a routable way through it (DEC-A2).
   *
   * NOT "gates beside a barrier" — nothing here knows which barrier is being
   * split, so membership cannot be tested at collection time. See
   * {@link OffBarrierGate}.
   *
   * Kept separate from {@link opensAt} rather than folded into it, because the
   * two answer different questions: `opensAt` is exact identity and needs no
   * corroboration, while these open a barrier only when a way through them
   * crosses it. Merging them would quietly turn the first rule into the second.
   */
  readonly offBarrier: readonly OffBarrierGate[];
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
  offBarrier: [],
};

/**
 * Whether this way may act as the "a route passes through here" half of DEC-A2.
 *
 * **A ROUTE, NOT ANY LINE.** Indexing every way lets a building outline, a
 * `landuse` edge, a waterway or another wall corroborate a gate. That is a real false-positive shape and not a contrived one: `entrance=*`
 * nodes are overwhelmingly vertices of BUILDING outlines, so
 * "building entrance node + building outline + a fence within a metre" would
 * have opened the fence — none of which involves a path.
 *
 * **`isRoad` PLUS A VALUE FILTER, not a presence test on `highway`** — and this
 * file is the last place that should have used one. `DENIED_ENTRANCES` exists
 * because the `entrance` key had "degraded to a presence test" and `entrance=no`
 * opened the one node OSM took the trouble to deny; `highway` has the same
 * denial-shaped values and one structural trap:
 *
 * - **`highway=pedestrian` + `area=yes`** — the building-outline argument
 *   arriving from the other side. A plaza is an OUTLINE, not a line through, and
 *   plazas abut walls constantly. **`isRoad` handles this one.**
 * - `highway=construction` / `proposed` — a route that does not exist yet
 *   vouching for a gate. **`isRoad` does NOT handle this**, and an earlier
 *   version of this comment claimed it did:
 *   `roads.ts` filters nodes, a missing `highway`, `tunnel=yes`, `covered=yes`
 *   and `area=yes`, and nothing else. **The class is real, and BOTH values are
 *   evidenced in the corpus**: `highway=construction` appears **3×** in Berlin's
 *   fixture and **1×** in Westminster's; `highway=proposed` appears **2×** in
 *   Westminster's. **Pinned per value by `site-barriers.test.ts`**, so neither a
 *   fixture refresh nor a swap of one value for the other can falsify this
 *   sentence silently. Hence {@link UNBUILT_HIGHWAYS} below.
 *
 *   **Pinned per value, not as a total**, because a summed assertion once let
 *   a wrong split (3 construction / none proposed) sit green: a count pinned
 *   more coarsely than the claim it defends is not a pin.
 *
 * The filter lives HERE rather than in `isRoad` on purpose: `isRoad` also
 * decides what `buildRoads` DRAWS, and whether a road under construction should
 * be drawn is a separate question from whether it may vouch for a gate. Widening
 * that predicate to settle this one would be a rendering change smuggled into a
 * pathfinding fix.
 *
 * `roads.ts` otherwise already encodes "a `highway` that is genuinely a linear
 * route" and is what the demo draws ribbons from — so reusing it keeps "a route
 * passes through here" meaning the same thing in both places rather than in two
 * that can drift.
 *
 * **AND IT MUST BE ON THE WALKING SURFACE**, by the same argument that vetoes a
 * below-surface gate NODE: a road passing under a wall is not a way through it.
 * Without this the veto was asymmetric — the node was checked and the
 * corroborating way was not. `isRoad` already refuses `tunnel=yes` and
 * `covered=yes`; `isBelowSurface` additionally catches `layer`/`level` below
 * zero and `location=underground`, so both run.
 *
 * NOT "the same layer as the barrier": the Tower's own corroborating way is
 * `bridge=yes layer=1`, so above-surface ways have to stay acceptable.
 */
function canCorroborate(feature: OsmFeature & { type: "way" }): boolean {
  if (UNBUILT_HIGHWAYS.has(feature.tags["highway"] ?? "")) return false;
  return isRoad(feature) && !isBelowSurface(feature);
}

/**
 * Records `geometry` under each of its vertex positions.
 *
 * MEMBERSHIP IS COORDINATE IDENTITY, for the reason the header gives: the model
 * carries inlined geometry and explicitly no node references, and Overpass emits
 * the same node's coordinates identically wherever they appear. So "a way
 * through this gate node" is "a way with a vertex here".
 */
function indexWayVertices(
  geometry: readonly LatLng[],
  waysAt: Map<string, (readonly LatLng[])[]>,
): void {
  for (const vertex of geometry) {
    const vertexKey = key(vertex);
    const held = waysAt.get(vertexKey);
    if (held === undefined) waysAt.set(vertexKey, [geometry]);
    else held.push(geometry);
  }
}

/** Whether this feature's tags mark it as a gate or an entrance (DEC-R12-7). */
function isGateNode(tags: Readonly<Record<string, string>>): boolean {
  const barrier = tags["barrier"];
  const entrance = tags["entrance"];
  return (
    (barrier !== undefined && GATE_BARRIERS.has(barrier)) ||
    // A VALUE TEST, NOT A PRESENCE TEST, and the asymmetry with `barrier` above
    // was a real gap: `entrance=no` is a real value meaning this node is
    // explicitly NOT an entrance, so a presence check opened a wall at the one
    // node OSM took the trouble to deny.
    (entrance !== undefined && !DENIED_ENTRANCES.has(entrance))
  );
}

/**
 * The gate and entrance NODES in `features`.
 *
 * NODES ONLY. A gap is a point on a barrier; a `barrier=gate` mapped as a way is
 * a gate drawn as a line — an obstacle-shaped thing in its own right — and
 * treating its vertices as openings would cut the wall it is attached to.
 */
export function gateOpenings(features: Iterable<OsmFeature>): GateOpenings {
  const positions = new Set<string>();
  const gateNodes: LatLng[] = [];
  /** Way geometries indexed by each of their vertex positions. */
  const waysAt = new Map<string, (readonly LatLng[])[]>();

  for (const feature of features) {
    if (feature.type === "way") {
      if (canCorroborate(feature)) indexWayVertices(feature.geometry, waysAt);
      continue;
    }
    if (feature.type !== "node") continue;
    if (!isGateNode(feature.tags)) continue;
    positions.add(key(feature.position));
    // A GATE THAT IS NOT ON THE WALKING SURFACE OPENS NOTHING BESIDE IT.
    // Found by the DEC-A2 corpus measurement rather than reasoned: the one new
    // opening at Cologne came from node 1591065517, `entrance=yes` **`layer=-1`**
    // ("Zugang Südturm"), an underground access sitting on a retaining wall. A
    // person walking at ground level cannot pass through it, so cutting the wall
    // there is exactly the invented opening this module exists to avoid.
    //
    // APPLIED ONLY TO THE OFF-BARRIER RULE, not to `opensAt`. The exact rule is
    // DEC-R12-1's and is not being revisited here — a gate that IS a vertex of
    // the barrier is a much stronger statement, and changing its meaning would
    // move counts this measurement is the baseline for.
    if (!isBelowSurface(feature)) gateNodes.push(feature.position);
  }

  // BUILT AFTER THE LOOP, because a gate node may be read before the way that
  // runs through it — feature order is Overpass's, not ours.
  const offBarrier: OffBarrierGate[] = [];
  for (const position of gateNodes) {
    const throughWays = waysAt.get(key(position));
    if (throughWays !== undefined && throughWays.length > 0) {
      offBarrier.push({ position, throughWays });
    }
  }

  return {
    opensAt: (position) => positions.has(key(position)),
    size: positions.size,
    offBarrier,
  };
}

/**
 * `line`, with a {@link GATE_GAP_M} opening removed around every gate on it.
 *
 * `minPieceM` is the shortest surviving piece worth keeping — pass the
 * feature's own `thicknessM`, since a piece shorter than the barrier is thick is
 * not a barrier. See the filter at the end for the case that produces one.
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
  minPieceM: number,
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

  const cuts = mergedCuts(line, gates, along, enu, frame);
  if (cuts.length === 0) return [line];

  const parts: { points: LatLng[]; lengthM: number }[] = [];
  let from = 0;
  for (const [start, end] of cuts) {
    if (start > from) {
      parts.push({
        points: slice(line, along, from, start),
        lengthM: start - from,
      });
    }
    from = end;
  }
  if (from < total) {
    parts.push({
      points: slice(line, along, from, total),
      lengthM: total - from,
    });
  }

  // A PIECE SHORTER THAN THE BARRIER IS THICK IS NOT A BARRIER, and this is a
  // LENGTH test rather than a point count because the case that produces one has
  // two perfectly good points. Two gates just over a gap apart — 0 m and 5.2 m —
  // give cuts that do NOT overlap and so are not merged, leaving 0.2 m of wall
  // stranded in the middle of a 7.7 m opening: a visible stub floating in the
  // gap, and a quad in the index that a step between two cell centres can still
  // hit. That is the "drawn and unusable" outcome GATE_GAP_M is bounded from
  // below to prevent, arriving from the other side.
  //
  // MEASURED AGAINST THE FEATURE'S OWN THICKNESS rather than a constant here,
  // which is both more correct and what keeps this module free of a dependency
  // on `barriers.ts` — the two would otherwise import each other.
  //
  // And a piece of one point cannot be drawn or indexed at all.
  return parts
    .filter((part) => part.points.length >= 2 && part.lengthM > minPieceM)
    .map((part) => part.points);
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
  enu: readonly Enu[],
  frame: EnuFrame,
): readonly (readonly [number, number])[] {
  const half = GATE_GAP_M / 2;
  const raw: [number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    if (!gates.opensAt(line[i]!)) continue;
    raw.push([along[i]! - half, along[i]! + half]);
  }
  // AND THE GATES BESIDE THE LINE (DEC-A2), which need corroboration the exact
  // matches above do not. Additive on purpose: every opening the original rule
  // produced is produced identically, so the corpus can only gain openings and
  // the before/after comparison means something.
  // THE BROAD PHASE, and without it this loop is the barrier build's whole cost.
  // `gates.offBarrier` is every gate and entrance node in the WHOLE merged tile
  // set — tens of thousands in a city, and the `gates.size === 0` early-out in
  // `splitAtGates` therefore never fires there. Each one used to walk this
  // line's every segment (`nearestOnLine`) before the `> GATE_ON_BARRIER_M`
  // test at the bottom of `offBarrierCut` rejected it, so a gate 6 km away cost
  // exactly as much as one standing in the wall.
  //
  // The box is the line's own extent grown by the same 1 m the distance test
  // uses, so it is CONSERVATIVE by construction: a gate outside it is more than
  // 1 m from every vertex and every segment of the line, and `offBarrierCut`
  // could only ever have returned `undefined` for it. Measured: the whole
  // off-barrier scan is ~1 s of the mesh build at working-set scale, and the
  // no-gates residual is 4 ms.
  const bounds = lineBounds(enu, GATE_ON_BARRIER_M);
  for (const gate of gates.offBarrier) {
    const gateEnu = frame.toEnu(gate.position);
    if (!withinBounds(bounds, gateEnu)) continue;
    const cutAt = offBarrierCut(gate, gateEnu, along, enu, frame);
    if (cutAt !== undefined) raw.push([cutAt - half, cutAt + half]);
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

/**
 * A point in the line's own ENU frame.
 *
 * An alias rather than a second declaration: `frame.toEnu()` already returns
 * this exact shape, and a structurally identical local type would drift from it
 * silently.
 */
type Enu = EnuPoint;

/**
 * Where `gate` opens this line, as a distance along it, or `undefined`.
 *
 * BOTH HALVES OF DEC-A2 ARE TESTED HERE, and the order is cheapest-first: the
 * projection is arithmetic, the crossing scan walks another way's segments.
 */
/**
 * The line's axis-aligned extent in its own ENU frame, grown by `padM`.
 *
 * An empty line yields an INVERTED box, which {@link withinBounds} rejects for
 * every point — the correct reading, since a line with no vertices is nowhere
 * near anything.
 */
function lineBounds(
  enu: readonly Enu[],
  padM: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of enu) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (minX > maxX) return { minX, maxX, minY, maxY };
  return {
    minX: minX - padM,
    maxX: maxX + padM,
    minY: minY - padM,
    maxY: maxY + padM,
  };
}

function withinBounds(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  point: Enu,
): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function offBarrierCut(
  gate: OffBarrierGate,
  gateEnu: Enu,
  along: readonly number[],
  enu: readonly Enu[],
  frame: EnuFrame,
): number | undefined {
  const near = nearestOnLine(gateEnu, enu, along);
  if (near === undefined || near.distanceM > GATE_ON_BARRIER_M)
    return undefined;
  // THE CORROBORATION. A gate beside a wall whose path never reaches the wall is
  // not a gateway — which is exactly the shape of the Tower's own `tunnel=yes`
  // stub, holding the gate node and crossing the wall zero times.
  if (!crossesNear(gate, gateEnu, enu, frame)) return undefined;
  return near.alongM;
}

/** The closest point on the polyline to `at`, as a distance along it. */
function nearestOnLine(
  gateEnu: Enu,
  enu: readonly Enu[],
  along: readonly number[],
): { distanceM: number; alongM: number } | undefined {
  let best: { distanceM: number; alongM: number } | undefined;
  for (let i = 1; i < enu.length; i++) {
    const a = enu[i - 1]!;
    const b = enu[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) continue;
    const t = Math.min(
      1,
      Math.max(0, ((gateEnu.x - a.x) * dx + (gateEnu.y - a.y) * dy) / lengthSq),
    );
    const distanceM = Math.hypot(
      gateEnu.x - (a.x + dx * t),
      gateEnu.y - (a.y + dy * t),
    );
    if (best === undefined || distanceM < best.distanceM) {
      best = { distanceM, alongM: along[i - 1]! + Math.sqrt(lengthSq) * t };
    }
  }
  return best;
}

/**
 * Whether a way through `gate` crosses the line within
 * {@link GATE_ON_BARRIER_M} of the gate node.
 *
 * NEAR THE GATE, not anywhere along the way, and that bound is what stops a long
 * path opening a wall it happens to cross half a kilometre from its gate.
 */
function crossesNear(
  gate: OffBarrierGate,
  gateEnu: Enu,
  enu: readonly Enu[],
  frame: EnuFrame,
): boolean {
  for (const way of gate.throughWays) {
    const path = way.map((position) => frame.toEnu(position));
    for (let i = 1; i < path.length; i++) {
      for (let k = 1; k < enu.length; k++) {
        const hit = segmentCrossing(
          path[i - 1]!,
          path[i]!,
          enu[k - 1]!,
          enu[k]!,
        );
        if (hit === undefined) continue;
        if (
          Math.hypot(hit.x - gateEnu.x, hit.y - gateEnu.y) <= GATE_ON_BARRIER_M
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Where two segments cross, or `undefined` when they do not. */
function segmentCrossing(
  a: Enu,
  b: Enu,
  c: Enu,
  d: Enu,
): { x: number; y: number } | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  // Parallel or degenerate. A collinear overlap is deliberately NOT a crossing:
  // a path running ALONG a wall is not a way through it.
  if (denominator === 0) return undefined;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  // TOUCHING COUNTS, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT (raised in
  // review on #277). The bounds are INCLUSIVE, so a way that merely ENDS on the
  // barrier corroborates a gate there. A footway that terminates at a gate in a
  // wall is a gateway — mapping it as a dead end at the wall rather than as a
  // line through it is a stylistic choice of the mapper, not a statement that
  // the wall is solid. Tightening these to strict inequalities would silently
  // close that class; `barrier-gates.test.ts` pins the T-junction shape so the
  // change cannot be made by accident.
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { x: a.x + rx * t, y: a.y + ry * t };
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
