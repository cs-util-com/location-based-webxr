import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import type { MeshData } from "./mesh-data.js";
import {
  ZEBRA_PARAMS,
  buildRoadMarkings,
  isZebraTags,
  zebraCrossings,
  type ZebraStripe,
} from "./road-markings.js";
import { ROAD_RANK_STEP_M, roadMarkingLiftM } from "./roads.js";

/**
 * WHY THESE TESTS MATTER. Zebra stripes are drawn from what the map says
 * about a crossing and nothing else, so every rule here decides whether paint
 * appears where a person crosses or somewhere it never was: the tag
 * vocabulary (a `crossing=unmarked` drawn white is a lie a walker can check),
 * the stripes lying inside their crossing, a crossing mapped twice (a way and
 * its node) drawn once, a node on no road skipped rather than turned a guessed
 * way, and the height that keeps the paint over every road class and under
 * the next rung of OsmDemo's ground ladder.
 */
const FRAME = enuFrameAt({ lat: 49.41, lng: 8.69 });
const at = (x: number, y: number): { lat: number; lng: number } =>
  FRAME.toLatLng({ x, y });

let nextId = 1;
function way(
  tags: Record<string, string>,
  points: readonly [number, number][],
  id = nextId++,
): OsmFeature {
  return {
    type: "way",
    id,
    tags,
    geometry: points.map(([x, y]) => at(x, y)),
  } as unknown as OsmFeature;
}
function node(
  tags: Record<string, string>,
  x: number,
  y: number,
  id = nextId++,
): OsmFeature {
  return { type: "node", id, position: at(x, y), tags };
}

const ZEBRA_WAY = { highway: "footway", footway: "crossing" };
const stripesOf = (features: OsmFeature[]): ZebraStripe[] =>
  zebraCrossings(features, FRAME).flatMap((c) => c.stripes);

describe("isZebraTags (the vocabulary)", () => {
  it.each([
    [{ "crossing:markings": "zebra" }],
    [{ "crossing:markings": "ladder" }],
    [{ "crossing:markings": "zebra:double" }],
    [{ "crossing:markings": "ladder:skewed" }],
    [{ crossing: "zebra" }],
    [{ crossing_ref: "zebra" }],
  ])("paints %j", (tags) => {
    expect(isZebraTags(tags)).toBe(true);
  });

  it.each([
    [{ crossing: "uncontrolled" }],
    [{ crossing: "unmarked" }],
    [{ crossing: "traffic_signals", "crossing:markings": "lines" }],
    [{ "crossing:markings": "yes" }],
    [{ "crossing:markings": "no" }],
    [{ "crossing:markings": "surface" }],
    [{}],
    [undefined],
  ])("does not paint %j", (tags) => {
    // `yes` says there is paint but not which: guessing zebra there would
    // draw stripes over what may be two plain lines.
    expect(isZebraTags(tags)).toBe(false);
  });
});

describe("stripes along a crossing way", () => {
  it("lays one stripe a pitch, centred, across the walking direction", () => {
    const stripes = stripesOf([
      way({ ...ZEBRA_WAY, "crossing:markings": "zebra" }, [
        [0, 0],
        [0, 6],
      ]),
    ]);
    expect(stripes).toHaveLength(6);
    stripes.forEach((s, i) => {
      expect(s.cx).toBeCloseTo(0, 6);
      expect(s.cy).toBeCloseTo(0.5 + i, 6);
      // Walking north: the stripe's long axis runs east-west.
      expect(Math.abs(s.ux)).toBeCloseTo(1, 6);
      expect(s.lengthM).toBe(ZEBRA_PARAMS.lengthM);
      expect(s.widthM).toBe(ZEBRA_PARAMS.barM);
    });
  });

  it("takes the crossing's mapped width as the stripe length", () => {
    const stripes = stripesOf([
      way({ ...ZEBRA_WAY, crossing: "zebra", width: "4.5 m" }, [
        [0, 0],
        [7, 0],
      ]),
    ]);
    expect(stripes).toHaveLength(7);
    for (const s of stripes) expect(s.lengthM).toBe(4.5);
  });

  it("draws nothing on a crossing shorter than one pitch", () => {
    expect(
      stripesOf([
        way({ ...ZEBRA_WAY, crossing: "zebra" }, [
          [0, 0],
          [0.8, 0],
        ]),
      ]),
    ).toEqual([]);
  });

  it("draws nothing on an unmarked crossing or a tunnel", () => {
    expect(
      stripesOf([
        way({ ...ZEBRA_WAY, crossing: "unmarked" }, [
          [0, 0],
          [0, 6],
        ]),
        way({ ...ZEBRA_WAY, crossing: "zebra", tunnel: "yes" }, [
          [5, 0],
          [5, 6],
        ]),
      ]),
    ).toEqual([]);
  });

  it("never stripes a carriageway along its length, whatever it is tagged", () => {
    // A `crossing=zebra` on a residential street is a mis-tag on the street,
    // not a 200 m zebra: only a path (rank 0) is walked across a road.
    expect(
      stripesOf([
        way({ highway: "residential", crossing: "zebra" }, [
          [0, 0],
          [0, 40],
        ]),
      ]),
    ).toEqual([]);
  });
});

