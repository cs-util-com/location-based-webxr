import { describe, expect, it } from "vitest";

import { buildBuildings, type BuildingVolume } from "./buildings.js";
import { buildCity } from "./city.js";
import { ENU_METRES_PER_DEG_LAT, enuFrameAt } from "./enu.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { CORPUS_SITES } from "../places/sites.js";

/**
 * `building:part` and the outline it belongs to, against Simple 3D Buildings.
 *
 * WHY THIS FILE EXISTS. `buildings.test.ts` and `nested-outlines.test.ts` pin
 * the main S3DB rule (an outline that has parts is not drawn) and the nested
 * outline fix. What they do not cover is what happens around that rule: the
 * outline a mapper only half filled with parts, a tower area drawn over its own
 * modelled spire, a part's own colour, and a building cut in two by a window.
 * Each test here names the building in the corpus that shows it.
 *
 * STATUS: written for the investigation of 2026-11-07 as failing proof (the
 * tests marked BUG) in
 * `GpsPlusSlamJs_Docs/docs/2026-11-07-0920-osm-building-geometry-bugs-findings.md`;
 * the ones here are green since the fix on branch r1104. PIN tests hold
 * behaviour a fix must keep.
 */

const FRAME = enuFrameAt({ lat: 0, lng: 0 });
const DEG_PER_METRE = 1 / ENU_METRES_PER_DEG_LAT;

function way(
  id: number,
  tags: Record<string, string>,
  points: readonly (readonly [number, number])[],
): OsmFeature {
  const closed = [...points, points[0] as readonly [number, number]];
  return {
    type: "way",
    id,
    tags,
    geometry: closed.map(([east, north]) => ({
      lat: north * DEG_PER_METRE,
      lng: east * DEG_PER_METRE,
    })),
  };
}

function box(
  id: number,
  tags: Record<string, string>,
  [west, south, east, north]: readonly [number, number, number, number],
): OsmFeature {
  return way(id, tags, [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ]);
}

/** Largest east coordinate of any drawn vertex, in metres. */
function eastmost(volumes: readonly BuildingVolume[]): number {
  let max = -Infinity;
  for (const volume of volumes) {
    for (let i = 0; i < volume.mesh.positions.length; i += 3) {
      max = Math.max(max, volume.mesh.positions[i] as number);
    }
  }
  return max;
}

function site(id: string): {
  features: readonly OsmFeature[];
  volumes: BuildingVolume[];
} {
  const entry = CORPUS_SITES.find((s) => s.id === id);
  if (entry === undefined)
    throw new Error(`${id} is missing from CORPUS_SITES`);
  const features = parseOverpassJson(loadSite(id).payload).features;
  return {
    features,
    volumes: buildBuildings(features, { frame: enuFrameAt(entry.position) }),
  };
}

/** Shoelace area of a way's ring, in square metres near its own latitude. */
function areaM2(feature: OsmFeature): number {
  if (feature.type !== "way") throw new Error("ways only");
  const lat0 = (feature.geometry[0]?.lat ?? 0) * (Math.PI / 180);
  const pts = feature.geometry.map((p) => [
    p.lng * ENU_METRES_PER_DEG_LAT * Math.cos(lat0),
    p.lat * ENU_METRES_PER_DEG_LAT,
  ]);
  let twice = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = pts[i] as [number, number];
    const [c, d] = pts[i + 1] as [number, number];
    twice += a * d - c * b;
  }
  return Math.abs(twice) / 2;
}

describe("an outline only partly covered by its parts", () => {
  // BUG, with a design decision in it. S3DB: "When a building has any
  // building:part areas, the building outline is not considered for 3D
  // rendering", and the outline "should be filled" with parts; Key:building:part
  // calls a half-filled outline a mapping error that "may not be visible in a
  // standard-compliant 3D renderer". OSM2World keeps the outline when parts
  // cover less than 90 % of it, streets-gl draws the uncovered remainder unless
  // it is under 10 %. We drop the whole outline the moment ONE part claims it
  // (`buildings.ts` `claimed`), so the rest of the building disappears. Measured:
  // 31 of 85 outlines with parts in the eleven sampled sites are under 90 %
  // covered, among them both towers of Tower Bridge (7 % and 6 %) and the
  // Cologne station hall (2 %).
  it("still draws the part of the building no part covers", () => {
    const volumes = buildBuildings(
      [
        box(1, { building: "yes", height: "12" }, [-10, -10, 10, 10]),
        box(2, { "building:part": "yes", height: "20" }, [-10, -10, -4, 10]),
      ],
      { frame: FRAME },
    );
    expect(eastmost(volumes)).toBeGreaterThan(9.9);
  });

  it("PIN: an outline its parts fill is still not drawn", () => {
    // The S3DB rule itself, which a fix for the test above must not undo.
    const volumes = buildBuildings(
      [
        box(1, { building: "yes", height: "12" }, [-10, -10, 10, 10]),
        box(2, { "building:part": "yes", height: "20" }, [-10, -10, 0, 10]),
        box(3, { "building:part": "yes", height: "8" }, [0, -10, 10, 10]),
      ],
      { frame: FRAME },
    );
    expect(volumes.map((v) => v.feature).sort()).toEqual(["way/2", "way/3"]);
  });

  it("draws Tower Bridge's north tower, not only its turrets", () => {
    // BUG, on real data. `way/367652787` "Tower Bridge North Tower" is 1 048 m²
    // and carries three parts covering 7 % of it. What is drawn is the parts.
    const { features, volumes } = site("london-tower-bridge");
    const tower = features.find((f) => f.type === "way" && f.id === 367652787);
    expect(tower).toBeDefined();
    const drawn = volumes
      .filter(
        (v) =>
          v.feature === "way/367652787" || v.parentFeature === "way/367652787",
      )
      .map((v) => features.find((f) => `${f.type}/${f.id}` === v.feature))
      .reduce((sum, f) => sum + (f === undefined ? 0 : areaM2(f)), 0);
    expect(drawn).toBeGreaterThan(0.9 * areaM2(tower as OsmFeature));
  });
});

