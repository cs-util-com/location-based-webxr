/**
 * Tests for the cloud slab's CPU half (plan
 * 2026-09-24-1010-lookdev-fly-through-cloud-layer-plan §11, as amended by
 * its review triage §12).
 *
 * Why this file matters: the slab is judged by eye on the look-dev page,
 * but what makes it right is arithmetic the eye cannot check: a cover that
 * still means share of sky (from the zenith), a march that samples where
 * the cloud is, an optical depth that does not depend on the step count, a
 * light that is the sheet's top from above and the dome's underside from
 * below, and an interval that never leaves the slab. Each is proven here
 * against an independent formula, never against the function's own output.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  CLOUD_SLAB,
  CLOUD_SLAB_STEPS,
  cloudSlabCumulativeM,
  cloudSlabFarWeight,
  cloudSlabInterval,
  cloudSlabLod,
  cloudSlabMarch,
  cloudSlabRenderOrder,
  cloudSlabSourceRadiance,
  cloudSlabStepOpticalDepth,
  cloudSlabSteps,
  cloudSlabSunTransmittance,
  cloudSlabThicknessM,
  cloudSlabThresholdThicknessM,
  cloudSlabZenithOpacity,
  CLOUD_SLAB_FRAGMENT_GLSL,
  createCloudSlab,
  setCloudSlabSteps,
  type Vec3,
} from './cloud-slab.js';
import { ATMOSPHERE_CLOUD_GLSL } from './atmosphere-glsl.js';
import { glslFloat } from '../../utils/glsl-float.js';
import {
  CLOUD_LAYER,
  CLOUD_TEXTURE_SIZE,
  cloudDensity,
  cloudLitRadiance,
  cloudNoise,
  cloudThreshold,
  combinedCloudNoise,
} from './cloud-layer.js';
import {
  CLOUD_SHEET,
  CLOUD_TOP_LIT_GLSL,
  cloudTopRadiance,
} from './cloud-sheet.js';
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios.js';

const S = CLOUD_SLAB;
const THICKNESS = S.topM - S.baseM;
const T0 = cloudSlabThresholdThicknessM();
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** A direction at elevation `elDeg` and azimuth `azDeg` (x east, -z north). */
const dirAt = (elDeg: number, azDeg: number): Vec3 => {
  const el = (elDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  return [
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    -Math.cos(el) * Math.cos(az),
  ];
};

describe('CLOUD_SLAB', () => {
  // WHY: every formula below assumes these relations; an edited constant
  // that breaks one fails here, not as a silent change of look.
  it('keeps the slab around the sheet, above the scene and inside the far plane', () => {
    expect(S.baseM).toBeLessThan(CLOUD_SHEET.altitudeM);
    expect(S.topM).toBeGreaterThan(CLOUD_SHEET.altitudeM);
    // The M1 guard: well above the look-dev scene's top (§10 item 7).
    expect(S.baseM).toBeGreaterThan(2 * 520);
    expect(S.maxMarchM).toBeGreaterThanOrEqual(
      Math.hypot(CLOUD_SHEET.farFadeEndM, S.topM)
    );
    expect(S.radiusM).toBeGreaterThan(CLOUD_SHEET.farFadeEndM);
    // The look-dev far plane is 30 km.
    expect(Math.hypot(S.radiusM, S.topM)).toBeLessThan(30_000);
    expect(CLOUD_SLAB_STEPS).toContain(S.defaultSteps);
  });
});

describe('the vertical profile', () => {
  // Q is the integral of the density ramp; value AND slope must be
  // continuous at the ramp's end, or the optical depth jumps there.
  it('integrates the base ramp continuously', () => {
    const b = S.baseSoftM;
    const e = 1e-6;
    expect(cloudSlabCumulativeM(b - e)).toBeCloseTo(
      cloudSlabCumulativeM(b + e),
      5
    );
    const slope = (x: number) =>
      (cloudSlabCumulativeM(x + e) - cloudSlabCumulativeM(x - e)) / (2 * e);
    expect(slope(b - 1e-3)).toBeCloseTo(slope(b + 1e-3), 3);
    expect(slope(b / 2)).toBeCloseTo(0.5, 6);
    expect(slope(2 * b)).toBeCloseTo(1, 6);
    expect(cloudSlabCumulativeM(-5)).toBe(0);
    // No ramp at all: Q is the height itself.
    expect(cloudSlabCumulativeM(30, 0)).toBe(30);
  });

  // WHY (finding 6, triage §12 LOW): T0 is where the zenith opacity is
  // exactly one half, for ANY ramp: the cover keeps meaning share of sky.
  it('puts the half-opacity thickness at ln 2 of optical depth, for any ramp', () => {
    const sigma = S.extinctionPerM;
    expect(sigma * cloudSlabCumulativeM(T0)).toBeCloseTo(Math.LN2, 12);
    for (const b of [0, 25, 50, 100, 200]) {
      for (const s of [0.01, 0.02, 0.04]) {
        const t = cloudSlabThresholdThicknessM(s, b);
        expect(s * cloudSlabCumulativeM(t, b)).toBeCloseTo(Math.LN2, 10);
      }
    }
  });
});

describe('the column', () => {
  it('is half opaque at the threshold, monotone, and empty below its reach', () => {
    const theta = 0.6;
    expect(cloudSlabZenithOpacity(theta, theta)).toBeCloseTo(0.5, 12);
    let previous = -1;
    for (let n = 0.3; n <= 1.2; n += 0.01) {
      const o = cloudSlabZenithOpacity(n, theta);
      expect(o).toBeGreaterThanOrEqual(previous);
      previous = o;
    }
    expect(
      cloudSlabZenithOpacity(theta - T0 / S.heightScaleM - 1e-9, theta)
    ).toBe(0);
    expect(cloudSlabThicknessM(theta + 10, theta)).toBe(THICKNESS);
    // Cover 0: an infinite threshold, no cloud anywhere.
    expect(cloudSlabThicknessM(1, Number.POSITIVE_INFINITY)).toBe(0);
  });

  // WHY: the knob's name promises a quantity (share of sky), so it is
  // tested for that quantity on the shipped noise (a lesson of the dome).
  it('makes the cover the share of zenith columns more than half opaque', () => {
    const field = combinedCloudNoise(
      cloudNoise(CLOUD_TEXTURE_SIZE, 1),
      CLOUD_TEXTURE_SIZE
    );
    for (const cover of [0.2, 0.5, 0.8]) {
      const theta = cloudThreshold(cover);
      let opaque = 0;
      for (const n of field)
        if (cloudSlabZenithOpacity(n, theta) > 0.5) opaque++;
      expect(Math.abs(opaque / field.length - cover)).toBeLessThanOrEqual(0.05);
    }
  });

  // WHY: seen from the ground the slab's cloud edges should be as sharp as
  // the dome's; if σ or H changes without the other, they are not.
  it('has the dome density slope at the threshold, within 20 %', () => {
    const theta = 0.6;
    const e = 1e-4;
    const slab =
      (cloudSlabZenithOpacity(theta + e, theta) -
        cloudSlabZenithOpacity(theta - e, theta)) /
      (2 * e);
    const dome =
      (cloudDensity(theta + e, theta) - cloudDensity(theta - e, theta)) /
      (2 * e);
    expect(Math.abs(slab / dome - 1)).toBeLessThanOrEqual(0.2);
  });

  it('flattens few tops at half cover', () => {
    const field = combinedCloudNoise(
      cloudNoise(CLOUD_TEXTURE_SIZE, 1),
      CLOUD_TEXTURE_SIZE
    );
    const shareAtTop = (cover: number) => {
      const theta = cloudThreshold(cover);
      let cloud = 0;
      let flat = 0;
      for (const n of field) {
        const t = cloudSlabThicknessM(n, theta);
        if (cloudSlabZenithOpacity(n, theta) > 0.5) cloud++;
        if (t >= THICKNESS) flat++;
      }
      return flat / cloud;
    };
    // MEASURED 2026-09-24: 0.057 at cover 0.5 (the design's estimate 0.07),
    // 0.330 at 0.9. H = 1000 would move to 750 above 0.15 at 0.5.
    const half = shareAtTop(0.5);
    expect(half).toBeLessThanOrEqual(0.15);
  });
});

describe('cloudSlabInterval', () => {
  const tFar = (dir: Vec3) =>
    CLOUD_SHEET.farFadeEndM / Math.max(Math.hypot(dir[0], dir[2]), 1e-6);

  it('enters and leaves the slab where the planes are', () => {
    const up = cloudSlabInterval(18, [0, 1, 0])!;
    expect(up.inM).toBeCloseTo(S.baseM - 18, 9);
    expect(up.outM).toBeCloseTo(S.topM - 18, 9);
    const down = cloudSlabInterval(3200, [0, -1, 0])!;
    expect(down.inM).toBeCloseTo(3200 - S.topM, 9);
    expect(down.outM).toBeCloseTo(3200 - S.baseM, 9);
    // Inside: the march starts at the camera, whichever way it looks.
    for (const dir of [
      [0, 1, 0],
      [0, -1, 0],
    ] as Vec3[]) {
      expect(cloudSlabInterval(2000, dir)!.inM).toBe(0);
    }
    const level = cloudSlabInterval(2000, [1, 0, 0])!;
    expect(level.inM).toBe(0);
    expect(level.outM).toBeCloseTo(Math.min(S.maxMarchM, tFar([1, 0, 0])), 9);
    // Outside and level, or looking away: no interval.
    expect(cloudSlabInterval(18, [1, 0, 0])).toBeNull();
    expect(cloudSlabInterval(18, [0, -1, 0])).toBeNull();
    expect(cloudSlabInterval(3200, [0, 1, 0])).toBeNull();
    // Exactly at the base, looking up: the whole thickness.
    expect(cloudSlabInterval(S.baseM, [0, 1, 0])!.outM).toBeCloseTo(
      THICKNESS,
      9
    );
    // Nearly level from below: the entry lies far beyond the far fade.
    expect(cloudSlabInterval(18, unit([1, 1e-7, 0]))).toBeNull();
  });

  it('refuses a direction that is not finite or has no length', () => {
    expect(() => cloudSlabInterval(18, [0, 0, 0])).toThrow(RangeError);
    expect(() => cloudSlabInterval(18, [Number.NaN, 1, 0])).toThrow(RangeError);
    expect(() => cloudSlabInterval(Number.NaN, [0, 1, 0])).toThrow(RangeError);
  });
});

describe('cloudSlabSteps', () => {
  // WHY (finding 2): uniform steps over 21 km put one or two samples where
  // a camera is looking; quadratic ones crowd at the entry.
  it('crowds quadratically at the entry and covers the interval exactly', () => {
    for (const n of CLOUD_SLAB_STEPS) {
      const L = 21_000;
      const { starts, ends, samples } = cloudSlabSteps(n, L);
      const total = ends.reduce((sum, e, i) => sum + (e - starts[i]!), 0);
      expect(Math.abs(total - L) / L).toBeLessThan(1e-9);
      for (let i = 1; i < n; i++) {
        expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
        expect(starts[i]).toBe(ends[i - 1]);
      }
      expect(ends[0]! - starts[0]!).toBeCloseTo(L / (n * n), 9);
      expect(
        (ends[n - 1]! - starts[n - 1]!) / (ends[0]! - starts[0]!)
      ).toBeCloseTo(2 * n - 1, 9);
    }
    const { samples } = cloudSlabSteps(16, 21_000);
    expect(samples.filter((s) => s < 3000).length).toBeGreaterThanOrEqual(5);
  });

  it('refuses a step count the shader is not built for', () => {
    expect(() => cloudSlabSteps(12, 1000)).toThrow(RangeError);
    expect(() => cloudSlabSteps(16, -1)).toThrow(RangeError);
  });
});

describe('cloudSlabStepOpticalDepth', () => {
  // WHY: the exact vertical integral is what keeps a coarse march from
  // drawing slices at hard tops. It must equal the brute-force integral of
  // the density along the ray, for rays that cross a top inside a step too.
  it('equals the numeric integral of the density along the step', () => {
    const random = mulberry32(7);
    const density = (h: number, T: number) =>
      h < 0 || h > T ? 0 : Math.min(1, h / S.baseSoftM);
    for (let k = 0; k < 1000; k++) {
      const y = 1500 + random() * 1000;
      const dirY = (random() * 2 - 1) * 0.999;
      const t0 = random() * 300;
      const t1 = t0 + random() * 300;
      const T = random() * THICKNESS;
      const steps = 10_000;
      let numeric = 0;
      for (let i = 0; i < steps; i++) {
        const t = t0 + ((i + 0.5) / steps) * (t1 - t0);
        numeric += density(y + dirY * t - S.baseM, T) * ((t1 - t0) / steps);
      }
      const exact = cloudSlabStepOpticalDepth(y, dirY, t0, t1, T);
      // The tolerance is the NUMERIC method's precision, not a guess: the
      // density jumps from full to 0 at the column's top, and a midpoint sum
      // is exact only to one sub-step there (σ·Δt per jump; the ramp at the
      // base is continuous and contributes far less).
      const subStep = (t1 - t0) / steps;
      expect(Math.abs(exact - S.extinctionPerM * numeric)).toBeLessThanOrEqual(
        1e-12 + S.extinctionPerM * subStep
      );
    }
  });
});

describe('the light', () => {
  const sunT: Vec3 = [0.9, 0.85, 0.75];
  const zenith: Vec3 = [0.02, 0.03, 0.05];

  // WHY: the slab is the sheet's model with depth: fully lit it is the
  // sheet's top, fully shaded the dome's underside, and nothing outside.
  it('is the sheet top when fully lit and the dome underside when shaded', () => {
    const sunY = 0.85;
    const cos = 0.3;
    const d = 0.7;
    const top = cloudTopRadiance(sunT, sunY, zenith);
    const under = cloudLitRadiance(sunT, cos, d, zenith);
    const lit = cloudSlabSourceRadiance(sunT, cos, d, zenith, sunY, 1);
    const dark = cloudSlabSourceRadiance(sunT, cos, d, zenith, sunY, 0);
    for (let c = 0; c < 3; c++) {
      expect(lit[c]).toBeCloseTo(top[c]!, 12);
      expect(dark[c]).toBeCloseTo(under[c]!, 12);
      const mid = cloudSlabSourceRadiance(sunT, cos, d, zenith, sunY, 0.5)[c]!;
      expect(mid).toBeGreaterThanOrEqual(Math.min(top[c]!, under[c]!));
      expect(mid).toBeLessThanOrEqual(Math.max(top[c]!, under[c]!));
    }
  });

  // WHY (triage §12 item 7): a step straddling a column top put the height
  // above the top, where the old form gave a sun transmittance above 1.
  it('never transmits more than all of the sun', () => {
    for (const h of [-10, 0, 30, 200, 399, 400, 450, 1000]) {
      const t = cloudSlabSunTransmittance(h, 400, 0.85);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
    expect(cloudSlabSunTransmittance(400, 400, 0.85)).toBe(1);
    expect(cloudSlabSunTransmittance(0, 400, 0.85)).toBeLessThan(
      cloudSlabSunTransmittance(200, 400, 0.85)
    );
  });
});

describe('cloudSlabMarch', () => {
  const uniform = (n: number) => () => n;
  const theta = 0.6;

  // WHY: the unweighted opacity of a vertical ray through a column at the
  // threshold is the zenith opacity, exactly, at every step count: the
  // exact vertical integral makes it independent of N (triage §12 item 3:
  // the WEIGHTED alpha carries the aerial fade and is not 0.5).
  it('gives the zenith opacity for a vertical ray at every step count', () => {
    for (const steps of CLOUD_SLAB_STEPS) {
      const m = cloudSlabMarch({
        camera: [0, 18, 0],
        dir: [0, 1, 0],
        steps,
        sample: uniform(theta),
        threshold: theta,
      });
      expect(m.opacity).toBeCloseTo(0.5, 9);
      expect(m.alpha).toBeLessThan(0.5);
      expect(m.alpha).toBeGreaterThan(0.45);
    }
  });

  it('exits early inside a thick cloud', () => {
    const m = cloudSlabMarch({
      camera: [0, 2000, 0],
      dir: [1, 0, 0],
      steps: 16,
      sample: uniform(theta + 1),
      threshold: theta,
    });
    expect(m.opacity).toBeGreaterThanOrEqual(0.99);
    expect(m.stepsTaken).toBeLessThan(16);
  });

  it('draws nothing at cover 0 and outside its interval', () => {
    const clear = cloudSlabMarch({
      camera: [0, 18, 0],
      dir: [0, 1, 0],
      steps: 16,
      sample: uniform(1),
      threshold: Number.POSITIVE_INFINITY,
    });
    expect(clear.alpha).toBe(0);
    const away = cloudSlabMarch({
      camera: [0, 18, 0],
      dir: [0, -1, 0],
      steps: 16,
      sample: uniform(1),
      threshold: 0,
    });
    expect(away.stepsTaken).toBe(0);
  });

  // WHY: 8 steps must not draw a different sky from 32. The field is the
  // shipped combined noise, bilinear, with the level of detail ignored
  // (GL mips are implementation-defined, so no twin reproduces them).
  it('keeps 8 steps close to 32 over seeded rays', () => {
    const size = CLOUD_TEXTURE_SIZE;
    const field = combinedCloudNoise(cloudNoise(size, 1), size);
    const texelM = (CLOUD_LAYER.tileKm * 1000) / size;
    const at = (i: number, j: number) =>
      field[
        (((j % size) + size) % size) * size + (((i % size) + size) % size)
      ]!;
    const sample = (x: number, z: number) => {
      const u = x / texelM - 0.5;
      const v = z / texelM - 0.5;
      const i = Math.floor(u);
      const j = Math.floor(v);
      const fu = u - i;
      const fv = v - j;
      return (
        (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) +
        (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv
      );
    };
    const threshold = cloudThreshold(0.5);
    const random = mulberry32(11);
    let sum = 0;
    const rays = 500;
    for (let k = 0; k < rays; k++) {
      const y = random() * 4000;
      const dir = unit([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]);
      const camera: Vec3 = [random() * 5000, y, random() * 5000];
      const a8 = cloudSlabMarch({
        camera,
        dir,
        steps: 8,
        sample,
        threshold,
      }).alpha;
      const a32 = cloudSlabMarch({
        camera,
        dir,
        steps: 32,
        sample,
        threshold,
      }).alpha;
      sum += Math.abs(a8 - a32);
    }
    expect(sum / rays).toBeLessThanOrEqual(0.05);
  });

  // WHY (triage §12 item 2): sunlit tops seen from above are brighter than
  // undersides seen from below, AWAY from the sun (toward it the forward
  // lobe lights undersides). The geometry is named: noon (58°), both views
  // along the anti-sun azimuth at 60° from the horizontal. The bounds come
  // from the pure light terms, not from the march's own output.
  //
  // MEASURED 2026-09-24 over the multiple-scattering factor k (the sweep
  // rule): above/below 1.60 / 2.51 / 3.06 / 2.70 at k 0.1 / 0.25 / 0.5 / 1,
  // so the 1.5 bound holds across the range and reverses only below it;
  // above/top 0.93 / 0.84 / 0.74 / 0.61, so the 0.7 bound would reverse at
  // k = 1. TOWARD the sun the underside reads 0.81 against the top's 0.51:
  // the forward lobe, and why the geometry is named.
  it('shows sunlit tops from above and undersides from below, away from the sun', () => {
    const sunEl = 58;
    const sunAz = 180;
    const sunDir = dirAt(sunEl, sunAz);
    const sunT: Vec3 = [0.9, 0.88, 0.8];
    const zenith: Vec3 = [0.01, 0.015, 0.03];
    const light = { sunTransmittance: sunT, sunDir, zenith };
    const thick = uniform(theta + 1);
    const above = cloudSlabMarch({
      camera: [0, 3200, 0],
      dir: dirAt(-60, sunAz + 180),
      steps: 16,
      sample: thick,
      threshold: theta,
      light,
    });
    const belowDir = dirAt(60, sunAz + 180);
    const below = cloudSlabMarch({
      camera: [0, 18, 0],
      dir: belowDir,
      steps: 16,
      sample: thick,
      threshold: theta,
      light,
    });
    const radiance = (m: typeof above) =>
      (m.colour[0] + m.colour[1] + m.colour[2]) / m.alpha;
    const top = cloudTopRadiance(sunT, sunDir[1], zenith);
    const cos =
      belowDir[0] * sunDir[0] +
      belowDir[1] * sunDir[1] +
      belowDir[2] * sunDir[2];
    const under = cloudLitRadiance(sunT, cos, 1, zenith);
    const sum = (v: readonly number[]) => v[0]! + v[1]! + v[2]!;
    // From above the tops dominate, from below the undersides.
    expect(radiance(above)).toBeGreaterThanOrEqual(0.7 * sum(top));
    expect(radiance(below)).toBeLessThanOrEqual(0.5 * (sum(top) + sum(under)));
    const ratio = radiance(above) / radiance(below);
    // The verdict reverses at 1.
    expect(ratio).toBeGreaterThanOrEqual(1.5);
  });
});

describe('cloudSlabLod', () => {
  const texelM = (CLOUD_LAYER.tileKm * 1000) / CLOUD_TEXTURE_SIZE;
  it('grows by one level per doubling of the footprint, and never goes negative', () => {
    const pixel = 0.001;
    const a = cloudSlabLod(200_000, pixel, 0, 0);
    const b = cloudSlabLod(400_000, pixel, 0, 0);
    expect(b - a).toBeCloseTo(1, 9);
    expect(a).toBeCloseTo(Math.log2((200_000 * pixel) / texelM), 9);
    // A coarse step that skips more ground than the pixel covers wins.
    expect(cloudSlabLod(10, pixel, 4 * texelM, 1)).toBeCloseTo(2, 9);
    expect(cloudSlabLod(10, pixel, 0, 0)).toBe(0);
  });
});

describe('cloudSlabRenderOrder and cloudSlabFarWeight', () => {
  it('draws behind the scene from below and in front of it from inside and above', () => {
    expect(cloudSlabRenderOrder(55)).toBe(-1);
    expect(cloudSlabRenderOrder(S.baseM)).toBe(-1);
    expect(cloudSlabRenderOrder(S.baseM + 1)).toBe(1);
    expect(cloudSlabRenderOrder(3200)).toBe(1);
  });

  it('fades the contribution to nothing by the far fade end', () => {
    expect(cloudSlabFarWeight(0)).toBe(1);
    expect(cloudSlabFarWeight(CLOUD_SHEET.farFadeStartM)).toBe(1);
    expect(cloudSlabFarWeight(CLOUD_SHEET.farFadeEndM)).toBe(0);
    expect(cloudSlabFarWeight(S.radiusM)).toBe(0);
  });
});

describe('CLOUD_SLAB_FRAGMENT_GLSL', () => {
  const loop = () => {
    const begin = CLOUD_SLAB_FRAGMENT_GLSL.indexOf('// atm-slab-loop-begin');
    const end = CLOUD_SLAB_FRAGMENT_GLSL.indexOf('// atm-slab-loop-end');
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    return CLOUD_SLAB_FRAGMENT_GLSL.slice(begin, end);
  };

  // WHY: one pattern, cover and light for dome, sheet and slab, and every
  // constant from the one place the CPU twin reads.
  it('shares the cloud chunk and the top light, and injects every constant', () => {
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(ATMOSPHERE_CLOUD_GLSL);
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(CLOUD_TOP_LIT_GLSL);
    for (const v of [
      S.baseM,
      S.topM,
      S.extinctionPerM,
      S.baseSoftM,
      S.heightScaleM,
      T0,
      S.sunDepthScale,
      S.sunMuFloor,
      S.maxMarchM,
      S.earlyExitTransmittance,
    ]) {
      expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(glslFloat(v));
    }
  });

  // WHY (cold review finding 3, cost): inside the loop implicit derivatives
  // are undefined, so the noise is read with an explicit level; and the
  // light's LUT reads are hoisted, the same for every sample.
  it('reads the noise with explicit levels in the loop and hoists the light', () => {
    const body = loop();
    expect(body).toContain('atmCloudNoiseLod(');
    for (const banned of [
      'texture2D(',
      'texture(',
      'atmCloudNoise(',
      'atmCloudLit(',
      'atmCloudTopLit(',
    ]) {
      expect(body).not.toContain(banned);
    }
  });

  // WHY (triage §12 item 1): the view ray comes from the pixel, never from
  // the mesh's interpolated position, which M1 measured breaking with the
  // eye 0.5 m from a large triangle.
  it('takes the view ray from gl_FragCoord', () => {
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain('gl_FragCoord');
    expect(CLOUD_SLAB_FRAGMENT_GLSL).not.toMatch(/varying/);
  });
});

describe('createCloudSlab', () => {
  const uniforms = () => ({
    atmCloudThreshold: { value: 0.6 },
    atmCloudCover: { value: 0.5 },
  });

  it('is a back-faced, depth-tested, transparent prism with the default steps', () => {
    const slab = createCloudSlab(uniforms());
    const m = slab.material as THREE.ShaderMaterial;
    expect(slab.name).toBe('atmosphere-cloud-slab');
    expect(m.side).toBe(THREE.BackSide);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
    expect(m.fog).toBe(false);
    expect(m.defines['ATM_SLAB_STEPS']).toBe(S.defaultSteps);
    expect(slab.frustumCulled).toBe(false);
  });

  // WHY: BackSide draws the faces that point AWAY from the camera. That is
  // the far inside of the prism from anywhere only if every face points
  // outward: the top cap up, the bottom cap down, the wall away from the
  // axis. One flipped cap and the slab vanishes from below or above.
  it('faces every triangle outward', () => {
    const geometry = createCloudSlab(uniforms()).geometry;
    const p = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    const half = THICKNESS / 2;
    const v = (i: number) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const up: number[] = [];
    const down: number[] = [];
    const wallVertical: number[] = [];
    const wallOutward: number[] = [];
    for (let k = 0; k < index.count; k += 3) {
      const a = v(index.getX(k));
      const b = v(index.getX(k + 1));
      const c = v(index.getX(k + 2));
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const centre = a.add(b).add(c).divideScalar(3);
      if (Math.abs(centre.y - half) < 1e-6) up.push(normal.y);
      else if (Math.abs(centre.y + half) < 1e-6) down.push(normal.y);
      else {
        wallVertical.push(Math.abs(normal.y));
        wallOutward.push(normal.x * centre.x + normal.z * centre.z);
      }
    }
    expect(up.length).toBeGreaterThan(0);
    expect(down.length).toBe(up.length);
    expect(Math.min(...up)).toBeGreaterThan(0.999);
    expect(Math.max(...down)).toBeLessThan(-0.999);
    expect(Math.max(...wallVertical)).toBeLessThan(1e-6);
    expect(Math.min(...wallOutward)).toBeGreaterThan(0);
    expect(wallOutward).toHaveLength(2 * CLOUD_SHEET.sectors);
  });

  // WHY: the mesh follows the camera (the pattern is sampled in world x/z),
  // the draw order flips at the base, and the shader's ray needs the
  // camera's matrices and the viewport of THIS render.
  it('follows the camera and hands the shader its ray matrices and viewport', () => {
    const slab = createCloudSlab(uniforms());
    const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 30_000);
    camera.position.set(100, 3200, -50);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const renderer = {
      getCurrentViewport: (target: THREE.Vector4) => target.set(0, 0, 800, 600),
    } as unknown as THREE.WebGLRenderer;
    const call = () =>
      slab.onBeforeRender(
        renderer,
        new THREE.Scene(),
        camera,
        slab.geometry,
        slab.material as THREE.Material,
        null as never
      );
    call();
    expect(slab.position.x).toBe(100);
    expect(slab.position.z).toBe(-50);
    expect(slab.position.y).toBe((S.baseM + S.topM) / 2);
    expect(slab.renderOrder).toBe(1);
    const u = (slab.material as THREE.ShaderMaterial).uniforms;
    expect(
      (u.atmSlabInverseProjection!.value as THREE.Matrix4).equals(
        camera.projectionMatrixInverse
      )
    ).toBe(true);
    expect(
      (u.atmSlabCameraWorld!.value as THREE.Matrix4).equals(camera.matrixWorld)
    ).toBe(true);
    expect((u.atmSlabViewport!.value as THREE.Vector4).toArray()).toEqual([
      0, 0, 800, 600,
    ]);
    expect(u.atmSlabPixelAngle!.value).toBeCloseTo(
      2 / (camera.projectionMatrix.elements[5] * 600),
      12
    );
    camera.position.set(0, 55, 0);
    camera.updateMatrixWorld();
    call();
    expect(slab.renderOrder).toBe(-1);
  });

  it('changes its step count through a new program, and refuses one it is not built for', () => {
    const slab = createCloudSlab(uniforms());
    const m = slab.material as THREE.ShaderMaterial;
    const version = m.version;
    setCloudSlabSteps(slab, 32);
    expect(m.defines['ATM_SLAB_STEPS']).toBe(32);
    expect(m.version).toBeGreaterThan(version);
    expect(() => setCloudSlabSteps(slab, 12)).toThrow(RangeError);
    expect(m.defines['ATM_SLAB_STEPS']).toBe(32);
  });
});

describe('the sample jitter', () => {
  // WHY (found on the look-dev page): a fixed sample point per step drew
  // the far deck as terraced bands at level rays. The shader moves the
  // sample inside each step per pixel; the step BOUNDS must not move, or the
  // exact integral and a vertical ray's opacity would change with it.
  it('moves the sample inside its step and leaves the bounds alone', () => {
    const mid = cloudSlabSteps(16, 21_000);
    for (const jitter of [0, 0.25, 0.9999]) {
      const j = cloudSlabSteps(16, 21_000, jitter);
      expect(j.starts).toEqual(mid.starts);
      expect(j.ends).toEqual(mid.ends);
      for (let i = 0; i < 16; i++) {
        expect(j.samples[i]).toBeGreaterThanOrEqual(j.starts[i]!);
        expect(j.samples[i]).toBeLessThanOrEqual(j.ends[i]!);
      }
    }
    expect(() => cloudSlabSteps(16, 1000, 1.5)).toThrow(RangeError);
    expect(() => cloudSlabSteps(16, 1000, Number.NaN)).toThrow(RangeError);
  });

  it('does not change a vertical ray through a uniform column', () => {
    for (const jitter of [0, 0.5, 0.99]) {
      const m = cloudSlabMarch({
        camera: [0, 18, 0],
        dir: [0, 1, 0],
        steps: 16,
        sample: () => 0.6,
        threshold: 0.6,
        jitter,
      });
      expect(m.opacity).toBeCloseTo(0.5, 9);
    }
  });

  it('is computed per pixel in the shader, inside the loop only as the sample point', () => {
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toMatch(
      /float jitter = fract\(.*gl_FragCoord/
    );
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(
      'float um = (float(i) + jitter)'
    );
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain('float u0 = float(i) /');
  });
});
