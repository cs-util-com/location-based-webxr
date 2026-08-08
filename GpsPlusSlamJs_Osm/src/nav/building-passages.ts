/**
 * Roads that go THROUGH a building, and where they open it (DEC-R12-3).
 *
 * WHY THIS EXISTS. The eighth testing session asked for an archway where a way
 * crosses a building. The code already had a rule for that — S3DB
 * `min_height > 0`, plus `building=roof` for canopies — and neither fires for
 * the case actually reported: a road through a gate tower with no height
 * tagging. `tunnel=building_passage` is what mappers write for it, and it turns
 * out to be everywhere: 118 such ways in the Tokyo extract, 18 at Westminster,
 * 16 at Cologne, and at least one at every site in the corpus.
 *
 * **THIS IS A PROPERTY OF THE ROAD, NOT OF THE BUILDING**, which is why it lives
 * in its own module and why the obstacle index consults a second feature set for
 * the first time. `min_height` and `building=roof` are both readable from the
 * building alone; this one is not.
 *
 * **A CORRIDOR, NOT THE WHOLE VOLUME, and that is a measurement rather than a
 * preference.** DEC-R12-3 was written as "the same passable-underneath treatment
 * `min_height > 0` and `building=roof` already get", which excludes the entire
 * volume from the obstacle index. Measured over the eight-site corpus, that
 * reading makes **30-35 % of the built AREA** at Cologne, Tokyo and Tower Bridge
 * walk-through, and 22 % of the BUILDINGS at Tower Bridge — an agent strolling
 * through a whole city block because one arcade was mapped. That is the same
 * failure DEC-R12-1 refused for barriers ("an invented opening lets an agent walk
 * through a wall that is really there"), so the decision's other phrase — passable
 * **along it** — is the one implemented.
 *
 * WHY A LINE RATHER THAN A HOLE IN THE RING. The obstacle index tests a step
 * against a closed RING (`segmentCrossesRing` joins the last vertex to the first
 * whether or not the caller repeated it), so a hole cannot be expressed by
 * cutting the ring the way `barrier-gates.ts` cuts a barrier centreline.
 * Buildings do not need it to be: they are drawn from their own footprints and
 * their passability has always been an INDEX-ONLY property here — `min_height`
 * and `building=roof` volumes are drawn exactly as they were and simply do not
 * obstruct.
 *
 * WHY A LINE RATHER THAN THE TWO MOUTHS, which is the same question one layer
 * down and was got wrong first. Opening the crossing POINTS admits the entry
 * step and nothing else — and nothing else is needed to free the entire
 * interior, because `segmentCrossesRing` is false for a segment lying wholly
 * inside a ring and `obstacleLevelsAt` never removes a cell's ground level.
 * Before an opening existed that was unobservable: a closed footprint could not
 * be entered, so interior freedom cost nothing. The first version of this rule
 * made it reachable, and a route could then cut a diagonal between two mouths
 * through the rooms between them — the corridor claim above, false by
 * construction. Carrying the LINE lets `crossesObstacle` ask "is this step on
 * the passage" of the inside as well as of the boundary.
 *
 * @see building-passages.ts.md
 */

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { containsPoint, type PlanarPoint } from "../spatial/point-in-ring.js";
import { segmentsIntersect } from "../spatial/segment-crossing.js";

/**
 * The one `tunnel` value that is a way THROUGH a building rather than under one.
 *
 * The same distinction `below-surface.ts` already makes for scoring, one module
 * along: `tunnel=yes` and `tunnel=culvert` are sub-surface, and
 * `building_passage` is an arcade or gateway at ground level.
 *
 * **`covered=yes` is deliberately absent** (DEC-R12-3). It is used for roads
 * under canopies and arcades where the building beside them is genuinely solid,
 * so honouring it would invent passages.
 */
const PASSAGE_TUNNEL = "building_passage";

/**
 * How wide a mapped building passage is taken to be, metres.
 *
 * **SIZED BY THE PATHFINDER, not by architecture**, exactly as `GATE_GAP_M` is —
 * and it has to be wider than a gate for a reason that only shows up here. A
 * gate needs ONE admitted step across a line. A corridor needs a CHAIN of them
 * along its length, and the res-13 cells the search moves between have centres
 * ~6 m apart on a lattice that has no idea where the passage runs: two
 * consecutive centres can sit several metres off the line, on the same side. A
 * corridor narrower than the lattice spacing is one the agent can enter and then
 * not follow — which is worse than not opening it at all, because the mouth is
 * visible.
 *
 * `building-passages.property.test.ts` states that as "the passage is walkable
 * end to end, at any bearing" and fails below this value.
 */
