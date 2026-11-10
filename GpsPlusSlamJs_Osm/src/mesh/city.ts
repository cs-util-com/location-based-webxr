/**
 * The city a renderer draws: buildings (with their parts and the barriers
 * drawn among them), coloured per feature and chunked for culling, the
 * trees, and on request the roads and paths.
 *
 * WHY IT IS HERE. OsmDemo's worker assembled this inline from this package's
 * builders. When the globe lab became the package's second consumer (globe
 * city plan 2026-10-05-0040 §14 L3), the assembly was the part both needed,
 * so it moved here: the tag inheritance of `building:part`, the colours, the
 * stable shell phase and the chunking now live once. The roads followed
 * (round-4 plan 2026-10-11-0122 DEC-R4-7: the owner asked for the globe's
 * city to draw what OsmDemo draws). Plates, region slabs, POI markers and
 * the cell grid stay with OsmDemo, which draws them around this.
 *
 * @see city.ts.md
 */

import {
  featureKey,
  type LatLng,
  type OsmFeature,
} from "../model/osm-feature.js";
import { barrierColour } from "./barrier-colours.js";
import { buildBarriers, type BarrierVolume } from "./barrier-volumes.js";
import {
  seededBuildingColours,
  type BuildingPalette,
} from "./building-palette.js";
import { buildBuildings, type BuildingVolume } from "./buildings.js";
import {
  DEFAULT_CITY_COLOUR_SCHEME,
  validateCityColourScheme,
  type CityColourScheme,
} from "./colour-scheme.js";
import type { Bbox } from "../spatial/clip.js";
import {
  buildCosmeticTrees,
  type CosmeticTreePlacement,
} from "./cosmetic-trees.js";
import {
  chunkMeshes,
  linearChunkColours,
  meshCentroidEnu,
  type MeshChunk,
} from "./chunk-meshes.js";
import type { EnuFrame, EnuPoint } from "./enu.js";
import { buildingColour, roadColour, roofColour } from "./feature-colours.js";
import { buildGroundTint, type GroundTint } from "./ground-tint.js";
import { buildRoads, type BuildRoadsOptions } from "./roads.js";
import { shellRandFor } from "./shell-rand.js";
import { buildTrees, type TreePlacement } from "./trees.js";

/** Where the city is built: its frame and the ground under it. */
export interface CityGround {
  readonly frame: EnuFrame;
  /** Ground elevation at a position, metres. Absent: flat at 0. */
  readonly groundHeightM?: (position: LatLng) => number;
}

/**
 * How much of the city is kept. `withinM`: only volumes, barriers and trees
 * whose own position (a mesh's centroid, a tree's placement) lies within
 * this many metres of the frame's origin in both directions, because a
 * height field covers a window and clamps its edge heights outward beyond it
 * (globe city plan 2026-10-05-0040 §12.4 R12). Absent: everything is kept.
 */
