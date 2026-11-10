/**
 * The land-use ground tint: which mapped area paints which class into the
 * ground, in which muted colour, in which order (city objects plan
 * 2026-11-07-2315 M3, a port of the O2 painted-ground prototype the owner
 * chose).
 *
 * @see ground-tint.ts.md
 */

import type { Rgb } from "./feature-colours.js";

/** The land-use classes the tint paints. */
export const GROUND_CLASS_NAMES = [
  "residential",
  "commercial",
  "industrial",
  "railway",
  "institutional",
  "construction",
  "farmyard",
  "farmland",
  "meadow",
  "grass",
  "park",
  "orchard",
  "allotments",
  "cemetery",
  "wood",
  "scrub",
  "wetland",
  "sand",
  "sport",
  "water",
  "pitch",
  "court",
  "playground",
  "parking",
  "square",
] as const;

export type GroundClass = (typeof GROUND_CLASS_NAMES)[number];

/**
 * The neutral ground: OsmDemo's ground colour (`surface-colours.ts`
 * `GROUND_COLOUR`), the colour of every texel no class paints and the blend
 * target of every class. sRGB.
 */
export const DEFAULT_GROUND_RGB: Rgb = 0x6b7280;

/**
 * O2's muted class colours, sRGB. All sit near the neutral ground in
 * lightness with a chroma (max minus min channel) under 45, so the heat ramp
 * stays the loudest colour (DEC-R4-5).
 */
export const DEFAULT_LAND_USE_RGB: ReadonlyMap<GroundClass, Rgb> = new Map<
  GroundClass,
  Rgb
>([
  ["residential", 0x74757a],
  ["commercial", 0x7c7579],
  ["industrial", 0x787570],
  ["railway", 0x6f6c6b],
  ["institutional", 0x77757f],
  ["construction", 0x7f786d],
  ["farmyard", 0x847c6d],
  ["farmland", 0x948e74],
  ["meadow", 0x878f70],
  ["grass", 0x7e8a6e],
  ["park", 0x7a866c],
  ["orchard", 0x858a69],
  ["allotments", 0x828867],
  ["cemetery", 0x737c6c],
  ["wood", 0x5f6e58],
  ["scrub", 0x6e765f],
  ["wetland", 0x6b7a72],
  ["sand", 0x9f9984],
  ["sport", 0x787e76],
  ["water", 0x6b8194],
  ["pitch", 0x7a8e74],
  ["court", 0x8b837e],
  ["playground", 0x928875],
  ["parking", 0x898b90],
  ["square", 0x8a8884],
]);
