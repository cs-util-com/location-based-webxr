/**
 * Ground plates — flat areas that are neither buildings nor roads.
 *
 * WHY THEY EXIST. The feedback: _"Genauso alles an Flächen, die so existieren,
 * sowas wie ich Parkplatzfläche oder sowas, die sind ja auch wirkliche Geometrien.
 * Das finde ich, sollte man auch alles wirklich als echte 3D-Geometrien rendern, so
 * dass da die als flache Platten quasi im 3D-Raum hängen."_ Car parks, pitches,
 * landuse — every polygon the scorer already reads, currently invisible in 3D.
 *
 * WHY THIS IS A THIN BUILDER. `toGeometry` already classifies these (including the
 * non-obvious rule that a closed way carrying `highway` is a LineString, not an
 * area) and `triangulate` already turns rings into filled geometry for buildings. So
 * the only new decisions are which features qualify, how holes behave, and how the
 * plate follows terrain — which is what these tests pin.
 */

import { describe, expect, it } from "vitest";

import { enuFrameAt } from "./enu.js";
import { mergeMeshes } from "./extrude.js";
import { buildAreaPlates, isPlateArea, type AreaPlate } from "./plates.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import type { Bbox } from "../spatial/clip.js";
import { loadFixture } from "../test-utils/load-fixtures.js";

const ORIGIN = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(ORIGIN);

/** A closed square way, ~30 m on a side, with the given tags. */
function square(
  id: number,
  tags: Record<string, string>,
  offsetLng = 0,
): OsmFeature {
  const a = ORIGIN.lng + offsetLng;
  return {
    type: "way",
    id,
    tags,
    geometry: [
      { lat: ORIGIN.lat, lng: a },
      { lat: ORIGIN.lat, lng: a + 0.00043 },
      { lat: ORIGIN.lat + 0.00027, lng: a + 0.00043 },
      { lat: ORIGIN.lat + 0.00027, lng: a },
      { lat: ORIGIN.lat, lng: a },
    ],
  };
}

/** The square's ring on its own, for building a multipolygon by hand. */
const OUTER_RING: readonly { lat: number; lng: number }[] = [
  { lat: ORIGIN.lat, lng: ORIGIN.lng },
  { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.00043 },
  { lat: ORIGIN.lat + 0.00027, lng: ORIGIN.lng + 0.00043 },
  { lat: ORIGIN.lat + 0.00027, lng: ORIGIN.lng },
  { lat: ORIGIN.lat, lng: ORIGIN.lng },
];

describe("isPlateArea", () => {
  it("accepts the ground areas the feedback named", () => {
    expect(isPlateArea({ amenity: "parking" })).toBe(true);
    expect(isPlateArea({ leisure: "pitch" })).toBe(true);
    expect(isPlateArea({ landuse: "grass" })).toBe(true);
    expect(isPlateArea({ natural: "water" })).toBe(true);
  });

  it("REJECTS buildings, which have their own builder", () => {
    // A plate over a building footprint would sit inside the extruded volume and
    // z-fight with its floor — and the building layer already draws it.
    expect(isPlateArea({ building: "yes" })).toBe(false);
    expect(isPlateArea({ "building:part": "yes" })).toBe(false);
    // Even when it also carries a plate-ish tag: `building` wins.
    expect(isPlateArea({ building: "yes", landuse: "retail" })).toBe(false);
  });

  it("REJECTS anything carrying `highway`, which the road builder owns", () => {
    // The way-449879297 rule, from the other direction: a closed `highway` way is
    // a LineString, so treating it as an area would draw a filled blob where a
    // ribbon belongs.
    expect(isPlateArea({ highway: "pedestrian", area: "yes" })).toBe(false);
  });

  it("rejects a feature with no recognised area tag at all", () => {
    expect(isPlateArea({ name: "somewhere" })).toBe(false);
    expect(isPlateArea({})).toBe(false);
  });
});

