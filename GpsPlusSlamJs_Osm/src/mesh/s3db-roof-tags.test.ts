import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildBuildings, type BuildingVolume } from "./buildings.js";
import { ENU_METRES_PER_DEG_LAT, enuFrameAt } from "./enu.js";
import type { MeshData } from "./mesh-data.js";
import type { OsmFeature } from "../model/osm-feature.js";

/**
 * Roof tags measured against the Simple 3D Buildings spec, one tag at a time.
 *
 * WHY THIS FILE EXISTS. The roof tests in `buildings.test.ts` and
 * `mesh-orientation.test.ts` prove the shapes that are generated are closed,
 * outward-facing and the right height. They cannot see a tag that is never read:
 * a roof that slopes the wrong way round is still a perfectly good roof. The
 * church the owner looked at (Heiliggeistkirche, Heidelberg) has its whole
 * mansard modelled by mappers as skillion parts with `roof:direction`, and a
 * spire made of `onion` and `pyramidal` parts, so these are the tags it lives on.
 *
 * STATUS: the tests marked BUG below failed on main on 2026-11-07. They are the
 * proof in
 * `GpsPlusSlamJs_Docs/docs/2026-11-07-0920-osm-building-geometry-bugs-findings.md`
 * and went green with the fixes on r1104; the label stays so the history of each
 * test is readable. The ones marked PIN held behaviour the fixes must not break,
 * and FIXED tests pin how the fixes chose to behave.
 *
 * Yardstick: the OSM wiki pages Simple_3D_Buildings, Key:roof:direction and
 * Key:roof:orientation. In the mesh, x is east, z is SOUTH (the render frame is
 * north at -z) and y is up.
 */

const FRAME = enuFrameAt({ lat: 0, lng: 0 });
const DEG_PER_METRE = 1 / ENU_METRES_PER_DEG_LAT;

/** A closed way from `(east, north)` metres around the frame's origin. */
function wayFrom(
  tags: Record<string, string>,
  points: readonly (readonly [number, number])[],
): OsmFeature {
  const closed = [...points, points[0] as readonly [number, number]];
  return {
    type: "way",
    id: 1,
    tags: { building: "yes", ...tags },
    geometry: closed.map(([east, north]) => ({
      lat: north * DEG_PER_METRE,
      lng: east * DEG_PER_METRE,
    })),
  };
}

/** `eastM` wide and `northM` deep, centred on the origin. */
function rectangle(
  tags: Record<string, string>,
  eastM: number,
  northM: number,
): OsmFeature {
  const e = eastM / 2;
  const n = northM / 2;
  return wayFrom(tags, [
    [-e, -n],
    [e, -n],
    [e, n],
    [-e, n],
  ]);
}

/** A regular polygon, as a steeple's footprint is drawn. */
function regular(
  tags: Record<string, string>,
  sides: number,
  radiusM: number,
): OsmFeature {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * 2 * Math.PI;
    points.push([radiusM * Math.cos(angle), radiusM * Math.sin(angle)]);
  }
  return wayFrom(tags, points);
}

function build(feature: OsmFeature): BuildingVolume {
  const volumes = buildBuildings([feature], { frame: FRAME });
  expect(volumes).toHaveLength(1);
  return volumes[0] as BuildingVolume;
}

interface Point {
  readonly east: number;
  readonly north: number;
  readonly up: number;
}

function pointsOf(mesh: MeshData): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    points.push({
      east: mesh.positions[i] as number,
      up: mesh.positions[i + 1] as number,
      north: -(mesh.positions[i + 2] as number),
    });
  }
  return points;
}

/** Every vertex on the very top of the building. */
function topPoints(mesh: MeshData): Point[] {
  const points = pointsOf(mesh);
  const top = Math.max(...points.map((p) => p.up));
  return points.filter((p) => p.up > top - 1e-3);
}

