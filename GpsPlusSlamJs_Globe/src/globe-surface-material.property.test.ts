/**
 * Why this test matters: the patch must only INSERT. Three's shader source
 * changes between versions (comments, new chunks, reordered defines), and a
 * patch that rewrote or dropped any of it would break lighting in ways no
 * pixel check here would name. So, over random extra lines placed anywhere
 * in three's real shader, the original is always a subsequence of the
 * patched source, and what the patch adds is always the same.
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createGlobeSurfaceUniforms,
  patchGlobeSurfaceShader,
} from "./globe-surface-material.js";

/** Removes `original`'s lines from `patched` in order; null if not a subsequence. */
function added(original: string[], patched: string[]): string[] | null {
  const extra: string[] = [];
  let i = 0;
  for (const line of patched) {
    if (i < original.length && line === original[i]) i += 1;
    else extra.push(line);
  }
  return i === original.length ? extra : null;
}

/** Three's standard shader with `junk` lines spliced in at random places. */
function withJunk(source: string, junk: [number, string][]): string {
  const lines = source.split("\n");
  for (const [at, text] of junk) {
    lines.splice(at % (lines.length + 1), 0, `// ${text}`);
  }
  return lines.join("\n");
}

const textures = () => ({
  night: new THREE.Texture(),
  clouds: new THREE.Texture(),
});

function patch(vertexShader: string, fragmentShader: string) {
  const shader = {
    vertexShader,
    fragmentShader,
    uniforms: {},
  } as THREE.WebGLProgramParametersWithUniforms;
  patchGlobeSurfaceShader(shader, createGlobeSurfaceUniforms(textures()));
  return shader;
}

describe("patchGlobeSurfaceShader, over any surrounding source", () => {
  it("only inserts, and always the same lines", () => {
    const lib = THREE.ShaderLib.standard;
    const reference = patch(lib.vertexShader, lib.fragmentShader);
    const refAdded = {
      vs: added(
        lib.vertexShader.split("\n"),
        reference.vertexShader.split("\n"),
      ),
      fs: added(
        lib.fragmentShader.split("\n"),
        reference.fragmentShader.split("\n"),
      ),
    };
    expect(refAdded.vs?.length).toBeGreaterThan(0);
    expect(refAdded.fs?.length).toBeGreaterThan(0);
    // Junk never contains "#include", so it cannot add or hide an anchor.
    const line = fc
      .string({ maxLength: 20 })
      .filter((t) => !t.includes("#") && !t.includes("\n"));
    const junk = fc.array(fc.tuple(fc.nat(), line), { maxLength: 12 });
    fc.assert(
      fc.property(junk, junk, (vJunk, fJunk) => {
        const vs = withJunk(lib.vertexShader, vJunk);
        const fs = withJunk(lib.fragmentShader, fJunk);
        const out = patch(vs, fs);
        expect(added(vs.split("\n"), out.vertexShader.split("\n"))).toEqual(
          refAdded.vs,
        );
        expect(added(fs.split("\n"), out.fragmentShader.split("\n"))).toEqual(
          refAdded.fs,
        );
      }),
    );
  });
});
