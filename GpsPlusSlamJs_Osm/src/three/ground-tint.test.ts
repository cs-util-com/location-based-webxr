import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { GroundTint } from "../mesh/ground-tint.js";
import {
  applyGroundTint,
  GROUND_TINT_FADE_M,
  groundTintTexture,
} from "./ground-tint.js";

/** A 2 x 2 tint: south row ground and class 1, north row class 2 twice. */
function tint(over: Partial<GroundTint> = {}): GroundTint {
  return {
    width: 2,
    height: 2,
    texelM: 2,
    originX: -2,
    originY: -2,
    classes: Uint8Array.from([0, 1, 2, 2]),
    palette: [0x6b7280, 0xff0000, 0x00ff00],
    shares: {},
    skipped: 0,
    ...over,
  };
}

/** The shader chunks the patch hooks, as three's standard material has them. */
function shader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>",
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe("groundTintTexture", () => {
  // WHY: the spike chose an RGBA8 texture with mipmaps over an R8 class
  // index (the index cannot be filtered, so its edges alias); the bytes are
  // sRGB and row 0 is the south edge, as the rasteriser writes it.
  it("expands classes to sRGB bytes, south row first, mipmapped", () => {
    const texture = groundTintTexture(tint());
    const data = texture.image.data as Uint8Array;
    expect([...data.subarray(0, 8)]).toEqual([
      0x6b, 0x72, 0x80, 255, 0xff, 0, 0, 255,
    ]);
    expect([...data.subarray(8, 12)]).toEqual([0, 0xff, 0, 255]);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });

  // WHY: a class byte the palette lacks would sample black; it reads as the
  // neutral ground instead, and a size mismatch is refused outright.
  it("paints an unknown class as ground and refuses a size mismatch", () => {
    const data = groundTintTexture(
      tint({ classes: Uint8Array.from([9, 9, 9, 9]) }),
    ).image.data as Uint8Array;
    expect([...data.subarray(0, 3)]).toEqual([0x6b, 0x72, 0x80]);
    expect(() => groundTintTexture(tint({ width: 3 }))).toThrow(RangeError);
  });
});

describe("applyGroundTint", () => {
  // WHY: the patch is O2's: world xz to ENU (north is minus z), the tint
  // multiplies the diffuse colour, fading to the neutral ground at the
  // window's edge, so the material's own colour must be white while it is on.
  it("patches the shader, keeps a prior hook, and whitens the material", () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    let priorRan = false;
    material.onBeforeCompile = () => {
      priorRan = true;
    };
    applyGroundTint(material, tint());
    expect(material.color.getHex()).toBe(0xffffff);
    const s = shader();
    material.onBeforeCompile(s, {} as THREE.WebGLRenderer);
    expect(priorRan).toBe(true);
    expect(s.vertexShader).toContain("vGroundXZ = (modelMatrix");
    expect(s.fragmentShader).toContain("vec2(vGroundXZ.x, -vGroundXZ.y)");
    expect(s.fragmentShader).toContain(
      "diffuseColor.rgb *= mix(groundNeutral, groundPaint, groundInside)",
    );
    expect(s.uniforms["groundFade"]?.value).toBe(GROUND_TINT_FADE_M);
    expect(s.uniforms["groundSize"]?.value).toEqual(new THREE.Vector2(4, 4));
    expect(material.customProgramCacheKey()).toContain("ground-tint");
  });

  // WHY: the layer switch toggles a uniform (no recompile). Off, the patch
  // multiplies by the neutral everywhere, which IS the plain ground, so the
  // material stays white (a neutral colour there would square it, darker).
  it("switches off to the neutral ground and frees the texture", () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x334455 });
    const applied = applyGroundTint(material, tint(), { enabled: false });
    const s = shader();
    material.onBeforeCompile(s, {} as THREE.WebGLRenderer);
    expect(s.uniforms["groundOn"]?.value).toBe(0);
    expect(material.color.getHex()).toBe(0xffffff);
    applied.setEnabled(true);
    expect(s.uniforms["groundOn"]?.value).toBe(1);
    expect(material.color.getHex()).toBe(0xffffff);
    applied.dispose();
    expect(material.color.getHex()).toBe(0x334455);
    const plain = shader();
    material.onBeforeCompile(plain, {} as THREE.WebGLRenderer);
    expect(plain.fragmentShader).not.toContain("groundTint");
    expect(material.customProgramCacheKey()).not.toContain("ground-tint");
  });

  it.each([-1, Number.NaN])("refuses fade %s", (fadeM) => {
    expect(() =>
      applyGroundTint(new THREE.MeshStandardMaterial(), tint(), { fadeM }),
    ).toThrow(RangeError);
  });
});
