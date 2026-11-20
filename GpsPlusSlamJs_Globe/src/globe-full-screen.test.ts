/**
 * Why this file matters: the atmosphere's space pass and the ground sky's
 * composite draw through this triangle (the cloud passes still build their
 * own copy). A wrong corner leaves a strip of the screen undrawn, a
 * culled mesh draws nothing at all, and a target resized every frame
 * reallocates GPU memory sixty times a second.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  fitTarget,
  fullScreenPass,
  halfFloatTarget,
} from "./globe-full-screen.js";

describe("fullScreenPass", () => {
  const material = new THREE.MeshBasicMaterial();

  it("holds one never-culled triangle covering clip space", () => {
    const pass = fullScreenPass(material);
    expect(pass.scene.children).toHaveLength(1);
    const mesh = pass.scene.children[0] as THREE.Mesh;
    expect(mesh.material).toBe(material);
    expect(mesh.frustumCulled).toBe(false);
    const position = mesh.geometry.getAttribute("position");
    expect(Array.from(position.array)).toEqual([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
    expect(pass.camera).toBeInstanceOf(THREE.OrthographicCamera);
    expect([
      pass.camera.left,
      pass.camera.right,
      pass.camera.top,
      pass.camera.bottom,
      pass.camera.near,
      pass.camera.far,
    ]).toEqual([-1, 1, 1, -1, 0, 1]);
  });

  it("draws its scene with its camera and frees only its geometry", () => {
    const pass = fullScreenPass(material);
    const render = vi.fn();
    pass.render({ render } as unknown as THREE.WebGLRenderer);
    expect(render).toHaveBeenCalledWith(pass.scene, pass.camera);
    const mesh = pass.scene.children[0] as THREE.Mesh;
    const geometryGone = vi.fn();
    const materialGone = vi.fn();
    mesh.geometry.addEventListener("dispose", geometryGone);
    material.addEventListener("dispose", materialGone);
    pass.dispose();
    expect(geometryGone).toHaveBeenCalledTimes(1);
    expect(materialGone).not.toHaveBeenCalled();
  });

  it("gives every pass its own scene and camera", () => {
    const a = fullScreenPass(material);
    const b = fullScreenPass(material);
    expect(a.scene).not.toBe(b.scene);
    expect(a.camera).not.toBe(b.camera);
  });
});

describe("halfFloatTarget and fitTarget", () => {
  it("starts 1 x 1, half-float, without depth", () => {
    const target = halfFloatTarget();
    expect([target.width, target.height]).toEqual([1, 1]);
    expect(target.texture.type).toBe(THREE.HalfFloatType);
    expect(target.depthBuffer).toBe(false);
  });

  it("resizes only when the size differs", () => {
    const target = halfFloatTarget();
    const setSize = vi.spyOn(target, "setSize");
    fitTarget(target, 8, 4);
    fitTarget(target, 8, 4);
    expect(setSize).toHaveBeenCalledTimes(1);
    expect([target.width, target.height]).toEqual([8, 4]);
    fitTarget(target, 8, 5);
    expect(setSize).toHaveBeenCalledTimes(2);
  });
});
