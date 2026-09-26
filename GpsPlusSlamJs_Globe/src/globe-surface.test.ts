/**
 * Why this test matters: the globe's surface rests on settings a later edit
 * could flip without any visible error on a desktop:
 * - the imagery is the COMMITTED Blue Marble pyramid (local, no network),
 *   in the 4326 layout the pyramid was cut to, textured onto the tiles;
 * - the library's unlit tile material is swapped for a lit one that keeps
 *   each tile's own texture (a shared map, or none, would paint one tile
 *   everywhere, or nothing), so the sun makes a day and a night side;
 * - the lit copies are freed when their tile unloads, and never the
 *   texture, which the overlay owns and releases itself.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  GLOBE_SURFACE,
  createGlobeSurface,
  disposeLitMaterials,
  useLitMaterial,
} from "./globe-surface.js";

describe("createGlobeSurface", () => {
  it("textures the ellipsoid from the committed 4326 Blue Marble pyramid", () => {
    const globe = createGlobeSurface();
    const plugin = globe.plugin;
    expect(plugin.projection).toBe("ellipsoid");
    // The overlay resolves its scheme only when it initialises, so the
    // options passed are what is pinned.
    expect(globe.options.overlayProjection).toBe("EPSG:4326");
    expect(globe.options.applyOverlayTexture).toBe(true);
    expect(GLOBE_SURFACE.imageryUrl).toBe(
      "/globe-assets/blue-marble-4326/{z}/{x}/{y}.jpg",
    );
    // Levels 0-3 are committed: four levels.
    expect(globe.options.levels).toBe(4);
    expect(plugin.overlay).toBe(globe.overlay);
    // The plugin has no name, so it is found in the renderer's own list.
    const registered = (globe.tiles as unknown as { plugins: object[] })
      .plugins;
    expect(registered).toContain(plugin);
    globe.dispose();
  });

  it("starts with no models and no tile errors, and adds its group to nothing", () => {
    const globe = createGlobeSurface();
    expect(globe.state()).toEqual({ models: 0, tileErrors: 0 });
    // The credits line reads this: the imagery on screen is the registry's.
    expect(globe.activeSources()).toEqual(["blue-marble"]);
    expect(globe.group.parent).toBeNull();
    globe.dispose();
  });
});

function tileModel(maps: (THREE.Texture | null)[]): THREE.Group {
  const model = new THREE.Group();
  const nested = new THREE.Group();
  maps.forEach((map, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ map }),
    );
    (i % 2 ? nested : model).add(mesh);
  });
  model.add(nested, new THREE.Object3D());
  return model;
}

const meshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

describe("useLitMaterial", () => {
  it("gives every mesh a lit copy that keeps its own texture", () => {
    const maps = [new THREE.Texture(), new THREE.Texture(), null];
    const model = tileModel(maps);
    const before = meshes(model).map(
      (m) => (m.material as THREE.MeshBasicMaterial).map,
    );
    const template = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const owned = new WeakSet<THREE.Material>();
    useLitMaterial(model, template, owned);
    meshes(model).forEach((mesh, i) => {
      const lit = mesh.material as THREE.MeshStandardMaterial;
      expect(lit).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(lit).not.toBe(template);
      expect(lit.roughness).toBe(0.9);
      expect(lit.map).toBe(before[i]);
      expect(owned.has(lit)).toBe(true);
    });
  });
});

describe("disposeLitMaterials", () => {
  it("frees the lit copies it made, never their textures", () => {
    const map = new THREE.Texture();
    const freeMap = vi.spyOn(map, "dispose");
    const model = tileModel([map, map]);
    const owned = new WeakSet<THREE.Material>();
    useLitMaterial(model, new THREE.MeshStandardMaterial(), owned);
    const lit = meshes(model).map((m) => m.material as THREE.Material);
    const frees = lit.map((m) => vi.spyOn(m, "dispose"));
    disposeLitMaterials(model, owned);
    for (const free of frees) expect(free).toHaveBeenCalledTimes(1);
    expect(freeMap).not.toHaveBeenCalled();
  });

  it("leaves materials it did not make alone", () => {
    const model = tileModel([null]);
    const foreign = meshes(model)[0]!.material as THREE.Material;
    const free = vi.spyOn(foreign, "dispose");
    disposeLitMaterials(model, new WeakSet());
    expect(free).not.toHaveBeenCalled();
  });
});
