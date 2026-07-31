/**
 * The S3DB pipeline: heights, extrusion, roofs, `building:part`, and trees.
 *
 * WHY THESE TESTS MATTER. Mesh bugs do not throw. A building extruded in
 * degrees is sheared, a roof with inverted normals is invisible from outside,
 * an outline drawn as well as its parts puts a box through a cathedral — and
 * every one of those renders something. So the assertions here are geometric
 * facts (bounding boxes in METRES, triangle counts, normal directions) rather
 * than "it produced a mesh".
 */

import { describe, expect, it } from "vitest";

import { enuFrameAt, ringToEnu } from "./enu.js";
import type { EnuPoint } from "./enu.js";
import {
  DEFAULT_BUILDING_HEIGHT_M,
  parseLengthMetres,
  resolveHeights,
} from "./building-heights.js";
import { extrudeBuilding, mergeMeshes } from "./extrude.js";
import { buildBuildings } from "./buildings.js";
import { buildTrees, packInstances, stableHash } from "./trees.js";
import type { OsmFeature } from "../model/osm-feature.js";

const ORIGIN = { lat: 50.9413, lng: 6.9583 };
const frame = enuFrameAt(ORIGIN);

/** A 10 m x 20 m rectangle in the ENU frame. */
const rectangle: EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];

function bounds(positions: Float32Array) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < positions.length; i += 3) {
    minY = Math.min(minY, positions[i] as number);
    maxY = Math.max(maxY, positions[i] as number);
  }
  return { minY, maxY };
}

describe("the ENU frame", () => {
  it("converts degrees to METRES, with longitude scaled by latitude", () => {
    // The whole reason this frame exists: a degree of longitude is ~111 km at
    // the equator and ~71 km at 50.9N. Building meshes in raw degrees shear.
    const east = frame.toEnu({ lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001 });
    const north = frame.toEnu({ lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng });

    expect(north.y).toBeCloseTo(111.32, 1);
    expect(east.x).toBeCloseTo(
      111.32 * Math.cos((ORIGIN.lat * Math.PI) / 180),
      1,
    );
    // ~63 % of the northward distance at this latitude — the anisotropy itself.
    expect(east.x / north.y).toBeCloseTo(0.63, 2);
  });

  it("round-trips a position", () => {
    const there = { lat: ORIGIN.lat + 0.002, lng: ORIGIN.lng - 0.003 };
    const back = frame.toLatLng(frame.toEnu(there));
    expect(back.lat).toBeCloseTo(there.lat, 9);
    expect(back.lng).toBeCloseTo(there.lng, 9);
  });

  it("makes a square footprint square in metres", () => {
    // 20 m of latitude and 20 m of longitude. In degrees these differ by ~36 %;
    // in the ENU frame they must not.
    const dLat = 20 / 111_320;
    const dLng = dLat / Math.cos((ORIGIN.lat * Math.PI) / 180);
    const ring = ringToEnu(
      [
        ORIGIN,
        { lat: ORIGIN.lat, lng: ORIGIN.lng + dLng },
        { lat: ORIGIN.lat + dLat, lng: ORIGIN.lng + dLng },
        { lat: ORIGIN.lat + dLat, lng: ORIGIN.lng },
      ],
      frame,
    );
    expect(ring[1]?.x).toBeCloseTo(20, 3);
    expect(ring[2]?.y).toBeCloseTo(20, 3);
  });
});

