/**
 * The relief's height-scale step without a whole-tree walk (perf plan
 * 2026-10-03-2017, H1 and PERF-2b option A; DEC-PERF-4).
 *
 * The library's `TerrainRGBMeshPlugin._updateHeightScale` rebuilds the
 * bounding volume of every node it ever made on each change of
 * `heightScale`, and the tree is never pruned (about 20,000 nodes after one
 * descent). This replaces that method on one plugin instance: the loaded
 * materials take the new scale at once, the volumes the last update visited
 * are refreshed at once (a raycast or the next traversal reads those
 * first), and every other volume is refreshed just before the renderer next
 * computes its view error. The drawn result and every volume the library
 * reads are the same as before; only the work moves to the nodes that are
 * actually read.
 */
import type * as THREE from "three";

/** What this module uses of a tile (the library's own field). */
interface LazyTile {
  traversal?: { lastFrameVisited?: number };
}

/** The scale version a tile's volume was last refreshed at. */
const VERSION = Symbol("globe-lazy-height-scale-version");

type Stamped = LazyTile & { [VERSION]?: number };

/** What this module uses of the renderer (3d-tiles-renderer 0.5.3). */
interface LazyTilesRenderer {
  frameCount: number;
  traverse(
    before: (tile: Stamped) => boolean | void,
    after: null,
    ensureFullyProcessed: boolean,
  ): void;
  forEachLoadedModel(callback: (scene: THREE.Object3D) => void): void;
  calculateTileViewError(tile: Stamped, target: unknown): unknown;
}

/** What this module uses of the terrain plugin (private in 0.5.3; guarded by the tests). */
interface LazyHeightScalePlugin {
  _heightScale: number;
  _updateBoundingVolume(tile: Stamped): void;
  _updateHeightScale(): void;
}

export interface LazyHeightScale {
  /** Counters for the frame-hitch recorder. */
  stats(): {
    /** Volumes refreshed at the last scale change (the visited ones). */
    lastStepRefreshes: number;
    /** Volumes refreshed on read since installation. */
    deferredRefreshes: number;
    scaleChanges: number;
  };
}

function hasMembers(
  value: unknown,
  members: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return members.every((m) => m in record);
}

/**
 * Installs the deferred refresh on `plugin` (registered on `tiles`). Call
 * once, after `registerPlugin`. TypeError if either lacks a member this
 * relies on (a library upgrade renamed it).
 */
export function installLazyHeightScale(
  tiles: unknown,
  plugin: unknown,
): LazyHeightScale {
  if (
    !hasMembers(plugin, [
      "_heightScale",
      "_updateBoundingVolume",
      "_updateHeightScale",
    ])
  ) {
    throw new TypeError(
      "the terrain plugin no longer has _heightScale, _updateBoundingVolume and _updateHeightScale",
    );
  }
  if (
    !hasMembers(tiles, [
      "frameCount",
      "traverse",
      "forEachLoadedModel",
      "calculateTileViewError",
    ])
  ) {
    throw new TypeError(
      "the tiles renderer no longer has frameCount, traverse, forEachLoadedModel and calculateTileViewError",
    );
  }
  const p = plugin as unknown as LazyHeightScalePlugin;
  const r = tiles as unknown as LazyTilesRenderer;

  let version = 0;
  let lastStepRefreshes = 0;
  let deferredRefreshes = 0;
  let scaleChanges = 0;

  const refreshVolume = p._updateBoundingVolume.bind(p);
  // Every refresh, the library's own (a tile loading, a parent seeding its
  // children) and ours, stamps the scale version it used.
  p._updateBoundingVolume = (tile) => {
    refreshVolume(tile);
    tile[VERSION] = version;
  };

  p._updateHeightScale = () => {
    version++;
    scaleChanges++;
    const scale = p._heightScale;
    r.forEachLoadedModel((scene) => {
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.displacementScale = scale;
        material.bumpScale = scale;
      });
    });
    let refreshed = 0;
    const frame = r.frameCount;
    // A cheap walk: a field compare per node; only visited nodes pay the
    // volume rebuild.
    r.traverse(
      (tile) => {
        if (tile.traversal?.lastFrameVisited === frame) {
          p._updateBoundingVolume(tile);
          refreshed++;
        }
      },
      null,
      false,
    );
    lastStepRefreshes = refreshed;
  };

  const viewError = r.calculateTileViewError.bind(r);
  r.calculateTileViewError = (tile, target) => {
    if (tile[VERSION] !== version) {
      p._updateBoundingVolume(tile);
      deferredRefreshes++;
    }
    return viewError(tile, target);
  };

  return {
    stats: () => ({ lastStepRefreshes, deferredRefreshes, scaleChanges }),
  };
}
