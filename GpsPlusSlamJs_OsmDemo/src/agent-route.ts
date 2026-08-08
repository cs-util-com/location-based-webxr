/**
 * The agent's route: pass A and pass B, joined.
 *
 * This is the first place the whole navigation chain runs end to end — the
 * obstacle index, the column model, the injected ground and the state search —
 * against a real feature set rather than a synthetic field. DEC-R11-3 fixes what
 * it is for: **the agent is ordered by click and the planned route is always
 * drawn**, because seeing the route go _around_ the wall is the proof, and a
 * polyline is a far better test artefact than watching a marker move.
 *
 * **The route is a list of positions, not of cells.** The caller draws it, and a
 * consumer that had to re-derive lat/lng from H3 indices would be re-deciding
 * `cellToLatLng` — the same "two computations that agree today with nothing
 * asserting they always will" shape this demo keeps finding.
 *
 * @see agent-route.ts.md
 */

import { cellToLatLng, latLngToCell } from "h3-js";
import {
  AFFORDANCE_RES,
  buildObstacleIndex,
  columnSpace,
  crossesObstacle,
  findStatePath,
  obstacleLevelsAt,
  type Column,
  type EnuFrame,
  type LatLng,
  type ObstacleIndex,
  type OsmFeature,
} from "gps-plus-slam-osm";

import { groundHeightAtCell, type GroundSampler } from "./cell-ground.js";

/** One point on a planned route, ready to draw. */
export interface RoutePoint {
  readonly position: LatLng;
  /** Metres above the frame's ground plane — the level the agent walks at. */
  readonly heightM: number;
}

/**
 * Expansions a single click may cost, before the route is called impossible.
 *
 * **A ROUTE IS A UI INTERACTION, SO IT IS BOUNDED WORK OR IT IS A FREEZE**, and
 * the library's `DEFAULT_MAX_EXPANSIONS` of 100 000 is sized for a scored
 * working set rather than for a click. The difference shows on the case that
 * matters most: a destination the agent cannot reach — inside a sealed
 * courtyard, across a closed ring — makes the search exhaust **everything
 * reachable** before it can answer, because "no route" is only knowable once
 * the frontier is empty. That is the common failure, not the rare one: it is
 * what every mis-click on the far side of a wall does.
 *
 * Found by a test timing out at 5 s under suite load. The test was NOT the
 * problem — it was reporting a real freeze on the demo's own click path.
 *
 * 20 000 is generous for the interaction it bounds: a res-13 cell is ~44 m², so
 * this covers roughly a 500 m radius of open ground at two standable levels per
 * cell, well beyond any route a user would order in a 2.4 km scene.
 */
const DEFAULT_ROUTE_EXPANSIONS = 20_000;

export interface RouteOptions {
  readonly frame: EnuFrame;
  readonly field: GroundSampler | undefined;
  /**
   * Expansion cap for the search; defaults to
   * {@link DEFAULT_ROUTE_EXPANSIONS}.
   *
   * `findStatePath` throws rather than returning `undefined` when the cap is
   * reached, precisely so a caller cannot mistake "gave up" for "no route
   * exists" — `planRoute` turns that throw into `undefined` at this boundary,
   * because a UI has nothing useful to do with the distinction and every reason
   * not to crash on a long click.
   */
  readonly maxExpansions?: number;
}

/**
 * A walkable route between two positions, or `undefined` when there is none.
 *
 * `undefined` covers both "no route exists" and "the search hit its cap": a
 * click on the far side of a sealed courtyard and a click 3 km away look the
 * same to the user, and both mean "the agent is not going there".
 */
export function planRoute(
  features: readonly OsmFeature[],
  from: LatLng,
  to: LatLng,
  options: RouteOptions,
): RoutePoint[] | undefined {
  const index = buildObstacleIndex(features);
  return planRouteWithIndex(index, from, to, options);
}

/**
 * The same route, over an index the caller already built.
 *
 * **Split out because the index is the expensive part.** `buildObstacleIndex`
 * runs `coverCells` at res-13 over every barrier and every building in the
 * working set; rebuilding it on each click would put that cost on an
 * interaction rather than on a publish, so the caller should keep one index per
 * published feature set.
 *
 * **Exported since stage 4 landed its caller.** That caller is the worker's
 * `planRoute` handler, which holds one index per feature set
 * (`worker/obstacle-index-cache.ts`) and answers many clicks from it. It is the
 * only production caller; `planRoute` above remains the one-shot form the unit
 * tests drive.
 */
export function planRouteWithIndex(
  index: ObstacleIndex,
  from: LatLng,
  to: LatLng,
  options: RouteOptions,
): RoutePoint[] | undefined {
  const groundAt = groundHeightAtCell(options.frame, options.field);
  const startCell = latLngToCell(from.lat, from.lng, AFFORDANCE_RES);
  const goalCell = latLngToCell(to.lat, to.lng, AFFORDANCE_RES);

  const levelsAt = (cell: string) => obstacleLevelsAt(index, cell, groundAt);

  const startLevels = levelsAt(startCell);
  if (startLevels.length === 0) return undefined;

  const space = columnSpace({
    levelsAt,
    // THE PIECE THAT MAKES THE ROUTE GO AROUND. Without it the search is free to
    // step through a wall, and the demo would show an agent walking through the
    // geometry it is standing next to.
    canCross: (fromCell, toCell) => !crossesObstacle(index, fromCell, toCell),
  });

  // THE LOWEST STANDABLE LEVEL, which is the ground the agent is standing on.
  // Starting from the highest would put it on a wall top it cannot have climbed
  // to (DEC-R11-10: there is no ingress this round).
  const start: Column = { cell: startCell, heightM: startLevels[0]! };

  let path: Column[] | undefined;
  try {
    path = findStatePath(start, (state) => state.cell === goalCell, space, {
      maxExpansions: options.maxExpansions ?? DEFAULT_ROUTE_EXPANSIONS,
    });
  } catch {
    // The cap. See `RouteOptions.maxExpansions` — a UI has nothing to do with
    // the difference between "gave up" and "nowhere to go".
    return undefined;
  }
  if (path === undefined) return undefined;

  return path.map((state) => {
    const [lat, lng] = cellToLatLng(state.cell);
    return { position: { lat, lng }, heightM: state.heightM };
  });
}
