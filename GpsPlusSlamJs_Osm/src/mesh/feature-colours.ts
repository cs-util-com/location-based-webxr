/**
 * What colour a building or a road is (W22/W23, R4-6/R4-10, DEC-R4-5).
 *
 * THE COMPLAINT. _"Die Gebäude sind halt gerade so ein hässliches Hellgrau"_ —
 * every building was `0xc8ccd8` and every road `0x8b909c`, one constant each for
 * the whole world.
 *
 * THE AXIS, and it was a real choice between three (DEC-R4-5). **Semantic class
 * as the base, appearance tags as an override.**
 *
 * - `building=*` and `highway=*` are present by definition — they are what makes
 *   the feature a building or a road at all — so every feature gets a colour
 *   everywhere on earth. That is the base.
 * - `building:colour`, `building:material` and `surface` are what the thing
 *   actually looks like, and they win where a mapper has said. They are sparse:
 *   in most of Cologne this changes nothing, which is why they could not be the
 *   base — appearance-only was offered and rejected for exactly that.
 * - Colouring by AFFORDANCE was the third option and was rejected: the cells and
 *   region slabs already own the heat ramp, and a building palette that read as
 *   "scores" would be two colour languages saying different things in the same
 *   hues.
 *
 * THE PALETTE IS MUTED, and that is a constraint rather than taste. R4-14 warns
 * the scene is already close to too colourful, and §2 of the round-4 plan makes
 * it an invariant: **the heat ramp stays the loudest thing on screen.** These are
 * desaturated material tones, not category codes.
 *
 * ROADS KEEP THEIR MEASURED CONTRAST. DEC-R2-13 lightened the road material to
 * `0x8b909c` after measuring that a darker asphalt grey landed within a few
 * levels of the ground and moved 77 pixels out of 460 800. Every road colour here
 * is checked against the ground in `feature-colours.test.ts` rather than trusted.
 *
 * @see feature-colours.ts.md
 */

import type { OsmTags } from "../model/osm-feature.js";

/** Packed `0xrrggbb`. */
export type Rgb = number;

/**
 * The ground's rendered tone, as the demo draws it.
 *
 * Stated here so the road palette can be checked against it. It is a COPY of a
 * value the demo owns, which is exactly the duplication this project distrusts —
 * so the test asserts a relationship (contrast) rather than equality, and a
 * change to the demo's ground colour makes the test wrong rather than silently
 * stale.
 */
export const REFERENCE_GROUND_RGB: Rgb = 0x3a4356;

/** Fallback for a building whose class nothing recognises. */
export const DEFAULT_BUILDING_RGB: Rgb = 0xc8ccd8;

/** Fallback for a road class nothing recognises. */
export const DEFAULT_ROAD_RGB: Rgb = 0x8b909c;

/**
 * Colour by `building=*`.
 *
 * Chosen so a city reads at a glance: homes warm and pale, commerce cooler,
 * industry drab, civic and religious buildings stony. Everything stays within a
 * narrow lightness band so the skyline does not turn into a chart.
 */
const BUILDING_CLASS_RGB: Readonly<Record<string, Rgb>> = {
  house: 0xd8c9b4,
  detached: 0xd8c9b4,
  semidetached_house: 0xd8c9b4,
  residential: 0xd2c4b2,
  apartments: 0xc9bda9,
  terrace: 0xd0bfa9,
  bungalow: 0xd8c9b4,
  hut: 0xb9a184,
  cabin: 0xb9a184,
  farm: 0xc9b295,
  farm_auxiliary: 0xb8a68c,
  barn: 0xa8886a,
  stable: 0xa8886a,
  greenhouse: 0xbcd0cc,
  commercial: 0xb4bcc8,
  retail: 0xc2b7c4,
  supermarket: 0xc2b7c4,
  office: 0xa9b6c6,
  hotel: 0xc6b6bd,
  industrial: 0x9fa5a8,
  warehouse: 0x9aa0a4,
  service: 0x9aa0a4,
  garage: 0x9aa0a4,
  garages: 0x9aa0a4,
  church: 0xbdb4a6,
  chapel: 0xbdb4a6,
  cathedral: 0xbdb4a6,
  mosque: 0xbdb4a6,
  synagogue: 0xbdb4a6,
  temple: 0xbdb4a6,
  school: 0xc6c2ab,
  university: 0xc6c2ab,
  college: 0xc6c2ab,
  kindergarten: 0xc9c3a8,
  hospital: 0xc4c9cd,
  public: 0xbec5cb,
  civic: 0xbec5cb,
  train_station: 0xb0aab4,
  transportation: 0xb0aab4,
  roof: 0xa6a9ad,
  construction: 0xb2ada2,
  ruins: 0xa79f92,
};

