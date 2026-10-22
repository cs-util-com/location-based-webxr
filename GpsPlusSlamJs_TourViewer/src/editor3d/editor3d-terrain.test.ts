/**
 * Why these tests matter: the 3D editor's ground is the globe's relief
 * under the editor's own map gate, and the values that gate rests on were
 * measured (the map shows at the start view, the top view and the farthest
 * zoom over the sample square, never near the request ceiling). A default
 * creeping back to the flight's limits gives a 3D view with no map and no
 * error. These pin the editor's limits as the overlay takes them, the
 * device class at the tablet's edge, the credits the view must show, and
 * that the map is attached before any tile loads (attached later, the
 * library asked it for levels it could not give yet).
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { osmGateLimits, worldFromEcefAt } from "gps-plus-slam-globe/editor";
import { OSM_TILE_MAX_ZOOM } from "gps-plus-slam-app-framework/utils/osm-tiles";

import {
  DESKTOP_MIN_WIDTH_PX,
  EDITOR_MESH_LEVEL,
  EDITOR_OSM_FADE_M,
  EDITOR_OSM_LIMITS,
  createEditorTerrain,
  reliefDeviceClass,
} from "./editor3d-terrain.js";

describe("the editor's map gate", () => {
  // Why: the values measured for the editor's views: off above 1250 m
  // over the ground, on again below 1125 m, faded out at 1600 m, asked for
  // at z15 and finer over a mesh of level 17, and no speed limit (an
  // orbiting camera crosses the place fast and must keep its map).
  it("is the measured one, and the overlay accepts it", () => {
    expect(EDITOR_OSM_LIMITS).toEqual({
      minZoom: 15,
      maxAboveGroundM: 1250,
      onBelowAboveGroundM: 1125,
      maxSpeedMps: Number.POSITIVE_INFINITY,
      onBelowSpeedMps: Number.POSITIVE_INFINITY,
    });
    expect(EDITOR_OSM_FADE_M).toBe(1600);
    expect(EDITOR_MESH_LEVEL).toBe(17);
    expect(osmGateLimits(EDITOR_OSM_LIMITS, OSM_TILE_MAX_ZOOM)).toEqual(
      EDITOR_OSM_LIMITS,
    );
  });
});

describe("reliefDeviceClass", () => {
  // Why: tablets wider than 768 px take the desktop's relief budget (the
  // editor's target); the phone's smaller one is the safe answer for
  // anything narrower or for a width nobody can read.
  it("is the desktop's above 768 px, the phone's otherwise", () => {
    expect(DESKTOP_MIN_WIDTH_PX).toBe(768);
    expect(reliefDeviceClass(768)).toBe("phone");
    expect(reliefDeviceClass(769)).toBe("desktop");
    expect(reliefDeviceClass(820)).toBe("desktop");
    expect(reliefDeviceClass(1920)).toBe("desktop");
    expect(reliefDeviceClass(375)).toBe("phone");
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      expect(reliefDeviceClass(bad)).toBe("phone");
    }
  });
});

describe("createEditorTerrain", () => {
  // The plugin draws height tiles on an OffscreenCanvas; Node has none, and
  // these tests never draw one. The library resolves its tileset against
  // the page.
  beforeEach(() => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1/" } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const make = () =>
    createEditorTerrain({
      renderer: {} as THREE.WebGLRenderer,
      centre: { lat: 48.137393, lng: 11.575493 },
      device: "desktop",
    });

  // Why: the heights' sources and the map are owed a visible credit each;
  // the page shows exactly this list.
  it("owes Mapterhorn, the elevation data behind it and OpenStreetMap", () => {
    const ground = make();
    const shorts = ground.credits.map((c) => c.short).join(" | ");
    expect(shorts).toMatch(/Mapterhorn/);
    expect(shorts).toMatch(/OpenStreetMap/);
    expect(ground.credits.length).toBeGreaterThanOrEqual(3);
    expect(ground.credits.at(-1)?.short).toMatch(/OpenStreetMap/);
    for (const credit of ground.credits) {
      expect(credit.href).toMatch(/^https:\/\//);
    }
    ground.dispose();
  });

  // Why: the map must be on the relief from the start, enabled, under the
  // editor's gate; the relief must stand in the world the page draws in.
  it("attaches the map at once, enabled, under the editor's gate", () => {
    const ground = make();
    const plugins = (ground.terrain.tiles as unknown as { plugins: unknown[] })
      .plugins;
    expect(plugins).toContain(ground.osm.plugin);
    expect(ground.osm.stats().enabled).toBe(true);
    expect(ground.osm.limits).toEqual(EDITOR_OSM_LIMITS);
    expect(ground.osm.uniforms.uOsmFadeM.value).toBe(EDITOR_OSM_FADE_M);
    const frame = worldFromEcefAt(
      ground.terrain.tiles.ellipsoid,
      { lat: 48.137393, lng: 11.575493 },
      new THREE.Matrix4(),
    );
    expect(ground.worldFromEcef.equals(frame)).toBe(true);
    ground.terrain.tiles.group.updateMatrix();
    const placed = ground.terrain.tiles.group.matrix.elements;
    frame.elements.forEach((v, i) => {
      expect(placed[i]).toBeCloseTo(v, 6);
    });
    ground.dispose();
  });

  // Why: before any height tile has loaded there is no ground under the
  // camera; the frame loop must run and keep the map off, not throw.
  it("runs a frame with no ground loaded, the map not yet asked for", () => {
    const ground = make();
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e7);
    camera.position.set(0, 6_400_000, 0);
    const renderer = {
      getDrawingBufferSize: (out: THREE.Vector2) => out.set(800, 600),
    } as unknown as THREE.WebGLRenderer;
    expect(() => {
      ground.update(camera, renderer, 0);
    }).not.toThrow();
    expect(ground.osm.stats().active).toBe(false);
    ground.dispose();
  });
});
