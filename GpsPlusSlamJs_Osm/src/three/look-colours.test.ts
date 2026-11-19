import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { LOOK_COLOUR_DECODE, type MeshChunk } from "../mesh/chunk-meshes.js";
import { buildingObjects, roadObjects } from "./city-objects.js";
import {
  applyLookColours,
  createLookMix,
  lookDecodeTexture,
  setTrimWeights,
} from "./look-colours.js";

/** The shader chunks the patch hooks, as three's standard material has them. */
function shader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <color_fragment>",
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

/** A one-triangle chunk carrying `looks` look colour buffers. */
function chunk(looks: number): MeshChunk {
  return {
    mesh: {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      indices: Uint32Array.from([0, 1, 2]),
    },
    colors: new Float32Array(9).fill(0.5),
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    ...(looks === 0
      ? {}
      : {
          lookColours: Array.from({ length: looks }, (_, k) =>
            new Uint8Array(9).fill(40 * (k + 1)),
          ),
        }),
  } as unknown as MeshChunk;
}

describe("createLookMix and setTrimWeights", () => {
  // WHY: the mix is ONE uniform object every chunk material holds, so one
  // write per sun step moves the whole city; it starts on look 0 at weight
  // 1, which draws what a fixed build of look 0 draws.
  it("starts on look 0 and pads missing looks with 0", () => {
    const mix = createLookMix();
    expect(mix.trimWeights.value.toArray()).toEqual([1, 0, 0, 0]);
    setTrimWeights(mix, [0.25, 0.75]);
    expect(mix.trimWeights.value.toArray()).toEqual([0.25, 0.75, 0, 0]);
  });

  // WHY: trim-folded weights are a look weight times a brightness trim, so
  // they need not sum to 1, but a NaN, a negative or a fifth look would
  // reach the shader as a black or wrong city with no error anywhere.
  it("refuses non-finite, negative, empty and over-long weights", () => {
    const mix = createLookMix();
    for (const bad of [[Number.NaN], [-0.1], [], [1, 0, 0, 0, 0], [Infinity]]) {
      expect(() => setTrimWeights(mix, bad)).toThrow(RangeError);
    }
    expect(mix.trimWeights.value.toArray()).toEqual([1, 0, 0, 0]);
    expect(() => setTrimWeights(mix, [1.2, 0.3])).not.toThrow();
  });
});

describe("lookDecodeTexture", () => {
  // WHY: the shader decodes a code with this texture rather than with an
  // sRGB formula of its own, so the GPU uses exactly the table the CPU
  // decode (`decodeLookColours`) uses: frame equality at weight 1 rests on
  // it. One texture serves every material and city, so it is never freed.
  it("holds LOOK_COLOUR_DECODE as a 256x2 nearest float texture, shared", () => {
    const texture = lookDecodeTexture();
    expect(texture).toBe(lookDecodeTexture());
    expect(texture.image.width).toBe(256);
    expect(texture.image.height).toBe(2);
    expect(texture.type).toBe(THREE.FloatType);
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(Array.from(texture.image.data as Float32Array)).toEqual(
      Array.from(LOOK_COLOUR_DECODE),
    );
  });
});