describe("a man_made=tower area over its own modelled parts", () => {
  // BUG, introduced by the F34 fix. Why this test matters: Cologne's Südturm
  // `way/645732603` has no `building` tag, so F34 extrudes it as a flat 157 m
  // prism. But the Südturm is MODELLED: its spire is `building:part`s from 71 m
  // to 155 m (`way/416846388` and the pinnacles around it), all inside that
  // area. So the cathedral now has one detailed spire and one grey box with the
  // other spire's tip poking out. The F34 header says the parts reach "70.95 m";
  // that is the five `Sockel` parts only. The same S3DB rule that suppresses an
  // outline with parts applies. NOTE: `nested-outlines.test.ts` "is extruded, at
  // roughly its tagged height" pinned the old behaviour and was changed with
  // the fix.
  const { volumes } = site("cologne-cathedral");

  it("is not drawn as a prism through the spire", () => {
    expect(volumes.filter((v) => v.feature === "way/645732603")).toEqual([]);
  });

  it("PIN: the Südturm spire parts are drawn", () => {
    const spire = volumes.find((v) => v.feature === "way/416846388");
    expect(spire?.heights.totalHeightM).toBeGreaterThan(140);
  });
});

describe("a building cut by the city window", () => {
  it("keeps all of a building's parts or none", () => {
    // BUG, medium visibility. `buildCity` keeps a volume when its OWN mesh
    // centroid is inside `withinM`, so a large modelled building on the edge of
    // the window keeps some parts and loses others: half a cathedral at the
    // globe city's edge. The parts below belong to one outline.
    const features = [
      box(1, { building: "yes" }, [60, -20, 140, 20]),
      box(2, { "building:part": "yes", height: "20" }, [60, -20, 100, 20]),
      box(3, { "building:part": "yes", height: "40" }, [100, -20, 140, 20]),
    ];
    const city = buildCity(features, { frame: FRAME }, { withinM: 100 });
    const kept = city.volumes.map((v) => v.feature).sort();
    expect([[], ["way/2", "way/3"]]).toContainEqual(kept);
  });
});

describe("a building:part drawn as a multipolygon with several outers", () => {
  it("draws every outer, not only the first", () => {
    // BUG, low visibility: `ringsOf` returns `polygons[0]` only. No sampled
    // site has such a building, so it is a correctness note, not a sight.
    const ring = (w: number, e: number) => [
      { lat: -5 * DEG_PER_METRE, lng: w * DEG_PER_METRE },
      { lat: -5 * DEG_PER_METRE, lng: e * DEG_PER_METRE },
      { lat: 5 * DEG_PER_METRE, lng: e * DEG_PER_METRE },
      { lat: 5 * DEG_PER_METRE, lng: w * DEG_PER_METRE },
      { lat: -5 * DEG_PER_METRE, lng: w * DEG_PER_METRE },
    ];
    const twoWings: OsmFeature = {
      type: "relation",
      id: 5,
      tags: { type: "multipolygon", building: "yes", height: "10" },
      members: [
        { type: "way", ref: 11, role: "outer", geometry: ring(-20, -10) },
        { type: "way", ref: 12, role: "outer", geometry: ring(10, 20) },
      ],
    };
    const volumes = buildBuildings([twoWings], { frame: FRAME });
    expect(eastmost(volumes)).toBeGreaterThan(19.9);
    let westmost = Infinity;
    for (const v of volumes)
      for (let i = 0; i < v.mesh.positions.length; i += 3)
        westmost = Math.min(westmost, v.mesh.positions[i] as number);
    expect(westmost).toBeLessThan(-19.9);
  });
});
