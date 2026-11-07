import fc from "fast-check";
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

describe("a man_made=tower area with one small part inside (review finding 9)", () => {
  // Why this test matters: the tower rule hid a tower the moment ANY part's
  // representative point lay inside it. A shaft with one small canopy part
  // mapped at its foot is not modelled by that part; hiding it erases a
  // landmark-sized shaft. The rule is now the outline rule: the parts must
  // cover the tower by PART_COVERAGE_TO_HIDE_OUTLINE. The Suedturm (100 %
  // covered by 25 parts) still goes, pinned above.
  it("keeps its shaft", () => {
    const volumes = buildBuildings(
      [
        box(1, { man_made: "tower", height: "80" }, [0, 0, 10, 10]),
        box(
          2,
          { "building:part": "roof", min_height: "3", height: "4" },
          [4, 4, 6, 6],
        ),
      ],
      { frame: FRAME },
    );
    expect(volumes.map((v) => v.feature).sort()).toEqual(["way/1", "way/2"]);
  });

  it("PIN: a tower its parts fill is still not drawn", () => {
    const volumes = buildBuildings(
      [
        box(1, { man_made: "tower", height: "80" }, [0, 0, 10, 10]),
        box(2, { "building:part": "yes", height: "60" }, [0, 0, 10, 10]),
      ],
      { frame: FRAME },
    );
    expect(volumes.map((v) => v.feature)).toEqual(["way/2"]);
  });
});

describe("a nested outline counts toward its enclosing outline (review finding 2)", () => {
  // Why these tests matter: parts go to the SMALLEST containing outline, so a
  // cathedral whose tower is mapped as its own nested outline (with the
  // tower's parts inside it) saw only the nave part when its own coverage was
  // measured. At a nave share under 90 % the 157 m cathedral outline was drawn
  // as a box through the whole model: the reviewer's synthetic cathedral. The
  // enclosing outline now counts every nested outline's polygon, and their
  // parts, as covered ground.
  const cathedral = (towerWidthM: number): OsmFeature[] => [
    box(1, { building: "cathedral", height: "157" }, [0, 0, 100, 40]),
    box(2, { building: "tower", height: "157" }, [0, 0, towerWidthM, 40]),
    box(
      3,
      {
        "building:part": "yes",
        height: "157",
        "roof:shape": "pyramidal",
        "roof:height": "60",
      },
      [0, 0, towerWidthM, 40],
    ),
    box(4, { "building:part": "yes", height: "45" }, [towerWidthM, 0, 100, 40]),
  ];

  it("draws no 157 m box over the reviewer's cathedral (tower 15 %)", () => {
    const drawn = buildBuildings(cathedral(15), { frame: FRAME });
    expect(drawn.map((v) => v.feature).sort()).toEqual(["way/3", "way/4"]);
  });

  it.each([5, 10, 15, 30])(
    "hides the cathedral outline at a nested tower share of %i percent",
    (share) => {
      const drawn = buildBuildings(cathedral(share), { frame: FRAME });
      expect(drawn.map((v) => v.feature)).not.toContain("way/1");
      expect(drawn.map((v) => v.feature)).not.toContain("way/2");
    },
  );

  it("hides an outline whose only parts sit in nested outlines", () => {
    // Before, an outline with no parts of its own was skipped before any
    // coverage was measured, so it was drawn over two fully modelled wings.
    const drawn = buildBuildings(
      [
        box(1, { building: "yes", height: "30" }, [0, 0, 100, 40]),
        box(2, { building: "yes", height: "30" }, [0, 0, 50, 40]),
        box(3, { building: "yes", height: "30" }, [50, 0, 100, 40]),
        box(4, { "building:part": "yes", height: "20" }, [0, 0, 50, 40]),
        box(5, { "building:part": "yes", height: "25" }, [50, 0, 100, 40]),
      ],
      { frame: FRAME },
    );
    expect(drawn.map((v) => v.feature).sort()).toEqual(["way/4", "way/5"]);
  });

  it("counts a nested outline without parts by its own polygon", () => {
    // The nested tower is not modelled, so it is drawn itself; it still
    // covers its share of the cathedral, which the nave part fills the rest of.
    const drawn = buildBuildings(
      [
        box(1, { building: "cathedral", height: "157" }, [0, 0, 100, 40]),
        box(2, { building: "tower", height: "157" }, [0, 0, 30, 40]),
        box(3, { "building:part": "yes", height: "45" }, [30, 0, 100, 40]),
      ],
      { frame: FRAME },
    );
    expect(drawn.map((v) => v.feature).sort()).toEqual(["way/2", "way/3"]);
  });

  it("PIN: the accepted loss - a lower parts-less nested outline under a taller enclosing one", () => {
    // Why this test matters: counting a parts-less nested outline by its own
    // polygon is a judgement call kept after the M1 review (both alternatives
    // were identical on all 13 fixtures and each failed a synthetic case
    // closer to the S3DB pattern). Its stated cost is this case: the 30 m
    // outline goes, so over the nested 10 m outline only 10 m is drawn. Pinned
    // so a change to the rule shows up here as a decision, not by accident.
    const drawn = buildBuildings(
      [
        box(1, { building: "yes", height: "30" }, [0, 0, 100, 40]),
        box(2, { building: "yes", height: "10" }, [0, 0, 30, 40]),
        box(3, { "building:part": "yes", height: "30" }, [30, 0, 100, 40]),
      ],
      { frame: FRAME },
    );
    expect(drawn.map((v) => v.feature).sort()).toEqual(["way/2", "way/3"]);
    const nested = drawn.find((v) => v.feature === "way/2");
    expect(nested?.topHeightM).toBeCloseTo(10, 6);
  });

  it("PIN: a kiosk inside an outline with no parts anywhere is still drawn", () => {
    // The removed nesting rule deleted Heidelberg's kiosks; nesting alone must
    // never hide anything. Only an outline that has parts somewhere is a
    // candidate for hiding.
    const drawn = buildBuildings(
      [
        box(1, { building: "train_station", height: "20" }, [0, 0, 100, 40]),
        box(2, { building: "kiosk", height: "3" }, [10, 10, 14, 14]),
      ],
      { frame: FRAME },
    );
    expect(drawn.map((v) => v.feature).sort()).toEqual(["way/1", "way/2"]);
  });

  it("PROPERTY: a modelled nested wing plus a filling part hides the outline, the wing alone does not", () => {
    // Any split point and any input order: the outline is hidden exactly when
    // the nested wing and the direct part together fill it.
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 60 }),
        fc.boolean(),
        fc.boolean(),
        (split, withNave, reversed) => {
          const features = cathedral(split).filter(
            (f) => withNave || f.id !== 4,
          );
          if (reversed) features.reverse();
          const drawn = buildBuildings(features, { frame: FRAME }).map(
            (v) => v.feature,
          );
          expect(drawn.includes("way/1")).toBe(!withNave);
          expect(drawn).not.toContain("way/2");
        },
      ),
    );
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

