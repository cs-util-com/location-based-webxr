/**
 * Tests for the cloud column's straight-line reading (round-3 plan
 * 2026-09-27-0532, stream D).
 *
 * Why this file matters: the sun disc behind a cloud, the cloud shadows on
 * the ground and the slab must agree on where the cloud is and how thick it
 * is, and none of them can be checked by eye against the other. So the
 * column's optical depth is proven here against the slab's own definition
 * of the cover (a column at the threshold lets exactly half through
 * straight up), its crossing point against plain geometry, and the GLSL
 * against the constants it must carry.
 */
import { describe, expect, it } from 'vitest';

import {
  CLOUD_COLUMN,
  CLOUD_COLUMN_GLSL,
  cloudColumnDistanceM,
  cloudColumnDrawn,
  cloudColumnOpticalDepth,
  cloudColumnTransmittanceToward,
  cloudColumnUv,
  cloudSlabThicknessM,
} from './cloud-column.js';
import { CLOUD_LAYER, cloudHorizonFade } from './cloud-layer.js';
import { CLOUD_SLAB, cloudSlabZenithOpacity } from './cloud-slab.js';
import { glslFloat } from '../../utils/glsl-float.js';

const THRESHOLD = 0.55;
const MID = (CLOUD_COLUMN.baseM + CLOUD_COLUMN.topM) / 2;

describe('the column model', () => {
  // The slab spreads the column's constants: one model, not two copies.
  it('is the slab’s column', () => {
    for (const key of Object.keys(
      CLOUD_COLUMN
    ) as (keyof typeof CLOUD_COLUMN)[]) {
      expect(CLOUD_SLAB[key]).toBe(CLOUD_COLUMN[key]);
    }
    // The dome's plane and the column's middle are the same 2 km: the disc
    // reads the dome's clouds where the dome draws them.
    expect(MID).toBe(CLOUD_LAYER.altitudeKm * 1000);
  });
});

describe('cloudColumnOpticalDepth', () => {
  // The cover's own definition (cloud-slab): a column at the threshold is
  // half opaque straight up. The straight line from the ground must agree.
  it('is ln 2 straight up from the ground through a column at the threshold', () => {
    expect(cloudColumnOpticalDepth(THRESHOLD, THRESHOLD, 0, 1)).toBeCloseTo(
      Math.LN2,
      12
    );
    for (const n of [0.4, 0.5, 0.6, 0.7]) {
      expect(
        1 - Math.exp(-cloudColumnOpticalDepth(n, THRESHOLD, 0, 1))
      ).toBeCloseTo(cloudSlabZenithOpacity(n, THRESHOLD), 12);
    }
  });

  // A slanted line crosses the column's height over 1/sin(elevation) of
  // path; below the floor the path stops growing (a level sun never divides
  // by 0).
  it('grows as 1/dirY down to the floor, and not below it', () => {
    const up = cloudColumnOpticalDepth(0.6, THRESHOLD, 0, 1);
    expect(cloudColumnOpticalDepth(0.6, THRESHOLD, 0, 0.5)).toBeCloseTo(
      up / 0.5,
      12
    );
    const floor = CLOUD_COLUMN.sunMuFloor;
    expect(cloudColumnOpticalDepth(0.6, THRESHOLD, 0, floor / 2)).toBeCloseTo(
      up / floor,
      12
    );
  });

  // Only the column ABOVE the point stops the light: a point in the layer
  // sees less of it, a point above the column's top none.
  it('counts only the column above the point', () => {
    const T = cloudSlabThicknessM(0.7, THRESHOLD);
    const below = cloudColumnOpticalDepth(0.7, THRESHOLD, 0, 1);
    const inside = cloudColumnOpticalDepth(
      0.7,
      THRESHOLD,
      CLOUD_COLUMN.baseM + T / 2,
      1
    );
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(below);
    expect(
      cloudColumnOpticalDepth(0.7, THRESHOLD, CLOUD_COLUMN.baseM + T + 1, 1)
    ).toBe(0);
  });

  // Thicker noise, thicker column; far below the threshold, nothing; a clear
  // sky (infinite threshold) never blocks.
  it('is monotone in the noise, 0 in the clear', () => {
    let previous = -1;
    for (let n = 0; n <= 1.0001; n += 0.02) {
      const tau = cloudColumnOpticalDepth(n, THRESHOLD, 0, 0.7);
      expect(tau).toBeGreaterThanOrEqual(previous);
      previous = tau;
    }
    expect(cloudColumnOpticalDepth(0.3, THRESHOLD, 0, 1)).toBe(0);
    expect(cloudColumnOpticalDepth(0.9, Number.POSITIVE_INFINITY, 0, 1)).toBe(
      0
    );
  });

  it('throws for a non-finite input', () => {
    expect(() => cloudColumnOpticalDepth(Number.NaN, THRESHOLD, 0, 1)).toThrow(
      RangeError
    );
    expect(() =>
      cloudColumnOpticalDepth(0.5, THRESHOLD, Number.POSITIVE_INFINITY, 1)
    ).toThrow(RangeError);
  });
});