describe("a lone zebra node", () => {
  const street = (): OsmFeature =>
    way({ highway: "residential" }, [
      [-20, 0],
      [0, 0],
      [20, 0],
    ]);

  it("lays stripes across the road it sits on, the road's width long", () => {
    // A residential street is 2 lanes of 3 m: six stripes, each 3 m along it.
    const stripes = stripesOf([street(), node({ crossing: "zebra" }, 0, 0)]);
    expect(stripes).toHaveLength(6);
    for (const s of stripes) {
      expect(Math.abs(s.ux)).toBeCloseTo(1, 6);
      expect(s.cx).toBeCloseTo(0, 6);
      expect(Math.abs(s.cy)).toBeLessThan(3);
      expect(s.lengthM).toBe(ZEBRA_PARAMS.lengthM);
    }
  });

  it("is skipped when no car road passes through it", () => {
    expect(stripesOf([node({ crossing: "zebra" }, 0, 0)])).toEqual([]);
    expect(
      stripesOf([
        way({ highway: "footway" }, [
          [0, -5],
          [0, 5],
        ]),
        node({ crossing: "zebra" }, 0, 0),
      ]),
    ).toEqual([]);
  });

  it("is never drawn twice when a striped crossing way passes through it", () => {
    const crossing = way({ ...ZEBRA_WAY, crossing: "zebra" }, [
      [0, -3],
      [0, 0],
      [0, 3],
    ]);
    const alone = stripesOf([street(), crossing]);
    const both = stripesOf([
      street(),
      crossing,
      node({ crossing: "zebra" }, 0, 0),
    ]);
    expect(both).toEqual(alone);
    expect(zebraCrossings([street(), crossing], FRAME)).toHaveLength(1);
  });
});

/** The render-frame face normal's y of every triangle (up is positive). */
function faceUps(mesh: MeshData): number[] {
  const p = (vertex: number, axis: number): number =>
    mesh.positions[vertex * 3 + axis] ?? Number.NaN;
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] ?? 0;
    const b = mesh.indices[t + 1] ?? 0;
    const c = mesh.indices[t + 2] ?? 0;
    const ux = p(b, 0) - p(a, 0);
    const uz = p(b, 2) - p(a, 2);
    const vx = p(c, 0) - p(a, 0);
    const vz = p(c, 2) - p(a, 2);
    out.push(uz * vx - ux * vz);
  }
  return out;
}

describe("buildRoadMarkings (the mesh)", () => {
  const crossing = (): OsmFeature =>
    way({ ...ZEBRA_WAY, crossing: "zebra" }, [
      [0, 0],
      [0, 4],
    ]);

  it("draws two up-facing triangles a stripe, at the lift over the ground", () => {
    const [marking] = buildRoadMarkings([crossing()], {
      frame: FRAME,
      groundHeightM: () => 7,
    });
    expect(marking?.stripeCount).toBe(4);
    expect(marking?.mesh.triangleCount).toBe(8);
    for (const up of faceUps(marking!.mesh)) expect(up).toBeGreaterThan(0);
    const ys = [...marking!.mesh.positions].filter((_, i) => i % 3 === 1);
    for (const y of ys) expect(y).toBeCloseTo(7 + roadMarkingLiftM(), 5);
  });

  it("sits over every road class and under OsmDemo's next ground rung", () => {
    // Why: the top road lifts 3.4 steps (rank 3 plus the tie lift); a gap
    // under 3 mm fought in the depth buffer at 226 m (roads.ts.md); the next
    // rung of OsmDemo's ground ladder is 4 cm up.
    const topRoad = ROAD_RANK_STEP_M * 3.4;
    expect(roadMarkingLiftM()).toBeGreaterThanOrEqual(0.02);
    expect(roadMarkingLiftM() - topRoad).toBeGreaterThanOrEqual(0.003);
    expect(roadMarkingLiftM()).toBeLessThan(0.04);
    // With the ranks off (every road on the ground) the paint still clears it.
    expect(roadMarkingLiftM(0)).toBeGreaterThanOrEqual(0.003);
  });

  it("skips a mesh for a crossing with no stripe", () => {
    expect(
      buildRoadMarkings(
        [
          way({ ...ZEBRA_WAY, crossing: "zebra" }, [
            [0, 0],
            [0.5, 0],
          ]),
        ],
        { frame: FRAME },
      ),
    ).toEqual([]);
  });

  it("refuses a pitch no wider than a bar, and a lift that is not a number", () => {
    expect(() =>
      buildRoadMarkings([], { frame: FRAME, pitchM: ZEBRA_PARAMS.barM }),
    ).toThrow(RangeError);
    expect(() =>
      buildRoadMarkings([], { frame: FRAME, pitchM: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      buildRoadMarkings([], { frame: FRAME, liftM: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });

  it("drapes a ground that is not a number at 0, never NaN", () => {
    const [marking] = buildRoadMarkings([crossing()], {
      frame: FRAME,
      groundHeightM: () => Number.NaN,
    });
    for (const v of marking!.mesh.positions)
      expect(Number.isFinite(v)).toBe(true);
  });
});
