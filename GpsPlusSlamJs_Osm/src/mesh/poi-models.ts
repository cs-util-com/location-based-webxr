/**
 * A procedural low-polygon model for each of the fifty most common POI kinds
 * (W17/W18, DEC-R4-7).
 *
 * THE ASK, AND WHY IT IS FIFTY. _"All diese Dinge, die da in dem Google Doc
 * vorkommen, ich finde, die haben verdient, ihr eigenes kleines prozedurales
 * Low-Polygon 3D-Modell zu bekommen"_ — the sheet has ~700 rows, so the owner
 * chose the fifty most common by the sheet's own `Count` column. The ranking is
 * `poi-ranking.ts`; the shapes are here.
 *
 * WHAT MAKES THESE "BESPOKE" RATHER THAN A SHAPE FAMILY. The owner was offered
 * ~12 parametrised primitives covering fifty values and rejected it, because it
 * would make a bench and a park seat the same shape at different sizes. Each
 * entry below is its OWN composition: a picnic table is a slab with two benches
 * beside it, a fuel station is a canopy over a pump, a post box is a rounded
 * pillar. They share primitives the way buildings share an extruder.
 *
 * REAL-WORLD DIMENSIONS ARE THE POINT, not decoration. `POI_HEIGHT_M = 6` used
 * to apply to every marker, so a bench and a hospital entrance were the same 6 m
 * orange cone. Scale is most of what makes a bench read as a bench, and it is
 * per KIND rather than per instance — which is why it is baked into the geometry
 * and the consumer places an instance with a translation alone.
 *
 * COLOURS ARE MUTED ON PURPOSE. The affordance heat ramp owns the loud end of
 * the palette and must stay the loudest thing on screen (R4-14 warns the scene
 * is already close to too colourful). These are material colours — timber,
 * galvanised steel, painted metal, stone — not category codes.
 *
 * @see poi-models.ts.md
 */

import type { MeshData } from "./mesh-data.js";
import {
  box,
  canopy,
  composed,
  hut,
  postWithHead,
  prism,
  slabOnLegs,
} from "./poi-primitives.js";

/** One kind's model: its geometry, its footprint and how it is coloured. */
export interface PoiModel {
  /** `key=value`, the same form `poiKind` returns. */
  readonly kind: string;
  /** Packed `0xrrggbb`. */
  readonly colour: number;
  /**
   * Overall height, metres.
   *
   * DERIVED from the built mesh, never declared. Twenty-five of the fifty
   * models disagreed with a hand-written figure on the first run — an awning
   * two centimetres above the roof, a spire counted twice — and every one of
   * those was a second source of truth for how tall the thing is. Measuring the
   * geometry makes the disagreement unrepresentable instead of caught.
   */
  readonly heightM: number;
  /** Built once, shared by every instance of this kind. */
  readonly mesh: MeshData;
}

/** Muted material palette — timber, steel, paint, stone, water, greenery. */
const TIMBER = 0x9c7b4f;
const STEEL = 0x8d949e;
const DARK_STEEL = 0x5d636d;
const PAINT_RED = 0xa8503f;
const PAINT_BLUE = 0x4a6c8c;
const PAINT_GREEN = 0x5a7d55;
const STONE = 0xa8a49b;
const GLASS = 0x7f97a8;
const WATER = 0x4f7f9c;
const ASPHALT = 0x6d7078;
const SAND = 0xbfae86;

