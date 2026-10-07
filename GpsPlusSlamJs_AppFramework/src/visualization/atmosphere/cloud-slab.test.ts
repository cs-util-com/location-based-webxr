/**
 * Tests for the cloud slab's CPU half (plan
 * 2026-09-24-1010-lookdev-fly-through-cloud-layer-plan §11, as amended by
 * its review triage §12; the march from above by plan
 * 2026-09-26-0549-clouds-from-above-plan §4-§5).
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
  CLOUD_SLAB_REACH,
  CLOUD_SLAB_STEPS,
  cloudSlabCumulativeM,
  cloudSlabFarWeight,
  cloudSlabInStepLight,
  cloudSlabInterval,
  cloudSlabLod,
  cloudSlabMarch,
  cloudSlabNodes,
  cloudSlabOccupied,
  cloudSlabRenderOrder,
  cloudSlabSourceRadiance,
  cloudSlabStepOpticalDepth,
  cloudSlabSunOpticalDepth,
  cloudSlabSunTransmittance,
  cloudSlabThicknessM,
  cloudSlabThresholdThicknessM,
  cloudSlabUniformShare,
  cloudSlabZenithOpacity,
  CLOUD_SLAB_FRAGMENT_GLSL,
  createCloudSlab,
  setCloudSlabCoverage,
  setCloudSlabDiscCentre,
  setCloudSlabRadius,
  setCloudSlabReach,
  setCloudSlabSceneDepth,
  setCloudSlabSteps,
  type Vec3,
} from './cloud-slab.js';
import { ATMOSPHERE_CLOUD_GLSL } from './atmosphere-glsl.js';
import {
  CLOUD_COVERAGE_GLSL,
  cloudCoverThresholds,
  cloudDiscThreshold,
  cloudThresholdForCover,
} from './cloud-coverage.js';
import { EARTH_ATMOSPHERE, transmittanceToTop } from './atmosphere-model.js';
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
import { cloudColumnOpticalDepth } from './cloud-column.js';
import { cloudForwardPhase, cloudForwardPhaseOf } from './cloud-sun.js';
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

describe('cloudSlabNodes', () => {
  // WHY (finding 2): uniform steps over 21 km put one or two samples where
  // a camera is looking; quadratic ones crowd at the entry. Quadratic stays
  // the spacing from below and inside (plan 2026-09-26-0549 §4).
  it('crowds quadratically at the entry and tiles the interval exactly', () => {
    for (const n of CLOUD_SLAB_STEPS) {
      const L = 21_000;
      const nodes = cloudSlabNodes(n, L);
      expect(nodes).toHaveLength(n + 2);
      expect(nodes[0]).toBe(0);
      expect(nodes[n + 1]).toBe(L);
      for (let k = 1; k < nodes.length; k++) {
        expect(nodes[k]!).toBeGreaterThan(nodes[k - 1]!);
      }
      // Node k (1..n) sits in the middle of quadratic step k - 1.
      for (let k = 1; k <= n; k++) {
        expect(nodes[k]).toBeCloseTo(((k - 0.5) / n) ** 2 * L, 6);
      }
    }
    const nodes = cloudSlabNodes(16, 21_000);
    expect(nodes.filter((s) => s < 3000).length).toBeGreaterThanOrEqual(5);
  });

  // WHY (plan 2026-09-26-0549 §1, §4): from above every ray crosses the
  // whole slab, and uniform nodes measured better than quadratic at every
  // view; the share blends between the two, so the nodes move continuously.
  it('spaces the nodes uniformly at share 1 and continuously between', () => {
    const L = 400;
    const uniform = cloudSlabNodes(8, L, 0.5, 1);
    for (let k = 1; k <= 8; k++) {
      expect(uniform[k]).toBeCloseTo(((k - 0.5) / 8) * L, 9);
    }
    const a = cloudSlabNodes(8, L, 0.5, 0.3);
    const b = cloudSlabNodes(8, L, 0.5, 0.3 + 1e-6);
    for (let k = 0; k < a.length; k++) {
      expect(Math.abs(a[k]! - b[k]!)).toBeLessThan(1e-3);
    }
  });

  it('refuses a step count the shader is not built for, and bad inputs', () => {
    expect(() => cloudSlabNodes(12, 1000)).toThrow(RangeError);
    expect(() => cloudSlabNodes(16, -1)).toThrow(RangeError);
    expect(() => cloudSlabNodes(16, 1000, 0.5, 1.5)).toThrow(RangeError);
    expect(() => cloudSlabNodes(16, 1000, 0.5, Number.NaN)).toThrow(RangeError);
  });
});

describe('cloudSlabUniformShare', () => {
  // WHY (plan 2026-09-26-0549 §4, guard E7): the spacing turns uniform only
  // ABOVE the slab (quadratic from below is a recorded decision), and the
  // turn is continuous, so the globe descent crossing the top does not jump.
  it('is 0 up to the top, 1 from the blend height above it, and continuous', () => {
    expect(S.uniformBlendM).toBeGreaterThan(0);
    expect(cloudSlabUniformShare(18)).toBe(0);
    expect(cloudSlabUniformShare(S.baseM)).toBe(0);
    expect(cloudSlabUniformShare(2000)).toBe(0);
    expect(cloudSlabUniformShare(S.topM)).toBe(0);
    expect(cloudSlabUniformShare(S.topM + S.uniformBlendM)).toBe(1);
    expect(cloudSlabUniformShare(5000)).toBe(1);
    let previous = 0;
    for (let y = S.topM; y <= S.topM + S.uniformBlendM; y += 0.25) {
      const share = cloudSlabUniformShare(y);
      expect(share).toBeGreaterThanOrEqual(previous);
      // A smoothstep's steepest slope is 1.5 per blend height.
      expect(share - previous).toBeLessThanOrEqual(
        (1.5 * 0.25) / S.uniformBlendM + 1e-12
      );
      previous = share;
    }
  });
});

describe('cloudSlabOccupied', () => {
  // WHY (plan 2026-09-26-0549 §2 change 1, the secant step): the part of a
  // segment under a LINEAR top is found exactly, so a top crossing a segment
  // no longer snaps to the segment's bounds (the contour layers from above).
  it('finds exactly the part of a segment under a linear top', () => {
    const random = mulberry32(5);
    const n = 4000;
    for (let k = 0; k < 2000; k++) {
      const da = (random() * 2 - 1) * 300;
      const db = (random() * 2 - 1) * 300;
      const occupied = cloudSlabOccupied(da, db);
      let inside = 0;
      for (let i = 0; i < n; i++) {
        if (da + ((db - da) * (i + 0.5)) / n >= 0) inside++;
      }
      const share = occupied ? occupied[1] - occupied[0] : 0;
      expect(Math.abs(share - inside / n)).toBeLessThanOrEqual(1 / n);
      // The occupied part's middle lies under the top (no claim when none is).
      const middle = occupied
        ? da + (db - da) * 0.5 * (occupied[0] + occupied[1])
        : 0;
      expect(middle).toBeGreaterThanOrEqual(0);
    }
    expect(cloudSlabOccupied(-1, -2)).toBeNull();
    expect(cloudSlabOccupied(3, 5)).toEqual([0, 1]);
  });
});

describe('cloudSlabInStepLight', () => {
  /** ∫ e^(-τu) e^(-(sunA + (sunB - sunA)u)) τ du over [0, 1], midpoint rule. */
  const numeric = (tau: number, sunA: number, sunB: number) => {
    const n = 20_000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      sum += Math.exp(-tau * u - (sunA + (sunB - sunA) * u)) * (tau / n);
    }
    return sum;
  };

  // WHY (plan 2026-09-26-0549 §4, the x < 0 regime): from below and inside
  // the sun's reach GROWS along the ray faster than the view is dimmed
  // (x = τ - sunA + sunB < 0), where the textbook form (1 - e^-x)/x needs
  // e^|x| up to e^20. The closed form must match the integral on BOTH sides,
  // at x = 0 and across the series limit.
  it('equals the integral of the reach over the dimming, for either sign of x', () => {
    const random = mulberry32(9);
    for (let k = 0; k < 400; k++) {
      const tau = random() * 12;
      const sunA = random() * 20;
      const sunB = Math.max(
        0,
        random() < 0.5 ? random() * 20 : sunA - tau + (random() - 0.5) * 0.05
      );
      const exact = numeric(tau, sunA, sunB);
      expect(
        Math.abs(cloudSlabInStepLight(tau, sunA, sunB) - exact)
      ).toBeLessThanOrEqual(1e-8 + 1e-6 * exact);
    }
    const limit = S.lightSeriesX;
    for (const x of [
      0,
      1e-12,
      -1e-12,
      limit * 0.999,
      limit * 1.001,
      -limit * 1.001,
    ]) {
      const tau = 2;
      const sunA = 1;
      const sunB = x - tau + sunA + 2;
      const value = cloudSlabInStepLight(tau, sunA + 2, sunB);
      expect(Number.isFinite(value)).toBe(true);
      expect(
        Math.abs(value - numeric(tau, sunA + 2, sunB))
      ).toBeLessThanOrEqual(1e-8);
    }
  });

  // WHY: the ends of the physics: a sun that reaches everywhere lights all
  // of the opacity (the sheet's top), one that reaches nowhere lights none,
  // and an empty segment lights nothing.
  it('is all of the opacity at full reach, none at none, and 0 for an empty segment', () => {
    for (const tau of [0.01, 0.5, 3, 12]) {
      expect(cloudSlabInStepLight(tau, 0, 0)).toBeCloseTo(
        1 - Math.exp(-tau),
        12
      );
      expect(cloudSlabInStepLight(tau, 800, 800)).toBeLessThan(1e-300);
      const v = cloudSlabInStepLight(tau, 0.3, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1 - Math.exp(-tau));
    }
    expect(cloudSlabInStepLight(0, 1, 2)).toBe(0);
  });

  // WHY (the shader has no expm1, and its floats are 32-bit): emulated with
  // Math.fround, the closed form cancels near x = 0; the series below
  // `lightSeriesX` keeps float32 within 1e-4 of float64. MEASURED 2026-09-26
  // (worst relative error over |x| in [1e-7, 30]) per limit: none: 0/0;
  // 1e-4: 7.2e-4; 1e-3: 7.3e-5; 1e-2: 7.6e-6; 1e-1: 4.0e-5; 0.3: 1.2e-3
  // (above 0.1 the series' own truncation takes over).
  it('keeps float32 within 1e-4 of float64 across x', () => {
    const f = Math.fround;
    const f32 = (tau: number, sunA: number, sunB: number) => {
      const x = f(f(f(tau) - f(sunA)) + f(sunB));
      const ra = f(Math.exp(-f(sunA)));
      if (Math.abs(x) < S.lightSeriesX) {
        return f(f(f(tau) * ra) * f(1 - f(x * 0.5) + f(f(x * x) / 6)));
      }
      return f(f(f(tau) * f(ra - f(Math.exp(f(-f(sunB) - f(tau)))))) / x);
    };
    let worst = 0;
    for (let e = -7; e <= 1.5; e += 0.05) {
      for (const sign of [-1, 1]) {
        const tau = 1.5;
        const sunA = 20;
        const sunB = sign * 10 ** e - tau + sunA;
        const exact = cloudSlabInStepLight(tau, sunA, sunB);
        worst = Math.max(worst, Math.abs(f32(tau, sunA, sunB) - exact) / exact);
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-4);
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
    // The march integrates the exponent (plan 2026-09-26-0549 §2 change 1).
    for (const h of [-10, 0, 30, 200, 450]) {
      expect(cloudSlabSunOpticalDepth(h, 400, 0.3)).toBeGreaterThanOrEqual(0);
      expect(Math.exp(-cloudSlabSunOpticalDepth(h, 400, 0.3))).toBeCloseTo(
        cloudSlabSunTransmittance(h, 400, 0.3),
        14
      );
    }
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
      // From above (uniform nodes, the secant step through a flat top).
      for (const jitter of [0, 0.3, 1]) {
        const down = cloudSlabMarch({
          camera: [0, 3200, 0],
          dir: [0, -1, 0],
          steps,
          sample: uniform(theta),
          threshold: theta,
          jitter,
        });
        expect(down.opacity).toBeCloseTo(0.5, 9);
      }
    }
  });

  // WHY (M2 review L4): a direction that is not unit length must march
  // the same ray, not put its samples at the wrong distances.
  it('marches the same ray for a direction of any length', () => {
    const at = (dir: Vec3) =>
      cloudSlabMarch({
        camera: [0, 18, 0],
        dir,
        steps: 16,
        sample: (x) => 0.55 + 0.1 * Math.sin(x / 700),
        threshold: 0.6,
      }).alpha;
    expect(at([3, 5, -2])).toBeCloseTo(at(unit([3, 5, -2])), 12);
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
      S.earlyExitTransmittance,
      S.uniformBlendM,
      S.lightSeriesX,
    ]) {
      expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(glslFloat(v));
    }
    // The march cap and the far fade are the reach's uniform since R1
    // (globe volume-cloud plan §13); the reach tests below hold them.
  });

  // WHY (cold review finding 3, cost): inside the loop implicit derivatives
  // are undefined, so the noise is read with an explicit level (through
  // `atmSlabNoiseAt`, which the entry node shares); and the light's LUT
  // reads are hoisted, the same for every segment.
  it('reads the noise with explicit levels in the loop and hoists the light', () => {
    const body = loop();
    expect(body).toContain('atmSlabNoiseAt(');
    const helper = CLOUD_SLAB_FRAGMENT_GLSL.slice(
      CLOUD_SLAB_FRAGMENT_GLSL.indexOf('float atmSlabNoiseAt('),
      CLOUD_SLAB_FRAGMENT_GLSL.indexOf('highp float atmSlabInStepLight(')
    );
    expect(helper).toContain('atmCloudNoiseLod(');
    for (const banned of [
      'texture2D(',
      'texture(',
      'atmCloudNoise(',
      'atmCloudLit(',
      'atmCloudTopLit(',
    ]) {
      expect(body).not.toContain(banned);
      expect(helper).not.toContain(banned);
    }
  });

  // WHY (M2 review M1, re-pinned by plan 2026-09-26-0549 §4): the CPU
  // twin's tests run the TypeScript march, so the SHADER's own nodes, secant
  // step, exact height integral and in-segment light are pinned here. A
  // point-sampled reach, the reach's ends swapped, nodes that do not tile the
  // interval or a lost small-x guard would pass every other test.
  it('marches jittered nodes, the secant step, the exact integral and the in-segment light', () => {
    const body = loop();
    for (const line of [
      'for (int i = 0; i <= ATM_SLAB_STEPS; i++) {',
      'float u = i == ATM_SLAB_STEPS ? 1.0 : (float(i) + jitter) / float(ATM_SLAB_STEPS);',
      'float tb = tIn + mix(u * u, u, share) * lengthM;',
      'float fa = da >= 0.0 ? 0.0 : da / (da - db);',
      'float fb = db >= 0.0 ? 1.0 : da / (da - db);',
      'abs(atmSlabCumulative(h1) - atmSlabCumulative(h0)) / abs(dir.y)',
      '(top - under) * atmSlabInStepLight(tau, sunA, sunB)',
      'ta = tb;',
      'na = nb;',
    ]) {
      expect(body).toContain(line);
    }
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain('float ta = tIn;');
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(
      'float share = smoothstep(ATM_SLAB_TOP, ATM_SLAB_TOP + ATM_SLAB_UNIFORM_BLEND, y);'
    );
    // The in-segment light: highp, the closed form with no positive
    // exponent, and the series below the limit (GLSL has no expm1).
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(
      'highp float atmSlabInStepLight(highp float tau, highp float sunA, highp float sunB) {'
    );
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(
      'if (abs(x) < ATM_SLAB_LIGHT_SERIES) return tau * ra * (1.0 - 0.5 * x + x * x / 6.0);'
    );
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(
      'return tau * (ra - exp(-sunB - tau)) / x;'
    );
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

describe('the node jitter', () => {
  // WHY (found on the look-dev page, plan 2026-09-24-1010 §13; restated by
  // plan 2026-09-26-0549 §4): a fixed placement drew the far deck as
  // terraced bands at level rays. The shader moves the INTERIOR nodes per
  // pixel; the entry and the exit never move, so the segments always tile
  // the interval and the exact integral keeps a uniform column's opacity
  // independent of the jitter. This SUPERSEDES "the step bounds do not
  // move": the nodes are now the bounds, and jittered nodes measured less
  // bias than fixed ones at every view (W2 M1 notes).
  it('moves each interior node inside its step and never the entry or the exit', () => {
    const L = 21_000;
    for (const share of [0, 0.5, 1]) {
      const first = cloudSlabNodes(16, L, 0, share);
      const last = cloudSlabNodes(16, L, 1, share);
      for (const jitter of [0, 0.25, 0.9999, 1]) {
        const nodes = cloudSlabNodes(16, L, jitter, share);
        expect(nodes[0]).toBe(0);
        expect(nodes[17]).toBe(L);
        for (let k = 1; k <= 16; k++) {
          expect(nodes[k]).toBeGreaterThanOrEqual(first[k]!);
          expect(nodes[k]).toBeLessThanOrEqual(last[k]!);
          expect(nodes[k]).toBeGreaterThanOrEqual(nodes[k - 1]!);
        }
      }
    }
    expect(() => cloudSlabNodes(16, 1000, 1.5)).toThrow(RangeError);
    expect(() => cloudSlabNodes(16, 1000, Number.NaN)).toThrow(RangeError);
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

  it('is computed per pixel in the shader and moves only the interior nodes', () => {
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toMatch(
      /float jitter = fract\(.*gl_FragCoord/
    );
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain(
      'float u = i == ATM_SLAB_STEPS ? 1.0 : (float(i) + jitter)'
    );
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain('float ta = tIn;');
  });
});

/**
 * The noise as the shader reads it at level 0 (`atmCloudNoiseLod`): two
 * bilinear reads of the 8-bit texture (texel centres at half texels,
 * wrapped), the second at the octave's frequency and offset.
 */
const shaderNoise = (() => {
  const size = CLOUD_TEXTURE_SIZE;
  const data = cloudNoise(size, 1);
  const texelM = (CLOUD_LAYER.tileKm * 1000) / size;
  const wrap = (i: number) => ((i % size) + size) % size;
  const tex = (i: number, j: number) => data[wrap(j) * size + wrap(i)]! / 255;
  const bilinear = (u: number, v: number) => {
    const i = Math.floor(u - 0.5);
    const j = Math.floor(v - 0.5);
    const fu = u - 0.5 - i;
    const fv = v - 0.5 - j;
    return (
      (tex(i, j) * (1 - fu) + tex(i + 1, j) * fu) * (1 - fv) +
      (tex(i, j + 1) * (1 - fu) + tex(i + 1, j + 1) * fu) * fv
    );
  };
  const c = CLOUD_LAYER;
  const offset = c.secondOctaveOffset * size;
  return (x: number, z: number) => {
    const u = x / texelM;
    const v = z / texelM;
    return (
      c.firstOctaveWeight * bilinear(u, v) +
      (1 - c.firstOctaveWeight) *
        bilinear(
          u * c.secondOctaveFrequency + offset,
          v * c.secondOctaveFrequency + offset
        )
    );
  };
})();

type MarchInput = Parameters<typeof cloudSlabMarch>[0];
type Light = NonNullable<MarchInput['light']>;

/**
 * The REFERENCE path (plan 2026-09-26-0549 §4): the SHIPPED point-sampled
 * march at any step count, which `cloudSlabNodes` refuses outside 8/16/24/32.
 * One noise read per step, that column's exact vertical integral, the sun's
 * reach at the sample point, the early exit. Built only from the exported
 * primitives, never from the nodes, the secant or the in-step light, so it
 * is independent of the code it judges. `quadratic` with a shipped count is
 * the march this plan replaced, exactly (pinned below).
 */
function referenceMarch(input: MarchInput & { quadratic?: boolean }): {
  alpha: number;
  opacity: number;
  colour: [number, number, number];
} {
  const { camera, dir, steps, sample, threshold, light } = input;
  const jitter = input.jitter ?? 0.5;
  const result = {
    alpha: 0,
    opacity: 0,
    colour: [0, 0, 0] as [number, number, number],
  };
  const interval = cloudSlabInterval(camera[1], dir);
  if (interval === null || !Number.isFinite(threshold)) return result;
  const L = interval.outM - interval.inM;
  const at = (u: number) => interval.inM + (input.quadratic ? u * u : u) * L;
  const horizontal = Math.hypot(dir[0], dir[2]);
  const cos = light
    ? dir[0] * light.sunDir[0] +
      dir[1] * light.sunDir[1] +
      dir[2] * light.sunDir[2]
    : 0;
  let transmittance = 1;
  for (let i = 0; i < steps; i++) {
    const t0 = at(i / steps);
    const t1 = at((i + 1) / steps);
    const t = at((i + jitter) / steps);
    const noise = sample(camera[0] + dir[0] * t, camera[2] + dir[2] * t, 0);
    const T = cloudSlabThicknessM(noise, threshold);
    const tau = cloudSlabStepOpticalDepth(camera[1], dir[1], t0, t1, T);
    const k =
      transmittance *
      (1 - Math.exp(-tau)) *
      cloudSlabFarWeight(t * horizontal) *
      Math.exp((-t * 0.001) / CLOUD_LAYER.aerialKm);
    if (light) {
      const s = cloudSlabSourceRadiance(
        light.sunTransmittance,
        cos,
        cloudDensity(noise, threshold),
        light.zenith,
        light.sunDir[1],
        cloudSlabSunTransmittance(
          camera[1] + dir[1] * t - S.baseM,
          T,
          light.sunDir[1]
        )
      );
      result.colour[0] += k * s[0];
      result.colour[1] += k * s[1];
      result.colour[2] += k * s[2];
    }
    result.alpha += k;
    transmittance *= Math.exp(-tau);
    if (transmittance < S.earlyExitTransmittance) break;
  }
  result.opacity = 1 - transmittance;
  return result;
}

/**
 * The sun at an elevation, the geometry every bound below names: its
 * transmittance at cloud height from the CPU sky model, a zenith sky
 * scaled with the sun (fixed values: triage §14 L5 applies here too).
 */
function lightAt(elevationDeg: number): Light {
  const sunDir = dirAt(elevationDeg, 180);
  const sunTransmittance = transmittanceToTop(
    EARTH_ATMOSPHERE.groundRadiusKm + CLOUD_LAYER.altitudeKm,
    sunDir[1],
    { visibilityKm: 40 }
  );
  const z = Math.min(1, Math.max(sunDir[1], 0.1) / 0.85);
  return { sunTransmittance, sunDir, zenith: [0.01 * z, 0.015 * z, 0.03 * z] };
}

/** Interleaved gradient noise: the shader's static per-pixel jitter. */
const ign = (x: number, y: number) => {
  const fract = (v: number) => v - Math.floor(v);
  return fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));
};

/**
 * A view from height `y` at `pitch` (degrees, negative looks down): 4 camera
 * positions × away from and toward the sun (±15°) × 20 rows over ±15°.
 */
function viewPixels(y: number, pitch: number) {
  const pixels: { camera: Vec3; dir: Vec3; col: number; row: number }[] = [];
  for (let p = 0; p < 4; p++) {
    for (const [a, azimuth] of [0, 180].entries()) {
      const camera: Vec3 = [500 + 3100 * p, y, 300 + 1900 * p];
      for (let row = 0; row < 20; row++) {
        const el = pitch - 15 + (30 * (row + 0.5)) / 20;
        pixels.push({
          camera,
          dir: dirAt(el, azimuth + (p % 2 ? 15 : -15)),
          col: 2 * p + a,
          row,
        });
      }
    }
  }
  return pixels;
}

const rmsOf = (v: number[]) =>
  Math.sqrt(v.reduce((s, x) => s + x * x, 0) / Math.max(v.length, 1));
const sum = (c: readonly number[]) => c[0]! + c[1]! + c[2]!;

/**
 * A march's error on a view against the 1024-step reference, on cloud
 * pixels (either alpha above 0.05), in units of the sheet top's radiance
 * for that sun (RGB sums): `bias` from the mean of 8 jittered frames (the
 * layers the jitter cannot hide), `single` from one frame with the shader's
 * static jitter (what the page shows). The reference early-exits too, as
 * the GPU's 256-step reference does.
 */
function viewError(
  march: (input: MarchInput) => { colour: readonly number[]; alpha: number },
  view: { y: number; pitch: number },
  sunEl: number,
  steps: number,
  cover = 0.5
): { bias: number; single: number } {
  const light = lightAt(sunEl);
  const norm = sum(
    cloudTopRadiance(light.sunTransmittance, light.sunDir[1], light.zenith)
  );
  const threshold = cloudThreshold(cover);
  const bias: number[] = [];
  const single: number[] = [];
  for (const p of viewPixels(view.y, view.pitch)) {
    const base = {
      camera: p.camera,
      dir: p.dir,
      sample: shaderNoise,
      threshold,
      light,
    };
    const ref = referenceMarch({ ...base, steps: 1024 });
    let colour = 0;
    let alpha = 0;
    for (let k = 0; k < 8; k++) {
      const m = march({ ...base, steps, jitter: (k + 0.5) / 8 });
      colour += sum(m.colour) / 8;
      alpha += m.alpha / 8;
    }
    if (!(ref.alpha > 0.05 || alpha > 0.05)) continue;
    const one = march({ ...base, steps, jitter: ign(p.col * 7 + 3, p.row) });
    bias.push((colour - sum(ref.colour)) / norm);
    single.push((sum(one.colour) - sum(ref.colour)) / norm);
  }
  return { bias: rmsOf(bias), single: rmsOf(single) };
}

const fixed = (input: MarchInput) => cloudSlabMarch(input);
const shipped = (input: MarchInput) =>
  referenceMarch({ ...input, quadratic: true });

describe('the reference path', () => {
  // WHY (plan 2026-09-26-0549 §4): every bound below is measured against the
  // point-sampled march this plan replaced; the reference must BE that march
  // at the shipped counts. The numbers were recorded from the pre-change
  // `cloudSlabMarch` on 2026-09-26 (scratch w2m1/pin.mjs).
  it('reproduces the replaced march exactly at the shipped counts', () => {
    const cases = [
      {
        camera: [3600, 3200, 2200] as Vec3,
        dir: dirAt(-65, 15),
        steps: 8,
        jitter: 0.5,
        cover: 0.5,
        sun: 58,
        alpha: 0.9621254179985599,
        colour: 0.49749123500286085,
      },
      {
        camera: [3600, 18, 2200] as Vec3,
        dir: dirAt(40, 200),
        steps: 16,
        jitter: 0.25,
        cover: 0.9,
        sun: 14.48,
        alpha: 0.9478434270006281,
        colour: 0.2052208188092708,
      },
      {
        camera: [6700, 2000, 4100] as Vec3,
        dir: dirAt(-10, 100),
        steps: 32,
        jitter: 0.8,
        cover: 0.3,
        sun: 5,
        alpha: 0.9927944984726794,
        colour: 0.03475010173470404,
      },
    ];
    for (const c of cases) {
      const m = referenceMarch({
        camera: c.camera,
        dir: c.dir,
        steps: c.steps,
        jitter: c.jitter,
        sample: shaderNoise,
        threshold: cloudThreshold(c.cover),
        light: lightAt(c.sun),
        quadratic: true,
      });
      expect(m.alpha).toBeCloseTo(c.alpha, 12);
      expect(sum(m.colour)).toBeCloseTo(c.colour, 12);
    }
  });
});

describe('the march from above, below and inside (plan 2026-09-26-0549 M1)', () => {
  // WHY: the twin must read the noise exactly where the shader does, at the
  // nodes `cloudSlabNodes` names for its camera's spacing (uniform above,
  // blended just above the top, quadratic below and inside). The error
  // bounds below cannot see the spacing at steep views (1.0-1.3x), so
  // without this a twin that ignored the rule would pass (mutant checked).
  it("reads the noise at the nodes of its camera's spacing", () => {
    const dir = dirAt(-40, 30);
    const up = dirAt(40, 30);
    for (const [y, d] of [
      [3200, dir],
      [2210, dir],
      [2000, dirAt(-10, 30)],
      [18, up],
    ] as [number, Vec3][]) {
      const camera: Vec3 = [100, y, -200];
      const horizontal = Math.hypot(d[0], d[2]);
      const read: number[] = [];
      cloudSlabMarch({
        camera,
        dir: d,
        steps: 8,
        jitter: 0.3,
        threshold: 0.6,
        sample: (x, z) => {
          read.push(Math.hypot(x - camera[0], z - camera[2]) / horizontal);
          return 0;
        },
      });
      const interval = cloudSlabInterval(y, d)!;
      const nodes = cloudSlabNodes(
        8,
        interval.outM - interval.inM,
        0.3,
        cloudSlabUniformShare(y)
      );
      expect(read).toHaveLength(nodes.length);
      read.forEach((t, k) =>
        expect(t).toBeCloseTo(interval.inM + nodes[k]!, 6)
      );
    }
  });

  // WHY (the owner's report, plan §1 and §5): from above the shipped march
  // drew contour layers, because it read one column and one sun reach per
  // slice. At 8 steps the new march must stay under a bound the shipped 8
  // steps exceeds at least twice over, per pose and sun, so the test can
  // tell them apart and a regression toward the old march fails it.
  // Each bound sits between the two, near their geometric mean. MEASURED
  // 2026-09-26 on this test's own views (new 8 / shipped 8, bias RMS in
  // top-radiance units): 3200 m 65°: 0.0012 / 0.0107 at noon, 0.0012 /
  // 0.0130 at 25°, 0.0037 / 0.0240 at 5°; 2300 m 65°: 0.0012 / 0.0209,
  // 0.0012 / 0.0249, 0.0038 / 0.0165; 5000 m 90°: 0.0010 / 0.0125, 0.0034 /
  // 0.0227; 2600 m 30°: 0.0053 / 0.0458, 0.0321 / 0.1903. Not held here, and
  // recorded: 3200 m 30° (0.060 / 0.038 at noon on these views, 0.026 /
  // 0.053 on the notes' wider grid: one sub-node cloud decides it) and every
  // 15° or 5° view (1.3-5x better, not solved; plan §2 change 3).
  const ABOVE = [
    { y: 3200, pitch: -65, sun: 58, bound: 0.0025 },
    { y: 3200, pitch: -65, sun: 25, bound: 0.003 },
    { y: 3200, pitch: -65, sun: 5, bound: 0.007 },
    { y: 2300, pitch: -65, sun: 58, bound: 0.0035 },
    { y: 2300, pitch: -65, sun: 25, bound: 0.004 },
    { y: 2300, pitch: -65, sun: 5, bound: 0.0055 },
    { y: 5000, pitch: -90, sun: 58, bound: 0.0025 },
    { y: 5000, pitch: -90, sun: 5, bound: 0.006 },
    { y: 2600, pitch: -30, sun: 58, bound: 0.011 },
    { y: 2600, pitch: -30, sun: 5, bound: 0.055 },
  ];
  it.each(ABOVE)(
    'from $y m, $pitch°, sun $sun°: under $bound at 8 steps, the shipped march over twice that',
    ({ y, pitch, sun, bound }) => {
      const now = viewError(fixed, { y, pitch }, sun, 8);
      const before = viewError(shipped, { y, pitch }, sun, 8);
      expect(now.bias).toBeLessThanOrEqual(bound);
      expect(before.bias).toBeGreaterThanOrEqual(2 * bound);
    }
  );

  // WHY (plan §4): the view from below and from inside was never the
  // complaint and must not regress. At the shipped 16 steps the new march
  // stays within 1.15x of the shipped 16 (bias and single frame), and at 8
  // its bias within the shipped 8's, each plus 0.002 of the top's radiance:
  // the floor the early exit leaves when a coarse march overshoots the 1 %
  // cut the reference stops at (with the exit off on both sides, the new
  // march's bias from below at the zenith is under 5e-5, 58-122x below the
  // shipped 8). MEASURED 2026-09-26,
  // the tightest: 1900 m level at 5°, one frame at 16, 0.413 against the
  // shipped 0.369 (bound 0.426). NOT held, and recorded: one frame at 8
  // inside looking up 25° at 5° reads 0.027 against the shipped 8's 0.024
  // (the nodes' grain; the bias is equal), and at 8 against the SHIPPED 16
  // the bias from below is up to 2.2x (0.0048 / 0.0021 at the zenith, 5°):
  // the M4 question (8 steps as the default) is the owner's.
  const BELOW = [
    { y: 18, pitch: 20 },
    { y: 18, pitch: 45 },
    { y: 18, pitch: 90 },
    { y: 2000, pitch: -25 },
    { y: 2000, pitch: 0 },
    { y: 2000, pitch: 25 },
    { y: 1900, pitch: 0 },
  ].flatMap((p) => [58, 14.48, 5].map((sun) => ({ ...p, sun })));
  it.each(BELOW)(
    'from $y m, $pitch°, sun $sun°: no worse than the shipped march',
    ({ y, pitch, sun }) => {
      const floor = 0.002;
      const now16 = viewError(fixed, { y, pitch }, sun, 16);
      const before16 = viewError(shipped, { y, pitch }, sun, 16);
      const now8 = viewError(fixed, { y, pitch }, sun, 8);
      const before8 = viewError(shipped, { y, pitch }, sun, 8);
      expect(now16.bias).toBeLessThanOrEqual(1.15 * before16.bias + floor);
      expect(now16.single).toBeLessThanOrEqual(1.15 * before16.single + floor);
      expect(now8.bias).toBeLessThanOrEqual(before8.bias + floor);
    }
  );

  // WHY (plan §4, the x < 0 regime, and the small-x guard): a vertical ray
  // from the street through a column, at a low sun where the reach grows up
  // the column faster than the view dims (x < 0: k/μ = 2.5), at the sun
  // where they cancel (x = 0 exactly: sin(elevation) = k), and at noon.
  // MEASURED 2026-09-26 against 8192 reference steps: at most 4.4e-5 of the
  // top's radiance at 8 steps (the shipped 8: up to 0.020).
  it('lights a column from below at every sign of x, finite at x = 0', () => {
    const k = S.sunDepthScale;
    const suns: Light[] = [lightAt(5), lightAt(58)];
    const exactZero = lightAt(20);
    suns.push({ ...exactZero, sunDir: [Math.sqrt(1 - k * k), k, 0] });
    for (const light of suns) {
      for (const T of [60, 150, 250]) {
        const noise = 0.6 + (T - T0) / S.heightScaleM;
        const input = {
          camera: [0, 18, 0] as Vec3,
          dir: [0, 1, 0] as Vec3,
          sample: () => noise,
          threshold: 0.6,
          light,
        };
        const ref = referenceMarch({ ...input, steps: 8192 });
        const norm = sum(
          cloudTopRadiance(
            light.sunTransmittance,
            light.sunDir[1],
            light.zenith
          )
        );
        for (const steps of [8, 16]) {
          const m = cloudSlabMarch({ ...input, steps });
          expect(Number.isFinite(sum(m.colour))).toBe(true);
          expect(
            Math.abs(sum(m.colour) - sum(ref.colour)) / norm
          ).toBeLessThanOrEqual(1e-4);
        }
      }
    }
  });
});

describe('the forward scattering in the march (round-3 plan 2026-09-27-0532, DEC-FB3-6)', () => {
  const theta = 0.6;
  const sunDir = dirAt(50, 90);
  const sunT: Vec3 = [0.9, 0.88, 0.8];
  const zenith: Vec3 = [0.01, 0.015, 0.03];
  const march = (
    noise: number,
    forward: number | undefined,
    dir: Vec3,
    silverLining = forward
  ) =>
    cloudSlabMarch({
      camera: [0, 18, 0],
      dir,
      steps: 8,
      sample: () => noise,
      threshold: theta,
      light: {
        sunTransmittance: sunT,
        sunDir,
        zenith,
        aureole: forward,
        silverLining,
      },
    });

  // WHY: off (0 or omitted) must be exactly today's march, or every
  // measurement taken before the glow existed changes under it.
  it('adds nothing when off', () => {
    const off = march(theta, undefined, sunDir);
    expect(march(theta, 0, sunDir).colour).toEqual(off.colour);
  });

  // WHY: looking at the sun through a thin column, the glow is the model's
  // E·phase·τe^(-τ), weighted like the samples (alpha over the opacity),
  // computed here from the column's own optical depth, not from the march.
  it('adds E·phase·τe^(-τ) toward the sun through thin cloud', () => {
    const off = march(theta, 0, sunDir);
    const on = march(theta, 1, sunDir);
    const tau = cloudColumnOpticalDepth(theta, theta, 18, sunDir[1]);
    const weight = on.alpha / on.opacity;
    for (let c = 0; c < 3; c++) {
      expect(on.colour[c]! - off.colour[c]!).toBeCloseTo(
        sunT[c]! * cloudForwardPhase(1) * tau * Math.exp(-tau) * weight,
        6
      );
    }
    // Each lobe alone adds its own share: the two add up to both on.
    const aureoleOnly = march(theta, 1, sunDir, 0);
    const silverOnly = march(theta, 0, sunDir, 1);
    for (let c = 0; c < 3; c++) {
      const gainA = aureoleOnly.colour[c]! - off.colour[c]!;
      const gainS = silverOnly.colour[c]! - off.colour[c]!;
      expect(gainA).toBeGreaterThan(0);
      expect(gainS).toBeGreaterThan(0);
      expect(gainA + gainS).toBeCloseTo(on.colour[c]! - off.colour[c]!, 9);
      expect(gainA).toBeCloseTo(
        sunT[c]! * cloudForwardPhaseOf(1, 1, 0) * tau * Math.exp(-tau) * weight,
        6
      );
    }
    // Away from the sun the glow is far weaker (the forward phase).
    const away = dirAt(50, 270);
    const gainAway =
      march(theta, 1, away).colour[0] - march(theta, 0, away).colour[0];
    expect(gainAway).toBeLessThan((on.colour[0] - off.colour[0]) / 50);
  });

  // WHY: past the early exit the depth is unknown; the glow is faded out
  // before it, so a thick cloud never glows at the exit's depth.
  it('adds nothing through a cloud thick enough to exit early', () => {
    const thick = theta + 1;
    const off = march(thick, 0, sunDir);
    expect(off.opacity).toBeGreaterThan(1 - CLOUD_SLAB.earlyExitTransmittance);
    expect(march(thick, 1, sunDir).colour).toEqual(off.colour);
  });
});

describe('CLOUD_SLAB_FRAGMENT_GLSL forward scattering', () => {
  // WHY: the CPU twin above is only the shader's stand-in if the shader
  // does the same after its loop: the marched depth, the sample weight and
  // the fade before the early exit, gated by the shared strength uniform.
  it('adds the glow after the loop, weighted and faded like the twin', () => {
    const g = CLOUD_SLAB_FRAGMENT_GLSL;
    const after = g.slice(g.indexOf('// atm-slab-loop-end'));
    expect(after).toContain('if (atmCloudForward.x + atmCloudForward.y > 0.0)');
    expect(after).toContain('-log(max(transmittance, 1e-6))');
    expect(after).toContain('alpha / max(1.0 - transmittance, 1e-6)');
    expect(after).toContain(
      'smoothstep(ATM_SLAB_EARLY_EXIT, ATM_SLAB_FORWARD_KNOWN * ATM_SLAB_EARLY_EXIT, transmittance)'
    );
    expect(after.indexOf('atmCloudForwardRadiance(')).toBeLessThan(
      after.indexOf('vec3 lit = colour / alpha;')
    );
    expect(g).toContain(
      `ATM_SLAB_FORWARD_KNOWN = ${glslFloat(CLOUD_SLAB.forwardKnownFactor)}`
    );
  });
});

describe('the scene depth (globe F2 plan 2026-10-03-1922, F2c)', () => {
  // WHY: the slab is a back-faced prism drawn with the depth test, so a
  // ridge in front of the prism's FAR face hid the whole pixel, the cloud
  // between the camera and the ridge with it, and a deck over a valley
  // marched on below the ground. With the scene's depth the march ends at
  // the scene instead (the interval's twin), and the depth test is off.
  it('ends the interval at the scene, and has none when the scene is nearer than the slab', () => {
    const down = cloudSlabInterval(3200, [0, -1, 0], 1250)!;
    expect(down.inM).toBeCloseTo(3200 - S.topM, 9);
    expect(down.outM).toBe(1250);
    // A ridge in front of the deck: nothing to march.
    expect(cloudSlabInterval(3200, [0, -1, 0], 900)).toBeNull();
    // A scene beyond the slab changes nothing.
    expect(cloudSlabInterval(3200, [0, -1, 0], 5000)).toEqual(
      cloudSlabInterval(3200, [0, -1, 0])
    );
  });

  it('refuses a scene distance that is negative or not a number', () => {
    expect(() => cloudSlabInterval(3200, [0, -1, 0], -1)).toThrow(RangeError);
    expect(() => cloudSlabInterval(3200, [0, -1, 0], Number.NaN)).toThrow(
      RangeError
    );
  });

  // The GPU half: opt-in by a define, so without a depth the shader is
  // today's; with one, the far end of the march is the scene's distance,
  // reconstructed through the same inverse projection as the ray.
  it('reads the depth only behind its define, and clips the interval with it', () => {
    const g = CLOUD_SLAB_FRAGMENT_GLSL;
    const block = g.slice(
      g.indexOf('#ifdef ATM_SLAB_SCENE_DEPTH\n  float atmSceneDepth'),
      g.indexOf('if (tOut <= tIn) discard;')
    );
    expect(block).toContain('texture2D(atmSlabSceneDepth');
    expect(block).toContain('atmSlabInverseProjection');
    expect(block).toContain('tOut = min(tOut,');
    expect(g).toContain(
      '#ifdef ATM_SLAB_SCENE_DEPTH\nuniform sampler2D atmSlabSceneDepth;'
    );
  });

  it('turns the depth on and off on the mesh: the define, the texture and the depth test', () => {
    const slab = createCloudSlab({
      atmCloudThreshold: { value: 0.6 },
      atmCloudCover: { value: 0.5 },
    });
    const m = slab.material as THREE.ShaderMaterial;
    expect(m.defines['ATM_SLAB_SCENE_DEPTH']).toBeUndefined();
    const depth = new THREE.DepthTexture(4, 4);
    const version = m.version;
    setCloudSlabSceneDepth(slab, depth);
    expect(m.defines['ATM_SLAB_SCENE_DEPTH']).toBe(1);
    expect(m.defines['ATM_SLAB_STEPS']).toBe(S.defaultSteps);
    expect(m.uniforms['atmSlabSceneDepth']!.value).toBe(depth);
    expect(m.depthTest).toBe(false);
    expect(m.version).toBeGreaterThan(version);
    setCloudSlabSceneDepth(slab, null);
    expect(m.defines['ATM_SLAB_SCENE_DEPTH']).toBeUndefined();
    expect(m.uniforms['atmSlabSceneDepth']!.value).toBeNull();
    expect(m.depthTest).toBe(true);
  });

  // Swapping one depth texture for another (a resize) is a uniform change,
  // not a new program.
  it('swaps one depth for another without a new program', () => {
    const slab = createCloudSlab({});
    const m = slab.material as THREE.ShaderMaterial;
    setCloudSlabSceneDepth(slab, new THREE.DepthTexture(4, 4));
    const version = m.version;
    const next = new THREE.DepthTexture(8, 8);
    setCloudSlabSceneDepth(slab, next);
    expect(m.version).toBe(version);
    expect(m.uniforms['atmSlabSceneDepth']!.value).toBe(next);
  });
});

describe('the coverage map and the disc (globe volume-cloud plan 2026-10-05-0016, C1)', () => {
  // WHY: the globe's clouds are one map; a volume near the camera must put
  // its clouds where the map has them, or the swap from the shell to the
  // volume changes the pattern (the "plop" the owner ruled out). The map
  // gives a cover per column, and the cover becomes a threshold through the
  // noise's own quantiles, the same rule the global cover uses.
  // WHY: the per-position threshold must leave today's march exactly as it
  // is when it is constant (OsmDemo and the look-dev pages never set it).
  it('marches exactly as before with a constant per-position threshold', () => {
    const base = {
      camera: [0, 3200, 0] as Vec3,
      dir: unit([1, -0.6, 0.2]),
      steps: 16,
      sample: (x: number, z: number) =>
        0.5 + 0.3 * Math.sin(x * 0.001 + z * 0.0007),
      threshold: 0.62,
      light: {
        sunTransmittance: [0.9, 0.85, 0.7] as Vec3,
        sunDir: unit([0.3, 0.8, 0.2]),
        zenith: [0.1, 0.2, 0.4] as Vec3,
      },
    };
    const before = cloudSlabMarch(base);
    const after = cloudSlabMarch({ ...base, thresholdAt: () => 0.62 });
    expect(after).toEqual(before);
    expect(before.opacity).toBeGreaterThan(0);
  });

  // WHY: the map decides where the clouds are: the same noise, clouds east
  // of x = 0 and clear west of it, gives cloud only toward the east.
  it('puts the clouds where the per-position threshold says', () => {
    const cloudy = cloudThresholdForCover(0.9);
    const thresholdAt = (x: number) => (x > 0 ? cloudy : 2);
    const march = (dir: Vec3) =>
      cloudSlabMarch({
        camera: [0, 3200, 0],
        dir: unit(dir),
        steps: 16,
        sample: () => 0.6,
        threshold: 2,
        thresholdAt,
      });
    expect(march([1, -0.5, 0]).opacity).toBeGreaterThan(0.1);
    expect(march([-1, -0.5, 0]).opacity).toBe(0);
  });

  // WHY: beyond the disc the shell draws the clouds; the volume must have
  // nothing there, or both would draw them. Seen from above, the slab's
  // entry about 10 km out: a 2 km disc leaves every node beyond it (the
  // threshold is read at the nodes, so a camera inside its own disc would
  // carry a sliver of cloud in its first segment by design).
  it('draws nothing beyond the disc', () => {
    const cloudy = cloudThresholdForCover(0.9);
    const march = (radiusM: number) =>
      cloudSlabMarch({
        camera: [0, 3_200, 0],
        dir: unit([10, -1, 0]),
        steps: 16,
        sample: () => 0.6,
        threshold: 2,
        thresholdAt: (x, z) =>
          cloudDiscThreshold(cloudy, Math.hypot(x, z), radiusM),
      });
    expect(march(40_000).opacity).toBeGreaterThan(0.1);
    expect(march(2_000).opacity).toBe(0);
  });

  // The GPU half: opt-in by defines, so without them the shader is today's.
  it('reads the coverage and the disc only behind their defines', () => {
    const g = CLOUD_SLAB_FRAGMENT_GLSL;
    // The shared chunk (cloud-coverage.ts), read at both nodes.
    expect(g).toContain(CLOUD_COVERAGE_GLSL);
    // The march reads the per-position threshold at both nodes.
    expect(g).toContain('atmSlabRawThickness(na, tha)');
    expect(g).toContain('atmSlabRawThickness(nb, thb)');
  });

  it('turns the coverage and the disc on and off on the mesh', () => {
    const slab = createCloudSlab({});
    const m = slab.material as THREE.ShaderMaterial;
    const plain = m.fragmentShader;
    expect(m.defines['ATM_CLOUD_COVERAGE']).toBeUndefined();
    const map = new THREE.Texture();
    setCloudSlabCoverage(slab, {
      glsl: 'uniform sampler2D uMap;\nfloat atmCloudCoverageAt(vec2 xz) { return texture2D(uMap, xz).r; }',
      uniforms: { uMap: { value: map } },
    });
    expect(m.defines['ATM_CLOUD_COVERAGE']).toBe(1);
    expect(m.fragmentShader).toContain('float atmCloudCoverageAt(vec2 xz)');
    expect(m.uniforms['uMap']!.value).toBe(map);
    expect(m.uniforms['atmCoverThresholds']!.value).toEqual(
      cloudCoverThresholds()
    );
    setCloudSlabRadius(slab, 20_000);
    expect(m.defines['ATM_CLOUD_DISC']).toBe(1);
    expect(m.uniforms['atmCoverDiscM']!.value).toBe(20_000);
    setCloudSlabCoverage(slab, null);
    setCloudSlabRadius(slab, null);
    expect(m.defines['ATM_CLOUD_COVERAGE']).toBeUndefined();
    expect(m.defines['ATM_CLOUD_DISC']).toBeUndefined();
    expect(m.fragmentShader).toBe(plain);
  });

  it('refuses a coverage chunk without its function, or a radius that is not positive', () => {
    const slab = createCloudSlab({});
    expect(() =>
      setCloudSlabCoverage(slab, {
        glsl: 'float other() { return 0.0; }',
        uniforms: {},
      })
    ).toThrow(RangeError);
    expect(() => setCloudSlabRadius(slab, 0)).toThrow(RangeError);
    expect(() => setCloudSlabRadius(slab, Number.NaN)).toThrow(RangeError);
  });
});

// WHY (globe volume-cloud plan 2026-10-05-0016 §13, R1): the slab's reach
// was fixed at the look-dev page's 21 km (its far plane is 30 km), so in the
// globe, where the camera looks out over a deck hundreds of km wide, the
// volume ended 21 km from the camera and most of the horizon the owner
// looked at had none (2026-10-06). The reach is now a setting, its default
// the old constants, so the look-dev page draws exactly what it drew.
describe('the reach (globe volume-cloud plan §13, R1)', () => {
  const wide = { farStartM: 60_000, farEndM: 80_000 };

  it('defaults to the sheet far fade, which every other number was sized for', () => {
    expect(CLOUD_SLAB_REACH.farStartM).toBe(CLOUD_SHEET.farFadeStartM);
    expect(CLOUD_SLAB_REACH.farEndM).toBe(CLOUD_SHEET.farFadeEndM);
    const level = cloudSlabInterval(2000, [1, 0, 0]);
    expect(level?.outM).toBe(CLOUD_SHEET.farFadeEndM);
    expect(cloudSlabFarWeight(CLOUD_SHEET.farFadeEndM)).toBe(0);
  });

  it('moves the interval and the far fade out to a wider reach', () => {
    expect(cloudSlabInterval(2000, [1, 0, 0], Infinity, wide)?.outM).toBe(
      80_000
    );
    expect(cloudSlabFarWeight(60_000, wide)).toBe(1);
    expect(cloudSlabFarWeight(70_000, wide)).toBeGreaterThan(0);
    expect(cloudSlabFarWeight(70_000, wide)).toBeLessThan(1);
    expect(cloudSlabFarWeight(80_000, wide)).toBe(0);
    // The march cap grows with the reach (it must never end the clouds
    // before the far fade does).
    const steep = cloudSlabInterval(2000, [1, -0.001, 0], Infinity, wide);
    expect(steep?.outM).toBeGreaterThan(79_000);
  });

  it('draws clouds out to the wider reach in the march, where the default draws none', () => {
    // From 200 m above the top at a 1 % dip: the deck is entered 20 km out
    // and left 60 km out, all of it beyond the default's 21 km.
    const dir: [number, number, number] = [1, -0.01, 0];
    const input = {
      camera: [0, CLOUD_SLAB.topM + 200, 0] as [number, number, number],
      dir,
      steps: CLOUD_SLAB.defaultSteps,
      sample: () => 1,
      threshold: 0,
    };
    expect(cloudSlabMarch(input).alpha).toBeLessThan(0.05);
    expect(cloudSlabMarch({ ...input, reach: wide }).alpha).toBeGreaterThan(
      0.5
    );
  });

  it('sets the reach on the mesh as a uniform and grows the mesh to cover it', () => {
    const slab = createCloudSlab({});
    const m = slab.material as THREE.ShaderMaterial;
    const reach = () => m.uniforms['atmSlabReach']!.value as THREE.Vector3;
    expect(reach().x).toBe(CLOUD_SHEET.farFadeStartM);
    expect(reach().y).toBe(CLOUD_SHEET.farFadeEndM);
    expect(reach().z).toBe(CLOUD_SLAB.maxMarchM);
    expect(slab.scale.x).toBe(1);
    const program = m.fragmentShader;
    setCloudSlabReach(slab, wide);
    expect(reach().x).toBe(60_000);
    expect(reach().y).toBe(80_000);
    expect(reach().z).toBeGreaterThanOrEqual(
      Math.hypot(80_000, CLOUD_SLAB.topM)
    );
    expect(slab.scale.x * CLOUD_SLAB.radiusM).toBeGreaterThan(80_000);
    expect(slab.scale.z).toBe(slab.scale.x);
    expect(slab.scale.y).toBe(1);
    // A uniform, not a new program.
    expect(m.fragmentShader).toBe(program);
    setCloudSlabReach(slab, null);
    expect(reach().y).toBe(CLOUD_SHEET.farFadeEndM);
    expect(slab.scale.x).toBe(1);
  });

  it('reads the reach from the uniform in the shader, not from constants', () => {
    expect(CLOUD_SLAB_FRAGMENT_GLSL).toContain('uniform vec3 atmSlabReach;');
    expect(CLOUD_SLAB_FRAGMENT_GLSL).not.toContain('ATM_SLAB_FAR_END');
    expect(CLOUD_SLAB_FRAGMENT_GLSL).not.toContain('ATM_SLAB_MAX_MARCH');
  });

  it('refuses a reach whose fade does not start before it ends, or is not finite', () => {
    const slab = createCloudSlab({});
    for (const bad of [
      { farStartM: 80_000, farEndM: 60_000 },
      { farStartM: -1, farEndM: 60_000 },
      { farStartM: 0, farEndM: Number.POSITIVE_INFINITY },
      { farStartM: Number.NaN, farEndM: 60_000 },
    ]) {
      expect(() => setCloudSlabReach(slab, bad)).toThrow(RangeError);
      expect(() => cloudSlabFarWeight(1, bad)).toThrow(RangeError);
    }
  });
});

describe('the disc centre on the slab (globe volume-cloud plan §15)', () => {
  it('centres the disc on a world point as a uniform, and back on the camera', () => {
    const slab = createCloudSlab({});
    const m = slab.material as THREE.ShaderMaterial;
    const program = m.fragmentShader;
    const centre = () =>
      (m.uniforms['atmCoverDiscCentre']!.value as THREE.Vector3).toArray();
    expect(centre()).toEqual([0, 0, 1]);
    setCloudSlabDiscCentre(slab, { x: 12_000, z: -30_000 });
    expect(centre()).toEqual([12_000, -30_000, 0]);
    expect(m.fragmentShader).toBe(program);
    setCloudSlabDiscCentre(slab, null);
    expect(centre()[2]).toBe(1);
    expect(() => setCloudSlabDiscCentre(slab, { x: Number.NaN, z: 0 })).toThrow(
      RangeError
    );
  });
});
