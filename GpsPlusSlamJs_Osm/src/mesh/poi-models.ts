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
  composed,
  groundedMesh,
  hut,
  prism,
  scaledToHeight,
  slabOnLegs,
} from "./poi-primitives.js";
import { B_VARIANTS } from "./poi-variants-b.js";
import { D_VARIANTS } from "./poi-variants-d.js";
import { G_VARIANTS } from "./poi-variants-g.js";
import { H_VARIANTS } from "./poi-variants-hybrid.js";
import { L_VARIANTS } from "./poi-variants-l.js";
import { M_VARIANTS } from "./poi-variants-m.js";
import { P_VARIANTS } from "./poi-variants-p.js";

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

/**
 * The one house colour with no equivalent among our material names.
 *
 * The rest of the house palette is reachable through the repointed constants
 * below — `TIMBER` is `woodMid`, `DARK_STEEL` is `metalDark`, `STONE` is
 * `stoneLight` — so only the second stone tone needs a name of its own. Two
 * names for one value is how a palette starts drifting.
 */
const STONE_MID = 0x6e7b85;

/**
 * The house accents (`MUSTARD`, `COPPER`, `WATER_BRIGHT`) were REMOVED when the
 * gallery verdict was adopted (DEC-R7b-2).
 *
 * They existed for the §4 rebuild's post box, memorial and drinking fountain —
 * three models the owner then replaced with `B` and `D` ports, which carry their
 * own colours through `adopted()`. Nothing referenced them afterwards. Noted
 * rather than silently deleted because the rule that put them here still stands:
 * R4-14 warns the palette budget is nearly spent, so an accent is added only
 * when a model that was liked actually uses it, never speculatively.
 */

/**
 * The material palette, REPOINTED AT THE HOUSE VALUES (§4, DEC-R6-27).
 *
 * These names are ours and the values are now `poi-markers-gallery (2)`'s. The
 * rename rather than a redesign is the point: our constants were already the
 * same materials by name — timber, steel, stone, water — so pointing each at
 * its house equivalent moves all FIFTY models onto one palette in one edit,
 * including the sixteen §4.3 leaves alone geometrically.
 *
 * **WHY ALL FIFTY AND NOT JUST THE REBUILT 34.** DEC-R6-11 rejected copying
 * each model from its own source precisely to avoid "five palettes and five
 * primitive libraries in one scene", and leaving sixteen kinds on the old
 * constants would have reintroduced two of them for the whole duration of the
 * rebuild — in the gallery that §4.6 says is the surface for judging every
 * model against its source.
 *
 * **Accepted cost:** the sixteen untouched kinds change colour without
 * individual judgement. A few may have been deliberately tuned away from their
 * material default, so `/gallery.html` is worth one look for a kind that now
 * reads wrong.
 *
 * sRGB hex, as three's `Color` and our `MeshBuilder.paint` both read it. Do NOT
 * convert these to linear.
 */
const TIMBER = 0x8a6a4f;
const STEEL = 0xa6adb2;
const DARK_STEEL = 0x5a6167;
const PAINT_RED = 0xa8543f;
const PAINT_BLUE = 0x55697c;
const PAINT_GREEN = 0x9baf8e;
const STONE = 0x8894a0;
const GLASS = 0x2b3540;
const WATER = 0x17878a;
const ASPHALT = 0xa99e8c;
const SAND = 0xc4b9a6;

/**
 * The highest point of a mesh, metres.
 *
 * One helper rather than the same three-line loop in both builders below —
 * `heightM` is DERIVED for every model, however the geometry arrived, and two
 * copies of the derivation is two places for it to stop agreeing.
 */
function peakOf(mesh: MeshData): number {
  let peak = 0;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    peak = Math.max(peak, mesh.positions[i] as number);
  }
  return peak;
}

