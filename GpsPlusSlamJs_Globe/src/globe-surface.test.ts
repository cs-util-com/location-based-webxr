/**
 * Why this test matters: M0's globe is an untextured ellipsoid that makes NO
 * image requests (the page must not reach the network, and the imagery only
 * arrives in M1). That rests on two settings a later edit could flip without
 * any visible error on a desktop: the overlay's texture is not applied, and
 * the tiling is the 4326 scheme M1's imagery uses. The lit-material swap is
 * pinned too, since the library's own material is unlit and the globe would
 * then show no day and night.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  GLOBE_SURFACE,
  createGlobeSurface,
  useLitMaterial,
} from "./globe-surface.js";

describe("createGlobeSurface", () => {
  it("generates the ellipsoid from a 4326 overlay, untextured", () => {
    const globe = createGlobeSurface();
    const plugin = globe.plugin;
    expect(plugin.projection).toBe("ellipsoid");
    // The overlay resolves its scheme only when it initialises, so the
    // options passed are what is pinned.
    expect(globe.options.overlayProjection).toBe("EPSG:4326");
    expect(GLOBE_SURFACE.overlayProjection).toBe("EPSG:4326");
    expect(plugin.overlay).toBe(globe.overlay);
    expect(globe.options.applyOverlayTexture).toBe(false);
    // The plugin has no name, so it is found in the renderer's own list.
    const registered = (globe.tiles as unknown as { plugins: object[] })
      .plugins;
    expect(registered).toContain(plugin);
    globe.dispose();
  });

  it("starts with no models and no tile errors, and adds its group to nothing", () => {
    const globe = createGlobeSurface();
    expect(globe.state()).toEqual({ models: 0, tileErrors: 0 });
    expect(globe.group.parent).toBeNull();
    globe.dispose();
  });
});

describe("useLitMaterial", () => {
  it("swaps every mesh material under a loaded model for the lit one", () => {
    const model = new THREE.Group();
    const a = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const b = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const nested = new THREE.Group();
    nested.add(b);
    model.add(a, nested, new THREE.Object3D());
    const lit = new THREE.MeshStandardMaterial();
    useLitMaterial(model, lit);
    expect(a.material).toBe(lit);
    expect(b.material).toBe(lit);
  });
});
