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
import { enuFrameAt, type OsmFeature } from "gps-plus-slam-osm";

import { planRoute } from "./agent-route.js";

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
    // Generous enough not to flake on a loaded CI box, tight enough that the
    // unbounded search this replaced (which ran past 5 s) cannot pass.
    expect(performance.now() - startedAt).toBeLessThan(2000);
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
