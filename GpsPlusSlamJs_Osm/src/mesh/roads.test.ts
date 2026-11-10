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
import { PEDESTRIAN_CLASSES, roadColour } from "./feature-colours.js";
import type { MeshData } from "./mesh-data.js";
import {
  ROAD_MITRE_LIMIT,
  ROAD_RANK_STEP_M,
  buildRoads,
  isBridgeCrossing,
  isPedestrianPath,
  isRoad,
  roadRank,
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
    // Two quads meeting at 90 degrees leave a wedge of bare ground on the
    // outside of the turn. Until M4a a disc on the shared vertex filled it;
    // since M4a the mitre joint does (the strip's two sides meet on the
    // bisector), and this test pins the outcome whichever closes it.
    //
    // Sampled just OUTSIDE the corner vertex on the diagonal — the deepest part
    // of the wedge.
    const corner = buildRoads(
      [way({ highway: "residential" }, [at(0, 0), at(60, 0), at(60, 60)])],
      options,
    );
    const mesh = corner[0]?.mesh as MeshData;

    expect(coversPoint(mesh, 60, 0)).toBe(true);
    // 2 m out along the outer diagonal: inside a 6 m road's 3 m radius.
    expect(coversPoint(mesh, 61.4, -1.4)).toBe(true);
    // And still bounded — a join is not an excuse for unbounded geometry.
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
      "platform",
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

  it("refuses a BELOW-SURFACE way, however it is tagged (PR #315 review)", () => {
    // Why this test matters: `level <= 1` also admits NEGATIVE layers, and
    // `isBridgeCrossing` is now wired into `addWater` via `bridgeDeckLines` --
    // so a `layer=-1` way opened a PASSAGE CORRIDOR through a river bank and an
    // agent could route across the water along something under it. Three
    // sibling rules in this package disagreed: `gateOpenings` vetoes a
    // below-surface gate node and `canCorroborate` vetoes a below-surface way,
    // while this one did not. One shared predicate now decides all three.
    expect(
      isBridgeCrossing(way({ bridge: "yes", highway: "footway", layer: "-1" })),
    ).toBe(false);
    expect(
      isBridgeCrossing(way({ bridge: "yes", highway: "footway", level: "-1" })),
    ).toBe(false);
    // `tunnel=yes` was already refused; `tunnel=culvert` was not, though
    // `below-surface.ts` has classified it as sub-surface all along.
    expect(
      isBridgeCrossing(
        way({ bridge: "yes", highway: "footway", tunnel: "culvert" }),
      ),
    ).toBe(false);
    expect(
      isBridgeCrossing(
        way({ bridge: "yes", highway: "footway", location: "underground" }),
      ),
    ).toBe(false);
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

describe("highway values that name Object.prototype members (M1 review finding 2)", () => {
  // WHY THIS TEST MATTERS. The width tables were plain objects, so
  // `PATH_WIDTH_M["constructor"]` found the inherited function: the road's
  // width came back as a function (NaN in the buffer, so the road vanished)
  // and `"toString" in PATH_WIDTH_M` made `toString` a footpath.
  // OSM values are free text, so every name below can arrive in a tile.
  const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype);

  it("gives each the unknown-class width", () => {
    const unknown = roadWidthM({ highway: "no_such_class" });
    for (const name of PROTOTYPE_NAMES) {
      expect(roadWidthM({ highway: name }), name).toBe(unknown);
    }
  });

  it("calls none of them a pedestrian path", () => {
    for (const name of PROTOTYPE_NAMES) {
      const feature: OsmFeature = {
        type: "way",
        id: 1,
        geometry: [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 0.001 },
        ],
        tags: { highway: name },
      };
      expect(isPedestrianPath(feature), name).toBe(false);
    }
  });
});

/** Triangles in a set of ribbons. */
function triangles(ribbons: readonly { mesh: MeshData }[]): number {
  return ribbons.reduce((sum, r) => sum + r.mesh.indices.length / 3, 0);
}

/** A turn of `deg` (left, counter-clockwise) at (0, 0), segments `len` long. */
function bend(deg: number, len = 20): { lat: number; lng: number }[] {
  const r = (deg * Math.PI) / 180;
  return [at(-len, 0), at(0, 0), at(Math.cos(r) * len, Math.sin(r) * len)];
}

/** The heights (render y) of every vertex at ENU (east, north). */
function heightsAt(mesh: MeshData, east: number, north: number): number[] {
  const found: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (
      Math.abs((mesh.positions[i] ?? 0) - east) < 1e-3 &&
      Math.abs((mesh.positions[i + 2] ?? 0) + north) < 1e-3
    ) {
      found.push(mesh.positions[i + 1] ?? 0);
    }
  }
  return found;
}

