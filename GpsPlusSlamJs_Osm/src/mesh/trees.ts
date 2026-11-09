/**
 * Tree placement, as instancing data.
 *
 * WHY THIS IS THE EASIEST WIN IN THE WHOLE 3D PLAN. Trees are the one part of
 * §8 that is straightforwardly a win on mobile: they are numerous, identical up
 * to a transform, and therefore exactly what `InstancedMesh` exists for. A few
 * shared geometries plus per-instance matrices draws a forest in one call.
 *
 * SO THIS FILE EMITS NO GEOMETRY AT ALL. It emits placements — position,
 * rotation, scale, variant — and the consumer app builds however many shared
 * `BufferGeometry` variants it wants. That keeps the package free of `three`
 * (plan §4.2) and keeps the interesting decisions (billboard vs. real geometry,
 * LOD distance) where the renderer is.
 *
 * DETERMINISM IS A FEATURE, NOT AN ACCIDENT. OSM2World seeds its randomness
 * from the tree's position or area id so the same tree looks the same on every
 * run. We do the same, for a sharper reason: this is an AR overlay used to
 * judge pose accuracy, and a forest that reshuffles itself between frames — or
 * between two devices looking at the same place — is useless for that. The hash
 * is therefore part of the contract, not an implementation detail.
 *
 * THE HASH MOVED TO `stable-jitter.ts` (§4a, DEC-R6-20) and is no longer
 * declared here. It was written for trees; POI markers now need exactly the
 * same thing, and two copies of a hash are two hashes that can drift apart
 * invisibly — both would still look random. The salt constants live there too,
 * so `poi.ts` and this file cannot disagree about which salt means "yaw".
 *
 * @see trees.ts.md
 */

import type {
  LatLng,
  OsmFeature,
  OsmFeatureKey,
} from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import { stableRotationY, unit } from "./stable-jitter.js";
import { parseLengthMetres } from "./building-heights.js";
import type { EnuFrame, EnuPoint } from "./enu.js";

/** How a tree should look. The consumer maps these to shared geometries. */
export type TreeVariant = "broadleaved" | "needleleaved" | "unknown";

export interface TreePlacement {
  readonly feature: OsmFeatureKey;
  /** Metres east/north of the frame origin. */
  readonly position: EnuPoint;
  /** Ground height at the tree, metres. */
  readonly groundHeightM: number;
  readonly heightM: number;
  /** Crown diameter, metres. */
  readonly crownDiameterM: number;
  /** Rotation about the vertical axis, radians. */
  readonly rotationY: number;
  /**
   * The form: broadleaved, needleleaved, or `unknown`, which the renderer
   * draws in the neutral form (DEC-R4-10). A `mixed` class is `unknown` here:
   * one tree has one form.
   */
  readonly variant: TreeVariant;
  /** The crown's colour, packed `0xRRGGBB`, sRGB (`treeColour`). */
  readonly colour: number;
}

/** What a tree is from its tags (`treeClass`). */
export interface TreeClass {
  readonly leafType: "broadleaved" | "needleleaved" | "mixed" | "unknown";
  readonly leafCycle: "deciduous" | "evergreen" | "unknown";
  /** The tag that decided `leafType`, or `none`. */
  readonly source: "leaf_type" | "wood" | "genus" | "none";
}

export const DEFAULT_TREE_HEIGHT_M = 8;
export const DEFAULT_CROWN_RATIO = 0.6;
/** A tagged height above this is refused as a typo, metres. */
export const MAX_TREE_HEIGHT_M = 60;
/** A tagged crown diameter above this is refused as a typo, metres. */
export const MAX_TREE_CROWN_M = 40;
/** The lightness spread per tree: plus or minus half of this. */
export const TREE_COLOUR_JITTER = 0.16;

/**
 * Values that name a leaf type, across both keys that carry one.
 *
 * `wood` is the older key and is still widely tagged; OSM2World reads both
 * (`TreeModule.LEAF_TYPE_KEYS`) and treats `deciduous` as an alias for
 * broadleaved. Including it matters because the class is the ONLY thing that
 * stops every tree being drawn alike (W6), and `leaf_type` alone leaves a
 * large share of trees at "unknown". `mixed` is kept as its own class: for a
 * wood it is a claim, not an unknown. `wood=yes` says nothing and is absent.
 *
 * Maps, not plain objects, here and below: on a plain object
 * `leaf_type=constructor` found an inherited function and the tree was
 * dropped; prototype names now read as unknown.
 */
