/**
 * Catalog category "standard" (W5 plan 2026-09-26-0549, M1): three's
 * physically based default, swept. The old grey swatch rows, now in colour:
 * roughness 0-1 on a dielectric and on three metals.
 *
 * Pure data: the page builds the materials (`material.type` + `params`).
 */

const ROUGHNESS = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** A dielectric (paint, plastic) at each roughness, in one hue. */
const dielectrics = ROUGHNESS.map((roughness) => ({
  id: `standard-dielectric-r${Math.round(roughness * 10)}`,
  category: "standard",
  name: `Standard dielectric, roughness ${roughness}`,
  label: `Paint · rough ${roughness}`,
  material: {
    type: "MeshStandardMaterial",
    params: { color: 0xc0392b, roughness, metalness: 0 },
  },
  features: ["pbr", "roughness"],
  costNotes: "The baseline every ratio is measured against.",
  arSafe: "unmeasured",
}));

const METALS = [
  { key: "gold", name: "gold", color: 0xe6b85c },
  { key: "copper", name: "copper", color: 0xc8744a },
  { key: "steel", name: "steel", color: 0x8c96a0 },
];

/** Each metal at the six roughnesses. */
const metals = METALS.flatMap((metal) =>
  ROUGHNESS.map((roughness) => ({
    id: `standard-${metal.key}-r${Math.round(roughness * 10)}`,
    category: "standard",
    name: `Standard ${metal.name}, roughness ${roughness}`,
    label: `${metal.name[0].toUpperCase()}${metal.name.slice(1)} · rough ${roughness}`,
    material: {
      type: "MeshStandardMaterial",
      params: { color: metal.color, roughness, metalness: 1 },
    },
    features: ["pbr", "metal", "roughness"],
    costNotes: "Same program as the dielectric; metalness is a uniform.",
    arSafe: "unmeasured",
  })),
);

export const STANDARD_ENTRIES = [...dielectrics, ...metals];
