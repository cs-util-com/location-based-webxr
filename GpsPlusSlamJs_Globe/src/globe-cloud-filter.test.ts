/**
 * Why this test matters: the cloud map's B-spline (round-3 plan
 * 2026-10-08-2345 M1) is read in four bilinear taps, a rewrite of the
 * sixteen-texel sum that is easy to get subtly wrong (an offset by half a
 * texel shifts every cloud; a wrong share blurs or rings). The CPU twin,
 * fed through a simulated bilinear tap, must equal the sixteen-texel sum
 * exactly, and the GLSL must be the twin's formula.
 */
import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { CLOUD_VOLUME_COVERAGE_GLSL } from "./globe-cloud-volume.js";
import {
  createGlobeSurfaceUniforms,
  patchGlobeSurfaceShader,
} from "./globe-surface-material.js";
import {
  GLOBE_CLOUD_FILTER_GLSL,
  bsplineTaps,
  bsplineWeights,
} from "./globe-cloud-filter.js";

/** A texel of a w x h grid, wrapping in x and clamped in y (the map's). */
const texel = (g: number[], w: number, h: number, x: number, y: number) =>
  g[Math.min(h - 1, Math.max(0, y)) * w + (((x % w) + w) % w)] ?? NaN;

/** A bilinear tap at a position in texels (centres at i + 0.5). */
function bilinear(g: number[], w: number, h: number, x: number, y: number) {
  const sx = x - 0.5;
  const sy = y - 0.5;
  const i = Math.floor(sx);
  const j = Math.floor(sy);
  const fx = sx - i;
  const fy = sy - j;
  const row = (jj: number) =>
    texel(g, w, h, i, jj) * (1 - fx) + texel(g, w, h, i + 1, jj) * fx;
  return row(j) * (1 - fy) + row(j + 1) * fy;
}

/** The sixteen-texel B-spline at a position in texels. */
function reference(g: number[], w: number, h: number, x: number, y: number) {
  const sx = x - 0.5;
  const sy = y - 0.5;
  const i = Math.floor(sx);
  const j = Math.floor(sy);
  const wx = bsplineWeights(sx - i);
  const wy = bsplineWeights(sy - j);
  let sum = 0;
  for (let b = 0; b < 4; b++) {
    for (let a = 0; a < 4; a++) {
      sum += wx[a]! * wy[b]! * texel(g, w, h, i - 1 + a, j - 1 + b);
    }
  }
  return sum;
}

/** The four-tap form, as the shader computes it. */
function fourTaps(g: number[], w: number, h: number, x: number, y: number) {
  const tx = bsplineTaps(x);
  const ty = bsplineTaps(y);
  const tap = (a: number, b: number) => bilinear(g, w, h, tx.at[a]!, ty.at[b]!);
  const top = tap(0, 0) * tx.share + tap(1, 0) * (1 - tx.share);
  const bottom = tap(0, 1) * tx.share + tap(1, 1) * (1 - tx.share);
  return top * ty.share + bottom * (1 - ty.share);
}

