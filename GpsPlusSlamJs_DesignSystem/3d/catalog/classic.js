/**
 * Catalog categories "classic" and "toon" (W5 plan 2026-09-26-0549, M1):
 * three's cheaper, non-physical shading models, for the cost comparison and
 * for looks that are not photographic.
 *
 * Pure data: the page builds the materials (`material.type` + `params`).
 */

export const CLASSIC_ENTRIES = [
  {
    id: "classic-lambert",
    category: "classic",
    name: "Lambert (diffuse only, per fragment)",
    label: "Lambert",
    material: { type: "MeshLambertMaterial", params: { color: 0x2e86de } },
    features: ["diffuse"],
    costNotes: "No specular, no environment light: cheaper than Standard.",
    arSafe: "unmeasured",
  },
  {
    id: "classic-phong-soft",
    category: "classic",
    name: "Phong, soft highlight (shininess 10)",
    label: "Phong · shiny 10",
    material: {
      type: "MeshPhongMaterial",
      params: { color: 0x27ae60, shininess: 10 },
    },
    features: ["diffuse", "blinn-phong"],
    costNotes: "Blinn-Phong highlight; no environment light.",
    arSafe: "unmeasured",
  },
  {
    id: "classic-phong-hard",
    category: "classic",
    name: "Phong, hard highlight (shininess 120)",
    label: "Phong · shiny 120",
    material: {
      type: "MeshPhongMaterial",
      params: { color: 0x27ae60, shininess: 120 },
    },
    features: ["diffuse", "blinn-phong"],
    costNotes: "Same program as the soft one; shininess is a uniform.",
    arSafe: "unmeasured",
  },
  {
    id: "classic-basic",
    category: "classic",
    name: "Basic (unlit, one flat colour)",
    label: "Basic (unlit)",
    material: { type: "MeshBasicMaterial", params: { color: 0x8e44ad } },
    features: ["unlit"],
    costNotes: "No lighting at all: the floor of the cost scale.",
    arSafe: "unmeasured",
  },
  {
    id: "toon-default",
    category: "toon",
    name: "Toon (three's default two-tone ramp)",
    label: "Toon",
    material: { type: "MeshToonMaterial", params: { color: 0xf39c12 } },
    features: ["toon"],
    costNotes: "Lambert-like cost with a stepped ramp.",
    arSafe: "unmeasured",
  },
];
