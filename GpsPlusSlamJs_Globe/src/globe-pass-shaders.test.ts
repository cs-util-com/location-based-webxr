/**
 * The shader programs of the Globe's sky passes, pinned by hash.
 *
 * Why this file matters: the passes share scaffolding (the full-screen
 * triangle, its camera, the scene-depth reconstruction), and moving that
 * scaffolding into shared modules must leave every program the GPU
 * compiles exactly as it was. Under Node no program is compiled, so this
 * test records every shader material each pass builds (vertex and fragment
 * source, GLSL version, defines, uniform names) and pins a SHA-256 of
 * them. A pure move keeps every hash; a deliberate shader change updates
 * the hash in the same commit, where the diff of the GLSL shows why.
 */
import { createHash } from "node:crypto";

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({ materials: [] as unknown[] }));

vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof THREE>();
  class ShaderMaterial extends three.ShaderMaterial {
    constructor(parameters?: THREE.ShaderMaterialParameters) {
      super(parameters);
      recorded.materials.push(this);
    }
  }
  class RawShaderMaterial extends three.RawShaderMaterial {
    constructor(parameters?: THREE.ShaderMaterialParameters) {
      super(parameters);
      recorded.materials.push(this);
    }
  }
  return { ...three, ShaderMaterial, RawShaderMaterial };
});

import { createGlobeAtmosphere } from "./globe-atmosphere.js";
import { createGlobeGroundSky } from "./globe-ground-sky.js";

/** A float-capable renderer that draws nothing. */
const fakeRenderer = (): THREE.WebGLRenderer => {
  let target: THREE.WebGLRenderTarget | null = null;
  return {
    extensions: { has: () => true },
    domElement: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    render: () => undefined,
  } as unknown as THREE.WebGLRenderer;
};

/** The count and SHA-256 of the programs of the materials `build` creates. */
function programsOf(build: () => void): { count: number; hash: string } {
  const from = recorded.materials.length;
  build();
  const made = recorded.materials.slice(from) as THREE.ShaderMaterial[];
  const programs = made.map((m) => ({
    raw: m instanceof THREE.RawShaderMaterial,
    glslVersion: m.glslVersion,
    defines: m.defines,
    uniforms: Object.keys(m.uniforms).sort(),
    vertexShader: m.vertexShader,
    fragmentShader: m.fragmentShader,
  }));
  const hash = createHash("sha256")
    .update(JSON.stringify(programs))
    .digest("hex");
  return { count: made.length, hash };
}

describe("the Globe sky passes' shader programs", () => {
  it("are the pinned programs", () => {
    const renderer = fakeRenderer();
    expect({
      groundSky: programsOf(() => createGlobeGroundSky(renderer)),
      atmosphere: programsOf(() =>
        createGlobeAtmosphere(renderer, [6378137, 6378137, 6356752.314245]),
      ),
    }).toEqual({
      groundSky: {
        count: 3,
        hash: "f8cebb0372bc710b9fc46d4dde7c3bd90f62355858c174f9b15442d19f49adab",
      },
      atmosphere: {
        count: 1,
        hash: "d9f57f3cc93ec62e1cfb27aa1ee09842598bd7022dad41e9cd6bb77c3d67a606",
      },
    });
  });
});
