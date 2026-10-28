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
  // Why: the values measured for the editor's views: faded out at 2400 m
  // (also the request reach), asked for at z14 and finer over a mesh of
  // level 17 - one zoom coarser than the near map, so the far map reaches
  // the horizon of an overview instead of fading at 1600 m, within the
  // request ceiling (measured 2026-10-26) - no speed limit (an orbiting camera crosses the place fast
  // and must keep its map) and no height limit (the orbit keeps the
  // camera within 1100 m of its centre, so the reach already bounds the
  // requests, and a height line switched the whole map off over a deep
  // valley: measured 2026-10-25).
  it("is the measured one, and the overlay accepts it", () => {
    expect(EDITOR_OSM_LIMITS).toEqual({
      minZoom: 14,
      maxAboveGroundM: Number.POSITIVE_INFINITY,
      onBelowAboveGroundM: Number.POSITIVE_INFINITY,
      maxSpeedMps: Number.POSITIVE_INFINITY,
      onBelowSpeedMps: Number.POSITIVE_INFINITY,
    });
    expect(EDITOR_OSM_FADE_M).toBe(2400);
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

  // Why (a measurement, 2026-10-25: the editor at 1440 x 900 over a
  // synthetic relief with 400 m hills and a fake tile server): the map
  // switched off when the camera was more than 1250 m over the ground
  // under it, which an orbit at its 1100 m limit reaches over a valley;
  // the top view at 1100 m showed no map at all. The editor's map stays on at any
  // height its orbit can reach; only an unknown height keeps it off.
  it("keeps the map on however high over the ground the camera is", () => {
    const ground = make();
    const position = new THREE.Vector3();
    ground.osm.update({ position, aboveGroundM: 1700, speedMps: 0, nowMs: 0 });
    expect(ground.osm.stats().active).toBe(true);
    ground.osm.update({ position, aboveGroundM: 5000, speedMps: 0, nowMs: 16 });
    expect(ground.osm.stats()).toMatchObject({ active: true, switchedOff: 0 });
    ground.osm.update({
      position,
      aboveGroundM: Number.NaN,
      speedMps: 0,
      nowMs: 32,
    });
    expect(ground.osm.stats().active).toBe(false);
    ground.dispose();
  });

  // Why: a kept map region (its texture and the library's lock on its
  // source bitmap, about 512 KiB) is memory outside the relief's budget,
  // and a phone's relief budget is a quarter of a desktop's, so the keep
  // is chosen per device class. Measured 2026-10-25 (the editor at 390 px
  // over a fake tile server answering in 300 ms): over a five-minute
  // scripted camera tour a keep of 32 stayed under the request ceiling at
  // 61 re-fetches, 64 at 8; a minute of orbiting at 600-1100 m and tilts
  // 70-75 filled the ceiling with 32 for 19-50 s, most of it re-fetches.
  // A phone keeps 64 too (about 32 MiB), until a phone shows the memory
  // is not there.
  it("keeps as many released map regions on a phone as on a desktop", () => {
    const phone = createEditorTerrain({
      renderer: {} as THREE.WebGLRenderer,
      centre: { lat: 48.137393, lng: 11.575493 },
      device: "phone",
    });
    expect(phone.osm.stats().keep).toBe(64);
    phone.dispose();
    const desktop = make();
    expect(desktop.osm.stats().keep).toBe(64);
    desktop.dispose();
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