/** Every model, in ranking order. Built once at module load. */
function models(): PoiModel[] {
  const model = (
    kind: string,
    colour: number,
    build: Parameters<typeof composed>[0],
  ): PoiModel => {
    const mesh = composed(build);
    return { kind, colour, heightM: peakOf(mesh), mesh };
  };

  /**
   * A model ported from one of the gallery prototypes (DEC-R7b-2).
   *
   * The owner compared 51 candidate models against the 50 shipped ones and
   * chose a winner for 31 kinds; 29 of those winners were not the incumbent.
   * These are those 29. The provenance letter is the source file the shape came
   * from — see each `poi-variants-*.ts`.
   *
   * GROUND FIRST, THEN SCALE, and the order is not cosmetic. `scaledToHeight`
   * scales about the origin and assumes the base is already there, so scaling an
   * un-grounded mesh multiplies its negative dip along with its height.
   *
   * WHY A TARGET HEIGHT IS PASSED AT ALL, when every other model derives its
   * own. The prototypes are dioramas: every kind was drawn to one display
   * envelope whatever the thing really is, so `D`'s place_of_worship is ~1.9 m
   * where a church is 12 m. The shape is right and the scale is not, so it is
   * scaled uniformly to a real-world height. `heightM` is still MEASURED from
   * the built mesh — the target is declared, the height is not.
   */
  const adopted = (
    kind: string,
    colour: number,
    variants: ReadonlyMap<string, () => MeshData>,
    targetHeightM: number,
  ): PoiModel => {
    const build = variants.get(kind);
    if (build === undefined) {
      throw new Error(`no ported variant builds "${kind}"`);
    }
    const mesh = scaledToHeight(groundedMesh(build()), targetHeightM);
    return { kind, colour, heightM: peakOf(mesh), mesh };
  };

  return [
    // 1 — a marked bay with a low kerb, not a building.
    model("amenity=parking", ASPHALT, (b) => {
      box(b, 5, 0.1, 2.5);
      box(b, 5, 0.12, 0.12, 0, 0, 1.25);
    }),
    // 2 — a pitch: a flat playing surface with a goal at one end.
    adopted("leisure=pitch", PAINT_GREEN, M_VARIANTS, 2.4200000762939453),
    // 3 — THE BENCH the notes name, REBUILT IN THE HOUSE STYLE (§4, DEC-R6-15).
    //
    // SOURCE: `poi-markers-gallery (2)`'s `k_bench`, which the owner rated
    // "nice details, best version so far" — the only kind in §4.3 with a stated
    // winner, and the model to study first when learning the vocabulary.
    //
    // WHAT WAS STRIPPED: its `plinth(p, 1.56, 0.62)` and the `PL_H` offset on
    // every part. DEC-R6-8 keeps real-world scale, so the bench stands on the
    // ground rather than on a 9 cm display slab. Nothing else changed.
    //
    // WHAT WAS CONVERTED: the prototype's `y` is a box CENTRE (three's
    // `BoxGeometry` is centred); our `box` takes a BASE. Every `y` below is
    // therefore the source's minus half its height — the one transformation
    // that had to be applied by hand, and the one to check first if this looks
    // wrong.
    //
    // Three slats, not one slab: the slatting IS the detail, and the previous
    // model (a `slabOnLegs` plus one backrest box) read as a plinth.
    model("amenity=bench", TIMBER, (b) => {
      // Seat: three slats running the length, with gaps between them.
      for (let i = 0; i < 3; i++) {
        box(b, 1.36, 0.05, 0.11, 0.415, 0, -0.13 + i * 0.13);
      }
      // Backrest: two slats, leaning at the back edge.
      for (let i = 0; i < 2; i++) {
        box(b, 1.36, 0.11, 0.05, 0.525 + i * 0.14, 0, -0.2);
      }
      // The frame, in metal rather than timber — which is the whole reason this
      // model needs per-face painting and could not be expressed before §4.
      b.paint(DARK_STEEL);
      for (const s of [-1, 1]) {
        box(b, 0.06, 0.44, 0.4, 0, s * 0.58, -0.03);
        box(b, 0.06, 0.32, 0.05, 0.44, s * 0.58, -0.2);
      }
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
    adopted("amenity=place_of_worship", STONE, L_VARIANTS, 12),
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
    adopted("leisure=park", PAINT_GREEN, H_VARIANTS, 4.559999942779541),
    // 10 — an information board on two posts.
    // REBUILT (§4). SOURCE: `k_information`, and **the first model to use the
    // rotation DEC-R6-26 added** — its whole board is `rx: -0.14`, and an
    // information board that is not tilted back is a fence panel.
    //
    // `pushTransform` rotates about the part's OWN origin and then offsets, so
    // the board's centre is given as the offset and its geometry is built
    // around zero. That is why the boxes below are at base `-h/2` rather than
    // at their final height.
    adopted("tourism=information", 0x6b4e3d, D_VARIANTS, 1.3049999475479126),
    // 11 — a garden: a bed edged in stone, with a shrub.
    model("leisure=garden", PAINT_GREEN, (b) => {
      box(b, 4, 0.25, 4);
      box(b, 3.4, 0.3, 3.4, 0.25);
      prism(b, 0.7, 0.45, 0.7, 6, 0.55);
    }),
    // 12 — a playground: a slide platform with a ladder.
    adopted("leisure=playground", PAINT_BLUE, D_VARIANTS, 2.7200000286102295),
    // 13 — THE WASTE BASKET the notes name: a tapered bin on a post.
    // REBUILT (§4, DEC-R6-15/28). SOURCE: `k_waste_basket`. §4.3 lists this
    // under G; DEC-R6-28 takes the house file's version because it has one.
    //
    // NOTE THE ARGUMENT ORDER, which is the trap in every `cyl` port: three's
    // `CylinderGeometry(radiusTop, radiusBottom, ...)` puts the TOP first and
    // our `prism(bottomRadius, topRadius, ...)` puts the bottom first. A bin
    // that tapers the wrong way still looks like a bin, so nothing catches it.
    adopted("amenity=waste_basket", STEEL, G_VARIANTS, 0.9024999737739563),
    // 14 — a fuel station: a canopy over a pump.
    adopted("amenity=fuel", STEEL, D_VARIANTS, 5),
    // 15 — bicycle parking: a row of hoops.
    adopted("amenity=bicycle_parking", STEEL, M_VARIANTS, 0.8100000023841858),
    // 16 — a cafe: a small shopfront with a parasol.
    adopted("amenity=cafe", TIMBER, L_VARIANTS, 3),
    // 17 — fast food: a boxy unit with a service window and a sign.
    adopted("amenity=fast_food", PAINT_RED, M_VARIANTS, 4.300000190734863),
    // 18 — a shelter: an open roof on four posts, with a bench in it.
    adopted("amenity=shelter", TIMBER, L_VARIANTS, 2.5),
    // 19 — a hotel: a tall block with a marked entrance canopy.
    model("tourism=hotel", STONE, (b) => {
      box(b, 10, 13.5, 9);
      box(b, 4, 0.3, 1.6, 2.8, 0, 5);
    }),
    // 20 — a bank: a stone block with a portico.
    adopted("amenity=bank", STONE, D_VARIANTS, 8),
    // 21 — toilets: a small block with two doors.
    model("amenity=toilets", STONE, (b) => {
      box(b, 3, 2.6, 2.4);
      box(b, 0.8, 1.9, 0.08, 0, -0.7, 1.25);
      box(b, 0.8, 1.9, 0.08, 0, 0.7, 1.25);
      box(b, 3.2, 0.2, 2.6, 2.6);
    }),
    // 22 — recycling: three containers side by side.
    adopted("amenity=recycling", PAINT_GREEN, D_VARIANTS, 1.399999976158142),
    // 23 — a pharmacy: a shopfront with a cross above it.
    model("amenity=pharmacy", PAINT_GREEN, (b) => {
      box(b, 5, 3.4, 4.5);
      box(b, 1.2, 0.35, 0.12, 3.7);
      box(b, 0.35, 1.2, 0.12, 3.15);
    }),
    // 24 — a post box: a rounded pillar with a slot hood.
    // REBUILT (§4). SOURCE: `k_post_box`. §4.3 lists it under B; DEC-R6-28
    // takes the house file's, which has one.
    adopted("amenity=post_box", STONE, B_VARIANTS, 1.0449999570846558),
    // 25 — a memorial: a plinth carrying a stele.
    // REBUILT (§4). SOURCE: `k_memorial`. A stepped base, a stele, an inscribed
    // plate and a verdigris cap — where the old model was three plain boxes.
    adopted("historic=memorial", STONE, D_VARIANTS, 1.1200000047683716),
    // 26 — a kindergarten: a low bright block with a pitched roof.
    model("amenity=kindergarten", PAINT_BLUE, (b) => {
      hut(b, 8, 6, 3.4, 1.8);
      box(b, 1, 2, 0.12, 0, -2, 3.05);
    }),
    // 27 — drinking water: a fountain bowl on a column.
    // REBUILT (§4). SOURCE: `k_drinking_water`. §4.3 lists it under D (as the
    // typo'd `drinking_walter`); DEC-R6-28 takes the house file's version.
    adopted("amenity=drinking_water", STONE, D_VARIANTS, 1.024999976158142),
    // 28 — a picnic table: a table slab with a bench each side.
    adopted("leisure=picnic_table", TIMBER, P_VARIANTS, 0.75),
    // 29 — a sports centre: a wide hall with a curved-looking roof band.
    model("leisure=sports_centre", STEEL, (b) => {
      box(b, 16, 8, 12);
      box(b, 16.4, 1, 12.4, 8);
    }),
    // 30 — an attraction: a plinth with a marker obelisk.
    adopted("tourism=attraction", STONE, L_VARIANTS, 4.199999809265137),
    // 31 — artwork: an irregular sculpture on a base.
    adopted("tourism=artwork", DARK_STEEL, P_VARIANTS, 3.049999952316284),
    // 32 — a vending machine: a cabinet with a front panel.
    adopted(
      "amenity=vending_machine",
      PAINT_BLUE,
      D_VARIANTS,
      1.7999999523162842,
    ),
    // 33 — a bar: a shopfront with a projecting sign.
    adopted("amenity=bar", DARK_STEEL, D_VARIANTS, 3.4000000953674316),
    // 34 — a hunting stand: a raised box on four tall legs, with a ladder.
    adopted("amenity=hunting_stand", TIMBER, L_VARIANTS, 4.5),
    // 35 — a viewpoint: a railing on a small platform.
    adopted("tourism=viewpoint", STEEL, L_VARIANTS, 1.1299999952316284),
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
    adopted("amenity=waste_disposal", DARK_STEEL, L_VARIANTS, 1.5),
    // 40 — a pub: a hut with a hanging sign on a bracket.
    model("amenity=pub", TIMBER, (b) => {
      hut(b, 7, 6, 3.6, 1.6);
      box(b, 0.08, 0.08, 1, 3, 3.4, 0.5);
      box(b, 0.06, 0.7, 0.8, 2.3, 3.4, 1);
    }),
    // 41 — a graveyard: headstones on grass.
    adopted("amenity=grave_yard", STONE, D_VARIANTS, 0.86 * 3),
    // 42 — a clinic: a small block with an entrance canopy and a sign.
    model("amenity=clinic", GLASS, (b) => {
      box(b, 8, 6, 6);
      box(b, 3, 0.25, 1.4, 2.8, 0, 3.2);
      box(b, 1.6, 0.35, 0.1, 4.6, 0, 3.05);
    }),
    // 43 — an archaeological site: broken column stubs on a base.
    adopted(
      "historic=archaeological_site",
      SAND,
      M_VARIANTS,
      1.600000023841858,
    ),
    // 44 — a guest house: a house with a dormer.
    model("tourism=guest_house", TIMBER, (b) => {
      hut(b, 8, 7, 5.2, 2.4);
      box(b, 1.4, 1, 1.6, 5.2, -1.6, 1.4);
    }),
    // 45 — a wayside cross: a cross on a stepped base.
    // REBUILT IN THE HOUSE STYLE (§4, DEC-R6-15).
    //
    // SOURCE: `poi-markers-gallery (2)`'s `k_wayside_cross`. §4.3 lists this
    // kind under D and L; DEC-R6-15 resolves the tie to L, whose vocabulary is
    // the one being adopted.
    //
    // Plinth stripped and every `y` converted from the source's box CENTRE to
    // our BASE. This one ports EXACTLY — it is pure boxes with no rotated
    // parts, which is why it went in the first batch (see §14.16).
    //
    // The stepped base and the two-tone stone are the detail the old model had
    // none of: it was four boxes in one colour, which reads as a signpost.
    model("historic=wayside_cross", STONE, (b) => {
      // A two-step stone base, darker than the shaft above it.
      b.paint(STONE_MID);
      box(b, 0.46, 0.09, 0.38, 0);
      box(b, 0.34, 0.08, 0.28, 0.09);
      // The pedestal, the shaft and the cross-arm, in lighter stone.
      b.paint(STONE);
      box(b, 0.17, 0.32, 0.15, 0.17);
      box(b, 0.13, 0.72, 0.12, 0.49);
      box(b, 0.44, 0.13, 0.12, 0.955);
      // The capstone, back to the darker stone.
      b.paint(STONE_MID);
      box(b, 0.15, 0.05, 0.13, 1.21);
    }),
    // 46 — `historic=yes`, unspecified: a plain marker stone. Deliberately
    // featureless, because the tag itself says nothing more than "old".
    adopted("historic=yes", STONE, B_VARIANTS, 1.4 * 3),
    // 47 — a fountain: a basin with a central jet column.
    adopted("amenity=fountain", WATER, D_VARIANTS, 1.7999999523162842),
    // 48 — a parking entrance: a ramp mouth with a headroom bar.
    adopted(
      "amenity=parking_entrance",
      ASPHALT,
      L_VARIANTS,
      2.5999999046325684,
    ),
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
