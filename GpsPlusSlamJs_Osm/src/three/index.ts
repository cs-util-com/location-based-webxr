/**
 * `gps-plus-slam-osm/three`: the city as three.js objects. A separate entry
 * point so the package's core stays free of three.js (globe city plan
 * 2026-10-05-0040 §14 L5); three is an optional peer, needed only here.
 */
export type { TreeForm, TreeObjectOptions } from "./city-objects.js";
export {
  applyWoodsShare,
  buildingObjects,
  cityObjects,
  cosmeticTreeObjects,
  disposeCityObjects,
  geometryFrom,
  roadObjects,
  treeObjects,
} from "./city-objects.js";
export {
  repackTreeLod,
  TREE_LOD_NEAR_M,
  TREE_LOD_REPACK_M,
} from "./trunk-trees.js";
export type {
  WoodsGovernor,
  WoodsGovernorMode,
  WoodsGovernorState,
} from "./woods-governor.js";
export { createWoodsGovernor, WOODS_GOVERNOR } from "./woods-governor.js";
export type { StreetFurnitureOptions } from "./street-furniture.js";
export {
  FURNITURE_CUT_M,
  FURNITURE_REPACK_M,
  repackFurniture,
  streetFurnitureObjects,
} from "./street-furniture.js";
export type {
  AppliedGroundTint,
  ApplyGroundTintOptions,
} from "./ground-tint.js";
export {
  applyGroundTint,
  GROUND_TINT_FADE_M,
  groundTintTexture,
} from "./ground-tint.js";
