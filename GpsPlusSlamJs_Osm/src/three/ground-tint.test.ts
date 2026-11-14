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

  // WHY: a rebuild applies and disposes a tint on the same material every
  // full pass. Restoring a BOUND copy of the hooks left a new wrapper in their
  // place each time, so the chain behind `onBeforeCompile` and the cache key
  // grew by one function per rebuild. Dispose must put back the originals.
  it("restores the material's own hooks, not copies, after any number of rebuilds", () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const hook = material.onBeforeCompile;
    const key = material.customProgramCacheKey;
    for (let i = 0; i < 3; i++) applyGroundTint(material, tint()).dispose();
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
  });

  // WHY: three.js runs `onBeforeCompile` only when a material has no
  // program for its cache key yet, and then keeps the uniforms of THAT
  // compile. A rebuild drops one tint and applies the next under the same key,
  // so the program compiled for the first tint is reused: before this was
  // fixed it sampled the first tint, freed (a null texture), and the ground
  // went dark after every rebuild (colour schemes plan 2026-11-10-0841, the
  // switch e2e). The uniforms bound at the first compile must carry the
  // current tint.
  it("feeds a later tint to the program compiled for an earlier one", () => {
    const material = new THREE.MeshStandardMaterial();
    const first = applyGroundTint(material, tint());
    const compiled = shader();
    material.onBeforeCompile(compiled, {} as THREE.WebGLRenderer);
    first.dispose();
    const next = tint({ originX: 10, palette: [0x112233, 0xff0000, 0x00ff00] });
    const second = applyGroundTint(material, next, { enabled: false });
    const u = compiled.uniforms;
    expect(u["groundTint"]?.value).toBeInstanceOf(THREE.DataTexture);
    expect(u["groundOrigin"]?.value).toEqual(new THREE.Vector2(10, -2));
    const neutral = new THREE.Color(0x112233);
    expect(u["groundNeutral"]?.value).toEqual(
      new THREE.Vector3(neutral.r, neutral.g, neutral.b),
    );
    expect(u["groundOn"]?.value).toBe(0);
    // A stale handle no longer reaches the live tint.
    first.setEnabled(true);
    first.dispose();
    expect(u["groundOn"]?.value).toBe(0);
    expect(u["groundTint"]?.value).toBeInstanceOf(THREE.DataTexture);
    second.setEnabled(true);
    expect(u["groundOn"]?.value).toBe(1);
  });

  it.each([-1, Number.NaN])("refuses fade %s", (fadeM) => {
    expect(() =>
      applyGroundTint(new THREE.MeshStandardMaterial(), tint(), { fadeM }),
    ).toThrow(RangeError);
  });
});