describe('cloudColumnDistanceM', () => {
  // The distance along a line to the layer's middle: what the aerial melt
  // and the far fade of the disc's cloud are measured by.
  it('is the height to the middle over the slope, 0 above it', () => {
    expect(cloudColumnDistanceM(0, 0.5)).toBeCloseTo(MID / 0.5, 9);
    expect(cloudColumnDistanceM(1500, 1)).toBeCloseTo(MID - 1500, 9);
    expect(cloudColumnDistanceM(MID + 10, 0.3)).toBe(0);
    // A level line stays finite (the crossing's own floor).
    expect(Number.isFinite(cloudColumnDistanceM(0, 0))).toBe(true);
  });
});

describe('cloudColumnUv', () => {
  // Plain geometry: from (x, y, z) along d, the 2 km plane is reached after
  // (2000 - y)/d.y; the texture coordinate is metres over the 24 km tile.
  it('reads the column where the line crosses the layer’s middle', () => {
    const d: [number, number, number] = [0.6, 0.8, 0];
    const [u, v] = cloudColumnUv([100, 400, -50], d, [0.25, 0.5]);
    const s = (MID - 400) / 0.8;
    expect(u).toBeCloseTo((100 + 0.6 * s) / 24_000 + 0.25, 12);
    expect(v).toBeCloseTo(-50 / 24_000 + 0.5, 12);
  });

  // The dome's plane is camera-centred at 2 km: from the origin the column
  // reading is the dome's own texture coordinate (atmClouds).
  it('from the origin, is the dome’s coordinate', () => {
    const d: [number, number, number] = [0.3, 0.5, -0.81];
    const [u, v] = cloudColumnUv([0, 0, 0], d, [0, 0]);
    const t = CLOUD_LAYER.altitudeKm / d[1];
    expect(u).toBeCloseTo((d[0] * t) / CLOUD_LAYER.tileKm, 12);
    expect(v).toBeCloseTo((d[2] * t) / CLOUD_LAYER.tileKm, 12);
  });

  it('above the middle, reads the point’s own column', () => {
    const [u, v] = cloudColumnUv([2400, 2100, 1200], [0.6, 0.8, 0], [0, 0]);
    expect(u).toBeCloseTo(2400 / 24_000, 12);
    expect(v).toBeCloseTo(1200 / 24_000, 12);
  });
});

