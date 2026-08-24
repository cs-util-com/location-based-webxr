/**
 * Barrier volumes — the drawn half of DEC-R11-2.
 *
 * Why these tests matter:
 * `mesh/barriers.ts` and `mesh/barrier-shape.ts` have been able to say how tall
 * a wall is and what ground it covers since #259, and `nav/obstacles.ts` has
 * been blocking agents with that answer ever since — **invisibly**. DEC-R7b-14
 * and DEC-R11-2 both require the walls to be DRAWN, on the explicit grounds
 * that an NPC pathing around geometry the viewer cannot see demonstrates
 * nothing. These tests are what make "drawn" a fact rather than an intention.
 *
 * The two invariants that are easy to get wrong and silent when wrong:
 *
 * - **The volume spans ground..ground+height, not 0..height.** A barrier that
 *   ignored terrain would be buried on a hillside and floating in a valley,
 *   which reads as a terrain bug in a different file.
 * - **Ground is sampled PER SEGMENT.** A curtain wall is hundreds of metres
 *   long; one sample for the whole way is exactly the artefact that tore
 *   Cologne Cathedral's spires off the model (`buildings.ts`, W5/R3-1), and a
 *   wall is longer than a cathedral is wide.
 *
 * @see barrier-volumes.ts.md
 */

import { describe, expect, it } from "vitest";

import { buildBarriers } from "./barrier-volumes.js";
import {
  DEFAULT_BARRIER_HEIGHT_M,
  DEFAULT_CITY_WALL_HEIGHT_M,
} from "./barriers.js";
import { enuFrameAt } from "./enu.js";
import type { LatLng, OsmWay } from "../model/osm-feature.js";

const HOME = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(HOME);

/** ~0.9 m of latitude. */
const STEP = 0.000008;

// Typed as OsmWay, not OsmFeature: the tests read `.geometry` off it, which the
// union does not expose — the same reason `obstacles.test.ts` gives, where the
// first draft reached it through an `as` cast instead.
const wall = (
  tags: Record<string, string> = {},
  geometry: LatLng[] = [
    { lat: HOME.lat, lng: HOME.lng },
    { lat: HOME.lat, lng: HOME.lng + STEP * 40 },
  ],
): OsmWay => ({
  type: "way",
  id: 1,
  geometry,
  tags: { barrier: "wall", ...tags },
});

/** Every Y coordinate in a mesh — Y is up, per `extrude.ts`'s `addWalls`. */
const heightsOf = (positions: Float32Array): number[] => {
  const out: number[] = [];
  for (let i = 1; i < positions.length; i += 3) out.push(positions[i]!);
  return out;
};

describe("buildBarriers", () => {
  it("extrudes a solid barrier into a volume with triangles", () => {
    const volumes = buildBarriers([wall()], { frame: FRAME });

    expect(volumes.length).toBe(1);
    expect(volumes[0]!.mesh.triangleCount).toBeGreaterThan(0);
  });

  it("ignores everything that is not a solid barrier", () => {
    // A gate is a HOLE in a wall (DEC-R11-4) — drawing it solid would seal the
    // one route the demo exists to show an agent taking.
    const volumes = buildBarriers(
      [
        wall({ barrier: "gate" }),
        { type: "way", id: 2, geometry: wall().geometry, tags: {} },
      ],
      { frame: FRAME },
    );

    expect(volumes).toEqual([]);
  });

  it("stands the volume on the default height when nothing is tagged", () => {
    const volumes = buildBarriers([wall()], { frame: FRAME });

    expect(Math.max(...heightsOf(volumes[0]!.mesh.positions))).toBeCloseTo(
      DEFAULT_BARRIER_HEIGHT_M,
      6,
    );
  });

  it("gives a city wall its own taller default", () => {
    // DEC-R11-4: a 2 m city wall is wrong in the exact case the feature exists
    // for, since the design's motivating example is an 8 m curtain wall.
    const volumes = buildBarriers([wall({ barrier: "city_wall" })], {
      frame: FRAME,
    });

    expect(Math.max(...heightsOf(volumes[0]!.mesh.positions))).toBeCloseTo(
      DEFAULT_CITY_WALL_HEIGHT_M,
      6,
    );
  });

  it("prefers a tagged height over any default", () => {
    const volumes = buildBarriers([wall({ height: "8" })], { frame: FRAME });

    expect(Math.max(...heightsOf(volumes[0]!.mesh.positions))).toBeCloseTo(
      8,
      6,
    );
  });

  it("sits the volume ON the terrain rather than at zero", () => {
    // The failure this catches is silent: a wall built at 0..2 on ground at
    // 100 m is not missing, it is under the hill, and it looks like the DEM is
    // wrong rather than the barrier.
    const volumes = buildBarriers([wall()], {
      frame: FRAME,
      groundHeightM: () => 100,
    });

    const heights = heightsOf(volumes[0]!.mesh.positions);
    expect(Math.min(...heights)).toBeCloseTo(100, 6);
    expect(Math.max(...heights)).toBeCloseTo(100 + DEFAULT_BARRIER_HEIGHT_M, 6);
  });

  it("samples the ground PER SEGMENT, so a long wall follows a slope", () => {
    // The whole reason this is not one sample per feature. A wall running up a
    // hill sampled once is buried at one end and floating at the other — the
    // artefact `buildings.ts` records as tearing the cathedral's spires off.
    const east = { lat: HOME.lat, lng: HOME.lng + STEP * 200 };
    const volumes = buildBarriers(
      [
        wall({}, [
          { lat: HOME.lat, lng: HOME.lng },
          { lat: HOME.lat, lng: HOME.lng + STEP * 100 },
          east,
        ]),
      ],
      {
        // A ramp in longitude: 0 m at HOME, rising eastward.
        frame: FRAME,
        groundHeightM: (p: LatLng) => (p.lng - HOME.lng) / STEP,
      },
    );

    const heights = heightsOf(volumes[0]!.mesh.positions);
    // The two segments straddle different parts of the ramp, so the bases
    // differ. One sample for the feature would make this range collapse.
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(
      DEFAULT_BARRIER_HEIGHT_M + 50,
    );
  });

  it("skips a way that cannot form a line", () => {
    // A one-node way is ordinary Overpass output, not a bug to throw on.
    const volumes = buildBarriers(
      [wall({}, [{ lat: HOME.lat, lng: HOME.lng }])],
      { frame: FRAME },
    );

    expect(volumes).toEqual([]);
  });

  it("carries the feature key, so a consumer can colour it by its tags", () => {
    // The demo looks the tags up by this key to colour the chunk (DEC-R11-11
    // draws barriers with the buildings, so they go through `buildingColour`
    // like everything else).
    const volumes = buildBarriers([wall()], { frame: FRAME });

    expect(volumes[0]!.feature).toBe("way/1");
  });

  it("reports the resolved height alongside the mesh", () => {
    // The same number `nav/obstacles.ts` indexes. If the drawn wall and the
    // indexed wall could disagree, the demo would show an agent detouring
    // around nothing, or walking through something.
    const volumes = buildBarriers([wall({ height: "8" })], { frame: FRAME });

    expect(volumes[0]!.heightM).toBe(8);
  });
});
