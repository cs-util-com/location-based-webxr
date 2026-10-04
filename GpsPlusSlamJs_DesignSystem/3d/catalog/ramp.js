/**
 * Catalog row "the old roughness ramp" (round-3 plan 2026-09-27-0532,
 * DEC-FB3-1): the twelve white and gold spheres that floated beside the
 * city since the first look-dev page, folded into the catalog as one
 * labelled row, so the page has one set of spheres at one spacing.
 *
 * KNOWN OVERLAP, kept visible on purpose: the gold half is nearly the
 * standard row's gold (0xe6c07a here, 0xe6b85c there, the same six
 * roughnesses, metalness 1), and the white half is the red dielectric row in
 * another hue. The owner chose the fold; the duplication is shown, not
 * dropped (round-3 record).
 *
 * Pure data: the page builds the materials (`material.type` + `params`).
 */

const ROUGHNESS = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** The old dielectric, 0xd8d8d8 (just under the validator's white limit). */
const white = ROUGHNESS.map((roughness) => ({
  id: `ramp-white-r${Math.round(roughness * 10)}`,
  category: "standard",
  name: `The old ramp: white dielectric, roughness ${roughness}`,
  label: `White · rough ${roughness}`,
  material: {
    type: "MeshStandardMaterial",
    params: { color: 0xd8d8d8, roughness, metalness: 0 },
  },
  features: ["pbr", "roughness"],
  costNotes: "Same program as the standard dielectric row.",
  arSafe: "unmeasured",
}));

/** The old metal, 0xe6c07a: almost the standard row's gold. */
const gold = ROUGHNESS.map((roughness) => ({
  id: `ramp-gold-r${Math.round(roughness * 10)}`,
  category: "standard",
  name: `The old ramp: gold metal, roughness ${roughness}`,
  label: `Ramp gold · rough ${roughness}`,
  material: {
    type: "MeshStandardMaterial",
    params: { color: 0xe6c07a, roughness, metalness: 1 },
  },
  features: ["pbr", "metal", "roughness"],
  costNotes: "Duplicates the standard gold row within a few levels of hue.",
  arSafe: "unmeasured",
}));

/** Twelve entries: exactly one catalog row (CATALOG_LAYOUT.perRow). */
export const RAMP_ENTRIES = [...white, ...gold];
