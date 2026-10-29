/**
 * The space pass (the atmosphere seen from space), moved out of the globe lab.
 *
 * Why this file matters: the pass is one shader whose inputs the air's
 * wiring sets every frame. Its look is the lab's smokes and the reference
 * captures; these tests pin, under Node with a recording fake renderer, the
 * CPU side the move must keep: the look's validation and its shader
 * rebuild only on a step change, the shares' and depth weight's range
 * checks, the depth used only when drawn this frame, the radiance per unit
 * of the tables' sun, the two tables drawn once, and nothing drawn where
 * float targets are missing or both shares are 0.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { ATMOSPHERE_RADIANCE_SCALE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-glsl";

import { createGlobeAtmosphere } from "./globe-atmosphere.js";
import { atmosphereLook } from "./globe-atmosphere-frame.js";

const RADII = [6378137, 6378137, 6356752.314245] as const;

/** A renderer that counts its draws; `float` says whether it has float targets. */
const fakeRenderer = (float: boolean) => {
  let draws = 0;
  let target: unknown = null;
  const renderer = {
    extensions: { has: () => float },
    domElement: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    getRenderTarget: () => target,
    setRenderTarget: (next: unknown) => {
      target = next;
    },
    render: () => {
      draws += 1;
    },
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    draws: () => draws,
  };
};

const frame = (more: Record<string, unknown> = {}) => ({
  worldFromEcef: new THREE.Matrix4(),
  sunEcef: new THREE.Vector3(1, 0, 0),
  sunIntensity: 5,
  ...more,
});

/** The pass's shader material, through the scene it draws. */
const materialOf = (renderer: THREE.WebGLRenderer) => {
  let material: THREE.ShaderMaterial | null = null;
  const draw = renderer.render.bind(renderer);
  renderer.render = (scene: THREE.Object3D, camera: THREE.Camera) => {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial)
        material = o.material;
    });
    draw(scene, camera);
  };
  return () => material;
};

describe("createGlobeAtmosphere", () => {
  it("starts with the default look and refuses a bad one", () => {
    const pass = createGlobeAtmosphere(fakeRenderer(true).renderer, RADII);
    expect(pass.supported).toBe(true);
    expect(pass.look).toEqual(atmosphereLook({}));
    expect(() => pass.setLook({ steps: 0 })).toThrow(RangeError);
    // A refused look leaves the old one.
    expect(pass.look).toEqual(atmosphereLook({}));
  });

  it("refuses a radius that is not positive and finite", () => {
    expect(() =>
      createGlobeAtmosphere(fakeRenderer(true).renderer, [0, 1, 1]),
    ).toThrow(RangeError);
  });

  // A new step count is a new shader (a define); a strength or thickness
  // is a uniform and must not recompile it.
  it("rebuilds the shader for a new step count only", () => {
    const { renderer } = fakeRenderer(true);
    const material = materialOf(renderer);
    const pass = createGlobeAtmosphere(renderer, RADII);
    pass.render(new THREE.PerspectiveCamera(), frame());
    const m = material();
    expect(m).not.toBeNull();
    if (m === null) return;
    const steps = pass.look.steps;
    expect(m.defines.ATM_SPACE_STEPS).toBe(steps);
    const version = m.version;
    pass.setLook({ strength: 2, thickness: 3 });
    expect(m.version).toBe(version);
    expect(m.uniforms.uThickness?.value).toBe(3);
    pass.setLook({ steps: steps + 1 });
    expect(m.defines.ATM_SPACE_STEPS).toBe(steps + 1);
    expect(m.version).toBe(version + 1);
  });

  it("refuses a share or a depth weight outside 0-1", () => {
    const pass = createGlobeAtmosphere(fakeRenderer(true).renderer, RADII);
    const camera = new THREE.PerspectiveCamera();
    for (const bad of [
      { skyShare: -0.1 },
      { groundShare: 1.1 },
      { sceneDepthWeight: Number.NaN },
    ]) {
      expect(() => pass.render(camera, frame(bad))).toThrow(RangeError);
    }
  });

  // The tables are drawn once (two draws), then each frame is one draw;
  // nothing when both shares are 0.
  it("draws the tables once, then one pass a frame, none at zero shares", () => {
    const { renderer, draws } = fakeRenderer(true);
    const pass = createGlobeAtmosphere(renderer, RADII);
    const camera = new THREE.PerspectiveCamera();
    pass.render(camera, frame({ skyShare: 0, groundShare: 0 }));
    expect(draws()).toBe(0);
    pass.render(camera, frame());
    expect(draws()).toBe(3);
    pass.render(camera, frame());
    expect(draws()).toBe(4);
    expect(pass.transmittance()).not.toBeNull();
    expect(draws()).toBe(4);
  });

  // The radiance per unit of the tables' sun, times the scene's sun and
  // the look's strength; the depth only when drawn this frame.
  it("sets the radiance and uses the depth only when fresh", () => {
    const { renderer } = fakeRenderer(true);
    const material = materialOf(renderer);
    const pass = createGlobeAtmosphere(renderer, RADII);
    pass.setLook({ strength: 2 });
    const camera = new THREE.PerspectiveCamera();
    const texture = new THREE.Texture();
    const depthCamera = { projectionMatrixInverse: new THREE.Matrix4() };
    pass.render(
      camera,
      frame({
        sceneDepth: { fresh: false, texture, camera: depthCamera },
        sceneDepthWeight: 0.5,
      }),
    );
    const m = material();
    if (m === null) throw new Error("the pass drew nothing");
    const value = (name: string): unknown => m.uniforms[name]?.value;
    expect(value("uRadiance")).toBeCloseTo(
      (5 * 2) / ATMOSPHERE_RADIANCE_SCALE,
      12,
    );
    expect(value("uSceneDepthWeight")).toBe(0);
    expect(value("uSceneDepth")).toBeNull();
    pass.render(
      camera,
      frame({
        sceneDepth: { fresh: true, texture, camera: depthCamera },
        sceneDepthWeight: 0.5,
      }),
    );
    expect(value("uSceneDepthWeight")).toBe(0.5);
    expect(value("uSceneDepth")).toBe(texture);
  });

  it("draws nothing and has no table without float targets", () => {
    const { renderer, draws } = fakeRenderer(false);
    const pass = createGlobeAtmosphere(renderer, RADII);
    expect(pass.supported).toBe(false);
    pass.render(new THREE.PerspectiveCamera(), frame());
    expect(draws()).toBe(0);
    expect(pass.transmittance()).toBeNull();
    pass.dispose();
  });
});
