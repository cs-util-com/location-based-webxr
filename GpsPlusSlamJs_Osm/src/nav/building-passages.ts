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
 * WHY THE OPENINGS ARE POINTS. The obstacle index tests a step against a closed
 * RING (`segmentCrossesRing` joins the last vertex to the first whether or not
 * the caller repeated it), so a hole cannot be expressed by cutting the ring the
 * way `barrier-gates.ts` cuts a barrier centreline. Buildings do not need it to
 * be: they are drawn from their own footprints and their passability has always
 * been an INDEX-ONLY property here — `min_height` and `building=roof` volumes are
 * drawn exactly as they were and simply do not obstruct. So a passage is
 * expressed as the points at which it pierces the boundary, and the index admits
 * a step that goes through one.
 *
 * @see building-passages.ts.md
 */

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import type { PlanarPoint } from "../spatial/point-in-ring.js";
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
 * Where each footprint's boundary is pierced by a building passage.
 *
 * Returns one list per footprint, in the same order, so the caller can zip the
 * two together. Most lists are empty: passages are common in a city extract but
 * rare per building.
 *
 * BOTH CROSSINGS MATTER — a passage that pierces a building enters and leaves,
 * and opening only one end would let an agent walk in and not out.
 */
export function passageOpenings(
  features: Iterable<OsmFeature>,
  footprints: readonly PassableFootprint[],
): readonly (readonly PlanarPoint[])[] {
  const passages = [...features].filter(isBuildingPassage);
  // THE COMMON CASE FIRST: with no passage in the extract there is nothing to
  // intersect, and this runs once per obstacle-index build over a whole city.
  if (passages.length === 0) return footprints.map(() => []);

  return footprints.map((footprint) => {
    const openings: PlanarPoint[] = [];
    for (const ring of footprint.rings) {
      for (const passage of passages) {
        if (passage.type !== "way") continue;
        collectCrossings(passage.geometry, ring, openings);
      }
    }
    return openings;
  });
}

/** Every point where `line` crosses the closed `ring`, appended to `into`. */
function collectCrossings(
  line: readonly LatLng[],
  ring: readonly PlanarPoint[],
  into: PlanarPoint[],
): void {
  if (ring.length < 2) return;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = planar(line[i]!);
    const b = planar(line[i + 1]!);
    for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
      const p = ring[k]!;
      const q = ring[j]!;
      if (!segmentsIntersect(a, b, p, q)) continue;
      const point = intersectionOf(a, b, p, q);
      if (point !== undefined) into.push(point);
    }
  }
}

/** Degrees as the index holds them: `x = lng`, `y = lat`. */
function planar(position: LatLng): PlanarPoint {
  return { x: position.lng, y: position.lat };
}

/**
 * Where two segments known to intersect actually meet.
 *
 * `undefined` for the parallel/collinear case, which `segmentsIntersect` reports
 * as a touch: there is no single crossing point then, and inventing one (a
 * midpoint, say) would place the opening somewhere the passage does not run.
 * A way running exactly ALONG a wall is the shape that produces it.
 */
function intersectionOf(
  a: PlanarPoint,
  b: PlanarPoint,
  c: PlanarPoint,
  d: PlanarPoint,
): PlanarPoint | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;

  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  return { x: a.x + t * rx, y: a.y + t * ry };
}