describe("colour of a building:part", () => {
  /** The distinct "r,g,b" of every vertex whose normal y passes `facing`. */
  function colouredWhere(
    normals: Float32Array,
    colors: Float32Array,
    facing: (normalY: number) => boolean,
  ): Set<string> {
    const seen = new Set<string>();
    for (let i = 0; i < normals.length; i += 3) {
      if (facing(normals[i + 1] as number))
        seen.add([colors[i], colors[i + 1], colors[i + 2]].join(","));
    }
    return seen;
  }

  /** The packed 0xrrggbb drawn at a volume's first vertex. */
  function drawnColour(features: OsmFeature[], feature: string): number {
    const city = buildCity(features, { frame: FRAME });
    const volume = city.volumes.find((v) => v.feature === feature);
    if (volume === undefined) throw new Error(`${feature} not drawn`);
    const [x, y, z] = [...volume.mesh.positions.slice(0, 3)];
    for (const chunk of city.buildings) {
      const p = chunk.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] === x && p[i + 1] === y && p[i + 2] === z && chunk.colors) {
          const c = chunk.colors;
          return (
            (Math.round((c[i] as number) * 255) << 16) |
            (Math.round((c[i + 1] as number) * 255) << 8) |
            Math.round((c[i + 2] as number) * 255)
          );
        }
      }
    }
    throw new Error("vertex not found in any chunk");
  }

  it("uses the part's own building:colour", () => {
    // Bug 8. S3DB: the colour tags "can be used on both building outlines and
    // building parts". 1 590 of the 2 147 parts in the eleven sampled sites
    // carry a colour of their own, and every one was drawn in its outline's.
    // Accepted recommendation 2026-11-07: the part's own colour wins.
    const features = [
      box(
        1,
        { building: "yes", "building:colour": "#0000ff" },
        [-10, -10, 10, 10],
      ),
      box(
        2,
        { "building:part": "yes", height: "9", "building:colour": "#ff0000" },
        [-10, -10, 10, 10],
      ),
    ];
    expect(drawnColour(features, "way/2")).toBe(0xff0000);
  });

  it("PIN: a part without a colour takes its outline's", () => {
    // The other half of the rule: an untagged part must not fall to the
    // default grey, or an untagged cathedral stripes by part.
    const features = [
      box(
        1,
        { building: "yes", "building:colour": "#0000ff" },
        [-10, -10, 10, 10],
      ),
      box(2, { "building:part": "yes", height: "9" }, [-10, -10, 10, 10]),
    ];
    expect(drawnColour(features, "way/2")).toBe(0x0000ff);
  });

  it("gives the roof its roof:colour, and keeps the walls the building's", () => {
    // Bug 8, a missing feature rather than a wrong one: `roof:colour` was read
    // nowhere and `chunkMeshes` held one colour per volume. A spire is nearly
    // all roof (the Nordturm shaft `way/207377042` is 61.6 m of roof on 24 m of
    // wall), so its colour IS its roof colour. Judged per face: the slopes
    // face up, the walls and gable ends do not.
    const city = buildCity(
      [
        box(
          1,
          {
            building: "yes",
            height: "10",
            "roof:height": "4",
            "roof:shape": "gabled",
            "building:colour": "#ffffff",
            "roof:colour": "#ff0000",
          },
          [-10, -5, 10, 5],
        ),
      ],
      { frame: FRAME },
    );
    const chunk = city.buildings[0];
    expect(chunk?.colors).toBeDefined();
    const n = chunk?.mesh.normals ?? new Float32Array();
    const c = chunk?.colors ?? new Float32Array();
    // Each set non-empty AND one colour: equality with a one-element set.
    expect(colouredWhere(n, c, (y) => y > 0.1)).toEqual(new Set(["1,0,0"]));
    expect(colouredWhere(n, c, (y) => Math.abs(y) < 1e-6)).toEqual(
      new Set(["1,1,1"]),
    );
  });

  describe("the roof is the roof block, not the upward faces (review finding 3)", () => {
    // Why these tests matter: a vertex was roof-coloured when its normal
    // pointed up. An onion swells out past the eave ring and draws in again,
    // so its lower half faces DOWN and was painted in the wall colour: half
    // a copper onion drawn grey. The roof is now the vertices the roof builder
    // emitted (per polygon) whose face is not vertical, so a downward roof
    // face is roof, while gable ends (vertical, in the roof block) and the
    // floor of a floating part (outside it) keep the wall colour.
    const RED = "1,0,0";
    // The colour buffer is a Float32Array, so the channel is the float32 value.
    const G = Math.fround(0x80 / 255);
    const GREY = `${G},${G},${G}`;

    /** "r,g,b" per vertex of the one chunk, with its y and normal y. */
    function vertices(
      tags: Record<string, string>,
    ): { y: number; ny: number; rgb: string }[] {
      const city = buildCity(
        [
          box(
            1,
            { "building:colour": "#808080", "roof:colour": "#ff0000", ...tags },
            [-10, -10, 10, 10],
          ),
        ],
        { frame: FRAME },
      );
      expect(city.buildings).toHaveLength(1);
      const chunk = city.buildings[0];
      const p = chunk?.mesh.positions ?? new Float32Array();
      const n = chunk?.mesh.normals ?? new Float32Array();
      const c = chunk?.colors ?? new Float32Array();
      const out: { y: number; ny: number; rgb: string }[] = [];
      for (let i = 0; i < p.length; i += 3) {
        out.push({
          y: p[i + 1] as number,
          ny: n[i + 1] as number,
          rgb: [c[i], c[i + 1], c[i + 2]].join(","),
        });
      }
      return out;
    }
    const colours = (list: readonly { rgb: string }[]): Set<string> =>
      new Set(list.map((v) => v.rgb));

    it("paints every non-vertical vertex of an onion above the eave in the roof colour", () => {
      const all = vertices({
        building: "yes",
        height: "30",
        "roof:shape": "onion",
        "roof:height": "15",
      });
      const roof = all.filter((v) => v.y > 15 - 1e-3 && Math.abs(v.ny) > 1e-3);
      // Not vacuous: the onion really has downward faces above the eave.
      expect(roof.some((v) => v.ny < -1e-3)).toBe(true);
      expect(colours(roof)).toEqual(new Set([RED]));
      expect(
        colours(all.filter((v) => Math.abs(v.ny) <= 1e-3 && v.y < 15)),
      ).toEqual(new Set([GREY]));
    });

    it("PIN: keeps a gabled house's gable triangles in the wall colour", () => {
      const all = vertices({
        building: "house",
        height: "10",
        "roof:shape": "gabled",
        "roof:height": "4",
      });
      const gables = all.filter((v) => v.y > 6 + 1e-3 && Math.abs(v.ny) < 1e-6);
      expect(gables.length).toBeGreaterThan(0);
      expect(colours(gables)).toEqual(new Set([GREY]));
      expect(colours(all.filter((v) => v.ny > 0.1))).toEqual(new Set([RED]));
    });

    it("PIN: a flat roof is its top face, the walls and floor keep the wall colour", () => {
      // A floating part draws a floor that faces down; it is not in the roof
      // block, so it must stay grey under the |ny| rule.
      const all = vertices({
        building: "yes",
        height: "10",
        min_height: "4",
      });
      expect(colours(all.filter((v) => v.ny > 0.5))).toEqual(new Set([RED]));
      const floor = all.filter((v) => v.ny < -0.5);
      expect(floor.length).toBeGreaterThan(0);
      expect(colours(floor)).toEqual(new Set([GREY]));
      expect(colours(all.filter((v) => Math.abs(v.ny) < 1e-6))).toEqual(
        new Set([GREY]),
      );
    });

    it("PIN: a dome is roof-coloured wherever it faces up, and nothing else is", () => {
      const all = vertices({
        building: "yes",
        height: "20",
        "roof:shape": "dome",
        "roof:height": "10",
      });
      expect(colours(all.filter((v) => v.ny > 1e-3))).toEqual(new Set([RED]));
      expect(colours(all.filter((v) => v.ny <= 1e-3))).toEqual(new Set([GREY]));
    });

    it("paints both wings of a two-outer multipolygon by their own roof ranges (M1 review finding 5)", () => {
      // Why this test matters: `volumeFor` merges one mesh per polygon, so the
      // second wing's roof range must move by the first wing's vertex count.
      // An offset left out paints the first wing's walls red and the second
      // wing's roof grey; one polygon per volume (every test above) cannot
      // show it.
      const ring = (w: number, e: number) => [
        { lat: -5 * DEG_PER_METRE, lng: w * DEG_PER_METRE },
        { lat: -5 * DEG_PER_METRE, lng: e * DEG_PER_METRE },
        { lat: 5 * DEG_PER_METRE, lng: e * DEG_PER_METRE },
        { lat: 5 * DEG_PER_METRE, lng: w * DEG_PER_METRE },
        { lat: -5 * DEG_PER_METRE, lng: w * DEG_PER_METRE },
      ];
      const city = buildCity(
        [
          {
            type: "relation",
            id: 5,
            tags: {
              type: "multipolygon",
              building: "yes",
              height: "10",
              "roof:shape": "gabled",
              "roof:height": "4",
              "building:colour": "#808080",
              "roof:colour": "#ff0000",
            },
            members: [
              { type: "way", ref: 11, role: "outer", geometry: ring(-20, -10) },
              { type: "way", ref: 12, role: "outer", geometry: ring(10, 20) },
            ],
          },
        ],
        { frame: FRAME },
      );
      const ranges = city.volumes[0]?.roofVertexRanges ?? [];
      expect(ranges).toHaveLength(2);
      const p = city.buildings.flatMap((chunk) => [...chunk.mesh.positions]);
      const n = city.buildings.flatMap((chunk) => [...chunk.mesh.normals]);
      const c = city.buildings.flatMap((chunk) => [...(chunk.colors ?? [])]);
      const seen = { west: new Set<string>(), east: new Set<string>() };
      const walls = new Set<string>();
      for (let i = 0; i < p.length; i += 3) {
        const rgb = [c[i], c[i + 1], c[i + 2]].join(",");
        if ((n[i + 1] as number) > 0.1) {
          seen[(p[i] as number) < 0 ? "west" : "east"].add(rgb);
        } else if (Math.abs(n[i + 1] as number) < 1e-6) walls.add(rgb);
      }
      expect(seen.west).toEqual(new Set([RED]));
      expect(seen.east).toEqual(new Set([RED]));
      expect(walls).toEqual(new Set([GREY]));
    });
  });

  it("gives a part its outline's roof:colour when it has none of its own", () => {
    // Once the outline is hidden behind its parts, the roofs a viewer sees are
    // the parts'; a roof:colour on the outline describes those.
    const features = [
      box(1, { building: "yes", "roof:colour": "red" }, [-10, -10, 10, 10]),
      box(2, { "building:part": "yes", height: "9" }, [-10, -10, 10, 10]),
    ];
    const city = buildCity(features, { frame: FRAME });
    const chunk = city.buildings[0];
    const n = chunk?.mesh.normals ?? new Float32Array();
    const c = chunk?.colors ?? new Float32Array();
    expect(colouredWhere(n, c, (y) => y > 0.5)).toEqual(new Set(["1,0,0"]));
  });
});
