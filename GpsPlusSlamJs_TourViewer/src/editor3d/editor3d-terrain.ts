/**
 * The 3D editor's ground: the globe's relief carrier on Mapterhorn's
 * heights, plain (no whole-Earth imagery: the creator looks at a place,
 * not a planet), with the OpenStreetMap map on it near the camera, and the
 * credits both need.
 *
 * The map's gate is the editor's, not the flight's. Measured on the
 * editor's start view, top view and farthest zoom over the sample tour's
 * square (2026-10-22): with the flight's limits (off above 200 m over the
 * ground, a 300 m fade) none of those views drew any map; with the map off
 * only above 1250 m (on again below 1125 m), faded out at 1600 m and asked
 * for at z15 and finer, every one did, at 23-83 requests a view, never
 * near the 150 a minute ceiling. A coarser relief (a mesh below level 17)
 * would draw z14 under the target and need `minZoom` 14; a fade below
 * about 1300 m loses the farthest view. The flight's speed limits are
 * opened: an editor's camera jumps across the place as it orbits, and the
 * map would blank in an ordinary turn.
 *
 * @see editor3d-terrain.ts.md
 */
import * as THREE from "three";

import {
  createGlobeOsmOverlay,
  createGlobeTerrain,
  mapterhornRelief,
  plainImagery,
  reliefCredits,
  reliefTerrainOptions,
  worldFromEcefAt,
  type GlobeOsmOverlay,
  type GlobeTerrain,
  type OsmGateLimits,
  type ReliefDeviceClass,
} from "gps-plus-slam-globe/editor";
import {
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_MAX_ZOOM,
  OSM_TILE_URL,
} from "gps-plus-slam-app-framework/utils/osm-tiles";
import {
  MAPTERHORN_ATTRIBUTION,
  MAPTERHORN_URL_TEMPLATE,
} from "gps-plus-slam-osm/elevation/terrarium";

/** The relief's mesh level near the camera: about 6.5 m between vertices,
 *  fine enough for the map's z15 and finer. */
export const EDITOR_MESH_LEVEL = 17;

/** The map's gate for the editor (see the module comment). */
export const EDITOR_OSM_LIMITS: Readonly<OsmGateLimits> = Object.freeze({
  minZoom: 15,
  maxAboveGroundM: 1250,
  onBelowAboveGroundM: 1125,
  maxSpeedMps: Number.POSITIVE_INFINITY,
  onBelowSpeedMps: Number.POSITIVE_INFINITY,
});

/** Where the map has faded out, and how far it is asked for (m). */
export const EDITOR_OSM_FADE_M = 1600;

/** The plain ground's colour where no map is drawn. */
const GROUND_COLOUR = 0xd9d4c7;

/** Wider than this (CSS px) the editor takes the desktop's relief budget. */
export const DESKTOP_MIN_WIDTH_PX = 768;

/**
 * The relief's device class for a viewport `widthPx` wide: the desktop's
 * (its 256 MiB cache) wider than 768 px, which the editor's tablets are
 * too; the phone's otherwise. A width that is not finite and > 0 is the
 * phone's: the smaller budget is the safe one.
 */
export function reliefDeviceClass(widthPx: number): ReliefDeviceClass {
  return Number.isFinite(widthPx) && widthPx > DESKTOP_MIN_WIDTH_PX
    ? "desktop"
    : "phone";
}

/** One credit line: its short name, its full text and its link (the
 *  globe's credit shape). */
export type EditorCredit = ReturnType<typeof reliefCredits>[number];

/** The editor's ground, ready to be added to a scene and updated. */
export interface EditorTerrain {
  readonly terrain: GlobeTerrain;
  /** The world frame: ECEF to the world (x east, y up, z south at the
   *  centre, the ellipsoid's point of the centre at the origin). */
  readonly worldFromEcef: THREE.Matrix4;
  readonly osm: GlobeOsmOverlay;
  /** The heights' sources, then the map's. */
  readonly credits: readonly EditorCredit[];
  /** The drawn ground (m over the ellipsoid) at a latitude and longitude
   *  in radians, null where none is loaded. */
  groundAt(latRad: number, lonRad: number): number | null;
  /** Each frame: the tiles and the map, for `camera` (world space). */
  update(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    nowMs: number,
  ): void;
  dispose(): void;
}

const cameraLocal = new THREE.Vector3();
const resolution = new THREE.Vector2();

/**
 * The editor's ground in the world frame of `centre` (`worldFromEcefAt`
 * on the relief's own ellipsoid): the relief (Mapterhorn, plain, mesh level 17, the device's
 * budget) with the OSM map attached at once, before any tile loads (a map
 * attached to a relief already loaded asked the library for levels it
 * could not give yet), enabled, under the editor's gate.
 */
export function createEditorTerrain(input: {
  readonly renderer: THREE.WebGLRenderer;
  /** The world frame's centre (degrees). */
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly device: ReliefDeviceClass;
}): EditorTerrain {
  const source = mapterhornRelief({
    url: MAPTERHORN_URL_TEMPLATE,
    attribution: MAPTERHORN_ATTRIBUTION,
  });
  const terrain = createGlobeTerrain({
    ...reliefTerrainOptions(source, input.device),
    imagery: plainImagery(),
    template: new THREE.MeshStandardMaterial({
      color: GROUND_COLOUR,
      roughness: 1,
      metalness: 0,
    }),
    heightScale: 1,
    meshMaxLevel: EDITOR_MESH_LEVEL,
  });
  const worldFromEcef = worldFromEcefAt(
    terrain.tiles.ellipsoid,
    input.centre,
    new THREE.Matrix4(),
  );
  const group = terrain.tiles.group;
  worldFromEcef.decompose(group.position, group.quaternion, group.scale);
  group.updateMatrixWorld(true);
  const osm = createGlobeOsmOverlay({
    url: OSM_TILE_URL,
    attribution: OSM_TILE_ATTRIBUTION,
    maxZoom: OSM_TILE_MAX_ZOOM,
    renderer: input.renderer,
    fadeM: EDITOR_OSM_FADE_M,
    limits: EDITOR_OSM_LIMITS,
  });
  osm.attach(terrain);
  osm.setEnabled(true);
  const groundAt = (latRad: number, lonRad: number) =>
    terrain.plugin.sampleCartographicElevation(latRad, lonRad);
  return {
    terrain,
    worldFromEcef,
    osm,
    credits: [...reliefCredits(source), osm.credit],
    groundAt,
    update(camera, renderer, nowMs) {
      group.updateMatrixWorld(true);
      group.worldToLocal(cameraLocal.copy(camera.position));
      const at = terrain.tiles.ellipsoid.getPositionToCartographic(
        cameraLocal,
        {},
      );
      const ground = groundAt(at.lat, at.lon);
      osm.update({
        position: camera.position,
        aboveGroundM: ground === null ? Number.NaN : at.height - ground,
        // The speed limits are open (see EDITOR_OSM_LIMITS).
        speedMps: 0,
        nowMs,
      });
      terrain.tiles.setCamera(camera);
      renderer.getDrawingBufferSize(resolution);
      terrain.tiles.setResolution(camera, resolution.x, resolution.y);
      terrain.tiles.update();
    },
    dispose() {
      // Disposes the tiles and their plugins, the map's included.
      terrain.dispose();
    },
  };
}