/** Every model, in ranking order. Built once at module load. */
function models(): PoiModel[] {
  const model = (
    kind: string,
    colour: number,
    build: Parameters<typeof composed>[0],
  ): PoiModel => {
    const mesh = composed(build);
    let heightM = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      heightM = Math.max(heightM, mesh.positions[i] as number);
    }
    return { kind, colour, heightM, mesh };
  };

  return [
    // 1 — a marked bay with a low kerb, not a building.
    model("amenity=parking", ASPHALT, (b) => {
      box(b, 5, 0.1, 2.5);
      box(b, 5, 0.12, 0.12, 0, 0, 1.25);
    }),
    // 2 — a pitch: a flat playing surface with a goal at one end.
    model("leisure=pitch", PAINT_GREEN, (b) => {
      box(b, 8, 0.06, 5);
      box(b, 3, 0.12, 0.12, 2.3, 0, -2.4);
      box(b, 0.12, 2.3, 0.12, 0, -1.5, -2.4);
      box(b, 0.12, 2.3, 0.12, 0, 1.5, -2.4);
    }),
    // 3 — THE BENCH the notes name: a seat, a back and four legs.
    model("amenity=bench", TIMBER, (b) => {
      slabOnLegs(b, 1.8, 0.5, 0.45);
      box(b, 1.8, 0.4, 0.06, 0.45, 0, -0.22);
    }),
    // 4 — a pool: water inset in a surround.
    model("leisure=swimming_pool", WATER, (b) => {
      box(b, 6, 0.2, 3, 0);
      box(b, 5.4, 0.06, 2.4, 0.2);
    }),
    // 5 — one bay, painted.
    model("amenity=parking_space", ASPHALT, (b) => {
      box(b, 5, 0.08, 2.5);
    }),
    // 6 — a church: a hut with a tower and a spire.
    model("amenity=place_of_worship", STONE, (b) => {
      hut(b, 6, 10, 5, 2);
      box(b, 2.4, 9, 2.4, 0, 0, 5.5);
      prism(b, 1.7, 0, 3, 4, 9, 0, 5.5);
    }),
    // 7 — a restaurant: a shopfront with an awning and a table outside.
    model("amenity=restaurant", PAINT_RED, (b) => {
      box(b, 6, 3.6, 5);
      box(b, 6.4, 0.12, 1.4, 2.6, 0, 3);
      slabOnLegs(b, 1, 1, 0.75, 0.06, 0.05);
    }),
    // 8 — a school: a long two-storey block with a flat roof.
    model("amenity=school", STONE, (b) => {
      box(b, 14, 7, 8);
      box(b, 14.4, 0.3, 8.4, 7);
      box(b, 2, 2.6, 0.3, 0, 0, 4.1);
    }),
    // 9 — a park: a tree over a lawn.
    model("leisure=park", PAINT_GREEN, (b) => {
      box(b, 8, 0.06, 8);
      prism(b, 0.18, 0.14, 1.6, 6, 0.06);
      prism(b, 1.4, 0, 2.9, 7, 1.66);
    }),
    // 10 — an information board on two posts.
    model("tourism=information", TIMBER, (b) => {
      box(b, 0.09, 1.5, 0.09, 0, -0.45);
      box(b, 0.09, 1.5, 0.09, 0, 0.45);
      box(b, 1.2, 0.8, 0.08, 1.1);
    }),
    // 11 — a garden: a bed edged in stone, with a shrub.
    model("leisure=garden", PAINT_GREEN, (b) => {
      box(b, 4, 0.25, 4);
      box(b, 3.4, 0.3, 3.4, 0.25);
      prism(b, 0.7, 0.45, 0.7, 6, 0.55);
    }),
    // 12 — a playground: a slide platform with a ladder.
    model("leisure=playground", PAINT_BLUE, (b) => {
      box(b, 1.4, 0.12, 1.4, 1.5);
      for (const sx of [-0.6, 0.6]) {
        for (const sz of [-0.6, 0.6]) box(b, 0.1, 1.5, 0.1, 0, sx, sz);
      }
      box(b, 1.4, 1.1, 0.08, 1.62);
      box(b, 0.7, 0.1, 2.4, 0.8, 0, 1.6);
    }),
    // 13 — THE WASTE BASKET the notes name: a tapered bin on a post.
    model("amenity=waste_basket", DARK_STEEL, (b) => {
      box(b, 0.08, 0.6, 0.08);
      prism(b, 0.2, 0.24, 0.45, 8, 0.6);
    }),
    // 14 — a fuel station: a canopy over a pump.
    model("amenity=fuel", STEEL, (b) => {
      canopy(b, 8, 5, 5, 0.25, 0.25);
      box(b, 0.7, 1.6, 0.5, 0);
    }),
    // 15 — bicycle parking: a row of hoops.
    model("amenity=bicycle_parking", STEEL, (b) => {
      for (const sx of [-0.9, 0, 0.9]) {
        box(b, 0.06, 0.75, 0.06, 0, sx, -0.35);
        box(b, 0.06, 0.75, 0.06, 0, sx, 0.35);
        box(b, 0.06, 0.06, 0.76, 0.75, sx);
      }
    }),
    // 16 — a cafe: a small shopfront with a parasol.
    model("amenity=cafe", TIMBER, (b) => {
      box(b, 4.5, 3, 4);
      box(b, 0.08, 1.4, 0.08, 0, 0, 2.8);
      prism(b, 1.1, 0, 0.5, 8, 1.4, 0, 2.8);
    }),
    // 17 — fast food: a boxy unit with a service window and a sign.
    model("amenity=fast_food", PAINT_RED, (b) => {
      box(b, 5, 3.2, 4);
      box(b, 2, 1, 0.12, 1.2, 0, 2.05);
      box(b, 1.6, 1, 0.12, 3.3);
    }),
    // 18 — a shelter: an open roof on four posts, with a bench in it.
    model("amenity=shelter", TIMBER, (b) => {
      canopy(b, 3, 2, 2.5);
      box(b, 2.4, 0.08, 0.4, 0.45, 0, -0.6);
    }),
    // 19 — a hotel: a tall block with a marked entrance canopy.
    model("tourism=hotel", STONE, (b) => {
      box(b, 10, 13.5, 9);
      box(b, 4, 0.3, 1.6, 2.8, 0, 5);
    }),
    // 20 — a bank: a stone block with a portico.
    model("amenity=bank", STONE, (b) => {
      box(b, 9, 7.5, 7);
      box(b, 5, 0.5, 1.6, 7.5, 0, 4);
      for (const sx of [-1.8, 0, 1.8]) prism(b, 0.28, 0.28, 7.5, 8, 0, sx, 4);
    }),
    // 21 — toilets: a small block with two doors.
    model("amenity=toilets", STONE, (b) => {
      box(b, 3, 2.6, 2.4);
      box(b, 0.8, 1.9, 0.08, 0, -0.7, 1.25);
      box(b, 0.8, 1.9, 0.08, 0, 0.7, 1.25);
      box(b, 3.2, 0.2, 2.6, 2.6);
    }),
    // 22 — recycling: three containers side by side.
    model("amenity=recycling", PAINT_GREEN, (b) => {
      for (const sx of [-1.05, 0, 1.05]) {
        prism(b, 0.5, 0.45, 1.4, 6, 0, sx);
      }
    }),
    // 23 — a pharmacy: a shopfront with a cross above it.
    model("amenity=pharmacy", PAINT_GREEN, (b) => {
      box(b, 5, 3.4, 4.5);
      box(b, 1.2, 0.35, 0.12, 3.7);
      box(b, 0.35, 1.2, 0.12, 3.15);
    }),
    // 24 — a post box: a rounded pillar with a slot hood.
    model("amenity=post_box", PAINT_RED, (b) => {
      prism(b, 0.28, 0.28, 1.1, 8);
      prism(b, 0.3, 0.22, 0.2, 8, 1.1);
    }),
    // 25 — a memorial: a plinth carrying a stele.
    model("historic=memorial", STONE, (b) => {
      box(b, 1.4, 0.35, 1.4);
      box(b, 1, 0.25, 1, 0.35);
      box(b, 0.7, 2, 0.4, 0.6);
    }),
    // 26 — a kindergarten: a low bright block with a pitched roof.
    model("amenity=kindergarten", PAINT_BLUE, (b) => {
      hut(b, 8, 6, 3.4, 1.8);
      box(b, 1, 2, 0.12, 0, -2, 3.05);
    }),
    // 27 — drinking water: a fountain bowl on a column.
    model("amenity=drinking_water", STEEL, (b) => {
      prism(b, 0.14, 0.11, 0.85, 6);
      prism(b, 0.26, 0.3, 0.2, 8, 0.85);
    }),
    // 28 — a picnic table: a table slab with a bench each side.
    model("leisure=picnic_table", TIMBER, (b) => {
      slabOnLegs(b, 1.8, 0.8, 0.75);
      box(b, 1.8, 0.06, 0.3, 0.45, 0, -0.75);
      box(b, 1.8, 0.06, 0.3, 0.45, 0, 0.75);
    }),
    // 29 — a sports centre: a wide hall with a curved-looking roof band.
    model("leisure=sports_centre", STEEL, (b) => {
      box(b, 16, 8, 12);
      box(b, 16.4, 1, 12.4, 8);
    }),
    // 30 — an attraction: a plinth with a marker obelisk.
    model("tourism=attraction", STONE, (b) => {
      box(b, 2, 0.4, 2);
      prism(b, 0.7, 0.35, 3, 4, 0.4);
      prism(b, 0.35, 0, 0.8, 4, 3.4);
    }),
    // 31 — artwork: an irregular sculpture on a base.
    model("tourism=artwork", DARK_STEEL, (b) => {
      box(b, 1.2, 0.25, 1.2);
      box(b, 0.5, 1.6, 0.5, 0.25, -0.2);
      box(b, 0.5, 1.2, 0.5, 1.85, 0.25);
    }),
    // 32 — a vending machine: a cabinet with a front panel.
    model("amenity=vending_machine", PAINT_BLUE, (b) => {
      // A post-mounted cabinet, which is what most of them are outside a wall.
      postWithHead(b, 0.6, 0.07, 0.75, 1.2);
      box(b, 0.6, 0.9, 0.06, 0.75, 0, 0.4);
    }),
    // 33 — a bar: a shopfront with a projecting sign.
    model("amenity=bar", DARK_STEEL, (b) => {
      box(b, 5, 3.4, 4.5);
      box(b, 0.1, 0.7, 0.9, 2.4, 2.5, 1.6);
    }),
    // 34 — a hunting stand: a raised box on four tall legs, with a ladder.
    model("amenity=hunting_stand", TIMBER, (b) => {
      for (const sx of [-0.55, 0.55]) {
        for (const sz of [-0.55, 0.55]) box(b, 0.1, 3, 0.1, 0, sx, sz);
      }
      box(b, 1.4, 0.1, 1.4, 3);
      // ON the platform. Built at base 0 it sat around the legs' feet — a hide
      // at ground level, which is the one thing a hunting stand is not.
      hut(b, 1.4, 1.4, 1, 0.4, 3.1);
      box(b, 0.5, 0.08, 3.2, 0.4, 0, 1.4);
    }),
    // 35 — a viewpoint: a railing on a small platform.
    model("tourism=viewpoint", STEEL, (b) => {
      box(b, 3, 0.15, 2);
      box(b, 3, 0.08, 0.08, 1.05, 0, -0.95);
      for (const sx of [-1.4, 0, 1.4]) box(b, 0.07, 0.9, 0.07, 0.15, sx, -0.95);
    }),
    // 36 — a hospital: a block with a cross and an ambulance canopy.
    model("amenity=hospital", STONE, (b) => {
      box(b, 14, 14, 10);
      box(b, 2.4, 0.5, 0.14, 14);
      box(b, 0.5, 2.4, 0.14, 12.9);
      box(b, 5, 0.3, 3, 3.4, 0, 6);
    }),
    // 37 — an ATM: a wall unit on a short pedestal.
    model("amenity=atm", DARK_STEEL, (b) => {
      box(b, 0.7, 1.6, 0.45);
      box(b, 0.5, 0.4, 0.06, 1, 0, 0.24);
    }),
    // 38 — a post office: a block with a horizontal sign band.
    model("amenity=post_office", PAINT_RED, (b) => {
      box(b, 8, 5, 6);
      box(b, 8.2, 0.6, 6.2, 5);
      box(b, 3, 0.5, 0.12, 3.4, 0, 3.05);
    }),
    // 39 — waste disposal: a large skip, tapered.
    model("amenity=waste_disposal", DARK_STEEL, (b) => {
      box(b, 2.4, 1.4, 1.5);
      box(b, 2.5, 0.1, 1.6, 1.4);
    }),
    // 40 — a pub: a hut with a hanging sign on a bracket.
    model("amenity=pub", TIMBER, (b) => {
      hut(b, 7, 6, 3.6, 1.6);
      box(b, 0.08, 0.08, 1, 3, 3.4, 0.5);
      box(b, 0.06, 0.7, 0.8, 2.3, 3.4, 1);
    }),
    // 41 — a graveyard: headstones on grass.
    model("amenity=grave_yard", STONE, (b) => {
      box(b, 6, 0.06, 6);
      for (const sx of [-1.6, 0, 1.6]) {
        for (const sz of [-1.4, 1.4]) {
          box(b, 0.5, 0.8, 0.12, 0.06, sx, sz);
        }
      }
    }),
    // 42 — a clinic: a small block with an entrance canopy and a sign.
    model("amenity=clinic", GLASS, (b) => {
      box(b, 8, 6, 6);
      box(b, 3, 0.25, 1.4, 2.8, 0, 3.2);
      box(b, 1.6, 0.35, 0.1, 4.6, 0, 3.05);
    }),
    // 43 — an archaeological site: broken column stubs on a base.
    model("historic=archaeological_site", SAND, (b) => {
      box(b, 5, 0.2, 5);
      prism(b, 0.35, 0.32, 1.4, 8, 0.2, -1.4, -1);
      prism(b, 0.35, 0.32, 0.9, 8, 0.2, 0.2, 0.6);
      prism(b, 0.35, 0.3, 0.5, 8, 0.2, 1.5, -1.2);
    }),
    // 44 — a guest house: a house with a dormer.
    model("tourism=guest_house", TIMBER, (b) => {
      hut(b, 8, 7, 5.2, 2.4);
      box(b, 1.4, 1, 1.6, 5.2, -1.6, 1.4);
    }),
    // 45 — a wayside cross: a cross on a stepped base.
    model("historic=wayside_cross", STONE, (b) => {
      box(b, 0.8, 0.2, 0.8);
      box(b, 0.6, 0.2, 0.6, 0.2);
      box(b, 0.2, 1.7, 0.16, 0.4);
      box(b, 0.9, 0.18, 0.16, 1.5);
    }),
    // 46 — `historic=yes`, unspecified: a plain marker stone. Deliberately
    // featureless, because the tag itself says nothing more than "old".
    model("historic=yes", STONE, (b) => {
      box(b, 0.9, 0.25, 0.9);
      prism(b, 0.35, 0.28, 1.15, 6, 0.25);
    }),
    // 47 — a fountain: a basin with a central jet column.
    model("amenity=fountain", WATER, (b) => {
      prism(b, 1.5, 1.5, 0.5, 10);
      prism(b, 1.35, 1.35, 0.42, 10, 0.04);
      prism(b, 0.25, 0.18, 1.3, 8, 0.5);
    }),
    // 48 — a parking entrance: a ramp mouth with a headroom bar.
    model("amenity=parking_entrance", ASPHALT, (b) => {
      box(b, 4, 0.15, 3);
      for (const sx of [-1.9, 1.9]) box(b, 0.25, 2.4, 0.25, 0.15, sx, -1.3);
      box(b, 4.2, 0.25, 0.3, 2.35, 0, -1.3);
    }),
    // 49 — a doctors' surgery: a house-scale block with a plaque.
    model("amenity=doctors", GLASS, (b) => {
      box(b, 6, 4.2, 5);
      box(b, 1, 0.6, 0.08, 2.2, -1.8, 2.55);
      box(b, 6.2, 0.3, 5.2, 4.2);
    }),
    // 50 — a community centre: a wide hall with a canopy along its front.
    model("amenity=community_centre", TIMBER, (b) => {
      box(b, 12, 5.5, 8);
      box(b, 12.4, 0.4, 8.4, 5.5);
      box(b, 10, 0.2, 2, 3, 0, 5);
      for (const sx of [-4.4, 0, 4.4]) box(b, 0.2, 3, 0.2, 0, sx, 5.9);
    }),
  ];
}