describe("height resolution", () => {
  it("prefers an explicit height over levels", () => {
    expect(
      resolveHeights({ height: "12", "building:levels": "2" }).totalHeightM,
    ).toBe(12);
  });

  it("falls back to levels x 3 m", () => {
    expect(resolveHeights({ "building:levels": "4" }).totalHeightM).toBe(12);
  });

  it("guesses, and SAYS it guessed, when nothing is mapped", () => {
    // The census found only 16 % of buildings carry `height`. A silent default
    // would make "we know this is 6 m" and "we have no idea" indistinguishable.
    const heights = resolveHeights({ building: "yes" });
    expect(heights.totalHeightM).toBe(DEFAULT_BUILDING_HEIGHT_M);
    expect(heights.heightIsGuessed).toBe(true);
  });

  it("reads min_height, which is what makes building:part work", () => {
    const heights = resolveHeights({ height: "30", min_height: "12" });
    expect(heights.minHeightM).toBe(12);
    expect(heights.totalHeightM).toBe(30);
  });

  it("gives a NON-FLAT roof a height even when nothing tags one", () => {
    // WHY THIS TEST MATTERS — it is the root cause of R3-1/R4-7, found by the
    // fixture corpus after three rounds of reading the source.
    //
    // `roof:height` and `roof:levels` are both rare. Defaulting the roof height
    // to zero meant a part tagged `roof:shape=pyramidal` with only a `height`
    // got `eaveHeightM === totalHeightM`, so the roof generator built a pyramid
    // of zero height — a FLAT CAP over the full footprint. At Cologne Cathedral
    // that is `way/206020152`, the 71 m lower tower body: it rendered as a
    // flat-topped prism with 59 vertices across its top, while the actual spire
    // parts above it (min_height 71, tapering to 157 m) tapered correctly. That
    // is exactly the reported picture — "twin towers as flat-topped prisms with
    // a finer spire behind them".
    //
    // OSM2World never lets this happen: `LevelAndHeightData` falls back to
    // `DEFAULT_RIDGE_HEIGHT` (5 m), or 1 m for a single-level building, and only
    // a FlatRoof gets zero.
    const tower = resolveHeights({ height: "71", "roof:shape": "pyramidal" });
    expect(tower.totalHeightM).toBe(71);
    // The roof has to occupy some of that height, or there is no roof.
    expect(tower.eaveHeightM).toBeLessThan(tower.totalHeightM);

    // A single-level building gets a smaller default: a 5 m ridge on a 3 m
    // cottage is most of the building.
    const cottage = resolveHeights({
      "building:levels": "1",
      "roof:shape": "gabled",
    });
    expect(cottage.eaveHeightM).toBeLessThan(cottage.totalHeightM);
    expect(cottage.totalHeightM - cottage.eaveHeightM).toBeLessThan(2);
  });

  it("still gives a FLAT roof no height at all", () => {
    // The other direction, and the reason the fix is conditional: a flat roof
    // with a phantom 5 m of "roof" would lower every untagged building's walls
    // by 5 m — a far more common case than the one being fixed.
    const heights = resolveHeights({ height: "20" });
    expect(heights.roofShape).toBe("flat");
    expect(heights.eaveHeightM).toBe(20);
    expect(heights.totalHeightM).toBe(20);
  });

  it("lets a tagged roof height win over the default", () => {
    const heights = resolveHeights({
      height: "20",
      "roof:shape": "gabled",
      "roof:height": "2",
    });
    expect(heights.eaveHeightM).toBe(18);
  });

  it("clamps a roof taller than its building", () => {
    // A mistyped roof:height=30 on a 10 m house would otherwise spike through
    // the sky — the most visible bad-data artefact there is.
    const heights = resolveHeights({ height: "10", "roof:height": "30" });
    expect(heights.eaveHeightM).toBeGreaterThanOrEqual(0);
    expect(heights.eaveHeightM).toBeLessThanOrEqual(heights.totalHeightM);
  });

  it("parses feet as well as metres, and junk as undefined", () => {
    expect(parseLengthMetres("12")).toBe(12);
    expect(parseLengthMetres("12 m")).toBe(12);
    expect(parseLengthMetres("40'")).toBeCloseTo(12.192, 3);
    // Not 0: a zero-height building is invisible, which reads as "not mapped"
    // rather than as "bad tag".
    expect(parseLengthMetres("about 12")).toBeUndefined();
  });

  it("falls back to flat for a roof shape it cannot generate", () => {
    // A flat roof of the right footprint at the right height is a far smaller
    // error than a confidently wrong `gambrel`.
    expect(resolveHeights({ "roof:shape": "gambrel" }).roofShape).toBe("flat");
    expect(resolveHeights({ "roof:shape": "gabled" }).roofShape).toBe("gabled");
  });
});