export const PASSAGE_CORRIDOR_M = 10;

/**
 * The footprint shape this module needs — rings as `x = lng, y = lat` degrees.
 *
 * THE INDEX'S OWN CONVENTION, structurally satisfied by `SolidFootprint`, so
 * the caller hands its footprints straight over with no conversion and no
 * second chance to swap the axes.
 */
export interface PassableFootprint {
  readonly rings: readonly (readonly PlanarPoint[])[];
}

/** Whether this feature is a way tagged as running through a building. */
function isBuildingPassage(feature: OsmFeature): boolean {
  return (
    feature.type === "way" &&
    feature.geometry.length >= 2 &&
    feature.tags["tunnel"] === PASSAGE_TUNNEL
  );
}

/**
 * The passage LINES running through each footprint.
 *
 * Returns one list per footprint, in the same order, so the caller can zip the
 * two together. Most lists are empty: passages are common in a city extract but
 * rare per building.
 *
 * **LINES, NOT THE TWO MOUTHS, and the difference is the whole corridor claim.**
 * An earlier version returned the boundary crossing points and the index
 * admitted any step passing near one. Blocking is a pure BOUNDARY property here
 * — `segmentCrossesRing` is false for a segment lying wholly inside a ring — so
 * that opened the mouths and, with them, the entire interior: every subsequent
 * step between two interior cells crossed no ring at all, and a route could cut
 * a diagonal between two mouths through the rooms between them. Carrying the
 * line lets the index ask "is this step ON the passage" for the inside as well
 * as for the boundary, which is what makes the corridor a corridor.
 *
 * **A passage that merely ENDS inside the footprint counts.** OSM ways are
 * routinely split at a building outline, which leaves the tagged segment wholly
 * inside and crossing the ring zero times. Raised in review as a hypothesis and
 * then MEASURED: no passage in the corpus has both endpoints inside a solid
 * footprint, but Tokyo has one with a vertex inside a building whose ring it
 * never crosses — so the containment test finds a seventh building there that
 * the crossing test alone missed. One real case out of eight sites, and its
 * failure mode is silent: the building simply stays solid.
 */
export function passageLines(
  features: Iterable<OsmFeature>,
  footprints: readonly PassableFootprint[],
): readonly (readonly (readonly PlanarPoint[])[])[] {
  const passages = [...features].filter(isBuildingPassage);
  // THE COMMON CASE FIRST: with no passage in the extract there is nothing to
  // intersect, and this runs once per obstacle-index build over a whole city.
  if (passages.length === 0) return footprints.map(() => []);

  const lines = passages.map((passage) =>
    passage.type === "way" ? passage.geometry.map(planar) : [],
  );

  return footprints.map((footprint) =>
    lines.filter((line) => touchesFootprint(line, footprint)),
  );
}

/** Whether `line` crosses into, or lies inside, the footprint. */
function touchesFootprint(
  line: readonly PlanarPoint[],
  footprint: PassableFootprint,
): boolean {
  if (line.length < 2) return false;

  // A vertex inside is the split-way case; a crossing is the ordinary one. The
  // containment test is first because it is O(rings) against O(rings x line).
  if (line.some((point) => insideFootprint(point, footprint))) return true;

  for (const ring of footprint.rings) {
    if (ring.length < 2) continue;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
        if (segmentsIntersect(a, b, ring[k]!, ring[j]!)) return true;
      }
    }
  }
  return false;
}

/**
 * Whether `point` is inside the solid part of `footprint`.
 *
 * **BY RING PARITY, not by "inside any ring".** A footprint's rings are the
 * outer boundary followed by its holes, and a point in a courtyard is inside the
 * outer ring AND inside a hole — two rings, so even, so outside the building,
 * which is the correct answer. Taking "inside any ring" instead counted a
 * passage that merely ends in a courtyard as running through the building,
 * which would have opened a route through its outer wall into the yard: an
 * invented opening, and the failure DEC-R12-1 spends a page refusing. Measured:
 * it moved Tokyo's count from 6 to 7 buildings, which is how it was noticed.
 */
function insideFootprint(
  point: PlanarPoint,
  footprint: PassableFootprint,
): boolean {
  let crossings = 0;
  for (const ring of footprint.rings) {
    if (ring.length >= 3 && containsPoint(ring, point)) crossings++;
  }
  return crossings % 2 === 1;
}

/** Degrees as the index holds them: `x = lng`, `y = lat`. */
function planar(position: LatLng): PlanarPoint {
  return { x: position.lng, y: position.lat };
}
