/**
 * The colour of a drawn barrier: a muted colour per kind, a material colour
 * where one is tagged, and a tagged colour mixed in at half (city objects
 * plan 2026-11-07-2315 M1, the O1 quiet-greens look the owner chose).
 *
 * @see barrier-colours.ts.md
 */

import type { OsmTags } from "../model/osm-feature.js";
import { barrierKind, type BarrierKind } from "./barriers.js";
import { parseOsmColour, type Rgb } from "./feature-colours.js";
import { linearToSrgb, srgbToLinear } from "./srgb.js";

/** sRGB per kind. Muted on purpose: barriers sit behind the buildings. */
export const BARRIER_KIND_RGB: ReadonlyMap<BarrierKind, Rgb> = new Map([
  ["hedge", 0x6a785d],
  ["wall", 0xa59e93],
  ["city_wall", 0x9b9081],
  ["retaining_wall", 0x9d9d98],
  ["fence", 0x7d7366],
]);

/** sRGB per tagged material (`material`, `fence_type` or a wall's `wall`). */
export const BARRIER_MATERIAL_RGB: ReadonlyMap<string, Rgb> = new Map([
  ["brick", 0x9a7262],
  ["stone", 0xa49a8a],
  ["dry_stone", 0xa49a8a],
  ["sandstone", 0xa8907a],
  ["concrete", 0xa0a09c],
  ["wood", 0x8a7660],
  ["metal", 0x7c8186],
  ["chain_link", 0x7c8186],
  ["steel", 0x7c8186],
]);

/** Share of a tagged `colour` in the result; the rest is the base colour. */
export const TAGGED_BARRIER_COLOUR_SHARE = 0.5;

const WALL_RGB = 0xa59e93;

function mixLinear(base: Rgb, tagged: Rgb, share: number): Rgb {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const a = srgbToLinear(((base >> shift) & 0xff) / 255);
    const b = srgbToLinear(((tagged >> shift) & 0xff) / 255);
    const byte = Math.round(linearToSrgb(a + (b - a) * share) * 255);
    out |= byte << shift;
  }
  return out >>> 0;
}

/**
 * The packed sRGB colour of a barrier with these tags.
 *
 * - The kind colour, a wall's for tags of no solid kind.
 * - Replaced by the material colour (`material`, then `fence_type`, then
 *   `wall` on a wall), except on a hedge, which is leaves.
 * - Then a parseable `colour` (else `building:colour`) is mixed in at
 *   `TAGGED_BARRIER_COLOUR_SHARE`, in linear light. Named colours resolve
 *   through the one parser (`parseOsmColour`).
 */
function baseColour(tags: OsmTags): Rgb {
  const kind = barrierKind(tags);
  const kindRgb =
    (kind === undefined ? undefined : BARRIER_KIND_RGB.get(kind)) ?? WALL_RGB;
  if (kind === "hedge") return kindRgb;
  const material =
    tags["material"] ??
    tags["fence_type"] ??
    (kind === "wall" ? tags["wall"] : undefined);
  return BARRIER_MATERIAL_RGB.get(material ?? "") ?? kindRgb;
}

export function barrierColour(tags: OsmTags): Rgb {
  const base = baseColour(tags);
  const tagged =
    parseOsmColour(tags["colour"]) ?? parseOsmColour(tags["building:colour"]);
  return tagged === undefined
    ? base
    : mixLinear(base, tagged, TAGGED_BARRIER_COLOUR_SHARE);
}