describe("applyLookColours", () => {
  // WHY: the K Uint8 codes replace the Float32 colours (a quarter of the
  // bytes per look); normalised, so the shader reads code / 255 and finds
  // the decode texel by rounding back.
  it("adds one normalised Uint8 attribute per look and drops `color`", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    const material = new THREE.MeshStandardMaterial({ vertexColors: true });
    const codes = [new Uint8Array(9), new Uint8Array(9).fill(7)];
    applyLookColours(geometry, material, codes, "linear", createLookMix());
    expect(geometry.getAttribute("color")).toBeUndefined();
    for (const [k, array] of codes.entries()) {
      const attribute = geometry.getAttribute(`lookColour${k}`);
      expect(attribute).toBeInstanceOf(THREE.BufferAttribute);
      expect(attribute.array).toBe(array);
      expect(attribute.itemSize).toBe(3);
      expect(attribute.normalized).toBe(true);
    }
    expect(material.vertexColors).toBe(false);
  });

  // WHY: the mix is per vertex, decoded in the vertex shader and multiplied
  // where three's vertex colour would be, so lighting, fog and the noon gain
  // (the material colour) apply exactly as for the fixed build.
  it("decodes and mixes in the vertex shader, multiplies after color_fragment", () => {
    const material = new THREE.MeshStandardMaterial();
    const mix = createLookMix();
    applyLookColours(
      new THREE.BufferGeometry(),
      material,
      [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)],
      "raw",
      mix,
    );
    const s = shader();
    material.onBeforeCompile(s, {} as THREE.WebGLRenderer);
    expect(s.vertexShader).toContain("attribute vec3 lookColour2;");
    expect(s.vertexShader).not.toContain("lookColour3");
    expect(s.vertexShader).toContain(
      "trimWeights.z * lookDecoded(lookColour2)",
    );
    expect(s.vertexShader).toContain("#define LOOK_DECODE_ROW 1");
    expect(s.vertexShader).toContain("texelFetch(lookDecode");
    expect(s.fragmentShader).toContain(
      "#include <color_fragment>\ndiffuseColor.rgb *= vLookColour;",
    );
    expect(s.uniforms["trimWeights"]).toBe(mix.trimWeights);
    expect((s.uniforms["lookDecode"] as { value: unknown }).value).toBe(
      lookDecodeTexture(),
    );
  });

  // WHY: three caches compiled programs by this key; one key for two look
  // counts or two decode rows would hand a road the building program.
  it("keys the program by look count and decode row", () => {
    const keyOf = (looks: number, decode: "linear" | "raw"): string => {
      const material = new THREE.MeshStandardMaterial();
      applyLookColours(
        new THREE.BufferGeometry(),
        material,
        Array.from({ length: looks }, () => new Uint8Array(3)),
        decode,
        createLookMix(),
      );
      return material.customProgramCacheKey();
    };
    const keys = new Set([
      keyOf(1, "linear"),
      keyOf(2, "linear"),
      keyOf(2, "raw"),
      keyOf(4, "raw"),
    ]);
    expect(keys.size).toBe(4);
    expect(keyOf(2, "raw")).toBe(keyOf(2, "raw"));
  });

  // WHY: the city materials may carry another patch; replacing its hook
  // would silently drop that patch, and a key without the earlier one would
  // share a program with a material that lacks it.
  it("chains a hook and a cache key already on the material", () => {
    const material = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    material.onBeforeCompile = (s) => {
      calls.push("earlier");
      s.vertexShader += "\n// earlier patch";
    };
    material.customProgramCacheKey = () => "earlier-key";
    applyLookColours(
      new THREE.BufferGeometry(),
      material,
      [new Uint8Array(3)],
      "linear",
      createLookMix(),
    );
    const s = shader();
    material.onBeforeCompile(s, {} as THREE.WebGLRenderer);
    expect(calls).toEqual(["earlier"]);
    expect(s.vertexShader).toContain("// earlier patch");
    expect(s.vertexShader).toContain("attribute vec3 lookColour0;");
    expect(material.customProgramCacheKey()).toBe(
      "earlier-key|look-colours-1-0",
    );
  });

  // WHY: a mismatch would draw garbage from a short buffer or skip looks;
  // the geometry's vertex count is the contract the builder kept.
  it("refuses no looks, more than four, and a buffer of the wrong length", () => {
    const geometry = (): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(9), 3),
      );
      return g;
    };
    const material = new THREE.MeshStandardMaterial();
    const mix = createLookMix();
    expect(() =>
      applyLookColours(geometry(), material, [], "linear", mix),
    ).toThrow(RangeError);
    expect(() =>
      applyLookColours(
        geometry(),
        material,
        Array.from({ length: 5 }, () => new Uint8Array(9)),
        "linear",
        mix,
      ),
    ).toThrow(RangeError);
    expect(() =>
      applyLookColours(
        geometry(),
        material,
        [new Uint8Array(6)],
        "linear",
        mix,
      ),
    ).toThrow(RangeError);
  });
});

describe("buildingObjects and roadObjects with looks", () => {
  // WHY: a chunk carrying looks draws them only when the app passes a mix;
  // without one (the globe, a fixed scheme) the chunk's `colors` draw as
  // before, so the option changes nothing for a consumer that ignores it.
  it("uses the look attributes only when a mix is given", () => {
    const mix = createLookMix();
    const [plain] = buildingObjects([chunk(2)]);
    expect(plain?.geometry.getAttribute("color")).toBeDefined();
    expect(plain?.geometry.getAttribute("lookColour0")).toBeUndefined();
    const [looked] = buildingObjects([chunk(2)], { looks: mix });
    expect(looked?.geometry.getAttribute("color")).toBeUndefined();
    expect(looked?.geometry.getAttribute("lookColour1")).toBeDefined();
    expect(looked?.userData["solid"]).toBe(true);
    const [noLooks] = buildingObjects([chunk(0)], { looks: mix });
    expect(noLooks?.geometry.getAttribute("color")).toBeDefined();
  });

  // WHY: buildings' colours are linear and roads' raw (today's two
  // pipelines), so the two layers decode on different rows; one row for
  // both would shift one layer's colours at weight 1.
  it("decodes buildings on the linear row and roads on the raw row", () => {
    const mix = createLookMix();
    const rowOf = (object: THREE.Mesh | undefined): string => {
      const s = shader();
      (object?.material as THREE.Material).onBeforeCompile(
        s,
        {} as THREE.WebGLRenderer,
      );
      return /#define LOOK_DECODE_ROW (\d)/.exec(s.vertexShader)?.[1] ?? "";
    };
    expect(rowOf(buildingObjects([chunk(1)], { looks: mix })[0])).toBe("0");
    expect(rowOf(roadObjects([chunk(1)], { looks: mix })[0])).toBe("1");
  });
});
