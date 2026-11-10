import { describe, expect, it } from "vitest";

import type { OsmTags } from "../model/osm-feature.js";
import type { EnuPoint } from "./enu.js";
import {
  ROOFSCAPE_DEFAULTS,
  chooseGableEnds,
  inventedEaveHeightM,
  inventedRoofRefusal,
  keepReason,
  neighbourhoodPriors,
  offsetRing,
  refusedHeightM,
  sharedWalls,
  simplifyRing,
  type NeighbourhoodPrior,
  type PriorEntry,
} from "./roofscape-rules.js";

/**
 * Which untagged building gets an invented roof, how high it stands, and which
 * of its walls are shared.
 *
 * WHY THIS FILE MATTERS. Everything invented here is cosmetic, so it has to be
 * stable (a reload looks the same) and it has to stop dead at a tag (a tagged
 * building is never changed). A wrong call here changes real data on screen
 * without any visual hint that it did. The cases are the ones the chosen
 * prototype page was judged on, re-stated against the library's types.
 */

const pt = (x: number, y: number): EnuPoint => ({ x, y });
const box = (x: number, y: number, w: number, h: number): EnuPoint[] => [
  pt(x, y),
  pt(x + w, y),
  pt(x + w, y + h),
  pt(x, y + h),
];
const P = ROOFSCAPE_DEFAULTS;
const low = { hasParts: false, belowSurface: false, heightLimitM: 14 };

describe("keepReason", () => {
  it("gives a roof only to a low building nothing says anything about", () => {
    expect(keepReason({ building: "yes" }, low)).toBeUndefined();
    expect(keepReason({ building: "house" }, low)).toBeUndefined();
    expect(
      keepReason({ building: "yes", "building:levels": "2" }, low),
    ).toBeUndefined();
  });

  it("leaves every tagged case alone", () => {
    // Why: `resolveHeights` cannot tell an absent roof from an explicit flat
    // one, so the tag itself is read; `flat` must stay flat.
    const cases: OsmTags[] = [
      { building: "yes", "roof:shape": "flat" },
      { building: "yes", "roof:shape": "gabled" },
      { building: "yes", "roof:height": "2" },
      { building: "yes", "roof:levels": "1" },
      { building: "yes", min_height: "3" },
      { building: "yes", "building:min_level": "1" },
      { building: "roof" },
      { building: "garages" },
      { "building:part": "yes" },
    ];
    for (const tags of cases)
      expect(keepReason(tags, low), JSON.stringify(tags)).toBeDefined();
  });

  it("leaves a building with parts, and one below the surface, alone", () => {
    expect(keepReason({ building: "church" }, { ...low, hasParts: true })).toBe(
      "parts",
    );
    expect(
      keepReason({ building: "yes" }, { ...low, belowSurface: true }),
    ).toBe("below surface");
  });

  it("moves the tall line with the limit, never with an unknown height", () => {
    const tall = { building: "yes", height: "16" };
    expect(keepReason(tall, low)).toBe("tall");
    expect(keepReason(tall, { ...low, heightLimitM: 20 })).toBeUndefined();
    expect(keepReason({ building: "yes", "building:levels": "5" }, low)).toBe(
      "tall",
    );
  });
});

