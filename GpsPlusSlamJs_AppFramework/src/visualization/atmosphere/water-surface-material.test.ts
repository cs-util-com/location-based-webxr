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
import { createHash } from 'node:crypto';

import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { AtmosphereHaze } from './atmosphere-haze.js';
import { CloudShadow } from './cloud-shadow.js';
import { WATER_POLISH_SWITCHES } from './water-polish.js';
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

// WHY (W6 plan, the water candidates, programme plan 2026-09-26-0539): the
// look-dev page lets the owner rate replacement wave sets on the pond. A
// candidate supplies its own `waterSlopeAt`, which must REPLACE the six
// built-in waves (not add to them), and must get its own shader program:
// three shares programs between materials whose onBeforeCompile source is
// equal, so two surfaces that differ only in their GLSL would otherwise draw
// the same waves, silently.
describe('WaterSurface with a custom slope (slopeGlsl)', () => {
  const custom = (tag: string) =>
    `vec2 waterSlopeAt(vec2 p, float t) { return vec2(0.0); } // ${tag}`;

  it('replaces the built-in waves with the given waterSlopeAt', () => {
    const shader = compile(
      new WaterSurface({ slopeGlsl: custom('CANDIDATE-A') }).material
    );
    expect(shader.fragmentShader).toContain('CANDIDATE-A');
    // The built-in set's wave calls are gone (their helper is not emitted).
    expect(shader.fragmentShader).not.toContain('void waterWave(');
    // The rest of the patch stays: the normal and the roughness.
    expect(shader.fragmentShader).toContain(
      'roughnessFactor = max(roughnessFactor'
    );
    expect(shader.vertexShader).toContain('vWaterWorldXZ');
  });

  it('gives each distinct slope its own program key, also under the haze', () => {
    const key = (glsl?: string) => {
      const water =
        glsl === undefined
          ? new WaterSurface()
          : new WaterSurface({ slopeGlsl: glsl });
      new AtmosphereHaze({ visibilityKm: 45 }).apply(water.material);
      return water.material.customProgramCacheKey();
    };
    const a = key(custom('A'));
    expect(key(custom('A'))).toBe(a);
    expect(key(custom('B'))).not.toBe(a);
    expect(key()).not.toBe(a);
  });

  it('refuses GLSL that does not define waterSlopeAt', () => {
    expect(
      () => new WaterSurface({ slopeGlsl: 'vec2 somethingElse() {}' })
    ).toThrow(RangeError);
  });
});

