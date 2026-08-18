/**
 * The NPC on a hillside — the reported Cologne defect, end to end.
 *
 * Why this test matters:
 * Reported from a live session at
 * `/osm/?clat=50.94005&clng=6.96252&cdist=58&lat=50.94016&lng=6.96243` — the
 * Frankenwerft promenade, where the ground climbs from the Rhine into the
 * Altstadt — as "no route: the agent cannot reach that spot" for every
 * destination, while the `walkable` heat map rated the whole area highly.
 *
 * NOTHING WAS IN THE WAY. The refusal came from `columnsAdjacent`, whose 0.5 m
 * step threshold was calibrated against kerbs and walls but was being applied to
 * DEM samples at cell centres ~6.4–6.9 m apart — so any continuous ground
 * steeper than ~7.5 % was treated as a cliff.
 *
 * **Every other route test in this package is FLAT** (`field: undefined` yields
 * ground 0 everywhere), which is exactly why none of them could see it. This one
 * is the guard for that gap: a sloped ground field, a route that must exist, and
 * a cliff that must still refuse one.
 *
 * The gradients are the measured ones. Terrarium tile 13/4254/2744 over the
 * reported position gives 48.51 m at the agent falling to 41.2 m 30 m to the
 * north-east — a mean grade of ~24 %, with 0.81 m between adjacent res-13 cell
 * centres.
 *
 * @see ../../GpsPlusSlamJs_Osm/docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md
 */

import { describe, expect, it } from "vitest";
import { enuFrameAt, type LatLng } from "gps-plus-slam-osm";

import { planRoute } from "./agent-route.js";
import type { GroundSampler } from "./cell-ground.js";

/** The reported agent position. */
const AGENT: LatLng = { lat: 50.94016, lng: 6.96243 };

const FRAME = enuFrameAt(AGENT);

/** Metres per degree of latitude — the same spherical figure the demo uses. */
const M_PER_DEG_LAT = 111_320;

/** A destination `metres` from the agent, on the given bearing in degrees. */
function away(metres: number, bearingDeg: number): LatLng {
  const radians = (bearingDeg * Math.PI) / 180;
  const north = Math.cos(radians) * metres;
  const east = Math.sin(radians) * metres;
  return {
    lat: AGENT.lat + north / M_PER_DEG_LAT,
    lng:
      AGENT.lng +
      east / (M_PER_DEG_LAT * Math.cos((AGENT.lat * Math.PI) / 180)),
  };
}

/**
 * Ground that falls at a constant grade towards the north-east.
 *
 * A PLANE, not the real DEM: the defect is a function of the grade alone, and a
 * captured heightfield would make the test's subject harder to read while
 * pinning it to one tile's sampling. `x` is east and `y` is north in the frame's
 * ENU, so this is the measured fall line at the reported position.
 */
function slopeOf(grade: number): GroundSampler {
  return {
    heightAt: (point) => 48.51 - (grade * (point.x + point.y)) / Math.SQRT2,
  };
}

describe("routing over sloped ground", () => {
  it("walks down the grade that made the reported location unroutable", () => {
    // THE REGRESSION CASE. 24 % is the measured fall from the promenade towards
    // the Rhine: steep for a street, ordinary for a river bank, and about three
    // times what the absolute step rule allowed.
    const route = planRoute([], AGENT, away(30, 45), {
      frame: FRAME,
      field: slopeOf(0.24),
    });

    expect(route).toBeDefined();
    // AND IT ARRIVES, rather than stopping at the first refused step. A route
    // of one point would be `planRoute` reporting success for going nowhere.
    expect(route!.length).toBeGreaterThan(1);
  });

  it("walks up the same grade", () => {
    // Symmetric by construction (`columnsAdjacent` compares magnitudes), and
    // asserted because the reported session could route uphill and not down —
    // an asymmetry that would have been a different bug entirely.
    const route = planRoute([], AGENT, away(30, 225), {
      frame: FRAME,
      field: slopeOf(0.24),
    });

    expect(route).toBeDefined();
    expect(route!.length).toBeGreaterThan(1);
  });

  it("refuses a cliff", () => {
    // THE CONTROL, and without it every assertion above would also pass for a
    // planner that had simply stopped checking heights. 150 % is a rock face,
    // well past `MAX_GROUND_GRADIENT`.
    const route = planRoute([], AGENT, away(30, 45), {
      frame: FRAME,
      field: slopeOf(1.5),
    });

    expect(route).toBeUndefined();
  });

  it("still refuses a destination on flat ground behind a sealed wall", () => {
    // The other control: the slope allowance must not have leaked into the
    // geometry veto. A route refused for crossing a wall is still refused, and
    // `agent-route.test.ts` owns that case in full — this only checks that a
    // sloped world has not quietly disarmed it.
    const ring: LatLng[] = [];
    for (let i = 0; i <= 36; i++) {
      const angle = (i * 10 * Math.PI) / 180;
      ring.push({
        lat: AGENT.lat + (Math.cos(angle) * 15) / M_PER_DEG_LAT,
        lng:
          AGENT.lng +
          (Math.sin(angle) * 15) /
            (M_PER_DEG_LAT * Math.cos((AGENT.lat * Math.PI) / 180)),
      });
    }

    const route = planRoute(
      [
        {
          type: "way",
          id: 1,
          tags: { barrier: "wall" },
          geometry: ring,
        },
      ],
      AGENT,
      away(30, 45),
      { frame: FRAME, field: slopeOf(0.24) },
    );

    expect(route).toBeUndefined();
  });
});