export interface CityOptions {
  /**
   * The bounding box (lat/lng) of the data the caller fetched. Required: a
   * relation reaches far outside any fetch (a forest, a boundary), and what
   * is invented from it (cosmetic trees) is placed only inside this box
   * (city objects plan 2026-11-07-2315 section 4).
   */
  readonly window: Bbox;
  /**
   * Also invent the trees of mapped woods, orchards and tree rows
   * (`buildCosmeticTrees`). Default true (the owner: on); false builds none.
   */
  readonly cosmeticTrees?: boolean;
  readonly withinM?: number;
  /**
   * Also build the roads and paths (`buildRoads`: ribbons draped per vertex
   * on the ground, tunnels and highway areas left out), chunked and
   * coloured by class and surface (`roadColour`). Default false: a
   * consumer that draws none builds none. An object builds them with
   * `buildRoads`'s look options (`CityRoadOptions`), so an audit or a
   * before/after page can switch the class lift or the mitre off; `true`
   * and `{}` take the builder's defaults.
   */
  readonly roads?: boolean | CityRoadOptions;
  /**
   * Which colours a building without a colour tag takes (city objects plan
   * 2026-11-07-2315 M7). `"seeded"` (default): the warm palette of
   * `building-palette.ts`, picked per building from its key, its roof by
   * its shape. `"class"`: `buildingColour` and `roofColour` by tag and
   * material, the colours before M7. Colour tags win under both.
   */
  readonly palette?: BuildingPalette;
  /**
   * Every colour the city is painted in (`colour-scheme.ts`, OSM demo colour
   * schemes plan 2026-11-10-0841). Absent: `DEFAULT_CITY_COLOUR_SCHEME`,
   * today's colours byte for byte. Under `palette: "class"` a scheme
   * changes everything but the class colours of buildings. A malformed scheme
   * throws `RangeError`.
   */
  readonly colours?: CityColourScheme;
  /**
   * Paint the land use into a ground tint over `window` (`ground-tint.ts`,
   * city objects plan 2026-11-07-2315 M3), in the scheme's `landUse` colours
   * over its `ground`. Default false: no consumer pays for a raster it does
   * not draw (the Globe and the Tour Editor ask for none).
   */
  readonly groundTint?: boolean;
  /**
   * Invent a roof, or a flat lid at an invented height, for every building
   * the map says nothing about (`buildBuildings`, `invented-roofs.ts`).
   * Default true (the owner: on); false draws every building from its tags
   * alone, as before invented roofs. The navigation index takes the same
   * heights by default (`buildObstacleIndex`), so a consumer that switches
   * this off switches it off there too.
   */
  readonly inventedRoofs?: boolean;
}

/**
 * The road look a city may set (`buildRoads`'s options): `rankStepM` the
 * lift between two road classes (0 puts every road on the ground, as before
 * M4a), `mitreLimit` the longest mitre before a join is bevelled (1
 * bevels every turn). Invalid values throw `RangeError` from the builder.
 */
export type CityRoadOptions = Pick<
  BuildRoadsOptions,
  "mitreLimit" | "rankStepM"
>;

/** What `buildCity` returns. */
export interface City {
  /** Every building volume (parts in place of their outlines). */
  readonly volumes: readonly BuildingVolume[];
  /** The barriers, drawn with the buildings. */
  readonly barriers: readonly BarrierVolume[];
  /**
   * Volumes and barriers merged per chunk, with a colour per vertex and the
   * shell attributes (`featureRand`, `height01`).
   */
  readonly buildings: readonly MeshChunk[];
  /** One placement per `natural=tree` node. */
  readonly trees: readonly TreePlacement[];
  /**
   * The invented trees of woods, orchards and tree rows, in rank order,
   * every one `cosmetic: true`; never in `trees`. Empty with
   * `cosmeticTrees: false`.
   */
  readonly cosmeticTrees: readonly CosmeticTreePlacement[];
  /**
   * The road and path ribbons merged per chunk, a colour per vertex; empty
   * unless `roads` was asked for.
   */
  readonly roads: readonly MeshChunk[];
  /** Road and path ways built (0 unless asked for). */
  readonly roadCount: number;
  /** The painted land use over `window`, only with `groundTint: true`. */
  readonly groundTint?: GroundTint;
}

/**
 * The ground for a frame: the field's height at a position's ENU metres, or
 * flat when there is no field. ONE derivation, so every layer a consumer
 * builds stands on the same surface (two copies of it once put two layers on
 * two surfaces in OsmDemo).
 */
export function cityGround(
  frame: EnuFrame,
  field: { heightAt(point: EnuPoint): number } | undefined,
): CityGround {
  if (field === undefined) return { frame };
  return {
    frame,
    groundHeightM: (position: LatLng) => field.heightAt(frame.toEnu(position)),
  };
}

/**
 * Builds the city in `features` on `ground`, within `options.withinM` when
 * given. Features that are not buildings, barriers or trees are ignored; a
 * feature whose geometry cannot be built is skipped (the builders'
 * contract). RangeError for a `withinM` that is not a positive number.
 */