function extent(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/** Downhill direction of a skillion's top, as a unit `(east, north)` vector. */
function downhillOf(mesh: MeshData): { east: number; north: number } {
  // The roof vertices are the ones with an upward-facing normal; a least-squares
  // plane through them gives the gradient however the footprint is turned.
  const roof: Point[] = [];
  for (let i = 0; i < mesh.normals.length; i += 3) {
    if ((mesh.normals[i + 1] as number) > 0.1) {
      roof.push({
        east: mesh.positions[i] as number,
        up: mesh.positions[i + 1] as number,
        north: -(mesh.positions[i + 2] as number),
      });
    }
  }
  const mean = (f: (p: Point) => number): number =>
    roof.reduce((sum, p) => sum + f(p), 0) / roof.length;
  const [me, mn, mu] = [
    mean((p) => p.east),
    mean((p) => p.north),
    mean((p) => p.up),
  ];
  let [ee, en, nn, eu, nu] = [0, 0, 0, 0, 0];
  for (const p of roof) {
    const [e, n, u] = [p.east - me, p.north - mn, p.up - mu];
    ee += e * e;
    en += e * n;
    nn += n * n;
    eu += e * u;
    nu += n * u;
  }
  const det = ee * nn - en * en;
  const a = (eu * nn - nu * en) / det;
  const b = (nu * ee - eu * en) / det;
  const length = Math.hypot(a, b);
  return { east: -a / length, north: -b / length };
}

function compassVector(degrees: number): { east: number; north: number } {
  const radians = (degrees * Math.PI) / 180;
  return { east: Math.sin(radians), north: Math.cos(radians) };
}

describe("roof:direction on a skillion", () => {
  // BUG. Why this test matters: on the Heiliggeistkirche every slope of the
  // mansard is a skillion part with `roof:direction` (357.24 and 177.24, north
  // and south, off the long side of the nave). Read, those parts make the
  // pitched roof; ignored, each one tilts end to end along the nave instead.
  // Corpus: 256 of 266 skillions in the six sites carry the tag, so it is not
  // an edge case. Key:roof:direction: "from high (ridge) to low (eaves)".
  it.each([
    ["0", 0],
    ["90", 90],
    ["180", 180],
    ["N", 0],
    ["SE", 135],
    ["NNE", 22.5],
    ["357.24", 357.24],
  ])(
    "slopes downhill towards roof:direction=%s",
    (value: string, degrees: number) => {
      const volume = build(
        rectangle(
          {
            height: "10",
            "roof:height": "3",
            "roof:shape": "skillion",
            "roof:direction": value,
          },
          20,
          10,
        ),
      );
      const downhill = downhillOf(volume.mesh);
      const wanted = compassVector(degrees);
      const cosine =
        downhill.east * wanted.east + downhill.north * wanted.north;
      expect(cosine).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
    },
  );

  it("slopes along any direction, on any footprint proportion", () => {
    // BUG, same cause, stated as a property so a fix cannot special-case the
    // eight compass points or the footprint's own axes.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 359 }),
        fc.integer({ min: 4, max: 40 }),
        fc.integer({ min: 4, max: 40 }),
        (degrees, eastM, northM) => {
          const volume = build(
            rectangle(
              {
                height: "10",
                "roof:height": "3",
                "roof:shape": "skillion",
                "roof:direction": String(degrees),
              },
              eastM,
              northM,
            ),
          );
          const downhill = downhillOf(volume.mesh);
          const wanted = compassVector(degrees);
          const cosine =
            downhill.east * wanted.east + downhill.north * wanted.north;
          expect(cosine).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
        },
      ),
      { numRuns: 40 },
    );
  });

  it("PIN: with no roof:direction it still slopes, along the long side", () => {
    // The fallback the sidecar documents. A mapper who drew no direction gets a
    // plausible roof, and a fix must not turn that into a flat one.
    const volume = build(
      rectangle(
        { height: "10", "roof:height": "3", "roof:shape": "skillion" },
        20,
        10,
      ),
    );
    expect(Math.abs(downhillOf(volume.mesh).east)).toBeGreaterThan(0.99);
  });
});