describe("extrusion", () => {
  it("builds walls and a cap between the given heights", () => {
    const mesh = extrudeBuilding([rectangle], {
      minHeightM: 0,
      eaveHeightM: 9,
      totalHeightM: 9,
      roofShape: "flat",
    });
    const { minY, maxY } = bounds(mesh.positions);
    expect(minY).toBeCloseTo(0, 6);
    expect(maxY).toBeCloseTo(9, 6);
    // 4 walls x 2 triangles + 2 cap triangles.
    expect(mesh.triangleCount).toBe(10);
  });

  it("starts the walls at min_height for a floating part", () => {
    const mesh = extrudeBuilding([rectangle], {
      minHeightM: 12,
      eaveHeightM: 30,
      totalHeightM: 30,
      roofShape: "flat",
    });
    const { minY, maxY } = bounds(mesh.positions);
    expect(minY).toBeCloseTo(12, 6);
    expect(maxY).toBeCloseTo(30, 6);
  });

  it("offsets the whole volume by the ground height", () => {
    const mesh = extrudeBuilding([rectangle], {
      minHeightM: 0,
      eaveHeightM: 9,
      totalHeightM: 9,
      roofShape: "flat",
      groundHeightM: 50,
    });
    const { minY, maxY } = bounds(mesh.positions);
    expect(minY).toBeCloseTo(50, 6);
    expect(maxY).toBeCloseTo(59, 6);
  });

  it("gives every wall a horizontal outward normal", () => {
    // A wall normal with a Y component means the quad is twisted; a wall normal
    // pointing inward means the building vanishes under backface culling.
    const mesh = extrudeBuilding([rectangle], {
      minHeightM: 0,
      eaveHeightM: 9,
      totalHeightM: 9,
      roofShape: "flat",
    });
    let horizontal = 0;
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const ny = mesh.normals[i + 1] as number;
      if (Math.abs(ny) < 1e-6) horizontal++;
    }
    // 4 walls x 4 vertices.
    expect(horizontal).toBe(16);
  });

  it("returns an empty mesh for a footprint that cannot form a volume", () => {
    const mesh = extrudeBuilding(
      [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
      {
        minHeightM: 0,
        eaveHeightM: 9,
        totalHeightM: 9,
        roofShape: "flat",
      },
    );
    expect(mesh.triangleCount).toBe(0);
  });

  it("walls a courtyard on the inside too", () => {
    const hole: EnuPoint[] = [
      { x: 3, y: 5 },
      { x: 7, y: 5 },
      { x: 7, y: 15 },
      { x: 3, y: 15 },
    ];
    const withHole = extrudeBuilding([rectangle, hole], {
      minHeightM: 0,
      eaveHeightM: 9,
      totalHeightM: 9,
      roofShape: "flat",
    });
    const solid = extrudeBuilding([rectangle], {
      minHeightM: 0,
      eaveHeightM: 9,
      totalHeightM: 9,
      roofShape: "flat",
    });
    // A courtyard has inner-facing walls. Omitting them leaves a building you
    // can see straight through from inside the yard.
    expect(withHole.triangleCount).toBeGreaterThan(solid.triangleCount);
  });
});