export function buildCity(
  features: Iterable<OsmFeature>,
  ground: CityGround,
  options: CityOptions,
): City {
  const { withinM, palette = "seeded" } = options;
  const colours =
    options.colours === undefined
      ? DEFAULT_CITY_COLOUR_SCHEME
      : validateCityColourScheme(options.colours);
  if (options.window === undefined) {
    throw new RangeError("buildCity needs a window (the fetched bbox)");
  }
  if (withinM !== undefined && !(withinM > 0)) {
    throw new RangeError(`withinM must be a positive number, got ${withinM}`);
  }
  if (palette !== "seeded" && palette !== "class") {
    throw new RangeError(
      `palette must be "seeded" or "class", got ${String(palette)}`,
    );
  }
  const inside = (p: EnuPoint): boolean =>
    withinM === undefined ||
    (Math.abs(p.x) <= withinM && Math.abs(p.y) <= withinM);
  const all = [...features];
  const built = buildBuildings(all, {
    ...ground,
    inventedRoofs: options.inventedRoofs !== false,
  });
  const volumes = withinWindow(built, inside);
  const barriers = buildBarriers(all, ground).filter((b) =>
    inside(meshCentroidEnu(b.mesh)),
  );
  const trees = buildTrees(all, {
    ...ground,
    treePalette: colours.trees,
  }).filter((t) => inside(t.position));
  // TAGS BY KEY: the builders return a feature key, not the tags.
  const tagsByKey = new Map(
    all.map((feature) => [featureKey(feature), feature.tags]),
  );
  // A `building:part` is coloured by its OWN colour tags first and by its
  // outline's when it has none (`buildingColour`, bug 8): an untagged part
  // stays the colour of the building it belongs to, so an untagged cathedral
  // is not striped, and a part a mapper coloured is drawn that colour. A
  // barrier has no outline and is simply itself.
  //
  // Under the seeded palette a part passes its OUTLINE's key, so an untagged
  // cathedral draws one wall tone and one roof tone across all its parts.
  const drawn = [
    ...volumes.map((volume) => {
      const tags = tagsByKey.get(volume.feature) ?? {};
      const outline =
        volume.parentFeature === undefined
          ? undefined
          : tagsByKey.get(volume.parentFeature);
      return {
        mesh: volume.mesh,
        roofVertexRanges: volume.roofVertexRanges,
        ...(palette === "seeded"
          ? seededBuildingColours(
              tags,
              outline,
              volume.parentFeature ?? volume.feature,
              drawsPitchedRoof(volume),
              colours,
            )
          : {
              wall: buildingColour(tags, outline),
              roof: roofColour(tags, outline),
            }),
      };
    }),
    ...barriers.map((barrier) => ({
      mesh: barrier.mesh,
      // A barrier has no roof block: it is all wall, in its own muted kind
      // colour, not a building's.
      roofVertexRanges: [],
      wall: barrierColour(tagsByKey.get(barrier.feature) ?? {}, colours),
      roof: undefined,
    })),
  ];
  // Linear light, as three.js shades (plan 2026-11-07-2315 section 7). The
  // whole chunk is converted, roof vertices included, so a tagged roof colour
  // is in the same colour space as its walls.
  const buildings = linearChunkColours(
    chunkMeshes(
      drawn,
      (item) => item.mesh,
      (item) => meshCentroidEnu(item.mesh),
      undefined,
      (item) => item.wall,
      // The shell shader's phase, from the feature's own geometry, so it is
      // stable across rebuilds (an index would re-shuffle on every refresh).
      (item) => shellRandFor(item.mesh),
      (item) =>
        item.roof === undefined
          ? undefined
          : { colour: item.roof, vertexRanges: item.roofVertexRanges },
    ),
  );
  const roadOptions = roadBuildOptions(options.roads, ground);
  const { roads, roadCount } =
    roadOptions === undefined
      ? { roads: [], roadCount: 0 }
      : cityRoads(all, roadOptions, inside, tagsByKey, colours);
  // Every built footprint excludes, not only the kept ones: a house just
  // outside `withinM` still has no tree growing through it.
  const cosmeticTrees =
    options.cosmeticTrees === false
      ? []
      : buildCosmeticTrees(all, {
          ...ground,
          window: options.window,
          excludeRings: built.flatMap((v) => v.outerRings),
          treePalette: colours.trees,
        }).filter((t) => inside(t.position));
  const city = {
    volumes,
    barriers,
    buildings,
    trees,
    cosmeticTrees,
    roads,
    roadCount,
  };
  return { ...city, ...cityGroundTint(all, ground, options, colours) };
}