describe("which way the ridge of a gabled or hipped roof runs", () => {
  // Key:roof:orientation: "along" (the default) is parallel to the longest
  // side, "across" at right angles. Key:roof:direction faces the slopes.
  const house = (extra: Record<string, string>, shape = "gabled"): MeshData =>
    build(
      rectangle(
        { height: "10", "roof:height": "3", "roof:shape": shape, ...extra },
        20,
        10,
      ),
    ).mesh;

  it("PIN: the ridge runs along the long side by default", () => {
    const top = topPoints(house({}));
    expect(extent(top.map((p) => p.east))).toBeGreaterThan(19);
    expect(extent(top.map((p) => p.north))).toBeLessThan(0.01);
  });

  it("PIN: roof:orientation=along changes nothing", () => {
    const top = topPoints(house({ "roof:orientation": "along" }));
    expect(extent(top.map((p) => p.east))).toBeGreaterThan(19);
  });

  it("turns the ridge with roof:orientation=across", () => {
    // BUG. Why this test matters: 139 of 289 ridged roofs in the six sites say
    // `across`. On Cologne Cathedral it is every gable over the aisles and the
    // choir chapels, and that row of cross gables is the silhouette of the
    // building. Ignored, each one turns ninety degrees.
    const top = topPoints(house({ "roof:orientation": "across" }));
    expect(extent(top.map((p) => p.north))).toBeGreaterThan(9);
    expect(extent(top.map((p) => p.east))).toBeLessThan(0.01);
  });

  it("turns a hipped ridge with roof:orientation=across as well", () => {
    // BUG, the same line of code on the other ridged shape.
    const top = topPoints(house({ "roof:orientation": "across" }, "hipped"));
    expect(extent(top.map((p) => p.north))).toBeGreaterThan(
      extent(top.map((p) => p.east)),
    );
  });

  it("puts the ridge at right angles to roof:direction", () => {
    // BUG. Slopes facing east and west mean the ridge runs north to south, even
    // though that is the short side. Key:roof:direction names the slope, not
    // the ridge. No ridged roof in the corpus uses it yet, so it ranks low.
    const top = topPoints(house({ "roof:direction": "90" }));
    expect(extent(top.map((p) => p.north))).toBeGreaterThan(9);
  });
});

describe("the roof shapes we do not generate", () => {
  const ROOF_HEIGHT = 6;
  const HEIGHT = 20;

  // BUG. Why this test matters: `normaliseRoofShape` turns every one of these
  // into `flat`, and `resolveRoofHeightM` then returns 0 before reading
  // `roof:height`, so the building is not merely missing its roof, its WALLS
  // run up to the top of where the roof should have ended. Heiliggeistkirche's
  // three onion parts (the tower cap and the ridge turret) become plain prisms
  // ending in a flat lid: the 45 m turret on the nave is a post. `cone` is the
  // ordinary steeple shape on the wiki's roof:shape page.
  // S3DB: "height" is ground to top of roof, "roof:height" is subtracted to get
  // the facade height.
  it.each([
    "onion",
    "cone",
    "round",
    "mansard",
    "gambrel",
    "half-hipped",
    "saltbox",
  ])("keeps roof:height off the walls for roof:shape=%s", (shape) => {
    const volume = build(
      rectangle(
        {
          height: String(HEIGHT),
          "roof:height": String(ROOF_HEIGHT),
          "roof:shape": shape,
        },
        20,
        10,
      ),
    );
    expect(volume.heights.eaveHeightM).toBeCloseTo(HEIGHT - ROOF_HEIGHT);
  });

  it.each([
    "onion",
    "cone",
    "round",
    "mansard",
    "gambrel",
    "half-hipped",
    "saltbox",
  ])("narrows towards the top for roof:shape=%s", (shape) => {
    // Whatever the exact profile, none of these shapes ends in a lid as wide
    // as the footprint: that is what the flat fallback produces.
    const volume = build(
      rectangle(
        {
          height: String(HEIGHT),
          "roof:height": String(ROOF_HEIGHT),
          "roof:shape": shape,
        },
        20,
        10,
      ),
    );
    const top = topPoints(volume.mesh);
    const lidArea =
      extent(top.map((p) => p.east)) * extent(top.map((p) => p.north));
    expect(lidArea).toBeLessThan(0.5 * 20 * 10);
  });

  it("draws an onion wider than its own base part way up", () => {
    // BUG. What separates an onion from a cone, and it is the feature the eye
    // reads on a Bavarian or Russian church. Mesh-level, so a fix that aliased
    // onion to pyramidal, the cheap way past the two tests above, stays red.
    const volume = build(
      regular(
        { height: "20", "roof:height": "8", "roof:shape": "onion" },
        12,
        4,
      ),
    );
    const widest = Math.max(
      ...pointsOf(volume.mesh)
        .filter((p) => p.up > 12.5)
        .map((p) => Math.hypot(p.east, p.north)),
    );
    // 10 % over the wall radius: well clear of float noise, well under any bulge.
    expect(widest).toBeGreaterThan(4.4);
  });

  it("PIN: a shape nobody defined still falls back to a flat roof", () => {
    // Flat stays the honest answer for a value with no agreed meaning.
    const volume = build(
      rectangle({ height: "20", "roof:shape": "bananas" }, 20, 10),
    );
    expect(volume.heights.roofShape).toBe("flat");
    expect(volume.heights.eaveHeightM).toBeCloseTo(20);
  });
});