describe("roofs", () => {
  const base = { minHeightM: 0, eaveHeightM: 9, totalHeightM: 13 };

  it("raises a pyramidal roof to the total height", () => {
    const mesh = extrudeBuilding([rectangle], {
      ...base,
      roofShape: "pyramidal",
    });
    expect(bounds(mesh.positions).maxY).toBeCloseTo(13, 6);
  });

  it("closes a gabled roof at both ends", () => {
    // Two slopes + two gable triangles. Without the gables the building is open
    // at both ends — visible from the street, and a classic omission.
    const mesh = extrudeBuilding([rectangle], { ...base, roofShape: "gabled" });
    expect(bounds(mesh.positions).maxY).toBeCloseTo(13, 6);
    expect(mesh.triangleCount).toBe(8 + 4 + 2);
  });

  it("slopes all four sides of a hipped roof", () => {
    const mesh = extrudeBuilding([rectangle], { ...base, roofShape: "hipped" });
    expect(bounds(mesh.positions).maxY).toBeCloseTo(13, 6);
  });

  it("keeps a skillion within its eave and ridge heights", () => {
    const mesh = extrudeBuilding([rectangle], {
      ...base,
      roofShape: "skillion",
    });
    const { minY, maxY } = bounds(mesh.positions);
    expect(minY).toBeCloseTo(0, 6);
    expect(maxY).toBeCloseTo(13, 6);
  });

  it("degrades to flat when there is no rise to work with", () => {
    const mesh = extrudeBuilding([rectangle], {
      minHeightM: 0,
      eaveHeightM: 9,
      totalHeightM: 9,
      roofShape: "gabled",
    });
    expect(bounds(mesh.positions).maxY).toBeCloseTo(9, 6);
  });
});

describe("building:part", () => {
  const outline: OsmFeature = {
    type: "way",
    id: 1,
    tags: { building: "cathedral" },
    geometry: [
      { lat: 50.9413, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9583 },
    ],
  };
  const tower: OsmFeature = {
    type: "way",
    id: 2,
    tags: { "building:part": "yes", height: "157" },
    geometry: [
      { lat: 50.94145, lng: 6.95845 },
      { lat: 50.94145, lng: 6.95865 },
      { lat: 50.94165, lng: 6.95865 },
      { lat: 50.94165, lng: 6.95845 },
      { lat: 50.94145, lng: 6.95845 },
    ],
  };

  it("does NOT extrude an outline that has parts", () => {
    // THE most visible S3DB mistake: drawing the outline as well as its parts
    // puts a box straight through every detailed building.
    const volumes = buildBuildings([outline, tower], { frame });
    expect(volumes.map((v) => v.feature)).toEqual(["way/2"]);
    expect(volumes[0]?.parentFeature).toBe("way/1");
  });

  it("extrudes an outline with no parts as its own volume", () => {
    const volumes = buildBuildings([outline], { frame });
    expect(volumes.map((v) => v.feature)).toEqual(["way/1"]);
  });

  it("keeps a part whose parent outline is absent", () => {
    // A tile boundary can deliver the part without its parent. Dropping it
    // would erase the building entirely.
    const volumes = buildBuildings([tower], { frame });
    expect(volumes.map((v) => v.feature)).toEqual(["way/2"]);
  });

  it("carries the part's own height, which is where the detail comes from", () => {
    const volumes = buildBuildings([outline, tower], { frame });
    expect(volumes[0]?.heights.totalHeightM).toBe(157);
  });

  it("ignores features that are not buildings", () => {
    const road: OsmFeature = {
      type: "way",
      id: 3,
      tags: { highway: "residential" },
      geometry: outline.type === "way" ? outline.geometry : [],
    };
    expect(buildBuildings([road], { frame })).toEqual([]);
  });
});

