/**
 * Ground height per H3 cell — the one place the library's frame-free world
 * meets the demo's ENU one.
 *
 * `nav/obstacles.ts` takes the ground as an injected `(cell) => number` rather
 * than importing a heightfield, and that is not decoration: it is what keeps
 * `nav/` free of ENU (DEC-R11-8). The library holds lat/lng and H3 cells; the
 * demo's `heightAt` speaks ENU metres in a frame the demo owns and re-anchors on
 * a teleport. **This module is the whole boundary between them** — if a
 * re-anchor ever invalidates a coordinate, it invalidates it here and nowhere
 * else, which is a far smaller thing to reason about than an index that had
 * stored ENU throughout.
 *
 * @see cell-ground.ts.md
 */

import { cellToLatLng } from "h3-js";
import type { EnuFrame } from "gps-plus-slam-osm";

/** The part of a `Heightfield` this needs — a sampler, nothing more. */
export interface GroundSampler {
  heightAt(point: { x: number; y: number }): number;
}

/**
 * A `(cell) => metres` lookup for `obstacleLevelsAt`, in `frame`.
 *
 * **Sampled at the cell's CENTRE**, which is the position an agent in a cell is
 * taken to occupy everywhere else in the navigation code — `crossesObstacle`
 * draws its step segments between the same points, so the two cannot disagree
 * about where the agent is.
 *
 * `field` is `undefined` during a DEM outage. That yields flat zero rather than
 * a refusal: the demo already renders flat in that case, and refusing every cell
 * would leave the agent unable to move at all rather than able to move on flat
 * ground.
 *
 * **A non-finite sample passes straight through, uncoerced.**
 * `obstacleLevelsAt` turns it into "no levels in this cell", which is visibly
 * unreachable; substituting 0 would put the agent at sea level under a hillside
 * and read as a DEM bug rather than as a missing sample.
 */
export function groundHeightAtCell(
  frame: EnuFrame,
  field: GroundSampler | undefined,
): (cell: string) => number {
  if (field === undefined) return () => 0;

  return (cell: string): number => {
    const [lat, lng] = cellToLatLng(cell);
    return field.heightAt(frame.toEnu({ lat, lng }));
  };
}