describe("dome", () => {
  it("is round in profile, not a pyramid", () => {
    // BUG, and a DOCUMENTED simplification (roof.ts.md, §8.4 of the OSM plan):
    // the sidecar argues a pyramid is indistinguishable at walking distance.
    // That reasoning was about shallow roofs. On the Dresden Frauenkirche and
    // the Berlin Cathedral the dome IS the landmark and a pyramid reads as
    // wrong from any distance. Half way up a real dome is at 87 % of its radius,
    // a pyramid at 50 %. The owner decides; this test is the measurement.
    const volume = build(
      regular(
        { height: "30", "roof:height": "10", "roof:shape": "dome" },
        16,
        10,
      ),
    );
    const midway = pointsOf(volume.mesh).filter((p) => p.up > 24 && p.up < 26);
    expect(midway.length).toBeGreaterThan(0);
    const radius = Math.max(...midway.map((p) => Math.hypot(p.east, p.north)));
    expect(radius).toBeGreaterThan(7.5);
  });
});

describe("where the apex of a pyramidal roof stands", () => {
  // Why these tests matter: a steeple is a pyramid on a small polygon, so a
  // lopsided apex is visible at any distance, and OSM rings repeat their first
  // node as their last.
  const apexOffset = (feature: OsmFeature): number => {
    const top = topPoints(build(feature).mesh)[0] as Point;
    return Math.hypot(top.east, top.north);
  };

  it("stands over the centre of a regular octagon", () => {
    // BUG. The closing node counts twice in the vertex average, pulling the
    // apex towards the first node by radius/9.
    const offset = apexOffset(
      regular(
        { height: "30", "roof:height": "20", "roof:shape": "pyramidal" },
        8,
        9,
      ),
    );
    expect(offset).toBeLessThan(0.05);
  });

  it("does not follow the mapper's vertex density", () => {
    // BUG. An apse or a stair turret is drawn with many short segments on one
    // side and few on the other. The average follows the nodes, the area
    // centroid follows the building: here a 20 x 20 square with eleven extra
    // nodes along its east wall.
    const east: [number, number][] = [];
    for (let i = 1; i < 12; i++) east.push([10, -10 + (20 * i) / 12]);
    const offset = apexOffset(
      wayFrom(
        { height: "30", "roof:height": "20", "roof:shape": "pyramidal" },
        [[-10, -10], [10, -10], ...east, [10, 10], [-10, 10]],
      ),
    );
    expect(offset).toBeLessThan(0.25);
  });
});

describe("a ridged roof on a footprint that is not a rectangle", () => {
  it("stays over its own walls", () => {
    // BUG, and the documented limit of the bounding-rectangle roof. Why this
    // test matters: the sidecar says to build a proper solution when
    // `isApproximate` fires on a meaningful share of buildings. It fires on 57
    // of 71 ridged roofs in Heidelberg, 15 of 42 at Cologne, 17 of 19 at Ulm.
    // The roof of an L-shaped house here spans the empty quarter, with nothing
    // under it.
    const volume = build(
      wayFrom({ height: "10", "roof:height": "3", "roof:shape": "gabled" }, [
        [-10, -10],
        [10, -10],
        [10, 0],
        [0, 0],
        [0, 10],
        [-10, 10],
      ]),
    );
    const outside = pointsOf(volume.mesh).filter(
      (p) => p.east > 0.5 && p.north > 0.5,
    );
    expect(outside).toEqual([]);
  });

  it("PIN: on a rectangle the roof is exact and says so", () => {
    const volume = build(
      rectangle(
        { height: "10", "roof:height": "3", "roof:shape": "gabled" },
        20,
        10,
      ),
    );
    expect(volume.roofIsApproximate).toBe(false);
  });
});