const LEAF_TYPES: ReadonlyMap<string, TreeClass["leafType"]> = new Map([
  ["broadleaved", "broadleaved"],
  ["deciduous", "broadleaved"],
  ["needleleaved", "needleleaved"],
  ["coniferous", "needleleaved"],
  ["mixed", "mixed"],
]);

const LEAF_CYCLES: ReadonlyMap<string, TreeClass["leafCycle"]> = new Map([
  ["deciduous", "deciduous"],
  ["semi_deciduous", "deciduous"],
  ["evergreen", "evergreen"],
  ["semi_evergreen", "evergreen"],
]);

/**
 * Genera whose leaf type is not in doubt, read from the first word of
 * `genus`, `species` or `taxon`.
 *
 * A CLOSED LIST, AND IT MAPS TO A LEAF TYPE ONLY: never to a shape, a size or
 * a species look. `genus` is free text, so only names on this list count; a
 * genus not on it (Ficus, a typo, a common name) leaves the tree unknown,
 * because a wrong leaf type is still worse than an unknown one. Larch-type
 * genera drop their needles, so they are needleleaved AND deciduous.
 */
const DECIDUOUS_NEEDLE_GENERA: ReadonlySet<string> = new Set([
  "Larix",
  "Metasequoia",
  "Taxodium",
]);
const NEEDLE_GENERA = [
  "Abies",
  "Cedrus",
  "Chamaecyparis",
  "Cupressus",
  "Juniperus",
  "Larix",
  "Metasequoia",
  "Picea",
  "Pinus",
  "Pseudotsuga",
  "Sequoia",
  "Sequoiadendron",
  "Taxodium",
  "Taxus",
  "Thuja",
  "Tsuga",
];
const BROAD_GENERA = [
  "Acer",
  "Aesculus",
  "Ailanthus",
  "Alnus",
  "Betula",
  "Carpinus",
  "Castanea",
  "Catalpa",
  "Celtis",
  "Cornus",
  "Corylus",
  "Crataegus",
  "Fagus",
  "Fraxinus",
  "Gleditsia",
  "Juglans",
  "Liquidambar",
  "Liriodendron",
  "Magnolia",
  "Malus",
  "Platanus",
  "Populus",
  "Prunus",
  "Pyrus",
  "Quercus",
  "Robinia",
  "Salix",
  "Sorbus",
  "Styphnolobium",
  "Tilia",
  "Ulmus",
  "Zelkova",
];
const GENUS_LEAF_TYPES: ReadonlyMap<string, TreeClass["leafType"]> = new Map([
  ...NEEDLE_GENERA.map((genus) => [genus, "needleleaved"] as const),
  ...BROAD_GENERA.map((genus) => [genus, "broadleaved"] as const),
]);