describe("trees", () => {
  const tree = (
    id: number,
    lat: number,
    tags: Record<string, string>,
  ): OsmFeature => ({
    type: "node",
    id,
    position: { lat, lng: ORIGIN.lng },
    tags: { natural: "tree", ...tags },
  });

  it("places one instance per tree node", () => {
    const placements = buildTrees(
      [tree(1, 50.9413, {}), tree(2, 50.9414, {})],
      {
        frame,
      },
    );
    expect(placements).toHaveLength(2);
  });

  it("is DETERMINISTIC — the same tree looks the same every run", () => {
    // This is an AR overlay used to judge pose accuracy. A forest that
    // reshuffles between frames, or between two phones standing next to each
    // other, is useless for that. So the randomness is hashed, not random.
    const once = buildTrees([tree(1, 50.9413, {})], { frame })[0];
    const twice = buildTrees([tree(1, 50.9413, {})], { frame })[0];
    expect(once?.rotationY).toBe(twice?.rotationY);
    expect(once?.heightM).toBe(twice?.heightM);
  });

  it("varies untagged trees so a row does not look like clones", () => {
    const [a, b] = buildTrees([tree(1, 50.9413, {}), tree(2, 50.9414, {})], {
      frame,
    });
    expect(a?.heightM).not.toBe(b?.heightM);
  });

  it("prefers a tagged height over the generated one", () => {
    expect(
      buildTrees([tree(1, 50.9413, { height: "22" })], { frame })[0]?.heightM,
    ).toBe(22);
  });

  it("reads the UNIT SUFFIXES that real tree tags carry", () => {
    // WHY THIS MATTERS. `height=12 m` and `height=25'` are both ordinary on
    // `natural=tree`, and `Number()` returns NaN for both — so the tagged value
    // was discarded and the tree fell back to the hashed default. The failure
    // is invisible: a tagged tree quietly becomes an untagged one, at a
    // plausible height, with no warning. `building-heights.ts` already exports
    // `parseLengthMetres` for exactly this and the buildings path uses it.
    expect(
      buildTrees([tree(1, 50.9413, { height: "12 m" })], { frame })[0]?.heightM,
    ).toBeCloseTo(12, 6);
    expect(
      buildTrees([tree(1, 50.9413, { height: "25'" })], { frame })[0]?.heightM,
    ).toBeCloseTo(25 * 0.3048, 6);
  });

  it("reads a crown diameter with a unit too", () => {
    expect(
      buildTrees([tree(1, 50.9413, { diameter_crown: "8 m" })], {
        frame,
      })[0]?.crownDiameterM,
    ).toBeCloseTo(8, 6);
  });

  it("falls back to the generated height for junk rather than NaN", () => {
    // A NaN height would propagate into the instance matrix and produce a tree
    // that does not render at all, which is worse than a default-sized one.
    const height = buildTrees([tree(1, 50.9413, { height: "tall" })], {
      frame,
    })[0]?.heightM;
    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeGreaterThan(0);
  });

  it("reads leaf_type into a variant", () => {
    expect(
      buildTrees([tree(1, 50.9413, { leaf_type: "needleleaved" })], {
        frame,
      })[0]?.variant,
    ).toBe("needleleaved");
    expect(buildTrees([tree(2, 50.9414, {})], { frame })[0]?.variant).toBe(
      "unknown",
    );
  });

  it("reads the older `wood` key too, and maps deciduous onto broadleaved", () => {
    // WHY THIS MATTERS (W6). `variant` is the only thing that can stop every
    // tree being drawn as the same fir, and `leaf_type` alone leaves a large
    // share of trees at "unknown" — `wood=deciduous`/`coniferous` is the same
    // controlled claim under an older key, and OSM2World's `TreeModule` reads
    // both (`LEAF_TYPE_KEYS = ["leaf_type", "wood"]`, with `deciduous` an alias
    // for broadleaved). Guessing from free-text `species` stays declined; this
    // is a controlled vocabulary and a different question.
    expect(
      buildTrees([tree(1, 50.9413, { wood: "deciduous" })], { frame })[0]
        ?.variant,
    ).toBe("broadleaved");
    expect(
      buildTrees([tree(2, 50.9414, { wood: "coniferous" })], { frame })[0]
        ?.variant,
    ).toBe("needleleaved");
    // `leaf_type` still wins where both are present: it is the current key, and
    // a feature carrying both is a feature mid-retagging.
    expect(
      buildTrees(
        [tree(3, 50.9415, { leaf_type: "broadleaved", wood: "coniferous" })],
        { frame },
      )[0]?.variant,
    ).toBe("broadleaved");
    // An unrecognised value is still "unknown" rather than a guess. `wood=yes`
    // is ordinary and says nothing about leaf type.
    expect(
      buildTrees([tree(4, 50.9416, { wood: "yes" })], { frame })[0]?.variant,
    ).toBe("unknown");
  });

  it("packs instances grouped by variant, ready for InstancedMesh", () => {
    // One InstancedMesh draws one geometry; mixing variants into a single
    // buffer would force the consumer to un-mix them.
    const placements = buildTrees(
      [tree(1, 50.9413, { leaf_type: "broadleaved" }), tree(2, 50.9414, {})],
      { frame },
    );
    const packed = packInstances(placements);
    expect([...packed.keys()].sort()).toEqual(["broadleaved", "unknown"]);
    expect(packed.get("broadleaved")?.positions).toHaveLength(3);
  });

  it("hashes stably across calls", () => {
    expect(stableHash("node/1")).toBe(stableHash("node/1"));
    expect(stableHash("node/1")).not.toBe(stableHash("node/2"));
  });
});

