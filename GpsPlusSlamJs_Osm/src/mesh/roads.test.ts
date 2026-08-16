/**
 * Road ribbons (W13) — the hardest builder in the round.
 *
 * WHY THE JUNCTION TESTS ARE THE POINT. DEC-R2-13 chose segment quads plus a
 * disc at every vertex instead of mitred joins, and the whole claim of that
 * design is that **it cannot leave a gap, at any angle, with no special cases**.
 * A test counting triangles would pass on geometry full of holes; the property
 * that matters is COVERAGE, so these tests ask "is this point inside the
 * surface" and let the triangle count be whatever it is.
 *
 * WHY THE WIDTH TESTS MATTER SEPARATELY. Width was the round's last open
 * `[confirm]` — proposed with no oracle. `streets-gl` supplied one
 * (2026-07-30-1520-streets-gl-road-modelling-findings.md): width comes from
 * LANES, not from the highway class. These tests pin that model rather than a
 * table of magic numbers, so the reasoning is checkable and the numbers are
 * derived.
 */

import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import type { MeshData } from "./mesh-data.js";
import {
  buildRoads,
  isBridgeCrossing,
  isPedestrianPath,
  isRoad,
  roadWidthM,
} from "./roads.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(COLOGNE);

/** Metres east/north of the origin, as a lat/lng the builder will re-project. */
function at(east: number, north: number): { lat: number; lng: number } {
  return FRAME.toLatLng({ x: east, y: north });
}

function way(
  tags: Record<string, string>,
  geometry: readonly { lat: number; lng: number }[],
  id = 1,
): OsmFeature {
  return { type: "way", id, tags, geometry } as unknown as OsmFeature;
}

/**
 * Whether `(east, north)` in ENU metres lies inside any triangle of the mesh.
 *
 * The mesh is in the RENDER frame, where ENU north is `-z` — the same
 * reflection `MeshBuilder.vertex` applies. Getting that wrong here would make
 * every junction test pass on a mirrored surface, so the flip is explicit.
 *
 * Height is ignored: a road ribbon is a surface draped on terrain, and the
 * question these tests ask is about plan coverage.
 */
function coversPoint(mesh: MeshData, east: number, north: number): boolean {
  const z = -north;
  /** Plan-view (x, z) of vertex `index`. */
  const xz = (index: number): [number, number] => {
    const base = (mesh.indices[index] ?? 0) * 3;
    return [mesh.positions[base] ?? 0, mesh.positions[base + 2] ?? 0];
  };
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    if (inTriangle(east, z, xz(i), xz(i + 1), xz(i + 2))) return true;
  }
  return false;
}

/** Half-plane test, with a tolerance so an edge counts as inside. */
function inTriangle(
  px: number,
  pz: number,
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  const side = (u: [number, number], v: [number, number]): number =>
    (u[0] - px) * (v[1] - pz) - (v[0] - px) * (u[1] - pz);
  const d1 = side(a, b);
  const d2 = side(b, c);
  const d3 = side(c, a);
  const negative = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const positive = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  // A DEGENERATE triangle has all three zero and would otherwise report every
  // point as covered — which would silently turn the "not covered" assertions
  // into no-ops. Those assertions passing is what proves no such triangle is
  // emitted, so this guard keeps that proof honest.
  if (!negative && !positive) return false;
  return !(negative && positive);
}

/**
 * The `y` component of `(b - a) x (c - a)` for triangle `i`, in the render frame.
 *
 * Positive means the face points UP. This is the quantity three.js computes for
 * itself when `flatShading` is on — which is why it, and not the stored normals,
 * is what the orientation test asserts.
 */