/** Every vertex height (render y) of a mesh. */
function allHeights(mesh: MeshData): number[] {
  const out: number[] = [];
  for (let i = 1; i < mesh.positions.length; i += 3) {
    out.push(mesh.positions[i] ?? 0);
  }
  return out;
}

/**
 * The mitre strip (city objects plan 2026-11-07-2315 M4a, owner decision
 * 2026-11-09 in its section 22). WHY THESE TESTS MATTER: a disc at every
 * vertex (DEC-R2-13) cost eight triangles per vertex, and dropping the disc
 * at near-straight points left the sawtooth the owner rejected on the O3
 * lab. The strip has to keep DEC-R2-13's promise (no gap at any angle)
 * without either: the counts pin "two triangles a segment, one per bevel,
 * eight per disc, discs only at ends and fallbacks", and the
 * coverage checks pin that no notch opens on either side.
 */
describe("buildRoads - the mitre strip (M4a)", () => {
  /** Two triangles a segment plus two end discs: a way with no joins to close. */
  const plain = (points: number): number => 2 * (points - 1) + 2 * 8;

  it("ships the mitre limit 2 as the default (bevels above 120 degrees)", () => {
    expect(ROAD_MITRE_LIMIT).toBe(2);
  });

  it("mitres a hair-thin turn even at limit 1 rather than bevelling a sliver", () => {
    // Found by the property test (seed -787614213): at limit 1 every turn
    // above zero exceeds the limit, and a turn of a millionth of a degree
    // (float noise on a straight way) got a bevel triangle with no area. Such
    // a turn's mitre is as long as the half width to the micrometre, so it is
    // mitred; a bevel is drawn only when its gap is at least a millimetre.
    const road = buildRoads(
      [
        way({ highway: "footway" }, [
          at(0, 0),
          at(3, 0),
          at(5.999999999999999, 6.345980621479719e-8),
        ]),
      ],
      {
        frame: FRAME,
        mitreLimit: 1,
      },
    );
    expect(triangles(road)).toBe(plain(3));
    const mesh = road[0]?.mesh as MeshData;
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const p = (k: number): [number, number] => {
        const base = (mesh.indices[i + k] ?? 0) * 3;
        return [mesh.positions[base] ?? 0, -(mesh.positions[base + 2] ?? 0)];
      };
      const [a, b, c] = [p(0), p(1), p(2)];
      const area =
        ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      expect(area).toBeGreaterThan(1e-6);
    }
    // A clear 30-degree turn at limit 1 still bevels.
    expect(
      triangles(
        buildRoads([way({ highway: "footway" }, bend(30))], {
          frame: FRAME,
          mitreLimit: 1,
        }),
      ),
    ).toBe(plain(3) + 1);
  });

  it("draws a straight way as two triangles a segment plus its two end discs", () => {
    const road = buildRoads(
      [
        way({ highway: "residential" }, [
          at(0, 0),
          at(10, 0),
          at(20, 0),
          at(30, 0),
        ]),
      ],
      { frame: FRAME },
    );
    expect(triangles(road)).toBe(plain(4));
    // The rounded end caps of DEC-R2-13 stay.
    expect(coversPoint(road[0]?.mesh as MeshData, -2.9, 0)).toBe(true);
    expect(coversPoint(road[0]?.mesh as MeshData, 32.9, 0)).toBe(true);
  });

  it("leaves no notch on either side of a near-straight curve (the owner's O3 defect)", () => {
    // A 6 m road along an arc turning 4 degrees at every vertex: the case the
    // dropped discs left a sawtooth on. Both sides are sampled at 97 % of the
    // half width on the bisector at every vertex, the deepest point of a
    // notch, and the strip covers them with no interior disc.
    const enu: { x: number; y: number }[] = [];
    let heading = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 12; i += 1) {
      enu.push({ x, y });
      x += 15 * Math.cos(heading);
      y += 15 * Math.sin(heading);
      heading += (4 * Math.PI) / 180;
    }
    const road = buildRoads(
      [
        way(
          { highway: "residential" },
          enu.map((p) => at(p.x, p.y)),
        ),
      ],
      { frame: FRAME },
    );
    const mesh = road[0]?.mesh as MeshData;
    expect(triangles(road)).toBe(plain(12));
    for (let k = 1; k + 1 < enu.length; k += 1) {
      const p = enu[k] as { x: number; y: number };
      const before = enu[k - 1] as { x: number; y: number };
      const after = enu[k + 1] as { x: number; y: number };
      const bisector =
        (Math.atan2(p.y - before.y, p.x - before.x) +
          Math.atan2(after.y - p.y, after.x - p.x)) /
        2;
      for (const side of [1, -1]) {
        expect(
          coversPoint(
            mesh,
            p.x - side * Math.sin(bisector) * 2.9,
            p.y + side * Math.cos(bisector) * 2.9,
          ),
        ).toBe(true);
      }
    }
  });

  it("mitres a 90 degree turn at the default limit, and bevels it under a limit of 1.4", () => {
    // 1 / cos(45 deg) = 1.414: a mitre at 2, a bevel at 1.4. The mitre point
    // of a 6 m road is (3, -3) from the corner on the outside of this left
    // turn; the bevel cuts it off and costs one triangle.
    const geometry = [at(-20, 0), at(0, 0), at(0, 20)];
    const mitred = buildRoads([way({ highway: "residential" }, geometry)], {
      frame: FRAME,
    });
    const bevelled = buildRoads([way({ highway: "residential" }, geometry)], {
      frame: FRAME,
      mitreLimit: 1.4,
    });
    expect(triangles(mitred)).toBe(plain(3));
    expect(triangles(bevelled)).toBe(plain(3) + 1);
    expect(coversPoint(mitred[0]?.mesh as MeshData, 2.9, -2.9)).toBe(true);
    expect(coversPoint(bevelled[0]?.mesh as MeshData, 2.9, -2.9)).toBe(false);
    // The bevel still closes the wedge up to its chord.
    expect(coversPoint(bevelled[0]?.mesh as MeshData, 1.4, -1.4)).toBe(true);
  });

  it("bevels a 130 degree turn at the default limit", () => {
    // 1 / cos(65 deg) = 2.37 > 2.
    expect(
      triangles(
        buildRoads([way({ highway: "residential" }, bend(130))], {
          frame: FRAME,
        }),
      ),
    ).toBe(plain(3) + 1);
    // 1 / cos(55 deg) = 1.74: still a mitre.
    expect(
      triangles(
        buildRoads([way({ highway: "residential" }, bend(110))], {
          frame: FRAME,
        }),
      ),
    ).toBe(plain(3));
  });

  it("falls back to a disc where the inner mitre point would run past half a neighbouring segment", () => {
    // A 6 m road turning 90 degrees: the inner point reaches h tan(45) = 3 m
    // along each segment, more than half of a 4 m segment. Two joins on one
    // short segment could cross and fold the strip, so the point takes a disc.
    const road = buildRoads(
      [way({ highway: "residential" }, [at(-20, 0), at(0, 0), at(0, 4)])],
      { frame: FRAME },
    );
    expect(triangles(road)).toBe(plain(3) + 8);
    expect(coversPoint(road[0]?.mesh as MeshData, 2, -2)).toBe(true);
  });

  it("falls back to a disc at a hairpin (a full reversal)", () => {
    const road = buildRoads(
      [way({ highway: "footway" }, [at(0, 0), at(20, 0), at(0, 0.0001)])],
      { frame: FRAME },
    );
    expect(triangles(road)).toBe(plain(3) + 8);
    expect(coversPoint(road[0]?.mesh as MeshData, 20.9, 0)).toBe(true);
  });

  it("runs a way through a junction like any other point: no break, no disc (M4a review MINOR 3)", () => {
    // WHY: without a kerb the junction disc drew nothing the strip did not,
    // cost eight triangles a junction, and made every ribbon depend on the
    // whole feature list. The way that ENDS at the junction brings its own
    // end disc; the way that runs through is one strip, mitred where it turns.
    const through = way(
      { highway: "residential" },
      [at(-30, 0), at(0, 0), at(30, 0)],
      1,
    );
    const turning = way(
      { highway: "residential" },
      [at(0, -30), at(0, 0), at(30, 30)],
      2,
    );
    const side = way({ highway: "footway" }, [at(0, 0), at(0, 30)], 3);
    const ribbons = buildRoads([through, turning, side], { frame: FRAME });
    expect(triangles(ribbons.slice(0, 1))).toBe(plain(3));
    // 45 degrees at the shared point: a mitre, as anywhere else.
    expect(triangles(ribbons.slice(1, 2))).toBe(plain(3));
    expect(triangles(ribbons.slice(2))).toBe(plain(2));
    // The junction is still covered by both carriageways.
    expect(coversPoint(ribbons[0]?.mesh as MeshData, 0, 2.9)).toBe(true);
    expect(coversPoint(ribbons[1]?.mesh as MeshData, -2.9, 0)).toBe(true);
  });

  it("builds every way from its own geometry alone, so roads can be built over a delta", () => {
    // WHY: the M4a junction set made `buildRoads` a whole-call pass, the one
    // reason roads left the decomposable builders. Each way alone must give
    // exactly the ribbon it gives among the others.
    const a = way(
      { highway: "residential" },
      [at(-30, 0), at(0, 0), at(30, 5)],
      1,
    );
    const b = way({ highway: "footway" }, [at(0, 0), at(0, 30)], 2);
    const together = buildRoads([a, b], { frame: FRAME });
    const alone = [
      ...buildRoads([a], { frame: FRAME }),
      ...buildRoads([b], { frame: FRAME }),
    ];
    expect(alone.map((r) => [...r.mesh.positions])).toEqual(
      together.map((r) => [...r.mesh.positions]),
    );
    expect(alone.map((r) => [...r.mesh.indices])).toEqual(
      together.map((r) => [...r.mesh.indices]),
    );
  });

  it("mitres through a point one way visits twice", () => {
    // A figure eight: (30, 0) is passed twice, straight both times, and is
    // mitred like any point (the strip overlaps itself in its own colour).
    // (60, 30) turns 135 degrees, over the mitre limit, and takes one bevel
    // triangle.
    const road = buildRoads(
      [
        way({ highway: "footway" }, [
          at(0, 0),
          at(30, 0),
          at(60, 0),
          at(60, 30),
          at(30, 0),
          at(0, -30),
        ]),
      ],
      { frame: FRAME },
    );
    expect(triangles(road)).toBe(plain(6) + 1);
  });

  it("does not depend on the input order of the ways", () => {
    const a = way(
      { highway: "residential" },
      [at(-30, 0), at(0, 0), at(30, 5)],
      1,
    );
    const b = way({ highway: "footway" }, [at(0, 0), at(0, 30)], 2);
    const ab = buildRoads([a, b], { frame: FRAME });
    const ba = buildRoads([b, a], { frame: FRAME });
    expect(ab[0]?.mesh.positions).toEqual(ba[1]?.mesh.positions);
    expect(ab[1]?.mesh.positions).toEqual(ba[0]?.mesh.positions);
  });

  it("winds every strip, bevel and disc triangle face up, none degenerate", () => {
    // Strictly positive: a folded strip shows up as a NEGATIVE face here.
    for (const deg of [0, 30, 90, 130, 170]) {
      for (const mitreLimit of [1, 2, 4]) {
        const road = buildRoads([way({ highway: "primary" }, bend(deg))], {
          frame: FRAME,
          mitreLimit,
        });
        const mesh = road[0]?.mesh as MeshData;
        for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
          expect(faceUpness(mesh, i)).toBeGreaterThan(1e-6);
        }
      }
    }
  });

  it("refuses a mitre limit below 1 or not finite", () => {
    const features = [way({ highway: "footway" }, [at(0, 0), at(30, 0)])];
    for (const mitreLimit of [0.99, -1, Number.NaN, Infinity]) {
      expect(() => buildRoads(features, { frame: FRAME, mitreLimit })).toThrow(
        RangeError,
      );
    }
    expect(() =>
      buildRoads(features, { frame: FRAME, mitreLimit: 1 }),
    ).not.toThrow();
  });
});