describe("merging", () => {
  it("concatenates meshes and re-bases their indices", () => {
    // Batching is what makes a city block renderable: one draw call per
    // building is what does not work on a phone.
    const one = extrudeBuilding([rectangle], {
      minHeightM: 0,
      eaveHeightM: 9,
      totalHeightM: 9,
      roofShape: "flat",
    });
    const merged = mergeMeshes([one, one]);
    expect(merged.triangleCount).toBe(one.triangleCount * 2);
    expect(Math.max(...merged.indices)).toBe(merged.positions.length / 3 - 1);
  });
});

describe("buildBuildings — the base on sloped terrain (DEC-R2-19)", () => {
  /**
   * WHY THIS CHANGED, AND WHY IT MATTERS MORE NOW. The base used to come from ONE
   * terrain sample, taken at the footprint's first vertex. On a slope that leaves a
   * building cut into the hill at one end and floating at the other — documented as
   * a known seam, and tolerable while the demo's terrain was a near-flat 600 m
   * square. The terrain now covers the whole rendered city with real relief, so the
   * artefact went from rare to routine.
   *
   * The fix is what OSM2World and most city renderers do: sit the building at the
   * LOWEST terrain height under its footprint, so no part of it can float, and let
   * the walls run down to meet the ground. Nothing is ever buried, nothing hovers.
   *
   * The accepted consequence is that walls become taller than the tagged height on
   * steep ground. That is correct — the tagged height is measured from the building's
   * own base, not from the lowest point of the terrain beneath it — and it is a
   * deliberate change to existing output, which is why the assertions below are
   * explicit about it.
   */

  /** A ~20 m square footprint, as a closed way. */
  const SQUARE: OsmFeature = {
    type: "way",
    id: 1,
    tags: { building: "yes", height: "10" },
    geometry: [
      { lat: 50.9413, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9586 },
      { lat: 50.94148, lng: 6.9586 },
      { lat: 50.94148, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9583 },
    ],
  };

  const FRAME = enuFrameAt({ lat: 50.9413, lng: 6.9583 });

  it("sits at the LOWEST terrain height under the footprint, not the first corner", () => {
    // The first corner is deliberately the HIGHEST here, so a first-corner sample
    // would place the building above the ground at three of its four corners.
    const heightByLng = (position: { lng: number }): number =>
      position.lng < 6.95845 ? 30 : 10;

    const [volume] = buildBuildings([SQUARE], {
      frame: FRAME,
      groundHeightM: heightByLng,
    });
    if (volume === undefined) throw new Error("no volume built");

    const lowestVertexY = lowestY(volume.mesh);
    // The base must be at 10 m (the minimum), not 30 m (the first corner).
    expect(lowestVertexY).toBeCloseTo(10, 3);
  });

  it("extends the walls DOWN so nothing floats over the low side", () => {
    // The other half. Sitting at the minimum without lengthening the walls would
    // put the roof 20 m lower than tagged on the high side.
    const heightByLng = (position: { lng: number }): number =>
      position.lng < 6.95845 ? 30 : 10;

    const [volume] = buildBuildings([SQUARE], {
      frame: FRAME,
      groundHeightM: heightByLng,
    });
    if (volume === undefined) throw new Error("no volume built");

    // Base at 10, and the roof still 10 m above the HIGHEST ground (30) — so the
    // wall spans 30 m rather than the tagged 10.
    expect(highestY(volume.mesh)).toBeCloseTo(40, 3);
    expect(highestY(volume.mesh) - lowestY(volume.mesh)).toBeCloseTo(30, 3);
  });

  it("is unchanged on FLAT ground, so the common case did not move", () => {
    // The regression guard. Most ground the demo renders is near-flat, and this
    // change must not shift any of it.
    const [volume] = buildBuildings([SQUARE], {
      frame: FRAME,
      groundHeightM: () => 12,
    });
    if (volume === undefined) throw new Error("no volume built");

    expect(lowestY(volume.mesh)).toBeCloseTo(12, 3);
    expect(highestY(volume.mesh)).toBeCloseTo(22, 3);
  });

  it("still works with no terrain at all", () => {
    const [volume] = buildBuildings([SQUARE], { frame: FRAME });
    if (volume === undefined) throw new Error("no volume built");
    expect(lowestY(volume.mesh)).toBeCloseTo(0, 3);
    expect(highestY(volume.mesh)).toBeCloseTo(10, 3);
  });
});

