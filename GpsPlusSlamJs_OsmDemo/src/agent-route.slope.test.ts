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
 * **Every other route test in this package stands on ground of a CONSTANT
 * height** — mostly `field: undefined`, which `cell-ground.ts` turns into a flat
 * zero, and otherwise a sampler returning one number — so their `Δground` is
 * zero and none of them could see it. This one is the guard for that gap: a
 * sloped ground field, a route that must exist, and a cliff that must not.
 *
 * **THE PLANE IS INFINITE, WHICH SHAPES THE CONTROLS.** A contour step stays
 * legal at any grade, so on a cliff the frontier is an unbounded line rather
 * than empty and the search answers from its expansion cap. Every refusal here
 * therefore names its own `maxExpansions`, and the actual "too steep" claim is
 * asserted at the step predicate where it can be stated without ambiguity.
 *
 * The gradients are the measured ones. Terrarium tile 13/4254/2744 over the
 * reported position gives 48.51 m at the agent falling to 41.2 m 30 m to the
 * north-east — a mean grade of ~24 %, with 0.81 m between adjacent res-13 cell
 * centres.
 *
 * @see ../../GpsPlusSlamJs_Osm/docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md
 */

import { describe, expect, it } from "vitest";
import { gridDisk, latLngToCell } from "h3-js";
import {
  AFFORDANCE_RES,
  columnsAdjacent,
  enuFrameAt,
  neighbourSpacingM,
  type LatLng,
} from "gps-plus-slam-osm";

import { planRoute } from "./agent-route.js";
import type { GroundSampler } from "./cell-ground.js";

/** The reported agent position. */
const AGENT: LatLng = { lat: 50.94016, lng: 6.96243 };

const FRAME = enuFrameAt(AGENT);

/** The run a grade is measured over — the predicate's own figure, not a guess. */
const NEIGHBOUR_SPACING_M = neighbourSpacingM(AFFORDANCE_RES);

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
    //
    // ⚠️ `maxExpansions` IS PART OF THE ASSERTION, NOT A SPEED KNOB (PR review,
    // 2026-08-18). The first version of this test ran the default 20 000 and
    // passed for the wrong reason: on an infinite plane the contour direction
    // stays legal at ANY grade, so the frontier is an unbounded line rather than
    // empty, and `undefined` came back from the expansion cap — 481 ms of it —
    // saying nothing about whether the cliff was refused. A small cap makes the
    // claim honest: whatever the search did, it did not get down the slope. The
    // step-level assertion below is what actually pins the refusal.
    const route = planRoute([], AGENT, away(30, 45), {
      frame: FRAME,
      field: slopeOf(1.5),
      maxExpansions: 200,
    });

    expect(route).toBeUndefined();
  });

  it("refuses the individual step down a cliff, which is the real claim", () => {
    // THE ASSERTION THE ROUTE-LEVEL CONTROL CANNOT MAKE. A route returning
    // `undefined` merges "nowhere to go" with "gave up" by design
    // (`agent-route.ts`), so the only place "this ground is too steep" can be
    // stated without ambiguity is the step predicate itself.
    //
    // 150 % over the ~7.09 m between two res-13 centres is a 10.6 m drop
    // against a 3.54 m budget; the 24 % case above is 1.70 m and passes.
    const cliff = 1.5 * NEIGHBOUR_SPACING_M;
    const walkable = 0.24 * NEIGHBOUR_SPACING_M;
    const here = latLngToCell(AGENT.lat, AGENT.lng, AFFORDANCE_RES);
    const next = gridDisk(here, 1).filter((cell) => cell !== here)[0]!;

    const stepOf = (drop: number) =>
      columnsAdjacent(
        { cell: here, heightM: 48.51, groundM: 48.51 },
        { cell: next, heightM: 48.51 - drop, groundM: 48.51 - drop },
      );

    expect(stepOf(cliff)).toBe(false);
    expect(stepOf(walkable)).toBe(true);
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
      { frame: FRAME, field: slopeOf(0.24), maxExpansions: 2000 },
    );

    // The ring is 15 m across, so everything inside it is reachable in far
    // fewer than 2 000 expansions — the cap is a guard against this test
    // silently becoming cap-bound the way the cliff control had, not the
    // reason the route is refused.
    expect(route).toBeUndefined();
  });
});