describe("the cloud map's B-spline", () => {
  it("has four weights that are never negative and sum to 1", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (t) => {
          const w = bsplineWeights(t);
          expect(w.every((v) => v >= 0)).toBe(true);
          expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        },
      ),
    );
  });

  it("in four bilinear taps equals the sixteen-texel sum, anywhere on any map", () => {
    const w = 8;
    const h = 6;
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: w * h,
          maxLength: w * h,
        }),
        // The whole map, the clamped rows (the poles) and the wrapped
        // columns (the 180 degree seam) included: each tap reads exactly
        // its own two texels, so clamping per tap equals clamping per texel.
        fc.double({ min: 0, max: w, maxExcluded: true, noNaN: true }),
        fc.double({ min: 0, max: h, maxExcluded: true, noNaN: true }),
        (g, x, y) => {
          expect(fourTaps(g, w, h, x, y)).toBeCloseTo(
            reference(g, w, h, x, y),
            10,
          );
        },
      ),
    );
  });

  it("is smooth where bilinear has a kink: the slope is continuous across a texel centre", () => {
    // One bright texel: bilinear's slope jumps at its centre; the
    // B-spline's does not.
    const w = 9;
    const h = 9;
    const g = Array.from({ length: w * h }, (_, i) =>
      i === 4 * w + 4 ? 1 : 0,
    );
    const slope = (f: typeof reference, x: number) =>
      (f(g, w, h, x + 1e-4, 4.5) - f(g, w, h, x - 1e-4, 4.5)) / 2e-4;
    const kink = (f: typeof reference) =>
      Math.abs(slope(f, 4.5 + 1e-3) - slope(f, 4.5 - 1e-3));
    expect(kink(bilinear)).toBeGreaterThan(1);
    expect(kink(fourTaps)).toBeLessThan(0.01);
  });

  it("carries the twin's formula into GLSL", () => {
    // The weights, the tap positions and the shares as the twin has them.
    for (const piece of [
      "vec4( 1.0, 2.0, 3.0, 4.0 ) - t",
      "vec2 st = uv * size - 0.5;",
      "vec4( -0.5, 1.5, -0.5, 1.5 )",
      "vec4( wx.yw, wy.yw ) / g",
      "share = vec2( g.x / ( g.x + g.y ), g.z / ( g.z + g.w ) );",
      "float globeCloudCubic( sampler2D map, vec2 uv, vec2 dx, vec2 dy )",
      "float globeCloudCubicLod( sampler2D map, vec2 uv )",
      // Which tap is which, and the order they are mixed in: the twin's
      // (first x tap weighted by share.x, first y row by share.y). The
      // M1 review checked this by hand; a swap would pass the rest.
      "float a = textureGrad( map, at.xz, dx, dy ).r;",
      "float b = textureGrad( map, at.yz, dx, dy ).r;",
      "float c = textureGrad( map, at.xw, dx, dy ).r;",
      "float d = textureGrad( map, at.yw, dx, dy ).r;",
      "return mix( mix( d, c, share.x ), mix( b, a, share.x ), share.y );",
    ]) {
      expect(GLOBE_CLOUD_FILTER_GLSL).toContain(piece);
    }
  });
});

/**
 * The lines a GLSL preprocessor keeps, for the one macro the filter guards
 * itself with: `#ifndef` / `#ifdef` of a name, `#define`, `#endif`; any
 * other `#if` is kept as true (what matters here is the guard alone).
 */
function activeLines(source: string): string[] {
  const defined = new Set<string>();
  const stack: boolean[] = [];
  const kept: string[] = [];
  for (const line of source.split("\n")) {
    const t = line.trim();
    const live = stack.every(Boolean);
    const ifndef = /^#ifndef\s+(\w+)/.exec(t);
    const ifdef = /^#ifdef\s+(\w+)/.exec(t);
    if (ifndef) stack.push(!defined.has(ifndef[1]!));
    else if (ifdef) stack.push(defined.has(ifdef[1]!));
    else if (/^#if\b/.test(t)) stack.push(true);
    else if (/^#endif\b/.test(t)) stack.pop();
    else if (live) {
      const def = /^#define\s+(\w+)/.exec(t);
      if (def) defined.add(def[1]!);
      kept.push(line);
    }
  }
  return kept;
}

describe("the filter in a program that includes it twice", () => {
  // Why (M1 milestone review, finding 1): a relief tile's program carries
  // the globe surface's declarations AND the volume shadow's coverage
  // chunk, and both include the filter. Without its guard the program
  // declared `uCloudCubic` and the cubic functions twice, which GLSL
  // rejects: every relief tile's shader failed to compile on the lab's
  // default page. Composed here as the relief and the framework's cloud
  // shadow compose it (the chunk before `main`).
  it("declares its uniform and functions once", () => {
    const lib = THREE.ShaderLib.standard;
    const shader = {
      vertexShader: lib.vertexShader,
      fragmentShader: lib.fragmentShader,
      uniforms: THREE.UniformsUtils.clone(lib.uniforms),
    } as THREE.WebGLProgramParametersWithUniforms;
    patchGlobeSurfaceShader(
      shader,
      createGlobeSurfaceUniforms({
        night: new THREE.Texture(),
        clouds: new THREE.Texture(),
      }),
    );
    const composed = shader.fragmentShader.replace(
      "void main() {",
      `${CLOUD_VOLUME_COVERAGE_GLSL}\nvoid main() {`,
    );
    expect(composed.split(GLOBE_CLOUD_FILTER_GLSL).length - 1).toBe(2);
    const active = activeLines(composed).join("\n");
    const count = (needle: string) => active.split(needle).length - 1;
    expect(count("uniform float uCloudCubic;")).toBe(1);
    expect(count("vec4 globeCubicWeights(")).toBe(1);
    expect(count("float globeCloudCubic(")).toBe(1);
    expect(count("float globeCloudCubicLod(")).toBe(1);
  });
});