describe("the invented heights", () => {
  it("put a garage lower than a house and a tagged level count first", () => {
    const eave = (tags: OsmTags, area: number): number =>
      inventedEaveHeightM(tags, area, "way/7");
    expect(eave({ building: "garage" }, 30)).toBeLessThan(3.5);
    expect(eave({ building: "yes" }, 120)).toBeGreaterThan(5);
    expect(eave({ building: "yes" }, 120)).toBeLessThanOrEqual(6.2);
    expect(eave({ building: "apartments" }, 120)).toBeGreaterThanOrEqual(8);
    expect(eave({ building: "yes", "building:levels": "3" }, 120)).toBe(9);
    expect(eave({ building: "yes", height: "7.5" }, 120)).toBe(7.5);
  });

  it("are stable and depend on the key, not on an index", () => {
    // Why: the owner compares a reload with a reload.
    const once = inventedEaveHeightM({ building: "yes" }, 120, "way/1");
    expect(inventedEaveHeightM({ building: "yes" }, 120, "way/1")).toBe(once);
    const seen = new Set<number>();
    for (let id = 0; id < 50; id++) {
      seen.add(inventedEaveHeightM({ building: "yes" }, 120, `way/${id}`));
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it("give a refused building its neighbours' heights, else the tag, else a house's", () => {
    // Why: an untagged tower among 20-30 m blocks must not get a house's 9 m.
    const heights = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
    const flat: NeighbourhoodPrior = {
      pitched: false,
      why: "flat roofs nearby",
      heights,
    };
    const h = refusedHeightM({ building: "yes" }, 120, "way/9", flat, P);
    expect(h).toBeGreaterThanOrEqual(22.25);
    expect(h).toBeLessThanOrEqual(26.75);
    expect(
      refusedHeightM(
        { building: "yes", height: "12.5" },
        120,
        "way/9",
        flat,
        P,
      ),
    ).toBe(12.5);
    const few = { ...flat, heights: [30, 30] };
    expect(refusedHeightM({ building: "yes" }, 120, "way/9", few, P)).toBe(
      inventedEaveHeightM({ building: "yes" }, 120, "way/9"),
    );
  });
});

describe("the footprint", () => {
  it("loses a point on a straight wall, keeps a real corner", () => {
    const ring = [pt(0, 0), pt(5, 0.01), pt(10, 0), pt(10, 8), pt(0, 8)];
    expect(simplifyRing(ring, 0.05)).toHaveLength(4);
    expect(simplifyRing(ring, 0.001)).toHaveLength(5);
  });
});

describe("offsetRing", () => {
  it("moves slopes out and leaves a gable wall where it stands", () => {
    // Why: a shared wall stays on its line, or the eave would grow into the
    // neighbour; the front eave still runs on to the corner.
    const out = offsetRing(box(0, 0, 10, 8), [0.3, 0, 0.3, 0.3]);
    expect(out).toBeDefined();
    expect(out?.[1]?.x).toBeCloseTo(10, 9);
    expect(out?.[1]?.y).toBeCloseTo(-0.3, 9);
    expect(out?.[3]?.x).toBeCloseTo(-0.3, 9);
  });

  it("refuses a corner it cannot follow", () => {
    // Two collinear walls with different offsets have no corner to stand on.
    const ring = [pt(0, 0), pt(5, 0), pt(10, 0), pt(10, 8), pt(0, 8)];
    expect(offsetRing(ring, [0.3, 0, 0.3, 0.3, 0.3])).toBeUndefined();
  });
});

describe("sharedWalls", () => {
  it("finds a wall two houses stand against each other", () => {
    // Why: in a closed row a hip towards the neighbour digs a valley between
    // every two houses; a shared wall takes a gable and the ridge runs on.
    const a = box(0, 0, 10, 8);
    const b = box(10.1, 0, 10, 8);
    const c = box(40, 0, 10, 8);
    const segments = [a, b, c].flatMap((ring, owner) =>
      ring.map((p, i) => ({
        a: p,
        b: ring[(i + 1) % 4] as EnuPoint,
        owner: `way/${owner}`,
      })),
    );
    expect(sharedWalls(a, "way/0", segments, P)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(sharedWalls(c, "way/2", segments, P)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // Moved past the gap, the same two walls are no longer one.
    expect(
      sharedWalls(a, "way/0", segments, { ...P, sharedGapM: 0.05 }),
    ).toEqual([false, false, false, false]);
  });
});

describe("chooseGableEnds", () => {
  it("takes long-enough free wing ends, the longest first, never two side by side", () => {
    // A ring of six walls: 0 (4 m), 1 (12 m), 2 (5 m), 3 (20 m), 4 (6 m), 5.
    const ring = [
      pt(0, 0),
      pt(4, 0),
      pt(4, 12),
      pt(-1, 12),
      pt(-1, -8),
      pt(5, -8),
    ];
    const free = [false, false, false, false, false, false];
    // 0, 1 and 2 all wing ends: 1 is longest and blocks both neighbours.
    expect([...chooseGableEnds([0, 1, 2], ring, free, P)]).toEqual([1]);
    // 3 is longer than the 16 m limit; 4 is a free end.
    expect([...chooseGableEnds([3, 4], ring, free, P)]).toEqual([4]);
    // A shared wall is never a gable end of its own.
    const shared = [false, true, false, false, false, false];
    expect([...chooseGableEnds([0, 1, 2], ring, shared, P)].sort()).toEqual([
      0, 2,
    ]);
  });
});

describe("the local roof prior", () => {
  // Why this block matters: invented pitched roofs are right in an Alpine
  // suburb and absurd on a New York brownstone row or a mall. The rule must
  // come from the data around a building, never from a city's name, so it
  // also holds where nobody has looked yet.
  const town = (
    offsetX: number,
    count: number,
    tagsFor: (i: number) => Record<string, string>,
  ): PriorEntry[] =>
    Array.from({ length: count }, (_, i) => ({
      key: `way/${offsetX}${i}`,
      tags: { building: "yes", ...tagsFor(i) },
      at: pt(offsetX + (i % 4) * 20 + 5, Math.floor(i / 4) * 20 + 5),
    }));

  it("invents no pitched roof where most tagged roofs nearby are flat", () => {
    const priors = neighbourhoodPriors(
      town(0, 8, (i): Record<string, string> =>
        i < 6 ? { "roof:shape": "flat" } : {},
      ),
      P,
    );
    expect(priors.get("way/07")).toMatchObject({
      pitched: false,
      why: "flat roofs nearby",
    });
  });

  it("keeps inventing where the tagged roofs nearby are pitched", () => {
    // Heidelberg's case: tall-ish old houses, most roofs tagged gabled.
    const priors = neighbourhoodPriors(
      town(0, 12, (i) => ({
        "building:levels": "4",
        ...(i < 7 ? { "roof:shape": i === 0 ? "flat" : "gabled" } : {}),
      })),
      P,
    );
    expect(priors.get("way/011")).toMatchObject({
      pitched: true,
      why: "pitched roofs nearby",
    });
  });

  it("reads a tall neighbourhood with no roof tags as flat-roofed", () => {
    // Park Slope's case: every height tagged by an import, no roof shape.
    const priors = neighbourhoodPriors(
      town(0, 12, () => ({ height: "13" })),
      P,
    );
    expect(priors.get("way/05")).toMatchObject({
      pitched: false,
      why: "tall neighbourhood",
    });
    expect(priors.get("way/05")?.heights).toHaveLength(12);
  });

  it("knows nothing, and keeps inventing, where nothing is tagged", () => {
    const priors = neighbourhoodPriors(
      town(0, 12, () => ({})),
      P,
    );
    expect(priors.get("way/03")).toMatchObject({
      pitched: true,
      why: "no evidence",
    });
  });

  it("is local: a flat-roofed district far away does not reach a village", () => {
    const priors = neighbourhoodPriors(
      [
        ...town(0, 8, () => ({})),
        ...town(5000, 12, () => ({ "roof:shape": "flat" })),
      ],
      P,
    );
    expect(priors.get("way/03")?.pitched).toBe(true);
    expect(priors.get("way/50003")?.pitched).toBe(false);
  });

  it("reaches exactly as far as the radius, measured between centres", () => {
    // Why: the grid that makes this fast must not change who is a neighbour.
    const flat = (i: number, x: number): PriorEntry => ({
      key: `way/f${i}`,
      tags: { building: "yes", "roof:shape": "flat" },
      at: pt(x, 0),
    });
    const self: PriorEntry = {
      key: "way/self",
      tags: { building: "yes" },
      at: pt(0, 0),
    };
    const inside = [1, 2, 3, 4, 5].map((i) => flat(i, 199.9));
    const outside = [1, 2, 3, 4, 5].map((i) => flat(i, 200.1));
    expect(
      neighbourhoodPriors([self, ...inside], P).get("way/self")?.pitched,
    ).toBe(false);
    expect(
      neighbourhoodPriors([self, ...outside], P).get("way/self")?.pitched,
    ).toBe(true);
  });

  it("counts one vote per building, however many parts it has", () => {
    // Why: Park Slope has one building with four tagged skillion parts. As
    // four votes they flipped 150 flat-roofed brownstones around it.
    const rows = town(0, 12, () => ({ height: "13" }));
    const parts: PriorEntry[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      key: `way/9${i}`,
      tags: { "building:part": "yes", "roof:shape": "skillion" },
      at: pt(6 + i * 0.5, 6),
      outlineKey: "way/00",
    }));
    const priors = neighbourhoodPriors([...rows, ...parts], P);
    expect(priors.get("way/05")?.why).toBe("tall neighbourhood");
  });

  it("needs enough evidence before one tag decides a neighbourhood", () => {
    const priors = neighbourhoodPriors(
      town(0, 12, (i): Record<string, string> =>
        i === 0 ? { "roof:shape": "flat" } : {},
      ),
      P,
    );
    expect(priors.get("way/05")?.pitched).toBe(true);
  });
});

describe("inventedRoofRefusal", () => {
  // Why: a mall, a warehouse or a supermarket is flat almost everywhere, and
  // a pitched roof on a hall the size of a block reads as a toy.
  const pitched: NeighbourhoodPrior = {
    pitched: true,
    why: "no evidence",
    heights: [],
  };

  it("refuses an invented roof on commercial and industrial classes", () => {
    for (const building of [
      "commercial",
      "retail",
      "industrial",
      "warehouse",
      "supermarket",
    ]) {
      expect(inventedRoofRefusal({ building }, 200, pitched, P)).toBe(
        "flat by class",
      );
    }
  });

  it("refuses one on a large footprint, and moves with the threshold", () => {
    const tags = { building: "yes" };
    expect(inventedRoofRefusal(tags, 3000, pitched, P)).toBe("large footprint");
    expect(inventedRoofRefusal(tags, 300, pitched, P)).toBeUndefined();
    expect(
      inventedRoofRefusal(tags, 3000, pitched, {
        ...P,
        largeFootprintM2: 4000,
      }),
    ).toBeUndefined();
  });

  it("leaves a church its roof, whatever the neighbourhood", () => {
    const flat: NeighbourhoodPrior = {
      pitched: false,
      why: "tall neighbourhood",
      heights: [],
    };
    expect(
      inventedRoofRefusal({ building: "church" }, 1500, flat, P),
    ).toBeUndefined();
  });

  it("follows the neighbourhood for an ordinary house", () => {
    const flat: NeighbourhoodPrior = {
      pitched: false,
      why: "flat roofs nearby",
      heights: [],
    };
    expect(inventedRoofRefusal({ building: "yes" }, 120, flat, P)).toBe(
      "flat roofs nearby",
    );
    expect(
      inventedRoofRefusal({ building: "yes" }, 120, pitched, P),
    ).toBeUndefined();
  });
});