// WHY (round-3 stream W, DEC-FB3-9): the water polish must leave the owner's
// P50 water EXACTLY as it was while every one of its switches is off, so a
// judgement "P50 alone" is a judgement of today's water. The patch only
// replaces anchors, so its whole contribution shows on a synthetic shader
// made of those anchors, independent of three's own chunk text (a three
// upgrade does not move these pins). The pins were taken from the water
// BEFORE the polish existed (webxr 542ac053): equal source means three
// builds the same program, so the pixels are byte-identical.
describe('WaterSurface before the polish (pinned)', () => {
  const ANCHORS = {
    vertex: ['#include <common>', '#include <project_vertex>'].join('\n'),
    fragment: [
      '#include <common>',
      '#include <lights_physical_pars_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <normal_fragment_maps>',
      '#include <lights_physical_fragment>',
      '#include <lights_fragment_begin>',
    ].join('\n'),
  };
  const patched = (water: WaterSurface) => {
    const shader = {
      uniforms: {},
      vertexShader: ANCHORS.vertex,
      fragmentShader: ANCHORS.fragment,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    water.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return {
      hash: createHash('sha256')
        .update(`${shader.vertexShader}\n//--\n${shader.fragmentShader}`)
        .digest('hex'),
      uniforms: Object.keys(shader.uniforms).sort(),
      key: water.material.customProgramCacheKey(),
    };
  };
  const STUB = 'vec2 waterSlopeAt(vec2 p, float t) { return vec2(0.0); } // P';

  it('patches the built-in waves as before the polish', () => {
    expect(patched(new WaterSurface())).toEqual({
      hash: 'db3fd51b9b1915776f7731677e898fd1e74b3fb04a4fd52c134e05956daf2004',
      uniforms: ['uWaterTime'],
      key: 'water-surface|built-in',
    });
  });

  it('patches a custom slope as before the polish', () => {
    expect(patched(new WaterSurface({ slopeGlsl: STUB }))).toEqual({
      hash: 'e016e8f7d559219d9bfe41e149bf4e1a992d825123f153742514aa14abe20171',
      uniforms: ['uWaterTime'],
      key: `water-surface|${STUB}`,
    });
  });
});

// WHY (round-3 stream W, DEC-FB3-9): each polish switch reaches the real
// three shader (its anchors exist there), gets its own program (three
// shares programs by key, so a switch missing from the key would draw the
// unpolished water, silently), binds its uniforms, and chains under the
// haze and the cloud shadows the look-dev page applies after it.
describe('WaterSurface with the polish', () => {
  const STUB_WAVES = `void waterWave(vec2 q, float t, vec2 d, float k, float ak, float w, float phase, inout vec2 slope) {
  float ph = k * dot(d, q);
  float fade = 1.0 - smoothstep(0.8, 1.6, fwidth(ph));
  slope += fade * ak * cos(ph - w * t + phase) * d;
}
vec2 waterSlopeAt(vec2 p, float t) {
  vec2 slope = vec2(0.0);
  waterWave(p, t, vec2(1.0, 0.0), 4.0, 0.06, 6.2, 0.0, slope);
  return slope;
}`;

  it('with every switch named off, is the unpolished water', () => {
    const allOff = Object.fromEntries(
      WATER_POLISH_SWITCHES.map((name) => [name, false])
    );
    for (const slopeGlsl of [undefined, STUB_WAVES]) {
      const plain = new WaterSurface(slopeGlsl ? { slopeGlsl } : {});
      const off = new WaterSurface({
        ...(slopeGlsl ? { slopeGlsl } : {}),
        polish: allOff,
      });
      const a = compile(plain.material);
      const b = compile(off.material);
      expect(b.fragmentShader).toBe(a.fragmentShader);
      expect(b.vertexShader).toBe(a.vertexShader);
      expect(Object.keys(b.uniforms).sort()).toEqual(
        Object.keys(a.uniforms).sort()
      );
      expect(off.material.customProgramCacheKey()).toBe(
        plain.material.customProgramCacheKey()
      );
    }
  });

  it('patches the real shader for each switch, with its own program key and uniforms', () => {
    const keys = new Set<string>();
    for (const name of WATER_POLISH_SWITCHES) {
      const water = new WaterSurface({
        slopeGlsl: STUB_WAVES,
        polish: { [name]: true },
      });
      const shader = compile(water.material);
      const key = water.material.customProgramCacheKey();
      expect(key).toContain(`|polish:${name}`);
      keys.add(key);
      expect(shader.uniforms.uWaterPolishGustDepth).toBe(
        water.polishUniforms.uWaterPolishGustDepth
      );
      expect(shader.uniforms.uWaterTime).toBe(water.uniforms.uWaterTime);
      const lighting = ['sunSize', 'fresnelDamp', 'body'].includes(name);
      expect(
        shader.fragmentShader.includes('#define RE_Direct waterPolishDirect')
      ).toBe(lighting);
      expect(shader.fragmentShader.includes('waterPolishWave(q,')).toBe(
        ['lostVariance', 'antiTiling', 'gusts'].includes(name)
      );
    }
    expect(keys.size).toBe(WATER_POLISH_SWITCHES.length);
  });

  it('hooks the built-in waves too', () => {
    const shader = compile(
      new WaterSurface({ polish: { lostVariance: true } }).material
    );
    expect(shader.fragmentShader).toContain(
      'waterPolishWave(p, t, d, k, ak, w, phase, fade, k * dot(d, p) - w * t + phase, slope);'
    );
    expect(shader.fragmentShader).toContain(
      'material.roughness = min(pow(pow4(material.roughness) + uWaterPolishVarianceScale * waterLostVar'
    );
  });

  it('lists every switch in order when all are on, and chains under the haze and the cloud shadows', () => {
    const all = Object.fromEntries(
      WATER_POLISH_SWITCHES.map((name) => [name, true])
    );
    const water = new WaterSurface({ slopeGlsl: STUB_WAVES, polish: all });
    expect(water.material.customProgramCacheKey()).toBe(
      `water-surface|${STUB_WAVES}|polish:${WATER_POLISH_SWITCHES.join(',')}`
    );
    new CloudShadow().apply(water.material);
    new AtmosphereHaze({ visibilityKm: 45 }).apply(water.material);
    const shader = compile(water.material);
    expect(shader.fragmentShader).toContain('waterPolishIndirectSpecular');
    expect(shader.fragmentShader).toContain('atmShadowCloudLightInfo');
    expect(shader.fragmentShader).toContain('atmHazeKeep');
  });

  it('refuses a wave set the per-wave switches cannot hook, at construction', () => {
    const plain = 'vec2 waterSlopeAt(vec2 p, float t) { return vec2(0.0); }';
    expect(
      () => new WaterSurface({ slopeGlsl: plain, polish: { gusts: true } })
    ).toThrow(RangeError);
    expect(
      () => new WaterSurface({ slopeGlsl: plain, polish: { body: true } })
    ).not.toThrow();
    expect(
      () =>
        new WaterSurface({
          polish: { typo: true } as unknown as { gusts: boolean },
        })
    ).toThrow(RangeError);
  });

  it('changes a constant through configurePolish without a recompile', () => {
    const water = new WaterSurface({ polish: { gusts: true } });
    const version = water.material.version;
    water.configurePolish({ gustDepth: 0.4 });
    expect(water.polishUniforms.uWaterPolishGustDepth.value).toBe(0.4);
    expect(water.material.version).toBe(version);
    expect(() => water.configurePolish({ gustDepth: 2 })).toThrow(RangeError);
    expect(water.polishUniforms.uWaterPolishGustDepth.value).toBe(0.4);
  });
});