/**
 * Kinds whose orientation is MEANINGFUL, so §4a's per-instance yaw must not
 * touch them (DEC-R6-18).
 *
 * Every entry is a flat ground marking — a painted bay, a playing surface, a
 * pool, a ramp mouth. These read as aligned to something real (a kerb, a
 * street, a building line), so a random spin reads as a defect rather than as
 * variety, in a way that a randomly-facing bench does not.
 *
 * AN OPT-OUT LIST RATHER THAN A PER-MODEL FLAG, and the trade is worth stating
 * because the plan asked for the opposite. A required field on all fifty models
 * would force each author to decide, which is the stronger design — but §4 is
 * about to rewrite thirty-four of those models, so fifty new declarations would
 * be written twice. The guard instead is a test: every kind named here must
 * exist in {@link POI_MODELS}, so a typo fails rather than silently leaving a
 * car park spinning.
 *
 * **A model added later gets rotation by default.** That is the accepted risk of
 * the opt-out form; if a future model is a ground marking, it belongs here.
 */
export const GROUND_ALIGNED_KINDS: ReadonlySet<string> = new Set([
  "amenity=parking",
  "amenity=parking_space",
  "amenity=parking_entrance",
  "leisure=pitch",
  "leisure=swimming_pool",
]);

/** Every model, keyed by `key=value`. */
export const POI_MODELS: ReadonlyMap<string, PoiModel> = new Map(
  models().map((entry) => [entry.kind, entry]),
);

/** The model for a POI kind, or `undefined` when it has none. */
export function poiModelFor(kind: string): PoiModel | undefined {
  return POI_MODELS.get(kind);
}
