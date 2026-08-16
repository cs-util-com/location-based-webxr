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
  findCheapestPath,
  obstacleLevelsAt,
  type Column,
  type EnuFrame,
  type LatLng,
  type ObstacleIndex,
  type OsmFeature,
} from "gps-plus-slam-osm";

import { groundHeightAtCell, type GroundSampler } from "./cell-ground.js";
import { pathFactor, penaltyFor } from "./route-penalty.js";

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
   * `findCheapestPath` throws rather than returning `undefined` when the cap is
   * reached, precisely so a caller cannot mistake "gave up" for "no route
   * exists" — `planRoute` turns that throw into `undefined` at this boundary,
   * because a UI has nothing useful to do with the distinction and every reason
   * not to crash on a long click.
   */
  readonly maxExpansions?: number;
  /**
   * The walkable score of one cell, or `undefined` where nothing is known
   * (DEC-R13-1).
   *
   * INJECTED RATHER THAN LOOKED UP, because the scores live in the pipeline
   * inside the worker and this module must stay constructible from a feature
   * list alone. The worker's `planRoute` handler already holds that pipeline —
   * it is the same one the `explain` handler reads scores from — so **no new
   * payload crosses the worker boundary**.
   *
   * Omitted means every cell prices as neutral ground, which is a uniform
   * multiplier and therefore leaves the route exactly where plain distance puts
   * it. That is the honest default for a caller that has no scores, and it is
   * what the unit fixtures use.
   */
  readonly scoreFor?: (cell: string) => number | undefined;

  /**
   * Whether a cell carries a pedestrian way — the path-ness half of "prefer
   * paths" (DEC-R2).
   *
   * **Separate from `scoreFor` because they answer different questions.** The
   * `walkable` score rates GROUND QUALITY, where `surface=grass` outranking
   * `highway=footway` is correct; path-ness is a property of the way. Asking one
   * number to carry both is what made the preference track how thoroughly a
   * place is mapped rather than whether a cell is a path.
   *
   * It also sees what the score cannot: scoring is multiplicative with zero
   * absorbing, so a footbridge sharing a cell with a river scores exactly 0 and
   * is indistinguishable from open water — while the provenance map still
   * records the footway.
   *
   * Omitted, or `undefined` for a cell, prices as off-path. Uniformly unknown is
   * a uniform multiplier and therefore leaves the route where plain distance
   * puts it — the same honest default `scoreFor` has.
   */
  readonly onPathAt?: (cell: string) => boolean | undefined;
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

  const metresBetweenCells = cellMetres(options.frame);
  // MEMOISED PER ROUTE, exactly like `cellMetres` and for the same reason: this
  // is consulted once per expanded cell on a path the search walks up to
  // `maxExpansions` times, and the lookup behind it walks a provenance map and
  // then a feature map per call.
  const onPathAt = memoisePathness(options.onPathAt);
  const goalAt = (cell: string) => metresBetweenCells(cell, goalCell);

  let path: Column[] | undefined;
  try {
    path = findCheapestPath(start, (state) => state.cell === goalCell, space, {
      maxExpansions: options.maxExpansions ?? DEFAULT_ROUTE_EXPANSIONS,
      // THE METRES ARE WHAT FIXES THE ZIGZAG (R13-2), and they do it without any
      // score at all: every `gridDisk` neighbour used to cost 1 whatever
      // direction it lay in, so a straight run and a staircase of the same step
      // count were indistinguishable. The penalty is what fixes the other half.
      // TWO MULTIPLIERS, NOT ONE (DEC-R2). The score rates the GROUND and the
      // path factor rates the WAY, and neither answers the other's question.
      // Both are >= 1, which is what keeps the unpenalised heuristic below a
      // lower bound — see the note on it directly beneath.
      cost: (leaving, entering) =>
        metresBetweenCells(leaving.cell, entering.cell) *
        penaltyFor(options.scoreFor?.(entering.cell)) *
        pathFactor(onPathAt(entering.cell)),
      // STRAIGHT-LINE DISTANCE, UNPENALISED, which is what keeps it a lower
      // bound: `penaltyFor` never returns less than 1, so no route can be
      // cheaper than its own metres. See `search.ts` on why consistency rather
      // than mere admissibility is the contract.
      heuristic: (state) => goalAt(state.cell),
    });
  } catch (failure) {
    // THE CAP, AND ONLY THE CAP. See `RouteOptions.maxExpansions` — a UI has
    // nothing to do with the difference between "gave up" and "nowhere to go".
    //
    // A BARE `catch` HERE COST REAL TIME during stage 1: with the library not
    // yet rebuilt, `findCheapestPath` was `undefined`, the call threw a
    // `TypeError`, and this boundary reported it as "no route" — so every route
    // test failed with the one message that says nothing about why. The search
    // documents `RangeError` as its only throw, so anything else is a fault in
    // this file or its inputs and must stay loud.
    if (!(failure instanceof RangeError)) throw failure;
    return undefined;
  }
  if (path === undefined) return undefined;

  return path.map((state) => {
    const [lat, lng] = cellToLatLng(state.cell);
    return { position: { lat, lng }, heightM: state.heightM };
  });
}

/**
 * Horizontal metres between two cell centres, through `frame`, memoised.
 *
 * MEMOISED BECAUSE A\* ASKS REPEATEDLY. Every expansion prices up to six
 * neighbours and evaluates one heuristic, and each of those would otherwise pay
 * a `cellToLatLng` — a search that expands thousands of states would do the H3
 * conversion tens of thousands of times for a few hundred distinct cells. The
 * cache lives for one route, so it cannot go stale against a re-anchor.
 *
 * HORIZONTAL ONLY, deliberately: climb is not charged. Including it would make
 * the agent avoid stairs and slopes, which is a behaviour nobody asked for and
 * which DEC-R13-1 does not describe. The drawn polyline still measures its own
 * length with the climb included (`route-path.ts`), because that is a different
 * question — how far the agent walks, not what the planner was minimising.
 */
function cellMetres(frame: EnuFrame): (a: string, b: string) => number {
  const centres = new Map<string, { x: number; y: number }>();
  const centreOf = (cell: string) => {
    let at = centres.get(cell);
    if (at === undefined) {
      const [lat, lng] = cellToLatLng(cell);
      at = frame.toEnu({ lat, lng });
      centres.set(cell, at);
    }
    return at;
  };
  return (a, b) => {
    const from = centreOf(a);
    const to = centreOf(b);
    return Math.hypot(to.x - from.x, to.y - from.y);
  };
}

/**
 * Caches a path-ness lookup for the life of one route.
 *
 * **`cache.has` rather than `cache.get(...) !== undefined`**, because
 * `undefined` — "nothing is known about this cell" — is a legitimate answer and
 * the commonest one outside the scored disk. Testing the value would re-run the
 * lookup for every unknown cell, which is precisely the population that makes
 * the memo worth having.
 */
function memoisePathness(
  lookup: ((cell: string) => boolean | undefined) | undefined,
): (cell: string) => boolean | undefined {
  if (lookup === undefined) return () => undefined;
  const cache = new Map<string, boolean | undefined>();
  return (cell) => {
    if (cache.has(cell)) return cache.get(cell);
    const answer = lookup(cell);
    cache.set(cell, answer);
    return answer;
  };
}
