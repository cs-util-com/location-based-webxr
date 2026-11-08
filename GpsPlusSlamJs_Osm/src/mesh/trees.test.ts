import { describe, expect, it } from "vitest";

import type { OsmFeature, OsmTags } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import {
  MAX_TREE_CROWN_M,
  MAX_TREE_HEIGHT_M,
  TREE_PALETTE,
  buildTrees,
  packInstances,
  treeClass,
  treeColour,
} from "./trees.js";

const ORIGIN = { lat: 49.41, lng: 8.69 };
const frame = enuFrameAt(ORIGIN);

const tree = (id: number, tags: Record<string, string>): OsmFeature => ({
  type: "node",
  id,
  position: { lat: ORIGIN.lat + id * 1e-5, lng: ORIGIN.lng },
  tags: { natural: "tree", ...tags },
});

const one = (tags: Record<string, string>, id = 1) => {
  const placement = buildTrees([tree(id, tags)], { frame })[0];
  if (placement === undefined) throw new Error("no placement");
  return placement;
};

const chroma = (rgb: number): number => {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b);
};

describe("treeClass", () => {
  it("reads every leaf_type and wood vocabulary value", () => {
    // WHY THIS MATTERS. The class picks the form and the colour; a value read
    // wrongly draws a fir as an oak. Both keys carry the same controlled
    // vocabulary, and `mixed` is kept as its own class (a wood's mixed stand
    // is a claim, not an unknown).
    const cases: [Record<string, string>, string, string][] = [
      [{ leaf_type: "broadleaved" }, "broadleaved", "leaf_type"],
      [{ leaf_type: "needleleaved" }, "needleleaved", "leaf_type"],
      [{ leaf_type: "mixed" }, "mixed", "leaf_type"],
      [{ wood: "deciduous" }, "broadleaved", "wood"],
      [{ wood: "coniferous" }, "needleleaved", "wood"],
      [{ wood: "mixed" }, "mixed", "wood"],
      [{ wood: "broadleaved" }, "broadleaved", "wood"],
      [
        { leaf_type: "broadleaved", wood: "coniferous" },
        "broadleaved",
        "leaf_type",
      ],
    ];
    for (const [tags, leafType, source] of cases) {
      expect(treeClass(tags), JSON.stringify(tags)).toMatchObject({
        leafType,
        source,
      });
    }
  });

  it("leaves an untagged or unreadable tree unknown, with source none", () => {
    // WHY THIS MATTERS. An untagged tree is drawn in the neutral form
    // (DEC-R4-10); any guess here would draw a confident wrong shape.
    const cases: OsmTags[] = [
      {},
      { wood: "yes" },
      { leaf_type: "palm" },
      { genus: "Ficus" },
    ];
    for (const tags of cases) {
      expect(treeClass(tags), JSON.stringify(tags)).toEqual({
        leafType: "unknown",
        leafCycle: "unknown",
        source: "none",
      });
    }
  });

  it("falls through to unknown for object prototype names", () => {
    // WHY THIS MATTERS. On a plain-object table `leaf_type=constructor` found
    // an inherited function; the tables are Maps so such a value is unknown.
    for (const value of ["constructor", "__proto__", "toString"]) {
      expect(treeClass({ leaf_type: value, genus: value }).leafType).toBe(
        "unknown",
      );
      expect(treeClass({ leaf_cycle: value }).leafCycle).toBe("unknown");
    }
  });

  it("reads leaf_cycle as the cycle hint, recovering deciduous-only trees", () => {
    // WHY THIS MATTERS. `leaf_cycle` is the tag that separates the light
    // deciduous green from the dark evergreen one. A tree tagged only
    // `leaf_cycle=deciduous` keeps its cycle (and so the hint) without being
    // given a leaf type it does not claim: a larch is deciduous too.
    expect(
      treeClass({ leaf_type: "broadleaved", leaf_cycle: "evergreen" }),
    ).toEqual({
      leafType: "broadleaved",
      leafCycle: "evergreen",
      source: "leaf_type",
    });
    expect(treeClass({ leaf_cycle: "semi_deciduous" }).leafCycle).toBe(
      "deciduous",
    );
    expect(treeClass({ leaf_cycle: "semi_evergreen" }).leafCycle).toBe(
      "evergreen",
    );
    expect(treeClass({ leaf_cycle: "deciduous" })).toEqual({
      leafType: "unknown",
      leafCycle: "deciduous",
      source: "none",
    });
  });

  it("maps a closed genus list to a leaf type only, from genus, species or taxon", () => {
    // WHY THIS MATTERS. About 40 percent of Heidelberg's trees carry a genus;
    // a genus whose leaf type is not in doubt is a reading, not a guess. The
    // list maps to a leaf type ONLY, never to a species shape.
    expect(treeClass({ genus: "Quercus" })).toMatchObject({
      leafType: "broadleaved",
      source: "genus",
    });
    expect(treeClass({ species: "Pinus sylvestris" })).toMatchObject({
      leafType: "needleleaved",
      source: "genus",
    });
    expect(treeClass({ taxon: "tilia cordata" }).leafType).toBe("broadleaved");
    // A tagged leaf type still wins over the genus.
    expect(
      treeClass({ leaf_type: "needleleaved", genus: "Acer" }).leafType,
    ).toBe("needleleaved");
  });

  it("makes larch-type genera needleleaved deciduous", () => {
    // WHY THIS MATTERS. Larch, dawn redwood and swamp cypress drop their
    // needles; they get the light larch colour, not the dark conifer one.
    for (const genus of ["Larix", "Metasequoia", "Taxodium"]) {
      expect(treeClass({ genus })).toEqual({
        leafType: "needleleaved",
        leafCycle: "deciduous",
        source: "genus",
      });
    }
    // A tagged leaf_cycle wins over the genus's cycle.
    expect(
      treeClass({ genus: "Larix", leaf_cycle: "evergreen" }).leafCycle,
    ).toBe("evergreen");
  });
});

