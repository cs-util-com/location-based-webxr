/**
 * Tests for the lightweight water surface (plan 2026-09-23-0048, M4;
 * DEC-SKY-3: "keep the water part very lightweight").
 *
 * Why this file matters: water is a mirror of the sky, so its errors show as
 * the SKY looking wrong on it. A surface that tilts on average reflects a
 * biased sky; slopes that are too steep turn a calm lake into chop; an F0
 * that is not water's makes it read as plastic or glass; detail that does
 * not fade with distance shimmers at the horizon. The GPU half is checked by
 * the look-dev smoke; these check the TS twin every GLSL constant comes from.
 */
import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { AtmosphereHaze } from './atmosphere-haze.js';
import {
  WATER_SURFACE,
  WaterSurface,
  waterNormal,
  waterRoughnessAtDistance,
  waterSlope,
  waterWaveFade,
} from './water-surface-material.js';

/** Run a material's onBeforeCompile on three's real ShaderLib source. */
function compile(material: THREE.Material) {
  const lib = THREE.ShaderLib.physical;
  const shader = {
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe('water optics', () => {
  // Schlick F0 from the index of refraction, the way three computes it
  // (lights_physical_fragment: pow2((ior − 1) / (ior + 1))): water's 0.02,
  // not the 0.04 three assumes for a generic dielectric.
  it('has water F0 (0.02) through three physical ior', () => {
    const { material } = new WaterSurface();
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const f0 = ((material.ior - 1) / (material.ior + 1)) ** 2;
    expect(f0).toBeGreaterThan(0.019);
    expect(f0).toBeLessThan(0.021);
    expect(material.metalness).toBe(0);
  });
});

describe('waterSlope / waterNormal (the TS twin of the shader)', () => {
  it('gives unit normals that point up', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 3600, noNaN: true }),
        (x, z, t) => {
          const n = waterNormal(x, z, t);
          expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 12);
          expect(n[1]).toBeGreaterThan(0.9);
        }
      )
    );
  });

  // Level on average: a mean slope reflects a tilted sky over the whole lake.
  it('is level on average over a patch', () => {
    let sx = 0;
    let sz = 0;
    const n = 64;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const [dx, dz] = waterSlope(i * 3.7, j * 4.1, 12);
        sx += dx;
        sz += dz;
      }
    }
    expect(Math.abs(sx / (n * n))).toBeLessThan(0.01);
    expect(Math.abs(sz / (n * n))).toBeLessThan(0.01);
  });

  // CALM water: the worst-case slope is the sum of every wave's A·k, and it
  // stays below 0.2 (~11°), a lake or harbour, not the open sea.
  it('keeps the steepest possible slope calm', () => {
    const worst = WATER_SURFACE.waves.reduce(
      (sum, w) => sum + (w.amplitudeM * 2 * Math.PI) / w.wavelengthM,
      0
    );
    expect(worst).toBeLessThan(0.2);
    expect(worst).toBeGreaterThan(0.02);
  });

  // Waves move at deep-water speed, c = √(gλ / 2π): a table of free speeds
  // would let a long swell crawl while ripples race.
  it('moves every wave at its deep-water phase speed', () => {
    for (const w of WATER_SURFACE.waves) {
      const expected = Math.sqrt((9.81 * w.wavelengthM) / (2 * Math.PI));
      expect(w.speedMps).toBeCloseTo(expected, 9);
    }
  });

  it('changes over time (the surface scrolls)', () => {
    const a = waterSlope(10, 20, 0);
    const b = waterSlope(10, 20, 1.5);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(1e-3);
  });

  // Two independent layers, not one: a single layer of parallel waves reads
  // as corrugated sheet metal.
  it('has at least two wave directions more than 30° apart', () => {
    const dirs = WATER_SURFACE.waves.map((w) => w.directionDeg);
    const spread = Math.max(...dirs) - Math.min(...dirs);
    expect(spread).toBeGreaterThan(30);
  });
});

