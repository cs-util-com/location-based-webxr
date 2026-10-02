/**
 * The globe's relief carrier, prepared (round-5 plan 2026-10-01-0945 §8
 * DEC-GL5-9): the tile library's own terrain tiles (`TerrariumMeshPlugin`)
 * carrying the globe's imagery and look. Three fixes the F0 spike measured
 * (results 2026-10-02-0307 §7):
 *
 * - heights uploaded as half float (R16F), which WebGL2 filters linearly
 *   on every device; as shipped (32-bit float, linear) they read 0 m where
 *   OES_texture_float_linear is missing;
 * - the globe's surface shading on the terrain tiles (the globe's patched
 *   MeshStandardMaterial, the library's displacement and bump kept);
 * - the imagery taken at the right place: the library asks the overlay
 *   with a Web Mercator range (Terrarium's tiling) while the globe's
 *   imagery is plate carree, so the range is converted, and the imagery UV
 *   is computed per vertex from the geodetic normal (a linear map across a
 *   Mercator tile is 15 km off at level 5 and 860 km at level 2).
 *
 * @see globe-terrain.ts.md
 */
import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import * as plugins from "3d-tiles-renderer/plugins";

export const GLOBE_TERRAIN = Object.freeze({
  /** The program key shared by every terrain tile's lit material. */
  programKey: "globe-terrain-lit",
  /** One half-float step at `heightM` (10 mantissa bits). */
  halfFloatStepM: (heightM: number): number =>
    heightM === 0 ? 0 : 2 ** (Math.floor(Math.log2(Math.abs(heightM))) - 10),
});

/** A range [west, south, east, north], normalised 0-1 (0 = south). */
export type NormalizedRange = readonly number[];

const isRange = (r: readonly number[]): boolean =>
  r.length === 4 &&
  r.every((v) => Number.isFinite(v)) &&
  r[0]! <= r[2]! &&
  r[1]! <= r[3]!;

/** Latitude (radians) of a normalised Web Mercator y (0 south, 1 north). */
const mercatorLatitude = (y: number): number =>
  2 * Math.atan(Math.exp((y - 0.5) * 2 * Math.PI)) - Math.PI / 2;

/**
 * A range normalised in Web Mercator (the terrain tiling's) as the same
 * box normalised in plate carree (the imagery's): longitude unchanged,
 * latitude through the Mercator inverse. RangeError for anything but four
 * finite numbers in order.
 */
export function mercatorToGeographicRange(range: NormalizedRange): number[] {
  if (!isRange(range)) {
    throw new RangeError(
      `a range must be four finite numbers west <= east, south <= north, got ${range.join(", ")}`,
    );
  }
  const toY = (y: number) => (mercatorLatitude(y) + Math.PI / 2) / Math.PI;
  return [range[0]!, toY(range[1]!), range[2]!, toY(range[3]!)];
}

/** What the terrain plugin uses of an imagery overlay. */
export interface TerrainImagery {
  readonly tiling: unknown;
  init(): Promise<unknown>;
  calculateLevel?(range: number[]): number;
  hasContent(range: number[], level: number): boolean;
  lockTexture(range: number[], level: number): Promise<unknown>;
  getTexture(range: number[], level: number): THREE.Texture;
  releaseTexture(range: number[], level: number): void;
}

/**
 * The plate-carree `imagery` as the terrain plugin needs it: every range
 * the plugin passes (normalised in its Web Mercator tiling) converted, and
 * the level the imagery itself picks for that range (the plugin passes the
 * terrain tile's level, up to 14, against the imagery's 0-5).
 */
export function geographicOverlay(imagery: TerrainImagery): TerrainImagery {
  const convert = (range: number[]) => {
    const g = mercatorToGeographicRange(range);
    const tiling = imagery.tiling as { maxLevel?: number } | null;
    const level = imagery.calculateLevel
      ? imagery.calculateLevel(g)
      : (tiling?.maxLevel ?? 0);
    return { g, level };
  };
  return {
    get tiling() {
      return imagery.tiling;
    },
    init: () => imagery.init(),
    hasContent(range) {
      const { g, level } = convert(range);
      return imagery.hasContent(g, level);
    },
    lockTexture(range) {
      const { g, level } = convert(range);
      return imagery.lockTexture(g, level);
    },
    getTexture(range) {
      const { g, level } = convert(range);
      return imagery.getTexture(g, level);
    },
    releaseTexture(range) {
      const { g, level } = convert(range);
      imagery.releaseTexture(g, level);
    },
  };
}