describe("treeColour", () => {
  it("gives each class its own muted base colour at zero jitter", () => {
    // WHY THIS MATTERS. The palette is the O1 look the owner chose; a slip
    // here changes every tree in every city.
    const at = (leafType: string, leafCycle: string) =>
      treeColour(
        { leafType, leafCycle } as Parameters<typeof treeColour>[0],
        "node/1",
        0,
      );
    expect(at("broadleaved", "deciduous")).toBe(0x7b8663);
    expect(at("broadleaved", "unknown")).toBe(0x77845f);
    expect(at("broadleaved", "evergreen")).toBe(0x5f6e55);
    expect(at("needleleaved", "evergreen")).toBe(0x52665c);
    expect(at("needleleaved", "unknown")).toBe(0x55685d);
    expect(at("needleleaved", "deciduous")).toBe(0x80875f);
    expect(at("unknown", "unknown")).toBe(0x737c66);
    expect(at("unknown", "deciduous")).toBe(0x737c66);
    expect(at("mixed", "unknown")).toBe(0x737c66);
    expect(TREE_PALETTE.get("unknown")).toBe(0x737c66);
  });

  it("spreads lightness by at most plus or minus 8 percent per key", () => {
    // WHY THIS MATTERS. A row of identical greens reads as clones; a spread
    // much larger than this reads as different classes.
    const base = 0x7b8663;
    const cls = { leafType: "broadleaved", leafCycle: "deciduous" } as const;
    const greens = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const c = treeColour(cls, `node/${i}`);
      greens.add(c);
      const ratio = ((c >> 8) & 0xff) / ((base >> 8) & 0xff);
      expect(ratio).toBeGreaterThanOrEqual(0.92 - 0.01);
      expect(ratio).toBeLessThanOrEqual(1.08 + 0.01);
    }
    expect(greens.size).toBeGreaterThan(10);
  });
});

describe("buildTrees with classes", () => {
  it("carries the variant and the colour on each placement", () => {
    // WHY THIS MATTERS. The renderer draws one mesh per variant and reads the
    // colour per instance; a placement without them would draw today's look.
    const broad = one({ leaf_type: "broadleaved", leaf_cycle: "deciduous" });
    expect(broad.variant).toBe("broadleaved");
    expect(chroma(broad.colour)).toBeLessThanOrEqual(
      chroma(0x7b8663) * 1.08 + 1,
    );
    expect(one({ genus: "Picea" }).variant).toBe("needleleaved");
    // `mixed` is a class, but a single tree has one form: the neutral one.
    expect(one({ leaf_type: "mixed" }).variant).toBe("unknown");
  });

  it("refuses a tagged height above 60 m and a crown above 40 m", () => {
    // WHY THIS MATTERS. `height=250` (a mistyped centimetre value) would
    // draw a tree taller than the cathedral; it falls back to the untagged
    // rule instead of drawing the typo.
    const tall = one({ height: "250" });
    expect(tall.heightM).toBeGreaterThanOrEqual(8 * 0.75);
    expect(tall.heightM).toBeLessThanOrEqual(8 * 1.25);
    expect(one({ height: String(MAX_TREE_HEIGHT_M) }).heightM).toBe(60);
    const wide = one({ height: "10", diameter_crown: "90" });
    expect(wide.crownDiameterM).toBeCloseTo(6, 6);
    expect(
      one({ height: "10", diameter_crown: String(MAX_TREE_CROWN_M) })
        .crownDiameterM,
    ).toBe(40);
  });

  it("refuses zero, negative and NaN sizes", () => {
    // WHY THIS MATTERS. A zero or NaN scale reaches the instance matrix and
    // the tree disappears; a negative one turns it inside out.
    for (const height of ["0", "-5", "NaN", "tall"]) {
      const h = one({ height }).heightM;
      expect(Number.isFinite(h), height).toBe(true);
      expect(h, height).toBeGreaterThan(0);
    }
    const crown = one({ height: "10", diameter_crown: "-3" }).crownDiameterM;
    expect(crown).toBeCloseTo(6, 6);
  });
});

describe("packInstances colours", () => {
  it("packs each instance's sRGB colour as three 0..1 channels", () => {
    // WHY THIS MATTERS. The three layer converts these through THREE.Color;
    // a packing slip would tint every tree of a variant with its neighbour's.
    const placements = buildTrees(
      [
        tree(1, { leaf_type: "broadleaved" }),
        tree(2, { leaf_type: "broadleaved" }),
      ],
      { frame },
    );
    const packed = packInstances(placements).get("broadleaved");
    expect(packed?.colours).toHaveLength(6);
    const second = placements[1]?.colour ?? 0;
    expect(packed?.colours[3]).toBeCloseTo(((second >> 16) & 0xff) / 255, 6);
    expect(packed?.colours[4]).toBeCloseTo(((second >> 8) & 0xff) / 255, 6);
    expect(packed?.colours[5]).toBeCloseTo((second & 0xff) / 255, 6);
  });
});