describe("buildAreaPlates", () => {
  it("builds one plate per qualifying area, and skips the rest", () => {
    const plates = buildAreaPlates(
      [
        square(1, { amenity: "parking" }),
        square(2, { building: "yes" }, 0.001),
        square(3, { leisure: "pitch" }, 0.002),
      ],
      { frame: FRAME },
    );

    expect(plates.map((plate) => plate.feature)).toEqual(["way/1", "way/3"]);
  });

  it("produces real triangles, not an empty mesh", () => {
    const [plate] = buildAreaPlates([square(1, { amenity: "parking" })], {
      frame: FRAME,
    });
    if (plate === undefined) throw new Error("no plate built");
    expect(plate.mesh.triangleCount).toBeGreaterThan(0);
    expect(plate.mesh.positions.length).toBeGreaterThan(0);
    // A square is two triangles; a triangulator that emitted a fan over the
    // closing point would emit three and is worth noticing.
    expect(plate.mesh.triangleCount).toBe(2);
  });

  it("lies FLAT — every vertex at the same height on level ground", () => {
    // The defining property. A plate with any vertical extent is a slab, and a
    // slab z-fights with the ground plane along its whole boundary.
    const [plate] = buildAreaPlates([square(1, { amenity: "parking" })], {
      frame: FRAME,
      groundHeightM: () => 17,
    });
    if (plate === undefined) throw new Error("no plate built");

    const ys: number[] = [];
    for (let i = 1; i < plate.mesh.positions.length; i += 3) {
      ys.push(plate.mesh.positions[i] ?? 0);
    }
    for (const y of ys) expect(y).toBeCloseTo(17, 3);
  });

  it("follows terrain PER VERTEX, unlike a building", () => {
    // The difference that made this need new machinery (DEC-R2-19's other half).
    // A building takes one sample and sits at the minimum; a 30 m plate must
    // drape, or it cuts into the ground at one end and floats at the other.
    const [plate] = buildAreaPlates([square(1, { amenity: "parking" })], {
      frame: FRAME,
      groundHeightM: (position) =>
        position.lng > ORIGIN.lng + 0.0002 ? 30 : 10,
    });
    if (plate === undefined) throw new Error("no plate built");

    const ys: number[] = [];
    for (let i = 1; i < plate.mesh.positions.length; i += 3) {
      ys.push(plate.mesh.positions[i] ?? 0);
    }
    // Both heights are present, so the plate really is draped rather than flat at
    // one sampled value.
    expect(Math.min(...ys)).toBeCloseTo(10, 3);
    expect(Math.max(...ys)).toBeCloseTo(30, 3);
  });

  it("keeps holes as holes", () => {
    // A car park with a building in it is a multipolygon with an inner ring. A
    // triangulator that ignored the hole would pave over the building.
    const withHole: OsmFeature = {
      type: "relation",
      id: 7,
      tags: { type: "multipolygon", amenity: "parking" },
      members: [
        { type: "way", ref: 1, role: "outer", geometry: OUTER_RING },
        {
          type: "way",
          ref: 2,
          role: "inner",
          geometry: [
            { lat: ORIGIN.lat + 0.00008, lng: ORIGIN.lng + 0.00012 },
            { lat: ORIGIN.lat + 0.00008, lng: ORIGIN.lng + 0.00028 },
            { lat: ORIGIN.lat + 0.00018, lng: ORIGIN.lng + 0.00028 },
            { lat: ORIGIN.lat + 0.00018, lng: ORIGIN.lng + 0.00012 },
            { lat: ORIGIN.lat + 0.00008, lng: ORIGIN.lng + 0.00012 },
          ],
        },
      ],
    };

    const [plate] = buildAreaPlates([withHole], { frame: FRAME });
    if (plate === undefined) throw new Error("no plate built");
    // An outer square alone is 2 triangles; with a rectangular hole the boundary
    // has to be re-triangulated into strictly more.
    expect(plate.mesh.triangleCount).toBeGreaterThan(2);
  });

  it("survives a degenerate ring without throwing", () => {
    // Real OSM has collapsed ways. A builder that throws takes the whole layer
    // down for one bad feature.
    const degenerate: OsmFeature = {
      type: "way",
      id: 9,
      tags: { amenity: "parking" },
      geometry: [
        { lat: ORIGIN.lat, lng: ORIGIN.lng },
        { lat: ORIGIN.lat, lng: ORIGIN.lng },
        { lat: ORIGIN.lat, lng: ORIGIN.lng },
      ],
    };
    expect(() => buildAreaPlates([degenerate], { frame: FRAME })).not.toThrow();
    expect(buildAreaPlates([degenerate], { frame: FRAME })).toEqual([]);
  });

  it("faces UP, so it is lit and not culled from above", () => {
    // A plate wound the wrong way is invisible under backface culling and lit
    // from below when double-sided — both read as "the layer does not work".
    const [plate] = buildAreaPlates([square(1, { amenity: "parking" })], {
      frame: FRAME,
    });
    if (plate === undefined) throw new Error("no plate built");
    for (let i = 1; i < plate.mesh.normals.length; i += 3) {
      expect(plate.mesh.normals[i]).toBeCloseTo(1, 5);
    }
  });
});

