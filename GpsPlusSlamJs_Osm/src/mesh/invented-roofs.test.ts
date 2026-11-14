import { describe, expect, it } from "vitest";

import type { OsmTags } from "../model/osm-feature.js";
import type { EnuPoint } from "./enu.js";
import {
  inventedRoofMesh,
  inventedTotalM,
  planInventedRoofs,
  type InventedFootprint,
  type InventedPlan,
  type InventedRoof,
} from "./invented-roofs.js";
import { ROOFSCAPE_DEFAULTS } from "./roofscape-rules.js";

/**
 * The invented roofs over small hand-built neighbourhoods.
 *
 * WHY THIS FILE MATTERS. These plans decide what an untagged house looks like
 * in every city the library draws, and the obstacle index takes its heights
 * from the same plans. The cases below pin what the rules promise in
 * geometric terms (the eave reaches past a free wall and not past a shared
 * one, a deep house is cut flat at the rise limit, a stated height is the
 * whole building, the drawn top is the planned top) rather than pinning the
 * code's own output.
 */

const P = ROOFSCAPE_DEFAULTS;

const rect = (x: number, y: number, w: number, h: number): EnuPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function footprint(
  key: string,
  ring: EnuPoint[],
  tags: OsmTags = { building: "yes" },
  extra: Partial<InventedFootprint> = {},
): InventedFootprint {
  const n = ring.length;
  return {
    key: key as InventedFootprint["key"],
    tags,
    at: {
      x: ring.reduce((s, p) => s + p.x, 0) / n,
      y: ring.reduce((s, p) => s + p.y, 0) / n,
    },
    polygons: [[ring]],
    hasParts: false,
    ...extra,
  };
}

const planOf = (
  fs: InventedFootprint[],
  key: string,
): InventedPlan | undefined =>
  planInventedRoofs(fs).get(key as InventedFootprint["key"]);

function roofOf(fs: InventedFootprint[], key: string): InventedRoof {
  const plan = planOf(fs, key);
  if (plan?.kind !== "roof") throw new Error(`no roof for ${key}`);
  return plan;
}

describe("planInventedRoofs: who gets a roof", () => {
  it("gives a lone untagged house a roof whose top is eave plus rise", () => {
    const plan = roofOf([footprint("way/1", rect(0, 0, 12, 8))], "way/1");
    // 96 m2, untagged: the house band of the rules.
    expect(plan.eaveM).toBeGreaterThanOrEqual(5);
    expect(plan.eaveM).toBeLessThanOrEqual(6.2);
    expect(plan.totalM).toBeCloseTo(
      plan.eaveM + plan.roof.ridgeT * plan.tan,
      9,
    );
    expect(plan.totalM - plan.eaveM).toBeLessThanOrEqual(P.maxRiseM + 1e-9);
    expect(inventedTotalM(plan)).toBe(plan.totalM);
  });

  it("keeps every building the map says something about", () => {
    // Tags win: none of these is planned, so each keeps the library volume.
    const fs = [
      footprint("way/1", rect(0, 0, 10, 8), {
        building: "yes",
        "roof:shape": "gabled",
      }),
      footprint(
        "way/2",
        rect(30, 0, 10, 8),
        { "building:part": "yes" },
        {
          outlineKey: "way/9" as InventedFootprint["key"],
        },
      ),
      footprint(
        "way/3",
        rect(60, 0, 10, 8),
        { building: "yes" },
        {
          hasParts: true,
        },
      ),
      footprint("way/4", rect(90, 0, 10, 8), { building: "carport" }),
      footprint("way/5", rect(120, 0, 10, 8), {
        building: "yes",
        height: "30",
      }),
      {
        ...footprint("way/6", rect(150, 0, 10, 8)),
        polygons: [[rect(150, 0, 10, 8)], [rect(170, 0, 10, 8)]],
      },
    ];
    const plans = planInventedRoofs(fs);
    expect([...plans.keys()]).toEqual([]);
  });

  it("refuses a roof to a shop, a hall and a flat-roofed neighbourhood", () => {
    const shop = planOf(
      [footprint("way/1", rect(0, 0, 10, 8), { building: "retail" })],
      "way/1",
    );
    expect(shop).toMatchObject({ kind: "lid", why: "flat by class" });
    const hall = planOf([footprint("way/2", rect(0, 0, 60, 50))], "way/2");
    expect(hall).toMatchObject({ kind: "lid", why: "large footprint" });

    // Five tagged flat roofs within 200 m: the untagged one is refused too.
    const flats = [0, 1, 2, 3, 4].map((i) =>
      footprint(`way/${10 + i}`, rect(20 * i + 20, 0, 10, 8), {
        building: "yes",
        "roof:shape": "flat",
      }),
    );
    const plan = planOf(
      [...flats, footprint("way/1", rect(0, 0, 10, 8))],
      "way/1",
    );
    expect(plan).toMatchObject({ kind: "lid", why: "flat roofs nearby" });
  });

  it("does not depend on the order the footprints arrive in", () => {
    const fs = [
      footprint("way/1", rect(0, 0, 12, 8)),
      footprint("way/2", rect(12, 0, 9, 8)),
      footprint("way/3", rect(40, 5, 14, 10)),
    ];
    const one = planInventedRoofs(fs);
    const two = planInventedRoofs([...fs].reverse());
    for (const key of one.keys()) {
      expect(two.get(key)).toEqual(one.get(key));
    }
  });
});