function genusOf(tags: Readonly<Record<string, string>>): string | undefined {
  for (const key of ["genus", "species", "taxon"] as const) {
    const value = tags[key];
    if (typeof value !== "string") continue;
    const word = value.trim().split(/\s+/)[0] ?? "";
    if (word === "") continue;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return undefined;
}

/**
 * What a tree is from its tags.
 *
 * The leaf type from `leaf_type`, then `wood`, then the closed genus list;
 * `leaf_type` FIRST, because it is the current key: a feature carrying both
 * is mid-retagging, and the newer value is the one someone last checked. The
 * cycle from `leaf_cycle`, else from a larch-type genus. `leaf_cycle` never
 * sets the leaf type: deciduous does not mean broadleaved (a larch is both
 * deciduous and needleleaved), so a tree tagged only with it keeps its cycle
 * and stays of unknown type.
 */
function leafTypeOf(
  tags: Readonly<Record<string, string>>,
  genus: string | undefined,
): Pick<TreeClass, "leafType" | "source"> {
  for (const key of ["leaf_type", "wood"] as const) {
    const leafType = LEAF_TYPES.get(tags[key] ?? "");
    if (leafType !== undefined) return { leafType, source: key };
  }
  const fromGenus =
    genus === undefined ? undefined : GENUS_LEAF_TYPES.get(genus);
  return fromGenus === undefined
    ? { leafType: "unknown", source: "none" }
    : { leafType: fromGenus, source: "genus" };
}

export function treeClass(tags: Readonly<Record<string, string>>): TreeClass {
  const genus = genusOf(tags);
  const { leafType, source } = leafTypeOf(tags, genus);
  const leafCycle =
    LEAF_CYCLES.get(tags["leaf_cycle"] ?? "") ??
    (genus !== undefined && DECIDUOUS_NEEDLE_GENERA.has(genus)
      ? "deciduous"
      : "unknown");
  return { leafType, leafCycle, source };
}

/**
 * The muted tree palette, packed sRGB, keyed `leafType/leafCycle`, plus
 * `unknown` for every tree whose leaf type is not known (mixed included).
 * Chroma 19 to 40 (max minus min channel) against today's 62: the trees sit
 * back and the heat ramp stays the loudest colour in the scene.
 */
export const TREE_PALETTE: ReadonlyMap<string, number> = new Map([
  ["broadleaved/deciduous", 0x7b8663],
  ["broadleaved/unknown", 0x77845f],
  ["broadleaved/evergreen", 0x5f6e55],
  ["needleleaved/evergreen", 0x52665c],
  ["needleleaved/unknown", 0x55685d],
  ["needleleaved/deciduous", 0x80875f],
  ["unknown", 0x737c66],
]);

/**
 * A tree's crown colour, packed sRGB: the class's palette entry, made lighter
 * or darker by up to half of `jitter` from a hash of `key` (the feature key),
 * so a row of one class is not a row of clones and stays the same on every
 * device. A non-finite `jitter` is read as 0.
 */
export function treeColour(
  cls: Pick<TreeClass, "leafType" | "leafCycle">,
  key: string,
  jitter: number = TREE_COLOUR_JITTER,
): number {
  const base =
    (cls.leafType === "broadleaved" || cls.leafType === "needleleaved"
      ? TREE_PALETTE.get(`${cls.leafType}/${cls.leafCycle}`)
      : undefined) ??
    TREE_PALETTE.get("unknown") ??
    0;
  const spread = Number.isFinite(jitter) ? jitter : 0;
  const lightness = 1 + (unit(key, "l") - 0.5) * spread;
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const channel = Math.round(((base >> shift) & 0xff) * lightness);
    out |= Math.max(0, Math.min(255, channel)) << shift;
  }
  return out;
}

function variantOf(cls: TreeClass): TreeVariant {
  return cls.leafType === "broadleaved" || cls.leafType === "needleleaved"
    ? cls.leafType
    : "unknown";
}

/** A tagged length in metres, when it is above zero and at most `maxM`. */
function taggedLength(
  raw: string | undefined,
  maxM: number,
): number | undefined {
  // `parseLengthMetres`, not `Number` — `height=12 m` and `height=25'` are
  // both ordinary on `natural=tree`, and `Number` returns NaN for both. The
  // fallback then swallows them, so a tagged tree silently becomes an
  // untagged one at a plausible height with nothing to show it happened.
  const value = parseLengthMetres(raw);
  return value !== undefined && value > 0 && value <= maxM ? value : undefined;
}

/** True for a feature this module can place. */
export function isTree(feature: OsmFeature): boolean {
  return feature.type === "node" && feature.tags["natural"] === "tree";
}

export interface BuildTreesOptions {
  readonly frame: EnuFrame;
  readonly groundHeightM?: (position: LatLng) => number;
}

/**
 * Placements for every `natural=tree` node in `features`.
 *
 * Only individual trees. The trees a wood, an orchard or a tree row implies
 * are invented by `cosmetic-trees.ts`, flagged `cosmetic: true`.
 */
