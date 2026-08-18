/**
 * The agent's route — the first end-to-end run of the navigation chain.
 *
 * Why these tests matter:
 * Every piece below this has been unit-tested in isolation, and the design's own
 * verification note warns about exactly that: **"a synthetic field fixture that
 * makes the thing under test constant"**. A wall test where the path would route
 * to the gate anyway proves nothing. So the fixture here is built to fail if the
 * blocking is removed — the direct line is short and clear, and the only way
 * around is a detour that the assertions measure.
 *
 * The headline case is the design's own: a wall between the agent and its
 * destination, with a gap at one end. The route must **go around**, and the
 * proof is that it is longer than the straight line and never crosses the wall.
 *
 * @see agent-route.ts.md
 */

import { describe, expect, it } from "vitest";
import { cellToLatLng } from "h3-js";
import { enuFrameAt, type OsmFeature } from "gps-plus-slam-osm";

import { planRoute } from "./agent-route.js";
import { NEUTRAL_SCORE, PATH_SCORE } from "./route-penalty.js";

const HOME = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(HOME);
/** ~0.9 m of latitude. */
const STEP = 0.000008;

const flat = { frame: FRAME, field: undefined };

/**
 * A north-south wall at HOME's longitude, running from well south of the route
 * to a northern end — so there IS a way round, at the top.
 */
const wallWithGapAtTheNorth = (northEnd: number): OsmFeature => ({
  type: "way",
  id: 100,
  geometry: [
    { lat: HOME.lat - STEP * 200, lng: HOME.lng },
    { lat: northEnd, lng: HOME.lng },
  ],
  tags: { barrier: "wall" },
});

