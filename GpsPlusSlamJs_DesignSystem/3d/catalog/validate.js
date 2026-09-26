/**
 * The material catalog's validator (W5 plan 2026-09-26-0549, M1): pure, so
 * `node --test` runs it without a browser or three.
 *
 * @see validate.js.md
 */

/** The categories, in the order the grid lays them out. */
export const CATEGORIES = [
  "standard",
  "classic",
  "physical",
  "toon",
  "matcap",
  "emissive",
  "transparency",
  "procedural",
  "ar",
  "custom",
];

/** The material classes an entry may name (three's own, by constructor name). */
export const MATERIAL_TYPES = [
  "MeshStandardMaterial",
  "MeshPhysicalMaterial",
  "MeshLambertMaterial",
  "MeshPhongMaterial",
  "MeshBasicMaterial",
  "MeshToonMaterial",
  "MeshMatcapMaterial",
  "ShadowMaterial",
];

/** Labels are read at a glance, from metres away. */
export const LABEL_MAX = 28;
/**
 * A sphere's base colour must read as a colour, not as the old grey
 * swatches (the owner asked for coloured spheres): relative luminance at or
 * below this.
 */
export const MAX_LUMINANCE = 0.85;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Relative luminance of a 0xRRGGBB colour (sRGB, no linearisation). */
export function luminance(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Every problem with the catalog, as readable strings; empty when valid.
 * Checks: required fields and their types, unique kebab-case ids, a known
 * category and material type, the label's length, a coloured base colour,
 * and that every custom shader (an entry with `make`) names its own
 * program cache key (else entries from one factory share a program).
 */
export function validateCatalog(entries) {
  if (!Array.isArray(entries)) return ["the catalog must be an array"];
  const problems = [];
  const seen = new Set();
  const cacheKeys = new Map();
  for (const [i, e] of entries.entries()) {
    const at = typeof e?.id === "string" ? e.id : `#${i}`;
    if (typeof e !== "object" || e === null) {
      problems.push(`${at}: not an object`);
      continue;
    }
    if (typeof e.id !== "string" || !ID.test(e.id)) {
      problems.push(`${at}: id must be kebab-case`);
    } else if (seen.has(e.id)) {
      problems.push(`${at}: duplicate id`);
    }
    seen.add(e.id);
    if (!CATEGORIES.includes(e.category)) {
      problems.push(`${at}: unknown category "${e.category}"`);
    }
    for (const field of ["name", "label"]) {
      if (typeof e[field] !== "string" || e[field].trim() === "") {
        problems.push(`${at}: ${field} is required`);
      }
    }
    if (typeof e.label === "string" && e.label.length > LABEL_MAX) {
      problems.push(`${at}: label longer than ${LABEL_MAX} characters`);
    }
    if (!Array.isArray(e.features)) {
      problems.push(`${at}: features must be an array`);
    }
    if (typeof e.costNotes !== "string") {
      problems.push(`${at}: costNotes must be a string`);
    }
    if (e.make !== undefined) {
      if (typeof e.make !== "function") {
        problems.push(`${at}: make must be a function`);
      }
      if (typeof e.cacheKey !== "string" || e.cacheKey === "") {
        problems.push(`${at}: a custom shader needs its own cacheKey`);
      } else if (cacheKeys.has(e.cacheKey)) {
        problems.push(
          `${at}: cacheKey "${e.cacheKey}" is also used by ${cacheKeys.get(e.cacheKey)}`,
        );
      } else {
        cacheKeys.set(e.cacheKey, at);
      }
    } else {
      const m = e.material;
      if (!m || !MATERIAL_TYPES.includes(m.type)) {
        problems.push(`${at}: unknown material type "${m?.type}"`);
      } else if (typeof m.params !== "object" || m.params === null) {
        problems.push(`${at}: material params must be an object`);
      }
    }
    const color = e.make ? e.color : e.material?.params?.color;
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff) {
      problems.push(`${at}: a base colour 0xRRGGBB is required`);
    } else if (luminance(color) > MAX_LUMINANCE) {
      problems.push(`${at}: colour too close to white`);
    }
  }
  return problems;
}
