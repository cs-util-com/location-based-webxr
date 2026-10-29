/**
 * The haze over the relief, moved out of the globe lab.
 *
 * Why this file matters: the haze's one fog decides `USE_FOG` for every
 * material on the page, so it must be set once and never flip at the edge
 * (a flip recompiles every program); its strength is the ground sky's
 * weight times the page's scale, written only on a change; and it patches
 * only what the relief loads. These tests pin that under Node, where the
 * framework's haze runs without a renderer. The look itself is the globe
 * lab's smoke and the reference captures.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { AtmosphereHaze } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-haze";

import { createGlobeHaze, FOG_OUT_OF_REACH_M } from "./globe-haze.js";

/** A tile set that hands its listener the models the test loads. */
const fakeTiles = () => {
  const listeners: ((event: { scene: THREE.Object3D }) => void)[] = [];
  return {
    addEventListener(
      type: "load-model",
      listener: (event: { scene: THREE.Object3D }) => void,
    ) {
      expect(type).toBe("load-model");
      listeners.push(listener);
    },
    load(model: THREE.Object3D) {
      for (const listener of listeners) listener({ scene: model });
    },
  };
};

const model = (...materials: THREE.Material[]) => {
  const root = new THREE.Group();
  for (const material of materials) {
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  }
  return root;
};

describe("createGlobeHaze", () => {
  // The fog is there from the start, its planes out of reach, so three's
  // stock fog never darkens a material the haze does not patch.
  it("sets one fog out of reach for the whole page", () => {
    const scene = new THREE.Scene();
    const haze = createGlobeHaze(scene, { visibilityKm: 60 });
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    const fog = scene.fog as THREE.Fog;
    expect(fog.near).toBe(FOG_OUT_OF_REACH_M);
    expect(fog.far).toBe(FOG_OUT_OF_REACH_M * 2);
    expect(haze.state()).toEqual({ synced: false, density: 0, patched: 0 });
  });

  // The density is the weight times the scale, 0 above the edge, and the
  // framework is told only when it changes.
  it("weighs the haze by weight times scale, only on a change", () => {
    const haze = createGlobeHaze(new THREE.Scene(), { visibilityKm: 60 });
    haze.setWeight(0.5, 2);
    expect(haze.state().density).toBe(1);
    haze.setWeight(0.25, 4);
    expect(haze.state().density).toBe(1);
    haze.setWeight(0, 2);
    expect(haze.state().density).toBe(0);
  });

  it("refuses a negative or non-finite strength, as the framework's", () => {
    const haze = createGlobeHaze(new THREE.Scene(), { visibilityKm: 60 });
    expect(() => haze.setWeight(-1, 2)).toThrow(RangeError);
    expect(() => haze.setWeight(Number.NaN, 2)).toThrow(RangeError);
  });

  it("refuses a visibility the framework's haze refuses", () => {
    expect(() =>
      createGlobeHaze(new THREE.Scene(), { visibilityKm: -1 }),
    ).toThrow(RangeError);
  });

  // Only the fog-capable, tone-mapped materials of the models loaded after
  // `patch`, counted once each.
  it("patches what the tiles load from then on, and counts it", () => {
    const haze = createGlobeHaze(new THREE.Scene(), { visibilityKm: 60 });
    const tiles = fakeTiles();
    tiles.load(model(new THREE.MeshStandardMaterial()));
    expect(haze.state().patched).toBe(0);
    haze.patch(tiles);
    const lit = new THREE.MeshStandardMaterial();
    tiles.load(model(lit, new THREE.MeshBasicMaterial({ fog: false })));
    expect(haze.state().patched).toBe(1);
    tiles.load(model(lit));
    expect(haze.state().patched).toBe(1);
  });

  // The ground sky's own uniforms (sun, scale, sky view) and visibility
  // reach the framework's haze: a sync that only flipped `synced` would
  // leave the relief hazed by a sky the page no longer shows.
  it("follows the ground sky after a sync", () => {
    const sync = vi.spyOn(AtmosphereHaze.prototype, "sync");
    try {
      const haze = createGlobeHaze(new THREE.Scene(), { visibilityKm: 60 });
      const groundKm = 6360;
      const sharedUniforms = {
        atmMieExtinction: { value: 0.01 },
        atmSunDirection: { value: new THREE.Vector3(0, 0, 1) },
        atmObserverRadius: { value: groundKm + 1 },
        atmRadianceToScene: { value: 1 },
        atmSkyViewLut: { value: new THREE.Texture() },
      };
      haze.sync({ visibilityKm: 40, sharedUniforms } as never);
      expect(sync).toHaveBeenCalledTimes(1);
      expect(sync.mock.calls[0]?.[0]).toEqual({
        sharedUniforms,
        visibilityKm: 40,
      });
      expect(sync.mock.calls[0]?.[0].sharedUniforms).toBe(sharedUniforms);
      expect(haze.state().synced).toBe(true);
    } finally {
      sync.mockRestore();
    }
  });

  it("takes its fog away on dispose", () => {
    const scene = new THREE.Scene();
    const haze = createGlobeHaze(scene, { visibilityKm: 60 });
    haze.dispose();
    expect(scene.fog).toBeNull();
  });
});
