/**
 * Mesh module — OSM features to renderable geometry, as plain typed arrays.
 *
 * Deliberately free of `three`: the package is pure data (plan §4.2), so the
 * consumer app turns these buffers into meshes and owns the renderer.
 */

export type { EnuFrame, EnuPoint } from "./enu.js";
export {
  ENU_METRES_PER_DEG_LAT,
  ENU_METRES_PER_DEG_LNG_EQUATOR,
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

export { barrierFootprints } from "./barrier-shape.js";

export type { GateOpenings } from "./barrier-gates.js";
export {
  GATE_GAP_M,
  NO_GATES,
  gateOpenings,
  splitAtGates,
} from "./barrier-gates.js";

export type { BarrierDimensions, BarrierKind } from "./barriers.js";
export {
  barrierCentrelines,
  barrierKind,
  isSolidBarrier,
  resolveBarrier,
  DEFAULT_BARRIER_HEIGHT_M,
  DEFAULT_CITY_WALL_HEIGHT_M,
  DEFAULT_BARRIER_THICKNESS_M,
} from "./barriers.js";

export {
  BARRIER_KIND_RGB,
  BARRIER_MATERIAL_RGB,
  TAGGED_BARRIER_COLOUR_SHARE,
  barrierColour,
} from "./barrier-colours.js";

export type { BarrierVolume, BuildBarriersOptions } from "./barrier-volumes.js";
export { buildBarriers } from "./barrier-volumes.js";

export type { MeshData } from "./mesh-data.js";
export { MeshBuilder } from "./mesh-data.js";
export type { ExtrudeOptions } from "./extrude.js";
export { extrudeBuilding, mergeMeshes } from "./extrude.js";
export type { ExtrudedBuilding } from "./extrude.js";

export type { RoofMesh, RoofOptions } from "./roof.js";
export { buildRoof } from "./roof.js";

export type {
  BuildBuildingsOptions,
  BuildingVolume,
  SolidFootprint,
} from "./buildings.js";
export { buildBuildings, solidBuildingFootprints } from "./buildings.js";

export type { Rgb } from "./feature-colours.js";
export {
  DEFAULT_BUILDING_RGB,
  DEFAULT_ROAD_RGB,
  REFERENCE_GROUND_RGB,
  allBuildingColours,
  allRoadColours,
  buildingColour,
  channelDistance,
  luma,
  parseOsmColour,
  roadColour,
} from "./feature-colours.js";

export type { BuildingColours, BuildingPalette } from "./building-palette.js";
export {
  FLAT_ROOF_TONES,
  PITCHED_ROOF_TONES,
  WALL_TONES,
  allPaletteColours,
  seededBuildingColours,
} from "./building-palette.js";

export type { MeshChunk } from "./chunk-meshes.js";
export {
  CHUNK_SIZE_M,
  chunkKeyFor,
  chunkMeshes,
  linearChunkColours,
  meshCentroidEnu,
} from "./chunk-meshes.js";

export { linearToSrgb, srgbToLinear } from "./srgb.js";

export type { AreaPlate, BuildPlatesOptions } from "./plates.js";
export { buildAreaPlates, isPlateArea } from "./plates.js";

export type {
  BuildRegionSlabsOptions,
  RegionSlab,
  SlabRegion,
} from "./region-slabs.js";
export { buildRegionSlabs } from "./region-slabs.js";

export type { BuildRoadsOptions, RoadRibbon } from "./roads.js";
export {
  ROAD_MITRE_LIMIT,
  ROAD_RANK_STEP_M,
  buildRoads,
  isBridgeCrossing,
  isPedestrianPath,
  isRoad,
  roadRank,
  roadWidthM,
} from "./roads.js";

export type { BuildPoiOptions, PoiMarker } from "./poi.js";
export { POI_KEYS, buildPoiMarkers, isPoiNode, poiKind } from "./poi.js";

export type { PoiModel } from "./poi-models.js";
export { POI_FALLBACK_MODEL, POI_MODELS, poiModelFor } from "./poi-models.js";
// The variant registry (`CHOSEN_VARIANTS`, `POI_VARIANTS`, `poiVariantsFor`,
// `markerHeightFor`, `LIKED_VARIANTS`, `VARIANT_SOURCES`) was DELETED once the
// owner's verdict was adopted into `POI_MODELS` (DEC-R7b-2a). It existed to let
// the gallery show candidate models beside the shipped ones; the choice is made,
// the winners are the shipped models, and the losers are in git history.
// `poi-building-overlap.ts` was DELETED by stage 1 (DEC-S2). It suppressed a POI
// marker standing inside a building already extruded — a rule that ran out of
// subjects when the symbol port made every building-scale marker a 2.5 m symbol,
// and whose real successor is `poi-hosts.ts`: the same containment test, for a
// far wider set of markers, deciding between three outcomes rather than two.
export type {
  HostCandidate,
  HostableMarker,
  PlacedMarker,
  PoiHostAnchor,
  PoiHostLayer,
  PoiPlacement,
} from "./poi-hosts.js";
export {
  annotatePoiHosts,
  dropHostedDuplicates,
  footprintAnchor,
  hostDerivedMarkers,
  HOST_CLEARANCE_M,
  hostMatches,
  hostScale,
  resolvePoiPlacement,
} from "./poi-hosts.js";
export { TALL_STRUCTURE_KINDS, isTallStructure } from "./tall-structures.js";
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

export type {
  BuildTreesOptions,
  TreeClass,
  TreeInstances,
  TreePlacement,
  TreeVariant,
} from "./trees.js";
export {
  DEFAULT_CROWN_RATIO,
  DEFAULT_TREE_HEIGHT_M,
  MAX_TREE_CROWN_M,
  MAX_TREE_HEIGHT_M,
  TREE_COLOUR_JITTER,
  TREE_PALETTE,
  buildTrees,
  isTree,
  packInstances,
  treeClass,
  treeColour,
} from "./trees.js";
// The shared deterministic hash. It lived in `trees.ts` until §4a gave POI
// markers the same variation; see `stable-jitter.ts` for why one copy matters.
export {
  POI_SCALE_JITTER,
  stableHash,
  stablePoiScale,
  stableRotationY,
  unit,
} from "./stable-jitter.js";

// The city a renderer draws, assembled once for every consumer (globe city
// plan 2026-10-05-0040 §14 L3; it was inline in OsmDemo's worker).
export type {
  BuildCosmeticTreesOptions,
  CosmeticTreePlacement,
  CosmeticTreeSource,
} from "./cosmetic-trees.js";
export {
  COSMETIC_ROAD_MARGIN_M,
  COSMETIC_TREE_CAP,
  COSMETIC_WOOD_DENSITY_PER_M2,
  buildCosmeticTrees,
  cosmeticRank,
  cosmeticTreeSource,
} from "./cosmetic-trees.js";
export type { City, CityGround, CityOptions } from "./city.js";
export { buildCity, cityGround } from "./city.js";
export { shellRandFor } from "./shell-rand.js";