/**
 * Colour by `building:material`, when a mapper has said what it is made of.
 *
 * Modelled on `streets-gl`'s `getFacadeParamsFromTags`, which does the same
 * lookup with the same intent. Values are muted versions of the real material.
 */
const BUILDING_MATERIAL_RGB: Readonly<Record<string, Rgb>> = {
  brick: 0xa8705c,
  brick_block: 0xa8705c,
  concrete: 0xb4b4b0,
  cement_block: 0xb4b4b0,
  stone: 0xb7b2a6,
  sandstone: 0xc4b393,
  limestone: 0xc6c0ae,
  marble: 0xd6d2c8,
  wood: 0xb08b5f,
  timber_framing: 0xc3ad8d,
  glass: 0x9fb6c4,
  mirror: 0x9fb6c4,
  metal: 0xa9aeb4,
  steel: 0xa9aeb4,
  plaster: 0xd0cabe,
  plastered: 0xd0cabe,
  stucco: 0xd0cabe,
  clay: 0xbe8f6d,
  adobe: 0xc9a077,
};

/**
 * Colour by `highway=*`.
 *
 * A road class ladder rather than a rainbow: bigger roads are lighter and
 * warmer, paths and tracks browner, so the hierarchy reads without a legend.
 * Every one of these is contrast-checked against the ground.
 */
const ROAD_CLASS_RGB: Readonly<Record<string, Rgb>> = {
  // CAR CLASSES ARE NEAR-ACHROMATIC (DEC-R7b-4a). They used to be warm beiges,
  // which put them in the same hue family as the paths and left the two
  // separated only by ~2 levels of lightness. Grey has no hue to confuse, which
  // is what makes the asymmetry work: the paths carry all the colour.
  motorway: 0xc2c4c6,
  motorway_link: 0xc2c4c6,
  trunk: 0xbcbec1,
  trunk_link: 0xbcbec1,
  primary: 0xb6b8bc,
  primary_link: 0xb6b8bc,
  secondary: 0xaeb0b4,
  secondary_link: 0xaeb0b4,
  tertiary: 0xa8aaae,
  tertiary_link: 0xa8aaae,
  unclassified: 0xa4a6a8,
  residential: 0xa0a3a8,
  living_street: 0x9fa1a6,
  // Five hex digits here (0x969aa) parsed as a dark blue and the lightness
  // band caught it — a service road would have rendered near-black against the
  // ground, which is precisely the failure DEC-R2-13 measured.
  service: 0x9699a4,
  busway: 0x9aa4b0,

  // PEDESTRIAN CLASSES ARE WARM AND SATURATED. The heat ramp is Viridis —
  // purple through yellow, entirely cool — so a brown path cannot compete with
  // the loudest thing on screen, which is what the muted-palette rule protects.
  // Every one stays inside the 120–215 lightness band the buildings share; the
  // hue does the separating, so none of them has to go dark to be legible.
  pedestrian: 0xbfa079,
  footway: 0xb5926a,
  path: 0xa9855c,
  steps: 0xc09b6e,
  cycleway: 0xb08d5f,

  // NOT pedestrian classes, and left alone. A track is an unpaved rural way and
  // a bridleway is for horses; both already sit in this brown and neither was
  // what the session asked about. Folding them in would answer a question
  // nobody put.
  track: 0x9d8f78,
  bridleway: 0x9d8f78,
};

/**
 * Colour by `surface`, when a mapper has said what the road is made of.
 *
 * OSM2World's `DefaultMaterials` is the reference for these: it colours by
 * surface rather than by class, and the values here are its palette moved into
 * this scene's lightness band.
 */
const SURFACE_RGB: Readonly<Record<string, Rgb>> = {
  asphalt: 0x9a9ea4,
  concrete: 0xb0b0ac,
  paving_stones: 0xb4aea6,
  sett: 0xa8a29a,
  cobblestone: 0xa8a29a,
  paved: 0xa4a6aa,
  gravel: 0xa89e8c,
  fine_gravel: 0xb4ab99,
  compacted: 0xac9f88,
  dirt: 0x9c8262,
  ground: 0x9c8f76,
  earth: 0x9c8262,
  unpaved: 0xa2947c,
  grass: 0x8ba173,
  sand: 0xc4b48a,
  wood: 0xb08b5f,
  metal: 0xa9aeb4,
};

/**
 * Parses `building:colour`, which OSM allows as `#rrggbb` or a CSS name.
 *
 * NAMES ARE NOT RESOLVED, deliberately: the CSS list is 148 entries of which a
 * handful appear in OSM, and a wrong colour is worse than the class default —
 * it looks like a decision. Only the hex forms are read.
 *
 * Returns `undefined` for anything malformed rather than black: a building that
 * renders black reads as a rendering failure, and `#gggggg` is a real thing
 * people type.
 */