describe('filtering (M4 review, finding 7)', () => {
  // EACH WAVE FADES BY ITS OWN PHASE CHANGE PER PIXEL (fwidth in the
  // shader; a footprint in metres here): a wave that changes by more than
  // ~0.8 rad across a pixel is on its way to aliasing into sparkle, and by
  // 1.6 rad it is gone. The first cut faded all six waves together by
  // camera distance, which left the 3.3 m wave shimmering at 200-300 m.
  it('leaves waves alone when the pixel is small, and removes them when it is large', () => {
    for (const [x, z, t] of [
      [3, 4, 1],
      [120, -40, 7.5],
    ] as const) {
      expect(waterSlope(x, z, t, 0)).toEqual(waterSlope(x, z, t));
      const small = waterSlope(x, z, t, 0.2);
      const full = waterSlope(x, z, t);
      expect(small[0]).toBeCloseTo(full[0], 12);
      expect(small[1]).toBeCloseTo(full[1], 12);
      const huge = waterSlope(x, z, t, 100);
      expect(huge[0]).toBe(0);
      expect(huge[1]).toBe(0);
    }
  });

  it('fades the SHORT waves first', () => {
    const shortest = Math.min(...WATER_SURFACE.waves.map((w) => w.wavelengthM));
    const longest = Math.max(...WATER_SURFACE.waves.map((w) => w.wavelengthM));
    const [start, end] = WATER_SURFACE.aliasFadeRad;
    // A footprint where the shortest wave is fully gone and the longest is
    // still fully present.
    const footprint = end / ((2 * Math.PI) / shortest);
    expect(((2 * Math.PI) / longest) * footprint).toBeLessThan(start);
    expect(waterWaveFade((2 * Math.PI) / shortest, footprint)).toBe(0);
    expect(waterWaveFade((2 * Math.PI) / longest, footprint)).toBe(1);
  });

  // Roughness rises with distance: the detail the filter removed reappears
  // as a wider highlight instead of vanishing.
  it('raises roughness monotonically with distance, from near to far', () => {
    const { roughnessNear, roughnessFar, roughnessRampM } = WATER_SURFACE;
    expect(waterRoughnessAtDistance(0)).toBe(roughnessNear);
    expect(waterRoughnessAtDistance(roughnessRampM[1] * 2)).toBe(roughnessFar);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10000, noNaN: true }),
        fc.double({ min: 0, max: 10000, noNaN: true }),
        (a, b) => {
          const [near, far] = a < b ? [a, b] : [b, a];
          expect(waterRoughnessAtDistance(far)).toBeGreaterThanOrEqual(
            waterRoughnessAtDistance(near)
          );
        }
      )
    );
  });

  // three floors roughness in its physical lighting; a smaller near value
  // would be fiction (the twin would say 0.04, the GPU draws 0.0525). Read
  // from three's own chunk so an upgrade that moves the floor is noticed.
  it('keeps the near roughness above three physical-lighting floor', () => {
    const chunk = THREE.ShaderChunk.lights_physical_fragment;
    const marker = 'max( roughnessFactor, ';
    const at = chunk.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const floor = Number.parseFloat(chunk.slice(at + marker.length));
    expect(floor).toBeGreaterThan(0.05);
    expect(WATER_SURFACE.roughnessNear).toBeGreaterThanOrEqual(floor);
  });
});

describe('WaterSurface (the material)', () => {
  it('patches three physical shader: world position out, normal and roughness in', () => {
    const water = new WaterSurface();
    const shader = compile(water.material);
    expect(shader.vertexShader).toContain('vWaterWorldXZ');
    expect(shader.fragmentShader).toContain('waterSlopeAt');
    expect(shader.fragmentShader).toContain(
      'roughnessFactor = max(roughnessFactor'
    );
    expect(shader.uniforms.uWaterTime).toBe(water.uniforms.uWaterTime);
  });

  it('advances time by update(), and rejects bad input', () => {
    const water = new WaterSurface();
    water.update(0.5);
    water.update(0.25);
    expect(water.uniforms.uWaterTime.value).toBeCloseTo(0.75, 12);
    expect(() => water.update(-1)).toThrow(RangeError);
    expect(() => water.update(Number.NaN)).toThrow(RangeError);
  });

  it('takes a depth tint and rejects a non-finite one', () => {
    const water = new WaterSurface({ tint: new THREE.Color(0.1, 0.2, 0.25) });
    expect(water.material.color.g).toBeCloseTo(0.2, 12);
    expect(
      () => new WaterSurface({ tint: new THREE.Color(Number.NaN, 0, 0) })
    ).toThrow(RangeError);
  });

  // "Haze applied like any other material" (plan §4.2): the haze chains after
  // the water patch and both survive in one program.
  it('takes the atmosphere haze like any lit material', () => {
    const water = new WaterSurface();
    const haze = new AtmosphereHaze({ visibilityKm: 45 });
    haze.apply(water.material);
    const shader = compile(water.material);
    expect(shader.fragmentShader).toContain('waterSlopeAt');
    expect(shader.fragmentShader).toContain('atmHazeKeep');
  });
});