/**
 * Class order (M4a): a carriageway covers the footway that crosses it, and a
 * way's discs sit at its own strip's height. WHY: the ribbons of one chunk are one
 * mesh at one ground height, so two overlapping ribbons z-fight or show
 * whichever the depth test happens to keep. The lift is geometric, inside
 * one rung of OsmDemo's 4 cm ground ladder (the M4a spike's choice).
 */
describe("buildRoads - class order (M4a)", () => {
  it("ranks paths lowest, then service and track, then local streets, then the rest", () => {
    expect(roadRank({ highway: "footway" })).toBe(0);
    expect(roadRank({ highway: "footway", footway: "sidewalk" })).toBe(0);
    expect(roadRank({ highway: "cycleway" })).toBe(0);
    expect(roadRank({ highway: "steps" })).toBe(0);
    expect(roadRank({ highway: "service" })).toBe(1);
    expect(roadRank({ highway: "track" })).toBe(1);
    expect(roadRank({ highway: "residential" })).toBe(2);
    expect(roadRank({ highway: "living_street" })).toBe(2);
    expect(roadRank({ highway: "primary" })).toBe(3);
    expect(roadRank({ highway: "some_future_value" })).toBe(3);
    expect(roadRank({})).toBe(3);
    // A free-text value never finds an inherited property.
    expect(roadRank({ highway: "constructor" })).toBe(3);
  });

  it("draws `highway=platform` as the path the class order says it is", () => {
    // WHY THIS TEST MATTERS (#909 review). `platform` reached the class order
    // at rank 0 but none of the other path tables, so a bus platform drew
    // with the unknown-class width (6 m), was no pedestrian path, and took
    // `surface` first for its colour: three tables, three answers.
    const tags = { highway: "platform" };
    expect(roadRank(tags)).toBe(0);
    expect(roadWidthM(tags)).toBe(roadWidthM({ highway: "pedestrian" }));
    expect(roadWidthM(tags)).toBe(2);
    expect(
      isPedestrianPath({
        type: "way",
        id: 1,
        geometry: [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 0.001 },
        ],
        tags,
      }),
    ).toBe(true);
    // Its colour is a pedestrian class's: the class wins over `surface`.
    expect(roadColour({ ...tags, surface: "asphalt" })).toBe(roadColour(tags));
    expect(PEDESTRIAN_CLASSES).toContain("platform");
  });

  it("ranks a class 0 exactly when it is a pedestrian path, and every pedestrian colour class is one", () => {
    // WHY THIS TEST MATTERS. The path list lives in `PATH_WIDTH_M` and the
    // rank table derives its rank-0 entries from it; this pins that the two
    // cannot disagree, over the classes the colour table names plus some it
    // does not. `PEDESTRIAN_CLASSES` (the colour exception) is a subset of
    // the paths: `bridleway` is a path but deliberately not one of them.
    const way = (highway: string): OsmFeature => ({
      type: "way",
      id: 1,
      geometry: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
      ],
      tags: { highway },
    });
    const classes = [
      ...PEDESTRIAN_CLASSES,
      "bridleway",
      "track",
      "service",
      "residential",
      "living_street",
      "unclassified",
      "busway",
      "primary",
      "motorway",
      "some_future_value",
    ];
    for (const highway of classes) {
      expect(roadRank({ highway }) === 0, highway).toBe(
        isPedestrianPath(way(highway)),
      );
    }
    for (const highway of PEDESTRIAN_CLASSES) {
      expect(isPedestrianPath(way(highway)), highway).toBe(true);
    }
    // The colour list is still a second list (feature-colours.ts), so pin
    // the other direction over the common `highway` values OSM documents for
    // ways: the only path that is not a pedestrian colour class is
    // `bridleway`. A path added to `PATH_WIDTH_M` alone fails here, unless
    // it is a value missing from this list.
    // Named here, not spread from `PEDESTRIAN_CLASSES`: a class missing
    // from the colour list must still be in this one.
    const documented = [
      ...classes,
      "footway",
      "path",
      "steps",
      "pedestrian",
      "platform",
      "cycleway",
      "tertiary",
      "secondary",
      "trunk",
      "motorway_link",
      "trunk_link",
      "primary_link",
      "secondary_link",
      "tertiary_link",
      "road",
      "corridor",
      "bus_guideway",
      "escape",
      "raceway",
      "via_ferrata",
      "elevator",
      "construction",
      "proposed",
    ];
    const pathsWithoutPedestrianColour = documented.filter(
      (highway) =>
        isPedestrianPath(way(highway)) &&
        !(PEDESTRIAN_CLASSES as readonly string[]).includes(highway),
    );
    expect(new Set(pathsWithoutPedestrianColour)).toEqual(
      new Set(["bridleway"]),
    );
  });

  it("lifts a carriageway above the footway that crosses it", () => {
    const ribbons = buildRoads(
      [
        way({ highway: "footway" }, [at(0, -20), at(0, 0), at(0, 20)], 1),
        way({ highway: "residential" }, [at(-30, 0), at(0, 0), at(30, 0)], 2),
      ],
      { frame: FRAME },
    );
    const footway = allHeights(ribbons[0]?.mesh as MeshData);
    const road = allHeights(ribbons[1]?.mesh as MeshData);
    expect(Math.min(...road)).toBeGreaterThan(Math.max(...footway));
  });

  it("puts a way's discs at its own strip's height, never under it", () => {
    // WHY (owner decision 2026-11-09, city objects plan section 27): a disc
    // half a step under its strip left a higher class's END disc 0.1 step
    // (0.5 mm) over a lower class's strip, which fought on the GPU at 226 m
    // (12.6 % of the overlap). At the strip's own height the disc is
    // coplanar only with its own strip, whose colour it shares, and every gap
    // to another class is the strips' 0.6 step. The end disc's centre and
    // the strip's corner beside it, where the disc's rim has a vertex too.
    const road = buildRoads(
      [way({ highway: "residential" }, [at(0, 0), at(30, 0)])],
      { frame: FRAME },
    );
    const mesh = road[0]?.mesh as MeshData;
    const [disc] = heightsAt(mesh, 0, 0);
    const corner = heightsAt(mesh, 0, 3);
    expect(disc).toBeDefined();
    expect(corner).toHaveLength(2);
    for (const h of corner) expect(h).toBeCloseTo(disc as number, 9);
    // Rank 2 at the default step: the lift is 2 + 0.4 f steps, f in [0, 1).
    expect(disc).toBeGreaterThanOrEqual(2 * ROAD_RANK_STEP_M);
    expect(disc).toBeLessThan(2.4 * ROAD_RANK_STEP_M);
  });

  it("keeps every lift inside 2 cm, under half of OsmDemo's 4 cm ground rung", () => {
    // M4b's zebras need the room above (2.5 cm), and the areas rung of
    // OsmDemo's ladder (`layer-order.ts`) starts 4 cm above the roads'.
    const ribbons = buildRoads(
      [
        way({ highway: "primary" }, [at(0, 0), at(30, 0)], 1),
        way({ highway: "footway" }, [at(0, 5), at(30, 5)], 2),
      ],
      { frame: FRAME },
    );
    for (const r of ribbons) {
      for (const h of allHeights(r.mesh)) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(0.02);
      }
    }
    expect(ROAD_RANK_STEP_M).toBeGreaterThan(0);
  });

  it("draws everything on the ground with a rank step of 0 (today's heights)", () => {
    const ribbons = buildRoads(
      [way({ highway: "primary" }, [at(0, 0), at(30, 0)])],
      { frame: FRAME, rankStepM: 0 },
    );
    for (const h of allHeights(ribbons[0]?.mesh as MeshData)) expect(h).toBe(0);
  });

  it("refuses a rank step that is negative or not finite", () => {
    const features = [way({ highway: "footway" }, [at(0, 0), at(30, 0)])];
    for (const rankStepM of [-0.001, Number.NaN, Infinity]) {
      expect(() => buildRoads(features, { frame: FRAME, rankStepM })).toThrow(
        RangeError,
      );
    }
  });
});