describe("the cross-section of a ridged roof", () => {
  // FIXED. Why these tests matter: gambrel and round used to be flat and are now
  // generated over the same ridge as gabled, with a different profile across it.
  // Measured on a 20 x 10 house with a 6 m roof on 14 m walls, so the half width
  // is 5 m: a straight gable is 2 m from the ridge line at 3.6 m above the eave.
  const slope = (shape: string, riseM: number): number => {
    const volume = build(
      rectangle(
        { height: "20", "roof:height": "6", "roof:shape": shape },
        20,
        10,
      ),
    );
    const level = pointsOf(volume.mesh).filter(
      (p) => Math.abs(p.up - (14 + riseM)) < 0.05,
    );
    expect(level.length).toBeGreaterThan(0);
    return Math.max(...level.map((p) => Math.abs(p.north)));
  };

  it("breaks a gambrel into a steep lower and a shallow upper slope", () => {
    // The break sits at 70 % of the half width and 60 % of the roof height.
    expect(slope("gambrel", 3.6)).toBeCloseTo(3.5, 1);
  });

  it("curves a round roof outward, not in a straight line", () => {
    // A quarter circle at half its height is at cos(30 deg) of the half width.
    expect(slope("round", 3)).toBeCloseTo(5 * Math.cos(Math.PI / 6), 1);
  });

  it("keeps the ridge of a round roof along roof:orientation=across", () => {
    const top = topPoints(
      build(
        rectangle(
          {
            height: "20",
            "roof:height": "6",
            "roof:shape": "round",
            "roof:orientation": "across",
          },
          20,
          10,
        ),
      ).mesh,
    );
    expect(extent(top.map((p) => p.north))).toBeGreaterThan(9);
  });
});

describe("a ridged roof that would overhang its walls", () => {
  // FIXED. Why these tests matter: the bounding-rectangle roof spans the empty
  // quarter of an L-shaped house. Past RIDGE_OVERHANG_LIMIT_M of overhang the
  // roof is the straight skeleton of the real outline (M2 of the skeleton-roof
  // plan; until then a hip over the outline). A flat lid would be the cheap way
  // past "stays over its own walls" above, and these tests keep that way
  // closed. The house is a 30 x 10 bar with a 10 x 5 wing, the common shape of
  // an L in the corpus.
  const lHouse = (): BuildingVolume =>
    build(
      wayFrom({ height: "10", "roof:height": "3", "roof:shape": "gabled" }, [
        [-15, -5],
        [15, -5],
        [15, 5],
        [-5, 5],
        [-5, 10],
        [-15, 10],
      ]),
    );

  it("still rises to its tagged height", () => {
    const top = Math.max(...pointsOf(lHouse().mesh).map((p) => p.up));
    expect(top).toBeCloseTo(10);
  });

  it("says it is exact: the skeleton found a gable at both wing ends", () => {
    // BASELINE MOVED BY PLAN (M2): the hip over the outline was an
    // approximation of a gabled tag; the skeleton is the tagged shape.
    expect(lHouse().roofIsApproximate).toBe(false);
  });

  it("faces no roof triangle downward", () => {
    // A hip whose eave edge runs the wrong way round its ridge point would face
    // down and vanish under back-face culling. An eave edge square to the ridge
    // makes an upright gable triangle (normal y = 0), which is a real gable.
    const { normals, positions } = lHouse().mesh;
    const downward: number[] = [];
    for (let i = 0; i < normals.length; i += 3) {
      const roof = (positions[i + 1] as number) > 7 + 1e-3;
      if (roof && (normals[i + 1] as number) < -1e-6) downward.push(i / 3);
    }
    expect(downward).toEqual([]);
  });

  it("stays over its own walls", () => {
    const outside = pointsOf(lHouse().mesh).filter(
      (p) => p.east > -4.5 && p.north > 5.5,
    );
    expect(outside).toEqual([]);
  });

  it("FIXED: the square L that fell back to a flat lid rises to its tagged height", () => {
    // BASELINE MOVED BY PLAN (M2). The square L of the test further up has a
    // square box, so the old hip ridge shrank to the inner corner and the roof
    // went flat at the eave (7 m), 3 m short of its tag. The skeleton has no
    // such corner case: two ridges meeting in a valley, up to 10 m.
    const volume = build(
      wayFrom({ height: "10", "roof:height": "3", "roof:shape": "gabled" }, [
        [-10, -10],
        [10, -10],
        [10, 0],
        [0, 0],
        [0, 10],
        [-10, 10],
      ]),
    );
    expect(Math.max(...pointsOf(volume.mesh).map((p) => p.up))).toBeCloseTo(10);
  });

  it("PIN: a rectangle within the limit keeps its gable", () => {
    // A 2 % skew moves no corner more than about 0.2 m out of the box.
    const volume = build(
      wayFrom({ height: "10", "roof:height": "3", "roof:shape": "gabled" }, [
        [-10, -5],
        [10, -5],
        [10.2, 5],
        [-9.8, 5],
      ]),
    );
    const top = topPoints(volume.mesh);
    expect(extent(top.map((p) => p.east))).toBeGreaterThan(15);
  });
});
