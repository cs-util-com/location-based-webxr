/**
 * Colour looks that switch the colour rules a scheme can switch (colour
 * tags, material walls, the tower rule, the lightness jitter, roads by
 * surface, the tone list lengths), every table moved, for the looks tests
 * and the looks bench: a look that only shifts the default tones exercises
 * the cheapest path and would hide the cost of the rules.
 *
 * @see rule-looks.ts.md
 */

import {
  DEFAULT_CITY_COLOUR_SCHEME,
  type CityColourScheme,
} from "../mesh/colour-scheme.js";

/** Every colour of a map moved by `delta` (xor), keys unchanged. */
function remapped<K>(
  map: ReadonlyMap<K, number>,
  delta: number,
): ReadonlyMap<K, number> {
  return new Map([...map].map(([key, rgb]) => [key, rgb ^ delta]));
}

/** A list of `n` tones derived from `base`, so list lengths differ per look. */
function tones(base: readonly number[], n: number, delta: number): number[] {
  return Array.from(
    { length: n },
    (_, i) =>
      (base[i % base.length] ?? 0) ^ ((delta + i * 0x030201) & 0x3f3f3f),
  );
}

/**
 * A look that differs from the default in every rule the default leaves off,
 * as the low-sun looks do: material walls on, a tower rule, a jitter, roads
 * by class, colour tags ignored, other list lengths and every table moved.
 */
export function ruleLook(
  delta: number,
  lengths: { walls: number; towers: number; roofs: number },
  rules: {
    honourColourTags: boolean;
    roadsBySurface: boolean;
    honourMaterialTags: boolean;
    towerFromM: number;
    wallJitterL: number;
  },
): CityColourScheme {
  const d = DEFAULT_CITY_COLOUR_SCHEME;
  return {
    ...d,
    ...rules,
    ground: d.ground ^ delta,
    walls: tones(d.walls, lengths.walls, delta),
    towerWalls: tones(d.walls, lengths.towers, delta ^ 0x111111),
    pitchedRoofs: tones(d.pitchedRoofs, lengths.roofs, delta),
    flatRoofs: tones(d.flatRoofs, lengths.roofs + 1, delta),
    materialWalls: new Map([
      ["brick", 0x9a5b44 ^ delta],
      ["stone", 0xb0a898 ^ delta],
      ["glass", 0x7f9db0 ^ delta],
      ["concrete", 0xa0a0a0 ^ delta],
      ["plaster", 0xd8cfc0 ^ delta],
    ]),
    roads: remapped(d.roads, delta),
    roadSurfaces: remapped(d.roadSurfaces, delta ^ 0x020202),
    sidewalk: d.sidewalk ^ delta,
    defaultRoad: d.defaultRoad ^ delta,
    markings: d.markings ^ delta,
    barriers: remapped(d.barriers, delta),
    barrierMaterials: remapped(d.barrierMaterials, delta),
    trees: remapped(d.trees, delta),
    landUse: remapped(d.landUse, delta),
  };
}

/** Today's look and three looks that each switch a different set of rules. */
const URBAN_LIKE = ruleLook(
  0x101010,
  { walls: 13, towers: 7, roofs: 5 },
  {
    honourColourTags: true,
    roadsBySurface: false,
    honourMaterialTags: true,
    towerFromM: 40,
    wallJitterL: 3,
  },
);
export const DUSK_LIKE = ruleLook(
  0x0c1824,
  { walls: 20, towers: 4, roofs: 3 },
  {
    honourColourTags: false,
    roadsBySurface: false,
    honourMaterialTags: true,
    towerFromM: 25,
    wallJitterL: 6,
  },
);
const BLUE_LIKE = ruleLook(
  0x201008,
  { walls: 12, towers: 12, roofs: 6 },
  {
    honourColourTags: true,
    roadsBySurface: true,
    honourMaterialTags: false,
    towerFromM: Infinity,
    wallJitterL: 0,
  },
);
export const FOUR_LOOKS = [
  DEFAULT_CITY_COLOUR_SCHEME,
  URBAN_LIKE,
  DUSK_LIKE,
  BLUE_LIKE,
] as const;