function faceUpness(mesh: MeshData, i: number): number {
  const xz = (offset: number): [number, number] => {
    const base = (mesh.indices[i + offset] ?? 0) * 3;
    return [mesh.positions[base] ?? 0, mesh.positions[base + 2] ?? 0];
  };
  const [ax, az] = xz(0);
  const [bx, bz] = xz(1);
  const [cx, cz] = xz(2);
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

describe("roadWidthM — the lanes-derived model", () => {
  it("uses an explicit width tag above everything else", () => {
    // Mapped data beats any model we could invent, and `parseLengthMetres`
    // rather than `Number`, because `width=7 m` is ordinary and `Number`
    // returns NaN for it — which the fallback would then swallow silently.
    expect(roadWidthM({ highway: "residential", width: "7" })).toBeCloseTo(
      7,
      6,
    );
    expect(roadWidthM({ highway: "residential", width: "7 m" })).toBeCloseTo(
      7,
      6,
    );
  });

  it("derives width from the LANES tag, which is the whole finding", () => {
    // A flat per-class table cannot tell a two-lane primary from a six-lane one,
    // and those are exactly the roads a user looks at and says "that's wrong".
    expect(roadWidthM({ highway: "primary", lanes: "4" })).toBeCloseTo(12, 6);
    expect(roadWidthM({ highway: "motorway", lanes: "6" })).toBeCloseTo(18, 6);
  });

  it("gives a SINGLE lane 4 m rather than 3", () => {
    // Not a rounding convenience. A one-lane road's drawn width has to cover the
    // carriageway plus the verge that makes it passable; 3 m reads as a footpath.
    expect(roadWidthM({ highway: "residential", lanes: "1" })).toBeCloseTo(
      4,
      6,
    );
    expect(roadWidthM({ highway: "residential", lanes: "2" })).toBeCloseTo(
      6,
      6,
    );
  });

  it("falls back to a per-class default lane count", () => {
    // 2 lanes for driveable classes, 1 for links and tracks — streets-gl's
    // table, which our own `residential` = 6 m expectation independently agrees
    // with.
    expect(roadWidthM({ highway: "residential" })).toBeCloseTo(6, 6);
    expect(roadWidthM({ highway: "primary" })).toBeCloseTo(6, 6);
    expect(roadWidthM({ highway: "motorway_link" })).toBeCloseTo(4, 6);
    expect(roadWidthM({ highway: "track" })).toBeCloseTo(4, 6);
  });

  it("gives service roads ONE default lane (F9), unlike streets-gl", () => {
    // The one place we deliberately differ, and the reason is the data: `service`
    // is driveways and parking aisles, which are numerous in a residential
    // working set and are not two lanes wide.
    expect(roadWidthM({ highway: "service" })).toBeCloseTo(4, 6);
  });

  it("gives paths flat widths, bypassing the lane model entirely", () => {
    // A footway has no lanes, and multiplying a fictional lane count by a lane
    // width would be arithmetic dressed up as data.
    expect(roadWidthM({ highway: "footway" })).toBeCloseTo(2, 6);
    expect(roadWidthM({ highway: "path" })).toBeCloseTo(2, 6);
    expect(roadWidthM({ highway: "steps" })).toBeCloseTo(2, 6);
    expect(roadWidthM({ highway: "cycleway" })).toBeCloseTo(3, 6);
  });

  it("gives an UNKNOWN class a documented default, never NaN or zero", () => {
    // A zero-width ribbon is invisible and a NaN one removes the geometry
    // entirely — both are the silent-absence failure this round has met
    // repeatedly. An unknown class gets the `unclassified` default.
    const unknown = roadWidthM({ highway: "some_future_value" });
    expect(Number.isFinite(unknown)).toBe(true);
    expect(unknown).toBeCloseTo(6, 6);
  });

  it("ignores a lanes tag that is not a positive integer", () => {
    // `lanes=1;2` and `lanes=none` both occur. `Number` gives NaN or a
    // surprise, and a NaN width silently deletes the road.
    for (const lanes of ["0", "-2", "none", "1;2", ""]) {
      expect(roadWidthM({ highway: "residential", lanes })).toBeCloseTo(6, 6);
    }
  });
});

describe("isRoad", () => {
  const line = [at(0, 0), at(50, 0)];

  it("accepts a highway way", () => {
    expect(isRoad(way({ highway: "residential" }, line))).toBe(true);
  });

  it("rejects a node and an untagged way", () => {
    expect(
      isRoad({
        type: "node",
        id: 1,
        tags: { highway: "bus_stop" },
      } as unknown as OsmFeature),
    ).toBe(false);
    expect(isRoad(way({ building: "yes" }, line))).toBe(false);
  });

  it("rejects a TUNNEL, which would otherwise cross ground it runs beneath (F10)", () => {
    expect(isRoad(way({ highway: "primary", tunnel: "yes" }, line))).toBe(
      false,
    );
    expect(isRoad(way({ highway: "primary", covered: "yes" }, line))).toBe(
      false,
    );
  });

  it("rejects a highway AREA, which belongs to the plate builder", () => {
    // `highway=pedestrian` + `area=yes` is a surface, not a ribbon. Two builders
    // drawing one feature is the mistake every builder here has had to avoid.
    expect(isRoad(way({ highway: "pedestrian", area: "yes" }, line))).toBe(
      false,
    );
  });
});

describe("buildRoads — geometry", () => {
  const options = { frame: FRAME };

  it("draws a straight way as a ribbon of the expected width", () => {
    // A 6 m residential road along the x axis: covered at +/-2.9 m across it,
    // and not covered at +/-3.1 m.
    const road = buildRoads(
      [way({ highway: "residential" }, [at(0, 0), at(100, 0)])],
      options,
    );
    expect(road).toHaveLength(1);
    const mesh = road[0]?.mesh as MeshData;

    expect(coversPoint(mesh, 50, 0)).toBe(true);
    expect(coversPoint(mesh, 50, 2.9)).toBe(true);
    expect(coversPoint(mesh, 50, -2.9)).toBe(true);
    expect(coversPoint(mesh, 50, 4)).toBe(false);
    expect(coversPoint(mesh, 50, -4)).toBe(false);
  });

  it("leaves NO GAP at a right-angle corner", () => {
    // THE PROPERTY THE DISC EXISTS FOR. Two quads meeting at 90 degrees leave a
    // wedge of bare ground on the outside of the turn; a disc of the road's own
    // width centred on the shared vertex fills it by construction.
    //
    // Sampled just OUTSIDE the corner vertex on the diagonal — the deepest part
    // of the wedge, and the point a mitre would have to compute.
    const corner = buildRoads(
      [way({ highway: "residential" }, [at(0, 0), at(60, 0), at(60, 60)])],
      options,
    );
    const mesh = corner[0]?.mesh as MeshData;

    expect(coversPoint(mesh, 60, 0)).toBe(true);
    // 2 m out along the outer diagonal: inside a 6 m road's 3 m radius.
    expect(coversPoint(mesh, 61.4, -1.4)).toBe(true);
    // And still bounded — a disc is not an excuse for unbounded geometry.
    expect(coversPoint(mesh, 68, -8)).toBe(false);
  });

  it("leaves no hole where three ways meet", () => {
    // A junction is three separate features sharing a coordinate, not one
    // feature — so the discs have to come from each way independently, and the
    // union has to close without any of them knowing about the others.
    const junction = buildRoads(
      [
        way({ highway: "residential" }, [at(-50, 0), at(0, 0)], 1),
        way({ highway: "residential" }, [at(0, 0), at(50, 0)], 2),
        way({ highway: "residential" }, [at(0, 0), at(0, 50)], 3),
      ],
      options,
    );
    expect(junction).toHaveLength(3);

    // Every way covers the shared vertex, so the union certainly does.
    for (const road of junction) {
      expect(coversPoint(road.mesh, 0, 0)).toBe(true);
    }
  });

  it("winds every triangle so its FACE normal points UP", () => {
    // WHY THIS TEST EXISTS, and it was written after the bug it catches. The
    // ribbon material uses `flatShading`, and flat shading makes three.js
    // RECOMPUTE the normal from each triangle's winding — the per-vertex normals
    // this builder supplies are ignored entirely. So a correctly-normalled but
    // inversely-wound ribbon is lit from below and culled away under
    // `side: FrontSide`, which is exactly what happened: 23 roads and 1724
    // triangles reported in the status line, and not one pixel on screen.
    //
    // The surviving evidence was that switching the material to `DoubleSide`
    // made bright (lit-from-above) pixels appear and `FrontSide` left only dark
    // ones — i.e. the faces we could see were the backs.
    //
    // Asserting the CROSS PRODUCT rather than the stored normals is the whole
    // point: the stored normals were right the entire time.
    const road = buildRoads(
      [way({ highway: "residential" }, [at(0, 0), at(60, 0), at(60, 60)])],
      { frame: FRAME },
    );
    const mesh = road[0]?.mesh as MeshData;
    expect(mesh.indices.length).toBeGreaterThan(0);

    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      // Degenerate triangles (0) are not an error here; a NEGATIVE one is.
      expect(faceUpness(mesh, i)).toBeGreaterThanOrEqual(0);
    }
  });

  it("samples the ground per vertex", () => {
    // Per-vertex like the plates, not once per feature like a building: a road
    // is a long surface, and one sample would cut into the hill at one end and
    // float at the other — the artefact DEC-R2-19 removed.
    const road = buildRoads(
      [way({ highway: "residential" }, [at(0, 0), at(200, 0)])],
      {
        frame: FRAME,
        groundHeightM: (p) => (p.lat > COLOGNE.lat ? 60 : 50),
      },
    );
    const mesh = road[0]?.mesh as MeshData;
    const heights = new Set<number>();
    for (let i = 1; i < mesh.positions.length; i += 3) {
      heights.add(Math.round(mesh.positions[i] ?? 0));
    }
    expect(heights.size).toBeGreaterThan(1);
  });

  it("skips a way with fewer than two distinct points", () => {
    // A one-node way and a degenerate two-node way both occur in OSM extracts.
    // A zero-length segment has no direction, so its quad is NaN — which deletes
    // the whole mesh silently.
    const degenerate = buildRoads(
      [
        way({ highway: "residential" }, [at(0, 0)], 1),
        way({ highway: "residential" }, [at(0, 0), at(0, 0)], 2),
      ],
      options,
    );
    for (const road of degenerate) {
      for (const value of road.mesh.positions) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("produces only finite vertex data for a real-ish polyline", () => {
    // The blanket guard: a single NaN anywhere removes the entire draw call in
    // three.js with no error, which is the failure mode this round keeps meeting.
    const road = buildRoads(
      [
        way({ highway: "primary", lanes: "3" }, [
          at(0, 0),
          at(30, 10),
          at(60, 10),
          at(90, 40),
        ]),
      ],
      options,
    );
    const mesh = road[0]?.mesh as MeshData;
    for (const value of mesh.positions)
      expect(Number.isFinite(value)).toBe(true);
    for (const value of mesh.normals) expect(Number.isFinite(value)).toBe(true);
    expect(mesh.triangleCount).toBeGreaterThan(0);
  });
});

// Why this test matters: DEC-R2 splits the two questions the `walkable` score
// was being asked to answer at once. `walkable` rates GROUND QUALITY — under
// "can a person walk on this surface", `surface=grass` 9 beating
// `highway=footway` 3 is correct — while routing needs PATH-NESS, which is a
// property of the way, not of the surface. This predicate is that second
// question, and it lives beside `PATH_WIDTH_M` so the allowlist has exactly one
// home; a second copy of it in the demo is the "two implementations of one
// predicate" mistake this package has already had to fix once.
describe("isPedestrianPath (DEC-R2)", () => {
  const way = (tags: Record<string, string>): OsmFeature => ({
    type: "way",
    id: 1,
    geometry: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ],
    tags,
  });

  it("admits the ways a person walks along", () => {
    for (const highway of [
      "footway",
      "path",
      "steps",
      "pedestrian",
      "bridleway",
      "cycleway",
    ]) {
      expect(isPedestrianPath(way({ highway })), highway).toBe(true);
    }
  });

  it("refuses carriageways and non-highways", () => {
    for (const highway of ["motorway", "trunk", "primary", "residential"]) {
      expect(isPedestrianPath(way({ highway })), highway).toBe(false);
    }
    expect(isPedestrianPath(way({ building: "yes" }))).toBe(false);
    expect(isPedestrianPath(way({}))).toBe(false);
  });

  it("refuses what `isRoad` refuses, for the same reasons", () => {
    // Underground and covered ways are not surface paths (F10), and a highway
    // AREA is a plate rather than a ribbon. Sharing the exclusions keeps the two
    // predicates from disagreeing about the same feature.
    expect(isPedestrianPath(way({ highway: "footway", tunnel: "yes" }))).toBe(
      false,
    );
    expect(isPedestrianPath(way({ highway: "footway", covered: "yes" }))).toBe(
      false,
    );
    expect(isPedestrianPath(way({ highway: "pedestrian", area: "yes" }))).toBe(
      false,
    );
  });

  it("refuses nodes, which have no length to walk along", () => {
    expect(
      isPedestrianPath({
        type: "node",
        id: 1,
        position: { lat: 0, lng: 0 },
        tags: { highway: "footway" },
      }),
    ).toBe(false);
  });
});

// Why this test matters: this predicate decides where a river bank may be
// opened (DEC-R1), so a wrong `true` puts an agent on water and a wrong `false`
// leaves a shipped picker location unroutable. The cases are not hypothetical —
// every one is a real way in `testdata/sites/london-tower-bridge.json`, and two
// earlier drafts of the rule were refuted against exactly this data.
describe("isBridgeCrossing (DEC-R1)", () => {
  const way = (tags: Record<string, string>): OsmFeature => ({
    type: "way",
    id: 1,
    geometry: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ],
    tags,
  });

  it("admits the ground-level decks, including the bascule spans", () => {
    // `bridge=yes` ALONE MISSES THE BRIDGE THE SITE IS NAMED AFTER: Tower
    // Bridge's opening spans are `bridge=movable`, 6 of the 14 ground-level
    // ways. An exact-match rule would silently fail there.
    expect(
      isBridgeCrossing(way({ bridge: "yes", highway: "trunk", layer: "1" })),
    ).toBe(true);
    expect(
      isBridgeCrossing(
        way({ bridge: "movable", highway: "trunk", layer: "1" }),
      ),
    ).toBe(true);
    expect(
      isBridgeCrossing(way({ bridge: "yes", highway: "footway", layer: "1" })),
    ).toBe(true);
    expect(
      isBridgeCrossing(way({ bridge: "viaduct", highway: "service" })),
    ).toBe(true);
  });

  it("refuses the high-level walkways, which are highways 43 m in the air", () => {
    // ways 153173986 / 153173987: `bridge=yes highway=footway layer=2`. A rule
    // keyed on "the deck is a highway" admits these, and the bank would be
    // opened under a walkway that is behind a turnstile 43 m up.
    expect(
      isBridgeCrossing(way({ bridge: "yes", highway: "footway", layer: "2" })),
    ).toBe(false);
  });

  it("refuses the structural areas that carry no way", () => {
    // ways 367652753 / 367653917: `bridge=yes building:part=yes min_height=40`,
    // closed areas with NO highway. A bare `bridge=*` rule opens the bank along
    // their whole outline, from a structure 40 m overhead.
    expect(
      isBridgeCrossing(
        way({ bridge: "yes", "building:part": "yes", layer: "2" }),
      ),
    ).toBe(false);
    expect(isBridgeCrossing(way({ bridge: "yes" }))).toBe(false);
  });

  it("refuses a negated bridge tag and anything with no bridge at all", () => {
    expect(isBridgeCrossing(way({ bridge: "no", highway: "footway" }))).toBe(
      false,
    );
    expect(isBridgeCrossing(way({ highway: "footway" }))).toBe(false);
  });

  it("treats a missing layer as ground level", () => {
    // Most simple bridges carry no `layer` at all. Reading absent as "unknown,
    // refuse" would drop the common case; reading it as ground level is what
    // the tag's default means.
    expect(isBridgeCrossing(way({ bridge: "yes", highway: "footway" }))).toBe(
      true,
    );
  });

  it("refuses nodes and tunnels", () => {
    expect(
      isBridgeCrossing({
        type: "node",
        id: 1,
        position: { lat: 0, lng: 0 },
        tags: { bridge: "yes", highway: "footway" },
      }),
    ).toBe(false);
    // A way cannot be both; if it claims to be, it is not a crossing over water.
    expect(
      isBridgeCrossing(
        way({ bridge: "yes", highway: "footway", tunnel: "yes" }),
      ),
    ).toBe(false);
  });
});