describe('cloudColumnTransmittanceToward', () => {
  const uniform = (n: number) => () => n;

  it('is e^(-optical depth) of the column the line crosses', () => {
    const dir: [number, number, number] = [0, 0.6, 0.8];
    const t = cloudColumnTransmittanceToward(
      [0, 0, 0],
      dir,
      THRESHOLD,
      uniform(0.62),
      [0, 0]
    );
    expect(t).toBeCloseTo(
      Math.exp(-cloudColumnOpticalDepth(0.62, THRESHOLD, 0, 0.6)),
      12
    );
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  // A light at or below the horizon and a clear sky pass unchanged: the
  // patch must never darken a scene without clouds.
  it('is 1 for a light below the horizon or a clear sky', () => {
    expect(
      cloudColumnTransmittanceToward(
        [0, 0, 0],
        [1, 0, 0],
        THRESHOLD,
        uniform(1),
        [0, 0]
      )
    ).toBe(1);
    expect(
      cloudColumnTransmittanceToward(
        [0, 0, 0],
        [0, 1, 0],
        Number.POSITIVE_INFINITY,
        uniform(1),
        [0, 0]
      )
    ).toBe(1);
  });

  // It reads the noise at the crossing, nowhere else.
  it('samples the noise at the crossing', () => {
    const seen: [number, number][] = [];
    cloudColumnTransmittanceToward(
      [10, 0, 20],
      [0, 1, 0],
      THRESHOLD,
      (u, v) => {
        seen.push([u, v]);
        return 0.5;
      },
      [0.1, 0.2]
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBeCloseTo(10 / 24_000 + 0.1, 12);
    expect(seen[0]![1]).toBeCloseTo(20 / 24_000 + 0.2, 12);
  });
});

describe('CLOUD_COLUMN_GLSL', () => {
  // The GLSL is only drawn in a browser; its constants must be the model's,
  // and it must be includable twice (the sky and a lit material can both
  // carry it next to other chunks).
  it('carries the model’s constants and an include guard', () => {
    const g = CLOUD_COLUMN_GLSL;
    expect(g).toContain('#ifndef ATM_CLOUD_COLUMN_GLSL');
    expect(g).toContain(`ATM_COLUMN_BASE = ${glslFloat(CLOUD_COLUMN.baseM)}`);
    expect(g).toContain(
      `ATM_COLUMN_SIGMA = ${glslFloat(CLOUD_COLUMN.extinctionPerM)}`
    );
    expect(g).toContain(`ATM_COLUMN_MID = ${glslFloat(MID)}`);
    expect(g).toContain(
      `ATM_COLUMN_MU_FLOOR = ${glslFloat(CLOUD_COLUMN.sunMuFloor)}`
    );
    expect(g).toContain('float atmColumnOpticalDepth(');
    expect(g).toContain('vec2 atmColumnUv(');
    // No uniform: every includer supplies its own inputs.
    expect(g).not.toContain('uniform');
  });
});

describe('cloudColumnDrawn and the view (round-3 review, finding 1)', () => {
  const FAR: [number, number] = [14_000, 21_000];

  // The sky draws a world-anchored cloud fully inside the far fade's start,
  // none past its end; the dome by the slope's horizon fade; both melt with
  // distance. These are the sky's own fades, so the disc, the shadows and
  // the dimming agree with what is drawn.
  it('is the far fade (anchored) or the horizon fade (dome), times the aerial melt', () => {
    const melt = (m: number) => Math.exp((-m * 0.001) / CLOUD_LAYER.aerialKm);
    expect(cloudColumnDrawn(5_000, 4_000, 0.4, true, FAR)).toBeCloseTo(
      melt(5_000),
      12
    );
    expect(cloudColumnDrawn(22_000, 21_500, 0.09, true, FAR)).toBe(0);
    expect(cloudColumnDrawn(3_000, 2_000, 0.03, false, FAR)).toBeCloseTo(
      cloudHorizonFade(0.03) * melt(3_000),
      12
    );
    expect(cloudColumnDrawn(3_000, 2_000, 0.5, false, FAR)).toBeCloseTo(
      melt(3_000),
      12
    );
  });

  // Past the far fade the line sees nothing; with no view it sees the whole
  // column (the unweighted form stays for callers that want the physics).
  it('weights the column by what the sky draws for the view', () => {
    const el = (5 * Math.PI) / 180;
    const dir: [number, number, number] = [Math.cos(el), Math.sin(el), 0];
    const thick = () => THRESHOLD + 0.3;
    const unweighted = cloudColumnTransmittanceToward(
      [0, 0, 0],
      dir,
      THRESHOLD,
      thick,
      [0, 0]
    );
    expect(unweighted).toBeLessThan(0.01);
    const anchored = cloudColumnTransmittanceToward(
      [0, 0, 0],
      dir,
      THRESHOLD,
      thick,
      [0, 0],
      { camera: [0, 0, 0], anchored: true, farFadeM: FAR }
    );
    expect(anchored).toBe(1);
    // Near the camera at a high sun, fully drawn but for the melt.
    const up: [number, number, number] = [0, 1, 0];
    const near = cloudColumnTransmittanceToward(
      [0, 0, 0],
      up,
      THRESHOLD,
      thick,
      [0, 0],
      { camera: [0, 0, 0], anchored: true, farFadeM: FAR }
    );
    const depth = cloudColumnOpticalDepth(THRESHOLD + 0.3, THRESHOLD, 0, 1);
    expect(near).toBeCloseTo(
      Math.exp(-depth * Math.exp(-2 / CLOUD_LAYER.aerialKm)),
      12
    );
  });

  it('has a GLSL twin, used by the disc and by the shadows', () => {
    expect(CLOUD_COLUMN_GLSL).toContain('float atmColumnDrawn(');
    expect(CLOUD_COLUMN_GLSL).toContain(
      `ATM_COLUMN_AERIAL_KM = ${glslFloat(CLOUD_LAYER.aerialKm)}`
    );
  });
});