export function parseOsmColour(raw: string | undefined): Rgb | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim().toLowerCase();
  const long = /^#([0-9a-f]{6})$/.exec(text);
  if (long?.[1] !== undefined) return Number.parseInt(long[1], 16);
  const short = /^#([0-9a-f]{3})$/.exec(text);
  if (short?.[1] === undefined) return undefined;
  // `#abc` is `#aabbcc`, not `#0a0b0c`.
  const [r, g, b] = [...short[1]] as [string, string, string];
  return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
}

/**
 * The colour of one building.
 *
 * Precedence: `building:colour`, then `building:material`, then `building=*`,
 * then the default. Highest first, which is the order a mapper's intent runs in
 * — an explicit colour is a statement about THIS building, a material is a
 * statement about its construction, and a class is a statement about its use.
 */
export function buildingColour(tags: OsmTags): Rgb {
  return (
    parseOsmColour(tags["building:colour"]) ??
    BUILDING_MATERIAL_RGB[tags["building:material"] ?? ""] ??
    BUILDING_CLASS_RGB[tags["building"] ?? ""] ??
    DEFAULT_BUILDING_RGB
  );
}

/**
 * The `highway` values that are for people on foot rather than in cars.
 *
 * `bridleway` is NOT here, deliberately. It is a horse way, the session that
 * asked for this was about pedestrians, and it already sits at the `track`
 * brown — well clear of the car greys. If it belongs anywhere it belongs with
 * `track` as a separate "unpaved rural" question, and folding it in silently
 * would answer that question without anyone asking it.
 */
export const PEDESTRIAN_CLASSES = [
  "footway",
  "path",
  "steps",
  "pedestrian",
  "cycleway",
] as const;

const PEDESTRIAN = new Set<string>(PEDESTRIAN_CLASSES);

/**
 * The colour of one road.
 *
 * Precedence: `surface`, then `highway=*`, then the default — EXCEPT for the
 * pedestrian classes, where the class wins (DEC-R7b-4).
 *
 * WHY THE EXCEPTION, and it is the actual defect the session reported. A surface
 * is what a road is made of and is the stronger claim about its appearance; a
 * class is what it is FOR. Those agree for car roads and disagree for paths:
 * `highway=footway, surface=asphalt` and `highway=residential, surface=asphalt`
 * rendered byte-identical, so in a well-mapped city centre — where `surface` is
 * tagged often — a footpath was simply a narrow road.
 *
 * **The trade is explicit**: a gravel path and a paved path now look the same.
 * Being able to see which ways you can walk on was judged worth more than the
 * material of the ones you can.
 */
export function roadColour(tags: OsmTags): Rgb {
  const highway = tags["highway"] ?? "";
  if (PEDESTRIAN.has(highway)) {
    return ROAD_CLASS_RGB[highway] ?? DEFAULT_ROAD_RGB;
  }
  return (
    SURFACE_RGB[tags["surface"] ?? ""] ??
    ROAD_CLASS_RGB[highway] ??
    DEFAULT_ROAD_RGB
  );
}

/** Every colour a road can take, for the contrast check. */
export function allRoadColours(): Rgb[] {
  return [
    ...Object.values(ROAD_CLASS_RGB),
    ...Object.values(SURFACE_RGB),
    DEFAULT_ROAD_RGB,
  ];
}

/** Every colour a building can take, for the palette-range check. */
export function allBuildingColours(): Rgb[] {
  return [
    ...Object.values(BUILDING_CLASS_RGB),
    ...Object.values(BUILDING_MATERIAL_RGB),
    DEFAULT_BUILDING_RGB,
  ];
}

/** Perceived brightness of a packed colour, 0–255. */
export function luma(colour: Rgb): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * How much colour a value has, 0 (grey) to 1 (fully saturated) — HSL's S.
 *
 * THE AXIS THE ROAD PALETTE SEPARATES ON (DEC-R7b-4a). Lightness was already
 * spent: `allRoadColours` must stay inside a 120–215 band so nothing competes
 * with the buildings, and the car greys occupy most of it. Hue angle is
 * meaningless on a near-grey. What actually distinguishes a path from a lane is
 * that one HAS colour and the other does not, and that is this number.
 */
export function saturation(colour: Rgb): number {
  const r = ((colour >> 16) & 0xff) / 255;
  const g = ((colour >> 8) & 0xff) / 255;
  const b = (colour & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const lightness = (max + min) / 2;
  return delta / (1 - Math.abs(2 * lightness - 1));
}

/** Chebyshev distance between two colours, per channel. */
export function channelDistance(a: Rgb, b: Rgb): number {
  return Math.max(
    Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)),
    Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)),
    Math.abs((a & 0xff) - (b & 0xff)),
  );
}
