/**
 * Why this file matters: the composite is the one place where the shell,
 * the slab, the shell's ground shadow and the high layer meet. A switch
 * left on while the shell has not faded in draws a shadow or a high layer
 * with no clouds; a slab weighed without its texture reads an old frame's
 * slab. The shell pass's own tests pin the same values through a whole
 * frame; these pin the composite's rules on their own.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createGlobeCloudComposite,
  type GlobeCloudCompositeFrame,
} from "./globe-cloud-composite.js";

const textures = () => ({
  shell: new THREE.Texture(),
  shadow: new THREE.Texture(),
  high: new THREE.Texture(),
});

const frame = (
  over: Partial<GlobeCloudCompositeFrame> = {},
): GlobeCloudCompositeFrame => ({
  shellIn: 1,
  shadowStrength: 0,
  high: null,
  cameraKm: 100,
  slabTexture: null,
  slabWeight: 0,
  ...over,
});

const read = (material: THREE.ShaderMaterial, name: string): unknown =>
  material.uniforms[name]?.value;

describe("createGlobeCloudComposite", () => {
  it("reads the shell pass's targets by identity", () => {
    const t = textures();
    const { material } = createGlobeCloudComposite(t);
    expect(read(material, "tShell")).toBe(t.shell);
    expect(read(material, "tShadow")).toBe(t.shadow);
    expect(read(material, "tHigh")).toBe(t.high);
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(false);
  });

  // Why: the shadow and the high layer belong to the shell; before its
  // fade-in they must not draw on their own.
  it("switches the shadow and the high layer only while the shell is in", () => {
    const composite = createGlobeCloudComposite(textures());
    const on = { shadowStrength: 0.5, high: { altitudeKm: 9 } };
    composite.apply(frame({ ...on, shellIn: 0 }));
    expect(read(composite.material, "uShadowOn")).toBe(0);
    expect(read(composite.material, "uHighOn")).toBe(0);
    expect(read(composite.material, "uShellWeight")).toBe(0);
    composite.apply(frame({ ...on, shellIn: 0.25 }));
    expect(read(composite.material, "uShadowOn")).toBe(1);
    expect(read(composite.material, "uHighOn")).toBe(1);
    expect(read(composite.material, "uShellWeight")).toBe(0.25);
  });

  // Why: from above the high layer lies over the clouds, from below
  // behind them; the order flips at its own height.
  it("puts the high layer in front only from above it", () => {
    const composite = createGlobeCloudComposite(textures());
    const high = { altitudeKm: 9 };
    composite.apply(frame({ high, cameraKm: 9.5 }));
    expect(read(composite.material, "uHighInFront")).toBe(1);
    composite.apply(frame({ high, cameraKm: 9 }));
    expect(read(composite.material, "uHighInFront")).toBe(0);
    composite.apply(frame({ high: null, cameraKm: 50 }));
    expect(read(composite.material, "uHighInFront")).toBe(0);
  });

  it("weighs the slab only with its texture", () => {
    const composite = createGlobeCloudComposite(textures());
    composite.apply(frame({ slabWeight: 0.4 }));
    expect(read(composite.material, "uSlabWeight")).toBe(0);
    expect(read(composite.material, "tSlab")).toBeNull();
    const slab = new THREE.Texture();
    composite.apply(frame({ slabTexture: slab, slabWeight: 0.4 }));
    expect(read(composite.material, "uSlabWeight")).toBe(0.4);
    expect(read(composite.material, "tSlab")).toBe(slab);
  });

  // Why: no other test can see the composite's GLSL (the uniform
  // snapshots record values only), so an edit to how the shell, the slab,
  // the shadow and the high layer blend would change every pixel under the
  // shell with every test green. A deliberate change updates the snapshot
  // in the same commit, where its diff shows the GLSL.
  it("draws with the fragment shader recorded in its snapshot", () => {
    const { material } = createGlobeCloudComposite(textures());
    expect(material.fragmentShader).toMatchSnapshot();
  });

  it("frees its material", () => {
    const composite = createGlobeCloudComposite(textures());
    let disposed = 0;
    composite.material.addEventListener("dispose", () => {
      disposed += 1;
    });
    composite.dispose();
    expect(disposed).toBe(1);
  });
});
