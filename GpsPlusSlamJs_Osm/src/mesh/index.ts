/**
 * Mesh module — OSM features to renderable geometry, as plain typed arrays.
 *
 * Deliberately free of `three`: the package is pure data (plan §4.2), so the
 * consumer app turns these buffers into meshes and owns the renderer.
 */

export type { EnuFrame, EnuPoint } from "./enu.js";
export {
  enuFrameAt,
  isCounterClockwise,
  ringToEnu,
  signedArea2,
} from "./enu.js";

export type { TriangulationResult } from "./triangulate.js";
export {
  dropClosingPoint,
  triangulate,
  triangulatedArea,
} from "./triangulate.js";

export type { BuildingHeights, RoofShape } from "./building-heights.js";
export {
  DEFAULT_BUILDING_HEIGHT_M,
  DEFAULT_LEVEL_HEIGHT_M,
  isBuilding,
  isBuildingPart,
  parseLengthMetres,
  resolveHeights,
} from "./building-heights.js";

export type { MeshData } from "./mesh-data.js";
export { MeshBuilder } from "./mesh-data.js";
export type { ExtrudeOptions } from "./extrude.js";
export { extrudeBuilding, mergeMeshes } from "./extrude.js";
export type { ExtrudedBuilding } from "./extrude.js";

export type { RoofMesh, RoofOptions } from "./roof.js";
export { buildRoof } from "./roof.js";

export type { BuildBuildingsOptions, BuildingVolume } from "./buildings.js";
export { buildBuildings } from "./buildings.js";

export type { MeshChunk } from "./chunk-meshes.js";
export {
  CHUNK_SIZE_M,
  chunkKeyFor,
  chunkMeshes,
  meshCentroidEnu,
} from "./chunk-meshes.js";

export type { AreaPlate, BuildPlatesOptions } from "./plates.js";
export { buildAreaPlates, isPlateArea } from "./plates.js";

export type {
  BuildRegionSlabsOptions,
  RegionSlab,
  SlabRegion,
} from "./region-slabs.js";
export { buildRegionSlabs } from "./region-slabs.js";

export type { BuildRoadsOptions, RoadRibbon } from "./roads.js";
export { buildRoads, isRoad, roadWidthM } from "./roads.js";

export type { BuildPoiOptions, PoiMarker } from "./poi.js";
export { POI_KEYS, buildPoiMarkers, isPoiNode, poiKind } from "./poi.js";

export type { PoiModel } from "./poi-models.js";
export { POI_MODELS, poiModelFor } from "./poi-models.js";
export {
  box,
  canopy,
  composed,
  hut,
  postWithHead,
  prism,
  slabOnLegs,
} from "./poi-primitives.js";
export type { RankedPoiKind } from "./poi-ranking.js";
export {
  POI_MODEL_LIMIT,
  parseUsageCount,
  rankPoiKinds,
} from "./poi-ranking.js";

export type { BuildTreesOptions, TreePlacement, TreeVariant } from "./trees.js";
export {
  DEFAULT_CROWN_RATIO,
  DEFAULT_TREE_HEIGHT_M,
  buildTrees,
  isTree,
  packInstances,
  stableHash,
} from "./trees.js";