describe("planInventedRoofs: the roof's shape", () => {
  it("stands vertical on a shared wall and reaches past none of it", () => {
    // Two terraced houses: way/1's wall 1 (x = 12) is way/2's wall 3.
    const fs = [
      footprint("way/1", rect(0, 0, 12, 8)),
      footprint("way/2", rect(12, 0, 9, 8)),
    ];
    const plan = roofOf(fs, "way/1");
    const onShared = plan.roof.faces.filter(
      (f) => f.ring === 0 && f.wall === 1,
    );
    expect(onShared.length).toBeGreaterThan(0);
    expect(onShared.every((f) => f.vertical)).toBe(true);
    // The eave ring keeps the shared wall's line: x = 12 at both its corners.
    const eave = plan.roofRings[0] ?? [];
    expect(eave[1]?.x).toBeCloseTo(12, 9);
    expect(eave[2]?.x).toBeCloseTo(12, 9);
    // And reaches past the long free wall by the overhang (the short free
    // wall opposite may stand as a gable, with no overhang).
    expect(eave[0]?.y).toBeCloseTo(-P.overhangM, 9);
  });

  it("cuts a deep house flat at the rise limit", () => {
    // 34 x 34, under 2 500 m2: a whole hip reaches t = 17, which even at the
    // floor slope would rise 6.1 m, past the limit.
    const plan = roofOf([footprint("way/1", rect(0, 0, 34, 34))], "way/1");
    expect(plan.style).toBe("cut");
    expect(plan.tan).toBe(P.tanFloor);
    expect(plan.roof.caps.length).toBeGreaterThan(0);
    expect(plan.totalM - plan.eaveM).toBeCloseTo(P.maxRiseM, 6);
  });

  it("fits the roof inside a stated height", () => {
    const plan = roofOf(
      [
        footprint("way/1", rect(0, 0, 12, 8), {
          building: "yes",
          height: "11",
        }),
      ],
      "way/1",
    );
    expect(plan.totalM).toBeCloseTo(11, 9);
  });

  it("puts gables on about the share of houses the rules ask for", () => {
    // 200 lone rectangles: each wants a gable with probability gableShare,
    // and a lone rectangle's two short ends always qualify.
    let gables = 0;
    for (let i = 0; i < 200; i++) {
      const plan = roofOf(
        [footprint(`way/${i}`, rect(0, 0, 12, 8))],
        `way/${i}`,
      );
      if (plan.style === "gable") gables += 1;
    }
    expect(gables / 200).toBeGreaterThan(P.gableShare - 0.1);
    expect(gables / 200).toBeLessThan(P.gableShare + 0.1);
  });
});

describe("inventedRoofMesh", () => {
  const ground = { lowest: 100, rise: 1.5 };

  function maxY(positions: Float32Array): number {
    let top = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      top = Math.max(top, positions[i] as number);
    }
    return top;
  }

  it("draws its top where the plan puts it, on the building's ground", () => {
    for (const ring of [rect(0, 0, 12, 8), rect(0, 0, 34, 34)]) {
      const plan = roofOf([footprint("way/1", ring)], "way/1");
      const mesh = inventedRoofMesh(plan, ground);
      expect(maxY(mesh.positions)).toBeCloseTo(
        ground.lowest + ground.rise + plan.totalM,
        3,
      );
    }
  });

  it("marks only the roof's own surfaces as roof", () => {
    const plan = roofOf([footprint("way/1", rect(0, 0, 12, 8))], "way/1");
    const mesh = inventedRoofMesh(plan, ground);
    const eave = ground.lowest + ground.rise + plan.eaveM;
    const { start, end } = mesh.roofVertices;
    expect(end).toBeGreaterThan(start);
    for (let v = start; v < end; v++) {
      expect(mesh.positions[v * 3 + 1]).toBeGreaterThanOrEqual(eave - 1e-3);
      // A roof surface faces up, never down.
      expect(mesh.normals[v * 3 + 1]).toBeGreaterThan(0);
    }
    expect(mesh.roofMethod).toBe("skeleton");
  });

  it("winds the eave's underside to face the ground", () => {
    // Why: the soffit is one-sided; wound the wrong way it is culled and the
    // eave reads as a hole from the street.
    const plan = roofOf([footprint("way/1", rect(0, 0, 12, 8))], "way/1");
    const { positions, normals, indices } = inventedRoofMesh(plan, ground);
    let soffits = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map(
        (i) => (i as number) * 3,
      ) as [number, number, number];
      if ((normals[a + 1] as number) > -0.5) continue;
      soffits += 1;
      const ux = (positions[b] as number) - (positions[a] as number);
      const uz = (positions[b + 2] as number) - (positions[a + 2] as number);
      const vx = (positions[c] as number) - (positions[a] as number);
      const vz = (positions[c + 2] as number) - (positions[a + 2] as number);
      // y of (b - a) x (c - a): negative is a front face looking down.
      expect(uz * vx - ux * vz).toBeLessThan(0);
    }
    expect(soffits).toBeGreaterThan(0);
  });
});
