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
 * below is therefore part of the contract, not an implementation detail.
 *
 * @see trees.ts.md
 */

import type {
  LatLng,
  OsmFeature,
  OsmFeatureKey,
} from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
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
  readonly variant: TreeVariant;
}

export const DEFAULT_TREE_HEIGHT_M = 8;
export const DEFAULT_CROWN_RATIO = 0.6;

/**
 * A stable 32-bit hash of a string.
 *
 * FNV-1a: small, fast, no dependency, and — the property that matters —
 * deterministic across runs, devices and platforms. `Math.random()` here would
 * make the same street look different on two phones standing next to each
 * other, which defeats the overlay's whole purpose.
 */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A deterministic value in [0, 1) from a key and a salt. */
function unit(key: string, salt: string): number {
  return stableHash(`${key}#${salt}`) / 0x1_0000_0000;
}

function variantOf(tags: Record<string, string>): TreeVariant {
  const leaf = tags["leaf_type"];
  if (leaf === "broadleaved") return "broadleaved";
  if (leaf === "needleleaved") return "needleleaved";
  // `genus`/`species` could refine this; deliberately not guessed from names,
  // because a wrong species is no better than an unknown one and OSM's
  // free-text species values are not a controlled vocabulary.
  return "unknown";
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
 * Only individual trees. `natural=wood`, `landuse=forest` and `natural=tree_row`
 * need a scatter over an area or along a line — the same placement type, a
 * different generator, and a well-defined follow-up rather than a guess.
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

    // `parseLengthMetres`, not `Number` — `height=12 m` and `height=25'` are
    // both ordinary on `natural=tree`, and `Number` returns NaN for both. The
    // fallback then swallows them, so a tagged tree silently becomes an
    // untagged one at a plausible height with nothing to show it happened.
    const taggedHeight = parseLengthMetres(tags["height"]);
    const heightM =
      taggedHeight !== undefined && taggedHeight > 0
        ? taggedHeight
        : // Deterministic variation around the default, so a row of untagged
          // trees does not look like a row of clones.
          DEFAULT_TREE_HEIGHT_M * (0.75 + unit(key, "h") * 0.5);

    const taggedCrown = parseLengthMetres(tags["diameter_crown"]);
    const crownDiameterM =
      taggedCrown !== undefined && taggedCrown > 0
        ? taggedCrown
        : heightM * DEFAULT_CROWN_RATIO;

    placements.push({
      feature: key,
      position: options.frame.toEnu(feature.position),
      groundHeightM: options.groundHeightM?.(feature.position) ?? 0,
      heightM,
      crownDiameterM,
      rotationY: unit(key, "r") * Math.PI * 2,
      variant: variantOf(tags),
    });
  }

  return placements;
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
): Map<
  TreeVariant,
  { positions: Float32Array; scales: Float32Array; rotations: Float32Array }
> {
  const byVariant = new Map<TreeVariant, TreePlacement[]>();
  for (const placement of placements) {
    const list = byVariant.get(placement.variant) ?? [];
    list.push(placement);
    byVariant.set(placement.variant, list);
  }

  const packed = new Map<
    TreeVariant,
    { positions: Float32Array; scales: Float32Array; rotations: Float32Array }
  >();
  for (const [variant, list] of byVariant) {
    const positions = new Float32Array(list.length * 3);
    const scales = new Float32Array(list.length * 2);
    const rotations = new Float32Array(list.length);
    list.forEach((placement, i) => {
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
    packed.set(variant, { positions, scales, rotations });
  }
  return packed;
}