/** Lowest vertex y in a mesh — the base the building sits on. */
function lowestY(mesh: { positions: Float32Array }): number {
  let min = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i] ?? 0;
    if (y < min) min = y;
  }
  return min;
}

/** Highest vertex y in a mesh — the top of the roof. */
function highestY(mesh: { positions: Float32Array }): number {
  let max = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i] ?? 0;
    if (y > max) max = y;
  }
  return max;
}

describe("buildBuildings — one base per BUILDING, not per part (W5, R3-1)", () => {
  /**
   * Why these tests matter:
   * DEC-R2-19 gave every volume its own terrain base — the minimum under ITS OWN
   * footprint. For a plain building that is right. For a building mapped under
   * Simple 3D Buildings it is wrong, because `min_height` is measured from the
   * BUILDING's base, not from the ground under one part: two parts of one
   * building over ground differing by `d` metres end up displaced from each
   * other by `d`.
   *
   * It was harmless for exactly as long as the sampled field was 600 m and
   * Cologne-flat, so `rise` was ~0 and every part got the same base by accident.
   * DEC-R2-8/R2-21 extended the field to 2.8 km with real relief, and the
   * artefact became visible on the demo's showcase building: Cologne Cathedral's
   * spires stopped merging into the model and started reading as separate
   * low-polygon cones stuck on top of it (finding R3-1).
   *
   * The fix is what OSM2World does: sample the whole building — outline plus
   * every part — once, and give every volume in it the same base and the same
   * rise.
   */

  const FRAME = enuFrameAt({ lat: 50.9413, lng: 6.9583 });

  /** A rectangle from a lat/lng box, closed. */
  const box = (
    south: number,
    west: number,
    north: number,
    east: number,
  ): { lat: number; lng: number }[] => [
    { lat: south, lng: west },
    { lat: south, lng: east },
    { lat: north, lng: east },
    { lat: north, lng: west },
    { lat: south, lng: west },
  ];

  /** An outline with two parts: a low hall to the west, a tower to the east. */
  const OUTLINE: OsmFeature = {
    type: "way",
    id: 100,
    tags: { building: "cathedral" },
    geometry: box(50.9413, 6.9583, 50.9418, 6.9595),
  };
  const HALL: OsmFeature = {
    type: "way",
    id: 101,
    tags: { "building:part": "yes", height: "12" },
    geometry: box(50.9413, 6.9583, 50.9418, 6.9589),
  };
  const TOWER: OsmFeature = {
    type: "way",
    id: 102,
    tags: { "building:part": "yes", height: "60", min_height: "12" },
    geometry: box(50.9413, 6.959, 50.9418, 6.9595),
  };

  /** Ground that drops 20 m from west to east, across the outline. */
  const SLOPE = (position: { lng: number }): number =>
    position.lng < 6.95895 ? 30 : 10;

  it("gives every part of one building the SAME base", () => {
    // THE INVARIANT. Before this, the hall sat at 30 (the minimum under the west
    // half) and the tower at 10 (the minimum under the east half) — 20 m of
    // relative displacement inside one building, which is what tore the spires
    // off the cathedral.
    const volumes = buildBuildings([OUTLINE, HALL, TOWER], {
      frame: FRAME,
      groundHeightM: SLOPE,
    });

    const hall = volumes.find((v) => v.feature === "way/101");
    const tower = volumes.find((v) => v.feature === "way/102");
    if (hall === undefined || tower === undefined) {
      throw new Error("both parts must be built");
    }

    // The hall starts at the building's base; the tower starts `min_height`
    // above THAT SAME base. Both numbers are relative to one ground, which is
    // the whole claim.
    expect(lowestY(hall.mesh)).toBeCloseTo(10, 3);
    expect(lowestY(tower.mesh)).toBeCloseTo(10 + 12, 3);
  });

  it("uses the minimum under the WHOLE building, including its parts", () => {
    // The base is the minimum over outline AND parts. Sampling the outline alone
    // would be nearly right and would silently drift wherever a part sticks out
    // past its outline — which real S3DB data does, since an outline is often
    // the courtyard-less footprint of the parts inside it.
    const volumes = buildBuildings([OUTLINE, HALL, TOWER], {
      frame: FRAME,
      groundHeightM: SLOPE,
    });

    for (const volume of volumes) {
      // Nothing in the building may sit below the terrain minimum.
      expect(lowestY(volume.mesh)).toBeGreaterThanOrEqual(10 - 1e-6);
    }
  });

  it("stretches the walls by the WHOLE building's rise, not each part's", () => {
    // The rise that lengthens the walls has to be the building's, for the same
    // reason as the base: a part that happens to sit entirely on flat ground
    // still has to reach down to the building's own base.
    const volumes = buildBuildings([OUTLINE, HALL, TOWER], {
      frame: FRAME,
      groundHeightM: SLOPE,
    });
    const hall = volumes.find((v) => v.feature === "way/101");
    if (hall === undefined) throw new Error("no hall built");

    // Base 10, tagged height 12, and 20 m of rise across the building: the roof
    // clears the highest ground under the BUILDING by its tagged height.
    expect(highestY(hall.mesh)).toBeCloseTo(30 + 12, 3);
  });

  it("leaves a part with no outline standing on its own ground", () => {
    // A tile boundary can deliver a part without its parent. It is still a real
    // volume and it has no building to share a base with, so it keeps the
    // per-footprint behaviour — which is also what makes the grouping safe to
    // apply unconditionally.
    const volumes = buildBuildings([TOWER], {
      frame: FRAME,
      groundHeightM: SLOPE,
    });
    const tower = volumes.find((v) => v.feature === "way/102");
    if (tower === undefined) throw new Error("no tower built");

    expect(tower.parentFeature).toBeUndefined();
    expect(lowestY(tower.mesh)).toBeCloseTo(10 + 12, 3);
  });
});