describe("buildAreaPlates — against the real captured fixture", () => {
  /**
   * WHY THIS TEST EXISTS. The synthetic squares above all passed while the demo
   * drew nothing, so they were not covering the thing that was broken. A test
   * against a real captured Overpass response is what closes that gap: the fixture
   * is Cologne Volksgarten, and a hand count of its elements finds 10 closed ways
   * carrying a plate tag, so "zero plates" is a detectable failure rather than a
   * plausible one.
   *
   * The general lesson is worth keeping: a builder tested only on geometry the test
   * author constructed is tested against their own assumptions about the data.
   */
  it("builds plates from Volksgarten, not zero", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const payload = JSON.parse(
      readFileSync(join(here, "..", "testdata", "park.json"), "utf8"),
    ).payload as unknown;

    const parsed = parseOverpassJson(payload);
    const frame = enuFrameAt({ lat: 50.9231, lng: 6.9445 });
    const plates = buildAreaPlates(parsed.features, { frame });

    expect(plates.length).toBeGreaterThan(0);
    for (const plate of plates) {
      expect(plate.mesh.triangleCount).toBeGreaterThan(0);
    }
  });
});

describe("plates survive mergeMeshes", () => {
  /**
   * WHY THIS TEST EXISTS. The demo merges every plate into ONE mesh, for the same
   * reason it merges buildings: hundreds of small draw calls would dominate the
   * frame. So `buildAreaPlates` being correct is not sufficient — the merge has to
   * preserve the triangles, and a merge that quietly produced an empty mesh would
   * look exactly like a builder that produced nothing.
   *
   * That is not hypothetical: it is what actually happened. The plates were built
   * (the status line counted them) and nothing appeared on screen.
   */
  it("keeps every triangle when several plates are merged", () => {
    const plates = buildAreaPlates(
      [
        square(1, { amenity: "parking" }),
        square(2, { leisure: "pitch" }, 0.001),
      ],
      { frame: FRAME },
    );
    expect(plates).toHaveLength(2);

    const merged = mergeMeshes(plates.map((plate) => plate.mesh));
    const expected = plates.reduce((sum, p) => sum + p.mesh.triangleCount, 0);
    expect(expected).toBeGreaterThan(0);
    expect(merged.triangleCount).toBe(expected);
    expect(merged.positions.length).toBeGreaterThan(0);
    expect(merged.indices.length).toBe(expected * 3);
  });
});

