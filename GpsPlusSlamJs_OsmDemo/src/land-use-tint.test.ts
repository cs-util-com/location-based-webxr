import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GroundTint } from "gps-plus-slam-osm";

import { landUseTint } from "./land-use-tint.js";
import { GROUND_COLOUR } from "./surface-colours.js";

/** A 2 x 1 tint: one park texel, one unpainted. */
function tintOf(ground = GROUND_COLOUR): GroundTint {
  return {
    width: 2,
    height: 1,
    texelM: 2,
    originX: -2,
    originY: -1,
    classes: new Uint8Array([1, 0]),
    palette: [ground, 0x6f9a5c],
    shares: new Map(),
    skipped: 0,
  } as unknown as GroundTint;
}

function groundMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: GROUND_COLOUR });
}

/** Runs the material's compile hook on three's own shader, as the renderer would. */
function compiled(material: THREE.Material): {
  uniforms: Record<string, { value: unknown }>;
  fragmentShader: string;
} {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

const groundOn = (material: THREE.Material): unknown =>
  compiled(material).uniforms["groundOn"]?.value;

describe("landUseTint", () => {
  it("applies a build's tint, white material, shown by default", () => {
    // WHY: the default look (owner Q6) is the tint on in the plain and slope
    // grounds; the material must be white under it, or the neutral is squared.
    const material = groundMaterial();
    const control = landUseTint(material);
    control.setTint(tintOf());
    expect(control.showing()).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(groundOn(material)).toBe(1);
    expect(material.customProgramCacheKey()).toContain("ground-tint");
  });

  it("hides it for the layer switch and the height ramp, without changing the colour", () => {
    // WHY: the e2e luma and chroma gates run with the switch off and must see
    // exactly today's ground; off is the neutral everywhere on a white material.
    const material = groundMaterial();
    const control = landUseTint(material);
    control.setTint(tintOf());
    control.setWanted(false);
    expect(control.showing()).toBe(false);
    expect(groundOn(material)).toBe(0);
    expect(material.color.getHex()).toBe(0xffffff);
    control.setWanted(true);
    control.setAppearance("ramp");
    expect(control.showing()).toBe(false);
    expect(groundOn(material)).toBe(0);
    control.setAppearance("slope");
    expect(control.showing()).toBe(true);
    expect(groundOn(material)).toBe(1);
  });

  it("starts hidden when the switch is already off at the first build", () => {
    // WHY: a tint arriving after the user switched it off must not flash on.
    const material = groundMaterial();
    const control = landUseTint(material, { wanted: false });
    control.setTint(tintOf());
    expect(control.showing()).toBe(false);
    expect(groundOn(material)).toBe(0);
  });

  it("replaces the previous tint and frees its texture", () => {
    // WHY: every full build brings a new raster; keeping the old texture alive
    // is a GPU leak per rebuild, and the new one must be the one sampled.
    const material = groundMaterial();
    const control = landUseTint(material);
    control.setTint(tintOf());
    const first = compiled(material).uniforms["groundTint"]
      ?.value as THREE.Texture;
    let freed = false;
    first.addEventListener("dispose", () => {
      freed = true;
    });
    control.setTint(tintOf(0x707070));
    const second = compiled(material).uniforms["groundTint"]?.value;
    expect(freed).toBe(true);
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(THREE.Texture);
    // One patch, not two stacked: the fragment declares the sampler once.
    const declarations =
      compiled(material).fragmentShader.match(/uniform sampler2D groundTint;/g)
        ?.length ?? 0;
    expect(declarations).toBe(1);
  });

  it("is a no-op for the same tint again", () => {
    // WHY: a redraw from the cached payload hands the same object back; it must
    // not rebuild a texture per layer toggle.
    const material = groundMaterial();
    const control = landUseTint(material);
    const tint = tintOf();
    control.setTint(tint);
    const texture = compiled(material).uniforms["groundTint"]?.value;
    control.setTint(tint);
    expect(compiled(material).uniforms["groundTint"]?.value).toBe(texture);
  });

  it("gives the material the scheme's ground whenever no tint is applied", () => {
    // WHY: the scheme's ground has one owner in both states; a
    // ground set while a tint is applied must land when the tint goes.
    const material = groundMaterial();
    const control = landUseTint(material);
    control.setGroundColour(0x405060);
    expect(material.color.getHex()).toBe(0x405060);
    control.setTint(tintOf(0x405060));
    control.setGroundColour(0x8899aa);
    expect(material.color.getHex()).toBe(0xffffff);
    control.setTint(undefined);
    expect(control.showing()).toBe(false);
    expect(material.color.getHex()).toBe(0x8899aa);
    expect(material.customProgramCacheKey()).not.toContain("ground-tint");
  });

  it("refuses a ground colour that is not 0xrrggbb", () => {
    // WHY: the colour comes from a scheme table; a typo must fail loudly here
    // rather than paint the ground black.
    const control = landUseTint(groundMaterial());
    for (const bad of [-1, 0x1000000, 1.5, Number.NaN]) {
      expect(() => control.setGroundColour(bad)).toThrow(RangeError);
    }
  });

  it("dispose frees the tint and leaves the ground colour", () => {
    // WHY: the view's dispose must not leave a texture or a white ground behind.
    const material = groundMaterial();
    const control = landUseTint(material);
    control.setTint(tintOf());
    control.dispose();
    expect(control.showing()).toBe(false);
    expect(material.color.getHex()).toBe(GROUND_COLOUR);
    expect(material.customProgramCacheKey()).not.toContain("ground-tint");
  });
});