/** Metres between two lat/lng points, through the shared ENU frame. */
function metresBetween(a: { lat: number; lng: number }, b: typeof a): number {
  const p = FRAME.toEnu(a);
  const q = FRAME.toEnu(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function lengthOf(route: { position: { lat: number; lng: number } }[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += metresBetween(route[i - 1]!.position, route[i]!.position);
  }
  return total;
}

describe("planRoute", () => {
  const west = { lat: HOME.lat, lng: HOME.lng - STEP * 30 };
  const east = { lat: HOME.lat, lng: HOME.lng + STEP * 30 };

  it("walks the straight line when nothing is in the way", () => {
    // THE CONTROL. Without it the wall test below cannot tell "routed around the
    // wall" from "routes the long way round everywhere", which is the exact
    // fixture trap the plan's §4 names.
    const route = planRoute([], west, east, flat);

    expect(route).toBeDefined();
    const direct = metresBetween(west, east);
    // A hex grid cannot draw a perfectly straight line; 1.5x is loose enough for
    // the quantisation and far tighter than any detour around a 180 m wall.
    expect(lengthOf(route!)).toBeLessThan(direct * 1.5);
  });

  it("goes AROUND a wall rather than through it", () => {
    // The design's motivating case, and the whole reason the feature exists.
    const route = planRoute(
      [wallWithGapAtTheNorth(HOME.lat + STEP * 60)],
      west,
      east,
      flat,
    );

    expect(route).toBeDefined();
    // It must detour: the wall stands directly between the two points, and the
    // only gap is ~54 m north. A route as short as the direct line would mean
    // the agent walked through the wall.
    expect(lengthOf(route!)).toBeGreaterThan(metresBetween(west, east) * 1.5);
  });

  it("routes north of the wall's end, which is where the gap is", () => {
    // Stronger than "it is longer": a longer route that wandered south would
    // also pass the length assertion while proving nothing about the gap.
    const northEnd = HOME.lat + STEP * 60;
    const route = planRoute(
      [wallWithGapAtTheNorth(northEnd)],
      west,
      east,
      flat,
    );

    expect(route).toBeDefined();
    const northernmost = Math.max(...route!.map((p) => p.position.lat));
    expect(northernmost).toBeGreaterThan(northEnd - STEP * 12);
  });

  it("returns undefined when the destination is sealed off, and quickly", () => {
    // A closed ring around the goal. `undefined` is the honest answer, and the
    // caller draws nothing — as opposed to a partial route that stops at the
    // wall, which would look like the agent gave up halfway.
    //
    // **THIS TEST FOUND A REAL FREEZE.** It timed out at 5 s under suite load,
    // because "no route" is only knowable once the frontier is empty — so an
    // unreachable destination made the search exhaust everything reachable
    // first, on the demo's own click path. `DEFAULT_ROUTE_EXPANSIONS` bounds it.
    // The elapsed assertion is what keeps that fixed rather than incidentally
    // fast.
    const startedAt = performance.now();
    const ring: OsmFeature = {
      type: "way",
      id: 101,
      geometry: [
        { lat: east.lat - STEP * 20, lng: east.lng - STEP * 20 },
        { lat: east.lat - STEP * 20, lng: east.lng + STEP * 20 },
        { lat: east.lat + STEP * 20, lng: east.lng + STEP * 20 },
        { lat: east.lat + STEP * 20, lng: east.lng - STEP * 20 },
        { lat: east.lat - STEP * 20, lng: east.lng - STEP * 20 },
      ],
      tags: { barrier: "wall" },
    };

    expect(planRoute([ring], west, east, flat)).toBeUndefined();
    // Generous enough not to flake on a loaded box, tight enough that the
    // unbounded search this replaced (which ran past 5 s) cannot pass.
    //
    // RAISED FROM 2 000 ms IN ROUND 13, AND THE COST IS MEASURED RATHER THAN
    // ASSUMED. A\* is intrinsically dearer than the BFS it replaced on THIS
    // case — the one where no route exists, so the whole reachable set is
    // expanded and the heuristic has nothing to prune. Profiled on this exact
    // fixture: the search alone goes 526 ms → 671 ms (+28 %), because
    // `canCross` runs 20 531 → 31 254 times; a weighted search must ask per
    // improving offer, where breadth-first could ask once per discovered state.
    //
    // The old budget was already within noise of the total (index build
    // included), so the extra 150 ms tipped it into failing about one run in
    // three — in ISOLATION, not only under suite load. 3 000 ms restores the
    // margin without weakening what the assertion discriminates: the regression
    // it exists to catch ran past 5 s with a far smaller working set.
    expect(performance.now() - startedAt).toBeLessThan(3000);
  });

  it("returns undefined rather than throwing when the search hits its cap", () => {
    // `findStatePath` throws on the cap so a caller cannot mistake "gave up"
    // for "no route". A UI has nothing to do with that distinction and every
    // reason not to crash on a long click, so the boundary absorbs it here.
    const far = { lat: HOME.lat + 0.05, lng: HOME.lng + 0.05 };
    expect(
      planRoute([], west, far, { ...flat, maxExpansions: 20 }),
    ).toBeUndefined();
  });

  it("reports the height it walks at, so the polyline sits on the ground", () => {
    // A route drawn at zero would sink into any hillside. The heights come from
    // the injected sampler, which is the whole point of the injection.
    const route = planRoute([], west, east, {
      ...flat,
      field: { heightAt: () => 42 },
    });

    expect(route).toBeDefined();
    for (const point of route!) expect(point.heightM).toBe(42);
  });

  it("returns undefined when the ground under the agent is unknown", () => {
    // A NaN from a missed DEM lookup makes the start cell unstandable. Better
    // to plan nothing than to plan from a position that does not exist.
    expect(
      planRoute([], west, east, { ...flat, field: { heightAt: () => NaN } }),
    ).toBeUndefined();
  });
});

/**
 * Stage 1 of round 13: the route is cheapest in METRES with a score penalty,
 * not shortest in STEPS (DEC-R13-1, DEC-R13-11 … DEC-R13-13).
 *
 * Why these tests matter:
 * The ninth session reported two things — "he does not take the shortest way"
 * and "he does not prefer the paths" — and both came from the same line: the
 * search was breadth-first, so every `gridDisk` neighbour cost 1 whatever
 * direction it lay in. A staircase and a straight run tie, and the winner is
 * decided by sort order. These tests pin the two halves separately, because a
 * cost model can fix either one alone and look half-right on screen.
 */
describe("planRoute, weighted by the walkable score", () => {
  const west = { lat: HOME.lat, lng: HOME.lng - STEP * 30 };
  const east = { lat: HOME.lat, lng: HOME.lng + STEP * 30 };

  /**
   * THE ZIGZAG HALF (R13-2), and it needs no scores at all. On open ground with
   * one uniform penalty the cheapest route in metres IS the straight line, where
   * breadth-first returned whichever staircase its expansion order reached
   * first.
   *
   * MEASURED BETWEEN THE ROUTE'S OWN ENDPOINTS, not between the requested
   * points: the route starts and ends at cell CENTRES, and folding that
   * quantisation into the ratio would loosen the bound by several metres of
   * nothing to do with the search.
   *
   * THE BOUND IS THE LATTICE'S OWN FLOOR, which is what makes this an assertion
   * rather than a sighting. A hex grid has no due-east neighbour, so travelling
   * east means alternating between two axes 60° apart, and even a perfect
   * straight line costs `1 / cos(30°) = 1.155` in path length. 1.17 leaves room
   * for one cell of rounding and nothing else — a route with a genuine detour in
   * it cannot pass.
   */
  it("walks a near-straight line on open ground, where BFS returned a staircase", () => {
    const route = planRoute([], west, east, flat);

    expect(route).toBeDefined();
    const spanned = metresBetween(
      route![0]!.position,
      route![route!.length - 1]!.position,
    );
    expect(lengthOf(route!)).toBeLessThan(spanned * 1.17);
  });

  /**
   * THE PATH-PREFERENCE HALF (R13-1). A lane of high-scoring cells runs north
   * of the direct line; the agent should bulge onto it. Scores are supplied
   * through the injected `scoreFor`, which is exactly how the worker supplies
   * them from `DemoPipeline` — no new payload crosses the boundary.
   */
  it("detours onto a lane of high-scoring cells", () => {
    const laneLat = HOME.lat + STEP * 8;
    const scoreFor = (cell: string): number | undefined => {
      const [lat] = cellToLatLng(cell);
      return Math.abs(lat - laneLat) < STEP * 3 ? PATH_SCORE : NEUTRAL_SCORE;
    };

    const plain = planRoute([], west, east, flat)!;
    const onLane = planRoute([], west, east, { ...flat, scoreFor })!;

    const northOf = (route: typeof plain) =>
      Math.max(...route.map((point) => point.position.lat));
    expect(northOf(onLane)).toBeGreaterThan(northOf(plain));
    // AND IT ACTUALLY REACHED THE LANE, rather than merely leaning north — a
    // one-cell lean would satisfy the comparison above while proving nothing.
    expect(northOf(onLane)).toBeGreaterThan(laneLat - STEP * 3);
  });

  /**
   * THE OTHER DIRECTION OF THE SAME TRADE-OFF, and the pair is what pins the
   * tunable rather than one side of it. The same lane placed far enough away
   * costs more to reach than it saves, so the agent ignores it — an NPC that
   * chases any path at any distance is as wrong as one that ignores them.
   */
  it("ignores a lane whose detour costs more than it saves", () => {
    const laneLat = HOME.lat + STEP * 400;
    const scoreFor = (cell: string): number | undefined => {
      const [lat] = cellToLatLng(cell);
      return Math.abs(lat - laneLat) < STEP * 3 ? PATH_SCORE : NEUTRAL_SCORE;
    };

    const route = planRoute([], west, east, { ...flat, scoreFor })!;
    const northernmost = Math.max(...route.map((point) => point.position.lat));
    expect(northernmost).toBeLessThan(laneLat - STEP * 100);
  });

  /**
   * DEC-R13-12, AS A ROUTE RATHER THAN AS A NUMBER. `route-penalty.test.ts`
   * pins that an unscored cell prices as neutral; this pins what that buys — the
   * planner does not treat the edge of the scored disk as an escape hatch. With
   * "unscored costs 1" the route would leave the scored band immediately,
   * because every scored cell here is ordinary ground and would cost strictly
   * more than the unknown.
   */
  it("does not route around the scored area to reach cheaper unknown ground", () => {
    const bandLat = HOME.lat;
    const scoreFor = (cell: string): number | undefined => {
      const [lat] = cellToLatLng(cell);
      // A band of ORDINARY scored ground along the direct line, unknown outside.
      return Math.abs(lat - bandLat) < STEP * 10 ? NEUTRAL_SCORE : undefined;
    };

    const route = planRoute([], west, east, { ...flat, scoreFor })!;
    const strayed = Math.max(
      ...route.map((point) => Math.abs(point.position.lat - bandLat)),
    );
    expect(strayed).toBeLessThan(STEP * 10);
  });

  /**
   * THE INVARIANT STAGE 1 MUST NOT BREAK. Barrier avoidance is what the session
   * praised by name, and the cost model is a new reason for the search to prefer
   * a cell — never a new reason to enter one. A tempting score on the far side
   * of a wall must change nothing.
   */
  it("still goes around a wall, however good the score on the other side", () => {
    const route = planRoute(
      [wallWithGapAtTheNorth(HOME.lat + STEP * 60)],
      west,
      east,
      { ...flat, scoreFor: () => PATH_SCORE },
    );

    expect(route).toBeDefined();
    expect(lengthOf(route!)).toBeGreaterThan(metresBetween(west, east) * 1.5);
  });

  /**
   * THE EXPANSION CAP AT THE SHIPPED PENALTY, and it is a real risk rather than
   * a formality. The heuristic is unpenalised metres while edges cost
   * metres × penalty, so the stronger the penalty the looser the guidance and
   * the closer A\* runs to Dijkstra — and hitting `DEFAULT_ROUTE_EXPANSIONS`
   * surfaces as `undefined`, which the UI presents as "there is no route". A
   * too-strong tuning value would ship as an NPC that silently refuses long
   * clicks, so raising `PATH_PREFERENCE` means re-running this.
   */
  it("plans a long route inside the default expansion cap", () => {
    const far = { lat: HOME.lat + STEP * 300, lng: HOME.lng + STEP * 300 };
    const route = planRoute([], west, far, {
      ...flat,
      scoreFor: (cell) => (cellToLatLng(cell)[0] > HOME.lat ? 900 : 0.2),
    });

    expect(route).toBeDefined();
  });
});

/**
 * Why these tests matter: DEC-R2 splits the two questions the `walkable` score
 * was being asked at once. This is the OUTCOME half — that the planner's route
 * actually moves onto a path — as opposed to `route-penalty.test.ts`, which pins
 * the arithmetic. Both are needed: a correct multiplier wired to nothing would
 * pass that file and change no route.
 */
describe("path-ness steers the route (DEC-R2)", () => {
  const west = { lat: HOME.lat, lng: HOME.lng - STEP * 30 };
  const east = { lat: HOME.lat, lng: HOME.lng + STEP * 30 };

  /** A corridor of on-path cells, offset north of the straight line. */
  const corridorNorthOf = (lat: number) => (cell: string) =>
    cellToLatLng(cell)[0] > lat;

  it("detours onto a path rather than taking the shorter neutral line", () => {
    const straight = planRoute([], west, east, flat);
    const viaPath = planRoute([], west, east, {
      ...flat,
      onPathAt: corridorNorthOf(HOME.lat + STEP * 2),
    });

    expect(straight).toBeDefined();
    expect(viaPath).toBeDefined();

    const northOf = (route: NonNullable<typeof straight>) =>
      route.filter((p) => p.position.lat > HOME.lat + STEP * 2).length /
      route.length;

    // The path corridor pulls the route north; without it there is no reason to
    // leave the straight line. Asserted as a SHARE of the route rather than as
    // exact cells, because the hex lattice decides the staircase and this test
    // is about the pull, not about the tiling.
    expect(northOf(viaPath!)).toBeGreaterThan(northOf(straight!));
  });

  it("does NOT detour when the path is too far to be worth it", () => {
    // The other half of "stay on paths unless it is a big detour". A corridor
    // far off the line costs more in distance than NON_PATH_PENALTY saves, so
    // the planner should ignore it — otherwise the NPC chases every distant
    // pavement, which reads as broken rather than as natural.
    const viaFarPath = planRoute([], west, east, {
      ...flat,
      onPathAt: corridorNorthOf(HOME.lat + STEP * 400),
    });

    expect(viaFarPath).toBeDefined();
    for (const point of viaFarPath!) {
      expect(point.position.lat).toBeLessThan(HOME.lat + STEP * 400);
    }
  });

  it("leaves the route unchanged when nothing is known about path-ness", () => {
    // Uniformly unknown is a uniform multiplier, so it cannot change which route
    // is cheapest — the same honest default `scoreFor` has.
    const withoutSignal = planRoute([], west, east, flat);
    const allUnknown = planRoute([], west, east, {
      ...flat,
      onPathAt: () => undefined,
    });

    expect(allUnknown).toEqual(withoutSignal);
  });
});