export function buildTrees(
  features: Iterable<OsmFeature>,
  options: BuildTreesOptions,
): TreePlacement[] {
  const placements: TreePlacement[] = [];

  for (const feature of features) {
    if (!isTree(feature) || feature.type !== "node") continue;

    const key = featureKey(feature);
    const tags = feature.tags as Record<string, string>;

    // A refused value (above the maximum, zero, negative, junk) falls back to
    // the untagged rule rather than drawing the typo.
    const heightM =
      taggedLength(tags["height"], MAX_TREE_HEIGHT_M) ??
      // Deterministic variation around the default, so a row of untagged
      // trees does not look like a row of clones.
      DEFAULT_TREE_HEIGHT_M * (0.75 + unit(key, "h") * 0.5);
    const crownDiameterM =
      taggedLength(tags["diameter_crown"], MAX_TREE_CROWN_M) ??
      heightM * DEFAULT_CROWN_RATIO;
    const cls = treeClass(tags);

    placements.push({
      feature: key,
      position: options.frame.toEnu(feature.position),
      groundHeightM: options.groundHeightM?.(feature.position) ?? 0,
      heightM,
      crownDiameterM,
      // The shared helper, not `unit(key, "r")` spelled out again: `poi.ts`
      // must produce the same yaw from the same key, and a duplicated
      // expression is where that quietly stops being true.
      rotationY: stableRotationY(key),
      variant: variantOf(cls),
      colour: treeColour(cls, key),
    });
  }

  return placements;
}

/** One variant's instances as flat arrays (`packInstances`). */
export interface TreeInstances {
  /** Render frame, three per instance. */
  readonly positions: Float32Array;
  /** `[heightM, crownDiameterM]` per instance. */
  readonly scales: Float32Array;
  readonly rotations: Float32Array;
  /**
   * The crown colour as sRGB channels 0 to 1, three per instance. The
   * renderer converts them to its working space (three.js: `Color.setRGB`
   * with `SRGBColorSpace`).
   */
  readonly colours: Float32Array;
}

/**
 * Packs placements into the flat arrays an `InstancedMesh` wants.
 *
 * Grouped by variant, because one `InstancedMesh` draws one geometry: mixing
 * variants into a single buffer would force the consumer to un-mix them.
 *
 * **`positions` is in the RENDER frame, not ENU** — `+x` east, `+y` up, `−z`
 * north, exactly as `MeshData` (`mesh-data.ts`) documents. A `TreePlacement` is
 * still ENU because it is a placement rather than a buffer; the reflection
 * happens here, at the boundary where buffers are produced, so instanced trees
 * and `mergeMeshes` output drop into the same scene without the consumer
 * having to know either frame exists.
 */
export function packInstances(
  placements: readonly TreePlacement[],
): Map<TreeVariant, TreeInstances> {
  const byVariant = new Map<TreeVariant, TreePlacement[]>();
  for (const placement of placements) {
    const list = byVariant.get(placement.variant) ?? [];
    list.push(placement);
    byVariant.set(placement.variant, list);
  }

  const packed = new Map<TreeVariant, TreeInstances>();
  for (const [variant, list] of byVariant) {
    const positions = new Float32Array(list.length * 3);
    const scales = new Float32Array(list.length * 2);
    const rotations = new Float32Array(list.length);
    const colours = new Float32Array(list.length * 3);
    list.forEach((placement, i) => {
      colours[i * 3] = ((placement.colour >> 16) & 0xff) / 255;
      colours[i * 3 + 1] = ((placement.colour >> 8) & 0xff) / 255;
      colours[i * 3 + 2] = (placement.colour & 0xff) / 255;
      positions[i * 3] = placement.position.x;
      positions[i * 3 + 1] = placement.groundHeightM;
      // ENU north → render −z, the same reflection `MeshBuilder.vertex` applies
      // to every `MeshData` buffer. Packing raw ENU here would put a forest and
      // its own buildings in two different handednesses.
      positions[i * 3 + 2] = -placement.position.y;
      scales[i * 2] = placement.heightM;
      scales[i * 2 + 1] = placement.crownDiameterM;
      rotations[i] = placement.rotationY;
    });
    packed.set(variant, { positions, scales, rotations, colours });
  }
  return packed;
}