/**
 * The land use painted over the window in the scheme's colours, as the
 * `groundTint` field, or nothing when it was not asked for.
 */
function cityGroundTint(
  all: readonly OsmFeature[],
  ground: CityGround,
  options: CityOptions & { readonly window: Bbox },
  colours: CityColourScheme,
): { readonly groundTint?: GroundTint } {
  if (options.groundTint !== true) return {};
  const groundTint = buildGroundTint(all, {
    frame: ground.frame,
    window: options.window,
    ground: colours.ground,
    landUse: colours.landUse,
  });
  return { groundTint };
}

/**
 * True when the ladder drew a sloped roof on some polygon of the volume: the
 * clay and slate tones go on what is drawn, so a pitched tag the ladder had to
 * draw as a flat lid ("flat" cap, "prism") takes the flat greys (M7 review
 * MINOR 4). A volume without polygons reads as flat.
 */
function drawsPitchedRoof(volume: BuildingVolume): boolean {
  return volume.roofMethods.some((m) => m !== "flat" && m !== "prism");
}

/**
 * `buildRoads`'s options for `CityOptions.roads`, or undefined when no roads
 * are asked for. Only the road look's own keys are taken from an object, so a
 * caller's object carries nothing else (a `frame`, say) into the builder.
 */
function roadBuildOptions(
  roads: CityOptions["roads"],
  ground: CityGround,
): BuildRoadsOptions | undefined {
  // null arrives from JSON-shaped options and means "no roads", as false does.
  if (roads === undefined || roads === null || roads === false) {
    return undefined;
  }
  if (roads === true) return ground;
  const { mitreLimit, rankStepM } = roads;
  return {
    ...ground,
    ...(mitreLimit === undefined ? {} : { mitreLimit }),
    ...(rankStepM === undefined ? {} : { rankStepM }),
  };
}

/**
 * The roads of a city, within its window, merged per chunk with a colour
 * per vertex (class and surface, `roadColour`). OsmDemo's worker did this
 * inline until the globe needed the same (round-4 plan 2026-10-11-0122).
 */
function cityRoads(
  all: readonly OsmFeature[],
  ground: BuildRoadsOptions,
  inside: (p: EnuPoint) => boolean,
  tagsByKey: ReadonlyMap<string, OsmFeature["tags"]>,
  colours: CityColourScheme,
): { roads: MeshChunk[]; roadCount: number } {
  const ribbons = buildRoads(all, ground).filter((road) =>
    inside(meshCentroidEnu(road.mesh)),
  );
  return {
    roads: chunkMeshes(
      ribbons,
      (road) => road.mesh,
      (road) => meshCentroidEnu(road.mesh),
      undefined,
      (road) => roadColour(tagsByKey.get(road.feature) ?? {}, colours),
    ),
    roadCount: ribbons.length,
  };
}

/**
 * The volumes whose BUILDING is inside the window (2026-11-07, bug 10).
 *
 * Decided per building, not per volume: the parts of one outline share one
 * verdict, taken at the mean of their mesh centroids. Per volume, a modelled
 * building on the window's edge kept some parts and lost others, which drew
 * half a cathedral at the globe city's rim. A building is its outline key, or
 * its own key when it has no parent.
 */
function withinWindow(
  volumes: readonly BuildingVolume[],
  inside: (p: EnuPoint) => boolean,
): BuildingVolume[] {
  const sums = new Map<string, { x: number; y: number; n: number }>();
  for (const volume of volumes) {
    const key = volume.parentFeature ?? volume.feature;
    const c = meshCentroidEnu(volume.mesh);
    const sum = sums.get(key) ?? { x: 0, y: 0, n: 0 };
    sum.x += c.x;
    sum.y += c.y;
    sum.n += 1;
    sums.set(key, sum);
  }
  const kept = new Set<string>();
  for (const [key, sum] of sums) {
    if (inside({ x: sum.x / sum.n, y: sum.y / sum.n })) kept.add(key);
  }
  return volumes.filter((v) => kept.has(v.parentFeature ?? v.feature));
}