/**
 * Uploads a 32-bit float height texture as R16F (a step of 0.5 m at
 * 1,000 m, 2 m at 4,000 m, 8 m at 8,848 m), which WebGL2 filters linearly
 * without OES_texture_float_linear. Heights are kept as metres, not offset
 * by 4,000 m: the library refills each grid's border from its neighbours
 * in place, which an offset copy would miss. Other textures are left.
 */
export function useHalfFloatHeights(texture: THREE.Texture): void {
  if (texture.type !== THREE.FloatType || texture.internalFormat === "R16F") {
    return;
  }
  texture.internalFormat = "R16F";
  texture.needsUpdate = true;
}

/** A tile's box in radians, from its geodetic normals. */
export interface GeographicBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * The latitude and longitude box (radians) of a terrain tile, from the
 * geodetic normals the library writes per vertex (skirts repeat the
 * perimeter's). RangeError without normals.
 */
export function tileGeographicBounds(
  geometry: THREE.BufferGeometry,
): GeographicBounds {
  const normal = geometry.getAttribute("normal");
  if (!normal || normal.count === 0) {
    throw new RangeError("a terrain tile needs normals for its bounds");
  }
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (let i = 0; i < normal.count; i++) {
    const x = normal.getX(i);
    const y = normal.getY(i);
    const z = normal.getZ(i);
    const len = Math.hypot(x, y, z);
    const lat = Math.asin(Math.max(-1, Math.min(1, z / len)));
    const lon = Math.atan2(y, x);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

/**
 * The imagery's UV per vertex from the geodetic normal, over the tile's
 * box: exact at every vertex, where the library's linear map across a Web
 * Mercator tile is not. The texture is the overlay's composed image of
 * that box, north at its top (flipY), so v runs south to north.
 */
const GEO_UV_VERTEX = /* glsl */ `
#ifdef USE_MAP
{
  vec3 gn = normalize( normal );
  float lat = asin( clamp( gn.z, -1.0, 1.0 ) );
  float lon = atan( gn.y, gn.x );
  vMapUv = vec2(
    ( lon - uTerrainGeoBounds.x ) / max( uTerrainGeoBounds.z - uTerrainGeoBounds.x, 1e-9 ),
    ( lat - uTerrainGeoBounds.y ) / max( uTerrainGeoBounds.w - uTerrainGeoBounds.y, 1e-9 )
  );
}
#endif`;

/**
 * A lit copy of the globe's `template` for one terrain tile: the tile's
 * own imagery, displacement and bump maps and scales, the library's
 * compile hook (its bump chunk) and the template's (the globe's look),
 * and the imagery UV from the geodetic normal over `bounds`.
 */
export function litTerrainMaterial(
  template: THREE.MeshStandardMaterial,
  own: THREE.Material & {
    map?: THREE.Texture | null;
    displacementMap?: THREE.Texture | null;
    displacementScale?: number;
    bumpMap?: THREE.Texture | null;
    bumpScale?: number;
  },
  bounds: GeographicBounds,
): THREE.MeshStandardMaterial {
  const lit = template.clone();
  const geoBounds = {
    value: new THREE.Vector4(
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north,
    ),
  };
  // Material.copy does not carry the compile hooks; neither uses `this`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const terrainHook = own.onBeforeCompile;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const globeHook = template.onBeforeCompile;
  lit.onBeforeCompile = (shader, renderer) => {
    terrainHook.call(own, shader, renderer);
    globeHook.call(template, shader, renderer);
    shader.uniforms.uTerrainGeoBounds = geoBounds;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec4 uTerrainGeoBounds;",
      )
      .replace("#include <uv_vertex>", `#include <uv_vertex>${GEO_UV_VERTEX}`);
  };
  lit.customProgramCacheKey = () => GLOBE_TERRAIN.programKey;
  lit.map = own.map ?? null;
  lit.displacementMap = own.displacementMap ?? null;
  lit.displacementScale = own.displacementScale ?? 1;
  lit.bumpMap = own.bumpMap ?? null;
  lit.bumpScale = own.bumpScale ?? 1;
  return lit;
}

/** What this module uses of the library's TerrariumMeshPlugin (untyped in 0.5.3). */
export interface TerrariumMeshPluginInstance {
  heightScale: number;
}

type TerrariumMeshPluginConstructor = new (options: {
  url: string;
  maxZoom?: number;
  overlay?: TerrainImagery;
  applyOverlayTexture?: boolean;
  heightScale?: number;
}) => TerrariumMeshPluginInstance;

const terrariumRuntime: unknown = (plugins as Record<string, unknown>)[
  "TerrariumMeshPlugin"
];

/** The relief carrier, as `createGlobeTerrain` returns it. */
export interface GlobeTerrain {
  readonly tiles: TilesRenderer;
  readonly plugin: TerrariumMeshPluginInstance;
  /** How many loaded tiles carry the globe's lit material now. */
  litTiles(): number;
  dispose(): void;
}

/**
 * The library's terrain tiles (`TerrariumMeshPlugin` on `url`, Terrarium
 * encoded, up to `maxZoom`) with the plate-carree `imagery` through
 * `geographicOverlay`, and on every tile it loads: heights as R16F
 * (`useHalfFloatHeights`) and the globe's lit copy of `template` over the
 * tile's box (`litTerrainMaterial`). The caller adds `tiles.group` to its
 * scene and calls `tiles.update()`. RangeError for an empty url or a
 * height scale that is not finite and >= 0; Error if the library stops
 * exporting the plugin.
 */
export function createGlobeTerrain(options: {
  url: string;
  imagery: TerrainImagery;
  template: THREE.MeshStandardMaterial;
  heightScale: number;
  maxZoom?: number;
}): GlobeTerrain {
  const { url, imagery, template, heightScale, maxZoom = 12 } = options;
  if (typeof url !== "string" || url.length === 0) {
    throw new RangeError("the terrain needs a tile url");
  }
  if (!(heightScale >= 0 && Number.isFinite(heightScale))) {
    throw new RangeError(
      `the height scale must be finite and >= 0, got ${heightScale}`,
    );
  }
  if (typeof terrariumRuntime !== "function") {
    throw new Error(
      "3d-tiles-renderer no longer exports TerrariumMeshPlugin from its plugins entry",
    );
  }
  const Plugin = terrariumRuntime as TerrariumMeshPluginConstructor;
  const plugin = new Plugin({
    url,
    maxZoom,
    overlay: geographicOverlay(imagery),
    applyOverlayTexture: true,
    heightScale,
  });
  const tiles = new TilesRenderer();
  tiles.registerPlugin(plugin);
  const owned = new Set<THREE.Material>();
  const meshesOf = (root: THREE.Object3D) => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) out.push(o as THREE.Mesh);
    });
    return out;
  };
  tiles.addEventListener("load-model", ({ scene }) => {
    for (const mesh of meshesOf(scene)) {
      const own = mesh.material as THREE.MeshLambertMaterial;
      if (own.displacementMap) useHalfFloatHeights(own.displacementMap);
      const lit = litTerrainMaterial(
        template,
        own,
        tileGeographicBounds(mesh.geometry),
      );
      owned.add(lit);
      mesh.material = lit;
    }
  });
  tiles.addEventListener("dispose-model", ({ scene }) => {
    for (const mesh of meshesOf(scene)) {
      const lit = mesh.material as THREE.Material;
      if (owned.delete(lit)) lit.dispose();
    }
  });
  return {
    tiles,
    plugin,
    litTiles: () => owned.size,
    dispose() {
      for (const lit of owned) lit.dispose();
      owned.clear();
      tiles.dispose();
    },
  };
}