describe("clipTo — bounding the quadratic (2026-07-31 perf loop)", () => {
  /**
   * Why these tests matter: `triangulate` is ear clipping, which is O(n^2) in
   * ring size, and OSM area size is unbounded. The `building-block` fixture is
   * one ordinary Cologne city block and contains a 316-member administrative
   * boundary relation whose largest polygon is 25,001 points; triangulating it
   * measured 2,657 ms, and `buildAreaPlates` as a whole 2,881 ms, on every mesh
   * build. `clipTo` bounds the input so the quadratic never gets large input.
   *
   * This is the THIRD code path that same relation has broken (ring stitching
   * and the h3 cover were the others), which is why the growth guard below
   * exists rather than only a correctness test.
   */
  const fixtureFeatures = (): OsmFeature[] => [
    ...parseOverpassJson(loadFixture("building-block").payload).features,
  ];
  const centre = loadFixture("building-block").centre;

  it("keeps plates that are inside the box, and drops those entirely outside", () => {
    const features = fixtureFeatures();
    const frame = enuFrameAt(centre);
    const near: Bbox = {
      south: centre.lat - 0.002,
      north: centre.lat + 0.002,
      west: centre.lng - 0.002,
      east: centre.lng + 0.002,
    };
    const faraway: Bbox = {
      south: centre.lat + 10,
      north: centre.lat + 11,
      west: centre.lng + 10,
      east: centre.lng + 11,
    };

    expect(
      buildAreaPlates(features, { frame, clipTo: near }).length,
    ).toBeGreaterThan(0);
    expect(buildAreaPlates(features, { frame, clipTo: faraway })).toEqual([]);
  });

  it("is enormously faster than the unclipped build it replaces", () => {
    // An ABSOLUTE budget, not a ratio: the unclipped call measured 2,881 ms on
    // this fixture and the clipped one ~2 ms, so 500 ms fails decisively if the
    // clip stops being applied while leaving ~250x headroom over the real cost.
    // Deliberately not asserting the unclipped time — that would make the test
    // itself take three seconds.
    const features = fixtureFeatures();
    const frame = enuFrameAt(centre);
    const clipTo: Bbox = {
      south: centre.lat - 0.013,
      north: centre.lat + 0.013,
      west: centre.lng - 0.02,
      east: centre.lng + 0.02,
    };

    buildAreaPlates(features, { frame, clipTo }); // warm-up, so JIT is not timed
    const started = performance.now();
    const plates = buildAreaPlates(features, { frame, clipTo });
    const elapsed = performance.now() - started;

    expect(plates.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("clipTo — a hole that swallows the clip box (PR #236 review)", () => {
  /**
   * Why this test matters: clipping outer and inner rings INDEPENDENTLY is
   * correct for h3 coverage — the only previous consumer — and wrong for
   * rendering. Take outer ⊇ hole ⊇ box, i.e. a big landuse/natural relation
   * whose inner ring (a clearing, a lake) is larger than the rendered extent,
   * with the user standing inside that hole. Sutherland-Hodgman clips BOTH
   * rings to the box rectangle, so the result is [box, box]: a hole exactly
   * coincident with its own outer ring. `triangulate` bridges it and emits a
   * solid fill, when the true intersection is EMPTY.
   *
   * The visible symptom is the whole ground plate painted as forest while the
   * user stands in the clearing. Before the 2026-07-31 clip the hole was carved
   * correctly, so this is a regression the clip introduced and the presence /
   * absence / wall-clock tests above could never have caught — all three pass
   * just as happily if the clip returned the box for every feature.
   */
  const ringAround = (halfLat: number, halfLng: number) => [
    { lat: ORIGIN.lat - halfLat, lng: ORIGIN.lng - halfLng },
    { lat: ORIGIN.lat - halfLat, lng: ORIGIN.lng + halfLng },
    { lat: ORIGIN.lat + halfLat, lng: ORIGIN.lng + halfLng },
    { lat: ORIGIN.lat + halfLat, lng: ORIGIN.lng - halfLng },
    { lat: ORIGIN.lat - halfLat, lng: ORIGIN.lng - halfLng },
  ];

  it("draws NOTHING when the user stands inside a hole bigger than the clip box", () => {
    // outer (0.05°) ⊇ hole (0.02°) ⊇ box (0.005°), all centred on the user.
    const donut: OsmFeature = {
      type: "relation",
      id: 99,
      tags: { type: "multipolygon", landuse: "forest" },
      members: [
        {
          type: "way",
          ref: 1,
          role: "outer",
          geometry: ringAround(0.05, 0.05),
        },
        {
          type: "way",
          ref: 2,
          role: "inner",
          geometry: ringAround(0.02, 0.02),
        },
      ],
    };
    const clipTo: Bbox = {
      south: ORIGIN.lat - 0.005,
      north: ORIGIN.lat + 0.005,
      west: ORIGIN.lng - 0.005,
      east: ORIGIN.lng + 0.005,
    };

    // Unclipped, the hole is carved and the user's position is not covered.
    expect(buildAreaPlates([donut], { frame: FRAME })).toHaveLength(1);

    // Clipped, the intersection of (outer minus hole) with the box is EMPTY,
    // so nothing may be drawn. A solid box here is the bug.
    expect(buildAreaPlates([donut], { frame: FRAME, clipTo })).toEqual([]);
  });
});

describe("clipTo — the clip preserves area, it does not fabricate or lose it", () => {
  /**
   * Why these tests matter: the presence / absence / wall-clock tests above all
   * pass just as happily if `clipToBbox` returned the box rectangle for every
   * feature — so none of them can tell "the clip worked" from "the clip
   * replaced the geometry". That is the one risk clipping-before-triangulating
   * introduces, and it is exactly the claim the PR body makes. Raised on
   * PR #236; the hole-swallows-the-box bug above is what happens when nothing
   * checks it.
   *
   * The measure is the triangulated AREA in ENU metres, which `triangulatedArea`
   * already computes for the triangulator's own tests.
   */
  const areaOf = (plates: readonly AreaPlate[]): number => {
    // Shoelace per triangle, through the INDEX buffer -- the vertex buffer is
    // deduplicated, so reading it as triangle soup silently measures something
    // else (which it did on the first attempt at this helper). The plate is flat
    // and upward-facing, so the x/z projection is the true area in metres.
    let total = 0;
    for (const plate of plates) {
      const { positions, indices } = plate.mesh;
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const a = indices[i]! * 3;
        const b = indices[i + 1]! * 3;
        const c = indices[i + 2]! * 3;
        const ax = positions[a]!,
          az = positions[a + 2]!;
        const bx = positions[b]!,
          bz = positions[b + 2]!;
        const cx = positions[c]!,
          cz = positions[c + 2]!;
        total += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      }
    }
    return total;
  };

  const box = (halfLat: number, halfLng: number): Bbox => ({
    south: ORIGIN.lat - halfLat,
    north: ORIGIN.lat + halfLat,
    west: ORIGIN.lng - halfLng,
    east: ORIGIN.lng + halfLng,
  });

  it("leaves a plate wholly INSIDE the box byte-for-byte unchanged in area", () => {
    // The clip must be a no-op here. If it returned the box instead, the area
    // would jump to the box's, which is far larger than a 30 m square.
    const feature = square(1, { amenity: "parking" });
    const unclipped = buildAreaPlates([feature], { frame: FRAME });
    const clipped = buildAreaPlates([feature], {
      frame: FRAME,
      clipTo: box(0.01, 0.01),
    });

    expect(clipped).toHaveLength(1);
    expect(areaOf(clipped)).toBeCloseTo(areaOf(unclipped), 3);
  });

  it("keeps exactly the part of a STRADDLING plate that is inside the box", () => {
    // Half the square is cut away, so the area must halve — not stay whole (no
    // clip) and not become the box (geometry replaced).
    const feature = square(1, { amenity: "parking" });
    const whole = areaOf(buildAreaPlates([feature], { frame: FRAME }));

    // The square spans lng [ORIGIN.lng, +0.00043]; cut it at the midpoint.
    const half = buildAreaPlates([feature], {
      frame: FRAME,
      clipTo: {
        south: ORIGIN.lat - 1,
        north: ORIGIN.lat + 1,
        west: ORIGIN.lng - 1,
        east: ORIGIN.lng + 0.000215,
      },
    });

    expect(half).toHaveLength(1);
    expect(areaOf(half)).toBeCloseTo(whole / 2, 1);
  });

  it("keeps a HOLE a hole when the box cuts through it", () => {
    // The regression that the hole-swallowing bug is the extreme form of: a
    // clipped polygon whose hole is dropped would gain area rather than lose it.
    const ring = (halfLat: number, halfLng: number) => [
      { lat: ORIGIN.lat - halfLat, lng: ORIGIN.lng - halfLng },
      { lat: ORIGIN.lat - halfLat, lng: ORIGIN.lng + halfLng },
      { lat: ORIGIN.lat + halfLat, lng: ORIGIN.lng + halfLng },
      { lat: ORIGIN.lat + halfLat, lng: ORIGIN.lng - halfLng },
      { lat: ORIGIN.lat - halfLat, lng: ORIGIN.lng - halfLng },
    ];
    const donut: OsmFeature = {
      type: "relation",
      id: 42,
      tags: { type: "multipolygon", landuse: "grass" },
      members: [
        { type: "way", ref: 1, role: "outer", geometry: ring(0.001, 0.001) },
        { type: "way", ref: 2, role: "inner", geometry: ring(0.0005, 0.0005) },
      ],
    };

    // A box larger than the outer ring: the clip changes nothing at all.
    const clipped = buildAreaPlates([donut], {
      frame: FRAME,
      clipTo: box(0.01, 0.01),
    });
    const unclipped = buildAreaPlates([donut], { frame: FRAME });

    expect(areaOf(clipped)).toBeCloseTo(areaOf(unclipped), 3);
    // And the hole is genuinely subtracted: outer area is 4x the inner, so the
    // filled ring is 3/4 of the outer. A dropped hole would give the full outer.
    const outerOnly = areaOf(
      buildAreaPlates([{ ...donut, members: [donut.members[0]!] }], {
        frame: FRAME,
      }),
    );
    expect(areaOf(clipped)).toBeLessThan(outerOnly * 0.8);
  });
});
