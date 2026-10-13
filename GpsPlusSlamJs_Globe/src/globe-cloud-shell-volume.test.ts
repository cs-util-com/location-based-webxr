/**
 * Why this test matters: the owner (2026-10-11, on r812) saw the clouds
 * "almost gone between about 700 and 30 km" and asked for volumetric clouds
 * in layers, coarse from about 700 km, finer from about 200 km, today's
 * slab from about 30 km, handing over as smoothly as today's volume fades
 * in (round-4 plan 2026-10-11-0122, DEC-R4-5). The plan's §6 item 8
 * reconciles that with DEC-R3-6 (one ground-anchored field, never two
 * fields stacked): ONE spherical pass whose parameters move with the
 * altitude, so the "layers" are its parameter sets along the descent. What
 * must never happen, and what these tests hold:
 *
 * - **A jump between layers**: the law's parameters are continuous in the
 *   altitude and reach each station's set exactly (a mutant that steps
 *   between stations fails the continuity test).
 * - **The clouds drawn twice or not at all** (the C2 invariant of
 *   `globe-cloud-volume.ts`, now over three drawers): the flat layer, the
 *   shell and the slab share 1 at every altitude.
 * - **A seam where the shell meets the slab**: at the bottom station the
 *   shell's set is the slab's (cells, thickness, octaves, steps).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { cloudVolumeShare } from "./globe-cloud-volume.js";
import {
  CLOUD_HIGH_LAYER,
  CLOUD_SHELL_VOLUME,
  GLOBE_CLOUD_SHELL_GLSL,
  type CloudShellStation,
  cloudShellFieldLiftKm,
  cloudLayerOver,
  cloudShellFieldWeights,
  cloudShellLayerLiftsKm,
  cloudShellLocalLiftKm,
  cloudShellNoiseCascade,
  cloudShellPixelWeight,
  cloudShellStationsFor,
  cloudShellVolumeLaw,
  cloudShellVolumeShares,
} from "./globe-cloud-shell-volume.js";

const LAB_SLAB = { ceilingKm: 40, fadeKm: 25 };

const FIELDS = [
  "steps",
  "octaves",
  "thicknessScale",
  "noiseShare",
  "aerial",
] as const satisfies readonly (keyof CloudShellStation)[];

describe("cloudShellVolumeLaw", () => {
  it("reaches each station's set exactly at its altitude", () => {
    for (const station of CLOUD_SHELL_VOLUME.stations) {
      const law = cloudShellVolumeLaw(station.altitudeKm);
      for (const f of FIELDS) expect(law[f]).toBeCloseTo(station[f], 12);
    }
  });

  it("holds the top set above the top station and the bottom set below the bottom one", () => {
    const [top] = CLOUD_SHELL_VOLUME.stations;
    const bottom = CLOUD_SHELL_VOLUME.stations.at(-1)!;
    for (const f of FIELDS) {
      expect(cloudShellVolumeLaw(5_000)[f]).toBe(top[f]);
      expect(cloudShellVolumeLaw(1)[f]).toBe(bottom[f]);
    }
  });

  // The descent's frame-to-frame change: on a log descent of 1 % a frame no
  // parameter may move more than a small share of its whole span; a law that
  // switched sets at a band's middle moves its whole span in one frame.
  it("is continuous along the altitude (no jump between layers)", () => {
    const spans = Object.fromEntries(
      FIELDS.map((f) => {
        const values = CLOUD_SHELL_VOLUME.stations.map((s) => s[f]);
        return [f, Math.max(...values) - Math.min(...values)];
      }),
    );
    let previous = cloudShellVolumeLaw(2_000);
    for (let h = 2_000; h > 5; h /= 1.01) {
      const law = cloudShellVolumeLaw(h);
      for (const f of FIELDS) {
        // smoothstep's steepest slope is 1.5 x the band's mean slope; the
        // narrowest band in the logarithm (700 to 200 km) spans 126
        // one-percent steps.
        expect(Math.abs(law[f] - previous[f])).toBeLessThanOrEqual(
          (spans[f]! * 1.5) / 120 + 1e-12,
        );
      }
      previous = law;
    }
  });

  it("moves each parameter monotonically from one station to the next", () => {
    const stations = CLOUD_SHELL_VOLUME.stations;
    for (let i = 0; i + 1 < stations.length; i++) {
      const hi = stations[i]!;
      const lo = stations[i + 1]!;
      for (const f of FIELDS) {
        let last: number = hi[f];
        for (let h = hi.altitudeKm; h >= lo.altitudeKm; h /= 1.02) {
          const v = cloudShellVolumeLaw(h)[f];
          // Signed toward the next station: never moving back.
          const sign = lo[f] <= hi[f] ? 1 : -1;
          expect(sign * (last - v)).toBeGreaterThanOrEqual(-1e-12);
          last = v;
        }
      }
    }
  });

  it("gives the march a whole step and octave count within the stations' range", () => {
    for (let h = 2_000; h > 5; h /= 1.05) {
      const { marchSteps, octaves } = cloudShellVolumeLaw(h);
      expect(Number.isInteger(marchSteps)).toBe(true);
      expect(marchSteps).toBeGreaterThanOrEqual(1);
      expect(marchSteps).toBeLessThanOrEqual(CLOUD_SHELL_VOLUME.maxSteps);
      expect(octaves).toBeGreaterThanOrEqual(1);
      expect(octaves).toBeLessThanOrEqual(CLOUD_SHELL_VOLUME.maxOctaves);
    }
  });

  // The seam: below the slab's ceiling the two are mixed, so the shell must
  // be the slab there: its cells (the slab's field, unscaled), its deck's
  // thickness, its octaves (the slab's march reads five) and its steps (8).
  it("is the slab's set at the bottom station", () => {
    const bottom = CLOUD_SHELL_VOLUME.stations.at(-1)!;
    expect(bottom.cellScale).toBe(1);
    expect(bottom.thicknessScale).toBe(1);
    expect(bottom.octaves).toBe(5);
    expect(bottom.steps).toBe(8);
    expect(bottom.noiseShare).toBe(1);
    expect(bottom.aerial).toBe(1);
    expect(cloudShellVolumeLaw(bottom.altitudeKm).cells).toEqual([1, 1]);
    expect(bottom.altitudeKm).toBeLessThanOrEqual(LAB_SLAB.ceilingKm);
  });

  it("takes its own stations (the sweep's), and refuses bad ones", () => {
    const stations: CloudShellStation[] = [
      {
        altitudeKm: 900,
        steps: 4,
        octaves: 3,
        cellScale: 2,
        thicknessScale: 4,
        noiseShare: 0.5,
        aerial: 0,
      },
      {
        altitudeKm: 40,
        steps: 8,
        octaves: 5,
        cellScale: 1,
        thicknessScale: 1,
        noiseShare: 1,
        aerial: 1,
      },
    ];
    expect(cloudShellVolumeLaw(900, stations).noiseShare).toBe(0.5);
    expect(cloudShellVolumeLaw(40, stations).noiseShare).toBe(1);
    const mid = cloudShellVolumeLaw(Math.sqrt(900 * 40), stations);
    expect(mid.noiseShare).toBeCloseTo(0.75, 9);
    expect(mid.cells).toEqual([2, 1]);
    expect(mid.cellMix).toBeCloseTo(0.5, 9);
    expect(() => cloudShellVolumeLaw(Number.NaN)).toThrow(RangeError);
    expect(() => cloudShellVolumeLaw(100, [])).toThrow(RangeError);
    expect(() =>
      cloudShellVolumeLaw(100, [stations[1]!, stations[0]!]),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellVolumeLaw(100, [{ ...stations[0]!, steps: 0 }, stations[1]!]),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellVolumeLaw(100, [
        { ...stations[0]!, cellScale: -1 },
        stations[1]!,
      ]),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellVolumeLaw(100, [
        { ...stations[0]!, noiseShare: 1.5 },
        stations[1]!,
      ]),
    ).toThrow(RangeError);
  });
});

// The cells are the one parameter never interpolated: a scale that moves
// with the altitude slides the ground-anchored clouds by tens of kilometres
// a percent of descent (the browser measured a correlation of -0.05 with
// the slab at a scale of 1.01). Between two stations the pass mixes the two
// stations' FIELDS, each at its own fixed scale, by the law's smoothstep,
// with weights that keep the field's spread.
describe("the cells and their mix", () => {
  it("names only the stations' own scales, and mixes them continuously", () => {
    const scales = new Set<number>(
      CLOUD_SHELL_VOLUME.stations.map((x) => x.cellScale),
    );
    let previous = cloudShellVolumeLaw(2_000);
    for (let h = 2_000; h > 5; h /= 1.01) {
      const law = cloudShellVolumeLaw(h);
      for (const c of law.cells) expect(scales.has(c)).toBe(true);
      expect(law.cellMix).toBeGreaterThanOrEqual(0);
      expect(law.cellMix).toBeLessThanOrEqual(1);
      // The scale drawn, as the mix's expectation: continuous across the
      // stations, where one band's end is the next one's start.
      const drawn = (x: typeof law) =>
        x.cells[0] + (x.cells[1] - x.cells[0]) * x.cellMix;
      expect(Math.abs(drawn(law) - drawn(previous))).toBeLessThan(0.1);
      previous = law;
    }
  });

  it("is one field at each station", () => {
    for (const station of CLOUD_SHELL_VOLUME.stations) {
      const { cells, cellMix } = cloudShellVolumeLaw(station.altitudeKm);
      const drawn = cellMix === 0 ? cells[0] : cells[1];
      expect(drawn).toBe(station.cellScale);
      expect([0, 1]).toContain(cellMix);
    }
  });

  it("weighs the two fields so their squares sum to 1, each alone at its end", () => {
    expect(cloudShellFieldWeights(0)).toEqual([1, 0]);
    expect(cloudShellFieldWeights(1)).toEqual([0, 1]);
    for (let t = 0; t <= 1; t += 0.05) {
      const [a, b] = cloudShellFieldWeights(t);
      expect(a * a + b * b).toBeCloseTo(1, 12);
    }
    expect(() => cloudShellFieldWeights(1.5)).toThrow(RangeError);
    expect(() => cloudShellFieldWeights(Number.NaN)).toThrow(RangeError);
  });
});

describe("cloudShellVolumeShares", () => {
  const shellOn = {
    topKm: CLOUD_SHELL_VOLUME.topKm,
    bandKm: CLOUD_SHELL_VOLUME.bandKm,
    ...LAB_SLAB,
  };

  // C2 over three drawers: whatever the flat layer gives up, the shell or
  // the slab draws, at every altitude, for every hand-over in the sweep.
  it("shares 1 between the flat layer, the shell and the slab at every altitude", () => {
    for (const top of [467, 700, 933]) {
      for (const band of [100, 300, 600]) {
        for (let h = 70_000; h > 0.5; h /= 1.01) {
          const s = cloudShellVolumeShares(h, {
            ...shellOn,
            topKm: top,
            bandKm: band,
          });
          expect(s.flat + s.shell + s.slab).toBeCloseTo(1, 12);
          for (const v of [s.flat, s.shell, s.slab, s.shellIn]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("draws nothing as the shell above its band, everything from its top down to the slab's ceiling", () => {
    const s = (h: number) => cloudShellVolumeShares(h, shellOn);
    // Above the band's top (1,050 km since round 5, C5) nothing; from the
    // shell's top (800 km) down everything.
    const above = CLOUD_SHELL_VOLUME.topKm + CLOUD_SHELL_VOLUME.bandKm + 1;
    expect(s(above).shell).toBe(0);
    expect(s(above).flat).toBe(1);
    expect(s(CLOUD_SHELL_VOLUME.topKm).shell).toBe(1);
    expect(s(700).shell).toBe(1);
    expect(s(100).shell).toBe(1);
    expect(s(40).shell).toBe(1);
    expect(s(15).shell).toBe(0);
    expect(s(15).slab).toBe(1);
  });

  it("hands the shell to the slab through the slab's own share", () => {
    for (let h = 40; h >= 15; h -= 0.5) {
      const s = cloudShellVolumeShares(h, shellOn);
      const v = cloudVolumeShare(h, LAB_SLAB);
      expect(s.slab).toBeCloseTo(v, 12);
      expect(s.shell).toBeCloseTo(1 - v, 12);
    }
  });

  it("is the slab's hand-over alone with the shell off (no top)", () => {
    for (const h of [5_000, 700, 100, 30, 10]) {
      const s = cloudShellVolumeShares(h, { ...LAB_SLAB, topKm: 0 });
      expect(s.shell).toBe(0);
      expect(s.slab).toBeCloseTo(cloudVolumeShare(h, LAB_SLAB), 12);
    }
  });

  it("never lets the shell rise above its fade as the camera climbs", () => {
    let last = -1;
    for (let h = 2_000; h > 700; h /= 1.01) {
      const { shellIn } = cloudShellVolumeShares(h, shellOn);
      expect(shellIn).toBeGreaterThanOrEqual(last);
      last = shellIn;
    }
  });

  it("refuses a band that is not positive, or a top below the slab's ceiling", () => {
    expect(() =>
      cloudShellVolumeShares(100, { ...shellOn, bandKm: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellVolumeShares(100, { ...shellOn, topKm: 20 }),
    ).toThrow(RangeError);
    expect(() => cloudShellVolumeShares(Number.NaN, shellOn)).toThrow(
      RangeError,
    );
  });
});

// The lab's march binds these uniforms by name and calls these functions
// (`globe-cloud-shell-volume.js`): the chunk's contract with its pass. A
// rename here without the pass would draw the map at uv 0 and the noise at
// the chart's origin, silently (an unset uniform reads 0).
describe("GLOBE_CLOUD_SHELL_GLSL", () => {
  it("declares the twin's uniforms and its two functions", () => {
    for (const name of [
      "uniform mat4 uShellWorldFromEcef;",
      "uniform vec3 uShellRadii;",
      "uniform float uShellGroundKm;",
      "uniform float uShellGaussianM;",
      "uniform float uShellLonOffset;",
      "vec2 globeShellMapUv( vec3 p )",
      "vec2 globeShellChartKm( vec3 p )",
      // The lift's smoothing, the twin of cloudShellLocalLiftKm's.
      "const float SHELL_LIFT_EPS = 0.001000;",
    ]) {
      expect(GLOBE_CLOUD_SHELL_GLSL).toContain(name);
    }
  });
});

// WHY (R4d milestone review, finding 1, 2026-10-12): the shell and the slab
// were mixed by one weight for the whole screen (the shell 1 - s, the slab
// s), but the slab exists only within its disc (80 km, cleared from 56 km):
// at the owner's oblique pose from 15 to 40 km every cloud beyond the disc
// was drawn at 1 - s and gone at 15 km. Per pixel, the shell gives up only
// what the slab draws there (round 5: by the slab's own alpha against the
// shell's, since a disc mask missed the slab's faster fade in its ring).
describe("cloudShellPixelWeight", () => {
  // Far from the slab's disc, or in a clear patch, the slab draws nothing:
  // the shell keeps its whole weight whatever the slab's share.
  it("keeps the shell whole where the slab draws nothing", () => {
    for (const slab of [0, 0.1, 0.35, 0.65, 0.9, 1]) {
      for (const shellAlpha of [0.05, 0.4, 1]) {
        expect(
          cloudShellPixelWeight({ shellIn: 1, slab, shellAlpha, slabAlpha: 0 }),
        ).toBe(1);
      }
    }
  });

  it("gives the slab its share where the two draw the same cloud, as the global mix did", () => {
    for (const slab of [0, 0.35, 1]) {
      for (const a of [0.05, 0.4, 1]) {
        expect(
          cloudShellPixelWeight({
            shellIn: 1,
            slab,
            shellAlpha: a,
            slabAlpha: a,
          }),
        ).toBeCloseTo(1 - slab, 12);
      }
    }
  });

  // C2 per pixel: with the shell fully in, the mix's alpha (the shell's at
  // its weight plus the slab's at its share) is never below the shell's,
  // and equals it wherever the slab draws no more than the shell (its fade
  // ring, its edge, a clear patch): nothing the shell draws is lost.
  it("never draws less than the shell, and exactly the shell where the slab draws less (C2 per pixel)", () => {
    const grid = [0, 0.01, 0.1, 0.3, 0.6, 0.9, 1];
    for (const slab of grid) {
      for (const shellAlpha of grid.filter((a) => a > 0)) {
        for (const slabAlpha of grid) {
          const w = cloudShellPixelWeight({
            shellIn: 1,
            slab,
            shellAlpha,
            slabAlpha,
          });
          const mix = w * shellAlpha + slab * slabAlpha;
          expect(mix).toBeGreaterThanOrEqual(shellAlpha - 1e-12);
          // Exactly the shell's wherever the slab draws no more than it.
          const gap = slabAlpha <= shellAlpha ? Math.abs(mix - shellAlpha) : 0;
          expect(gap).toBeLessThan(1e-12);
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("scales with the shell's own fade-in, and treats a shell without clouds as nothing to keep", () => {
    expect(
      cloudShellPixelWeight({
        shellIn: 0.4,
        slab: 0,
        shellAlpha: 0.5,
        slabAlpha: 0.5,
      }),
    ).toBeCloseTo(0.4, 12);
    expect(
      cloudShellPixelWeight({
        shellIn: 1,
        slab: 0.5,
        shellAlpha: 0,
        slabAlpha: 0.3,
      }),
    ).toBeCloseTo(0.5, 12);
  });

  it("refuses shares or alphas outside 0..1", () => {
    const ok = { shellIn: 1, slab: 0.5, shellAlpha: 0.5, slabAlpha: 0.5 };
    expect(() => cloudShellPixelWeight({ ...ok, slab: 1.1 })).toThrow(
      RangeError,
    );
    expect(() => cloudShellPixelWeight({ ...ok, shellIn: -0.1 })).toThrow(
      RangeError,
    );
    expect(() =>
      cloudShellPixelWeight({ ...ok, shellAlpha: Number.NaN }),
    ).toThrow(RangeError);
    expect(() => cloudShellPixelWeight({ ...ok, slabAlpha: 2 })).toThrow(
      RangeError,
    );
  });
});

// WHY (R4d milestone review, findings 9 and 11, 2026-10-12): the law's
// bottom station (the slab's own set) was fixed at 30 km while the slab's
// ceiling is a knob (10-100 km, 40 by default), so between the ceiling and
// 30 km the shell mixed with the slab while still mid-law (two fields, its
// aerial and thickness off the slab's), and with the ceiling near 100 km
// the patterns dissolved into each other; and a top at the ceiling (both
// knobs in range) threw in every frame.
describe("cloudShellStationsFor", () => {
  const knobs = {
    topKm: 700,
    midKm: 200,
    cellScale: 4,
    thicknessScale: 4,
    noiseShare: 0.35,
  };

  it("puts the slab's own set at the slab's ceiling or below, for every ceiling", () => {
    for (const ceilingKm of [10, 27, 30, 40, 53, 75, 100]) {
      const stations = cloudShellStationsFor({ ...knobs, ceilingKm });
      const bottom = stations.at(-1)!;
      expect(bottom.altitudeKm).toBeGreaterThanOrEqual(ceilingKm);
      expect(bottom.cellScale).toBe(1);
      expect(bottom.thicknessScale).toBe(1);
      expect(bottom.aerial).toBe(1);
      // From the ceiling down the shell is the slab's set: one field.
      for (let h = ceilingKm; h > 1; h /= 1.1) {
        const law = cloudShellVolumeLaw(h, stations);
        expect(law.cells).toEqual([1, 1]);
        expect(law.aerial).toBe(1);
        expect(law.thicknessScale).toBe(1);
      }
    }
  });

  it("keeps the module's 30 km station where the ceiling is below it", () => {
    const stations = cloudShellStationsFor({ ...knobs, ceilingKm: 20 });
    expect(stations.at(-1)!.altitudeKm).toBe(30);
  });

  it("orders the stations strictly downwards, whatever the knobs, so the law never throws", () => {
    for (const ceilingKm of [10, 40, 100]) {
      for (const topKm of [50, 100, 300, 700, 2_000]) {
        for (const midKm of [20, 100, 200, 600]) {
          const stations = cloudShellStationsFor({
            ...knobs,
            topKm,
            midKm,
            ceilingKm,
          });
          const [top, mid, bottom] = stations;
          expect(top!.altitudeKm).toBeGreaterThan(mid!.altitudeKm);
          expect(mid!.altitudeKm).toBeGreaterThan(bottom!.altitudeKm);
          expect(() => cloudShellVolumeLaw(500, stations)).not.toThrow();
          expect(() =>
            cloudShellVolumeShares(50, {
              topKm: top!.altitudeKm,
              ceilingKm,
              fadeKm: 25,
            }),
          ).not.toThrow();
        }
      }
    }
  });

  it("takes the top's look from the knobs and its square roots in the middle", () => {
    const [top, mid] = cloudShellStationsFor({ ...knobs, ceilingKm: 40 });
    expect(top!.cellScale).toBe(4);
    expect(top!.thicknessScale).toBe(4);
    expect(top!.noiseShare).toBe(0.35);
    expect(mid!.cellScale).toBe(2);
    expect(mid!.thicknessScale).toBe(2);
    expect(mid!.noiseShare).toBeCloseTo(Math.sqrt(0.35), 12);
  });

  it("refuses knobs that are not positive and finite", () => {
    expect(() =>
      cloudShellStationsFor({ ...knobs, ceilingKm: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellStationsFor({ ...knobs, topKm: 0, ceilingKm: 40 }),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellStationsFor({ ...knobs, cellScale: -1, ceilingKm: 40 }),
    ).toThrow(RangeError);
  });
});

// WHY (round-5 plan 2026-10-12-0612 C2; the owner on r822): the clouds
// morphing into each other on the way down was "cool", "realistic", "a
// feature", but between about 300 and 150 km "nothing moves": the station
// law's smoothstep has no slope at its stations. The noise now runs down a
// cascade of fixed-scale, decorrelated fields, two at a time, with weights
// cos and sin of the progress: the squares sum to 1 (no opacity dip) and
// the morph's speed is the same at every altitude (no static stretch).
describe("cloudShellNoiseCascade", () => {
  const cascade = { topKm: 1_050, bottomKm: 40, fields: 3, topScale: 4 };

  it("weighs two fields so their squares sum to 1, at every altitude", () => {
    for (let h = 2_000; h > 1; h /= 1.01) {
      const c = cloudShellNoiseCascade(h, cascade);
      expect(c.weights[0] ** 2 + c.weights[1] ** 2).toBeCloseTo(1, 12);
      for (const w of c.weights) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  // The owner's "nothing moves" between stations: the morph's speed (how
  // fast the mix turns, per unit of the altitude's logarithm) is constant
  // from the top to the bottom, so no stretch of the descent is static.
  it("morphs at the same speed at every altitude between its top and bottom", () => {
    const speeds: number[] = [];
    const angle = (h: number) => {
      const c = cloudShellNoiseCascade(h, cascade);
      return c.index * (Math.PI / 2) + Math.atan2(c.weights[1], c.weights[0]);
    };
    const dl = 0.001;
    for (let h = 1_000; h > 42; h /= 1.02) {
      speeds.push(Math.abs(angle(h * Math.exp(-dl)) - angle(h)) / dl);
    }
    const lo = Math.min(...speeds);
    const hi = Math.max(...speeds);
    expect(lo).toBeGreaterThan(0);
    expect(hi / lo).toBeLessThan(1.01);
  });

  it("is continuous along the descent (no jump where one pair hands to the next)", () => {
    let prev = cloudShellNoiseCascade(2_000, cascade);
    for (let h = 2_000 / 1.001; h > 1; h /= 1.001) {
      const c = cloudShellNoiseCascade(h, cascade);
      // Compare by field: each field's weight, wherever it sits in the pair.
      const weightOf = (x: typeof c, k: number) =>
        (x.index === k ? x.weights[0] : 0) +
        (x.index + 1 === k ? x.weights[1] : 0);
      for (let k = 0; k <= cascade.fields; k++) {
        expect(Math.abs(weightOf(c, k) - weightOf(prev, k))).toBeLessThan(0.01);
      }
      prev = c;
    }
  });

  it("is the slab's own field (scale 1, no offset) at and below the bottom", () => {
    for (const h of [40, 39, 20, 5, 0]) {
      const c = cloudShellNoiseCascade(h, cascade);
      const [field] = c.fields;
      expect(c.weights[0]).toBe(1);
      expect(field.scale).toBe(1);
      expect(field.offsetCells).toEqual([0, 0]);
    }
  });

  it("is the top field alone at and above its top, at the top's scale", () => {
    for (const h of [1_050, 2_000, 70_000]) {
      const c = cloudShellNoiseCascade(h, cascade);
      expect(c.index).toBe(0);
      expect(c.weights[0]).toBe(1);
      expect(c.fields[0].scale).toBe(4);
    }
  });

  it("gives each field a fixed scale, falling from the top's to 1, and its own offset", () => {
    // Every sighting of a field, by its place in the cascade.
    const sightings = new Map<number, { scale: number; offset: string }[]>();
    for (let h = 1_100; h > 30; h /= 1.05) {
      const c = cloudShellNoiseCascade(h, cascade);
      c.fields.forEach((field, i) => {
        const k = c.index + i;
        const list = sightings.get(k) ?? [];
        list.push({ scale: field.scale, offset: field.offsetCells.join() });
        sightings.set(k, list);
      });
    }
    // Fixed: each field seen alike at every altitude.
    for (const list of sightings.values()) {
      expect(new Set(list.map((e) => `${e.scale}/${e.offset}`)).size).toBe(1);
    }
    const seen = new Map(
      [...sightings.entries()].map(([k, list]) => [k, list[0]!] as const),
    );
    const scales = [...seen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, e]) => e.scale);
    for (let i = 1; i < scales.length; i++)
      expect(scales[i]!).toBeLessThan(scales[i - 1]!);
    const offsets = new Set([...seen.values()].map((e) => e.offset));
    expect(offsets.size).toBe(seen.size);
  });

  it("refuses a bottom at or above the top, no field, or a scale below 1", () => {
    expect(() =>
      cloudShellNoiseCascade(100, { ...cascade, bottomKm: 1_050 }),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellNoiseCascade(100, { ...cascade, fields: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellNoiseCascade(100, { ...cascade, topScale: 0.5 }),
    ).toThrow(RangeError);
    expect(() => cloudShellNoiseCascade(Number.NaN, cascade)).toThrow(
      RangeError,
    );
  });
});

describe("cloudShellFieldLiftKm", () => {
  // WHY (round-5 plan §10, DEC-R5-4, the owner's step 1): a coarser field's
  // clouds float higher, so the blend of the resolutions reads as clouds at
  // several heights, not one plane. The slab's own field (scale 1) is never
  // lifted: at the hand-over the shell must stay on the slab's deck (C4).
  it("lifts the top field fully, the slab's own not at all, between by the scale's log", () => {
    const o = { liftKm: 10, topScale: 4 };
    expect(cloudShellFieldLiftKm(4, o)).toBe(10);
    expect(cloudShellFieldLiftKm(1, o)).toBe(0);
    expect(cloudShellFieldLiftKm(2, o)).toBeCloseTo(5, 12);
    expect(cloudShellFieldLiftKm(Math.SQRT2, o)).toBeCloseTo(2.5, 12);
    // Off by default: no lift at any scale.
    expect(cloudShellFieldLiftKm(4, { liftKm: 0, topScale: 4 })).toBe(0);
    // One field only (top scale 1): nothing to order, no lift.
    expect(cloudShellFieldLiftKm(1, { liftKm: 10, topScale: 1 })).toBe(0);
  });

  it("refuses a scale or top scale below 1 and a lift below 0", () => {
    for (const [scale, liftKm, topScale] of [
      [0.5, 10, 4],
      [2, -1, 4],
      [2, Number.NaN, 4],
      [2, 10, 0.5],
      [Number.NaN, 10, 4],
    ] as const) {
      expect(() => cloudShellFieldLiftKm(scale, { liftKm, topScale })).toThrow(
        RangeError,
      );
    }
  });
});

describe("cloudShellLocalLiftKm", () => {
  // WHY: the column at a spot is lifted by the lifts of the fields that make
  // its cloud there, each by its share of the noise's anomaly. Where one
  // field makes the cloud its height wins; at a station (the other field's
  // weight 0, its anomaly 0) the deck is that field's; the column's length
  // (its opacity) is never touched, only its base.
  it("weights each field's lift by its share of the anomaly", () => {
    expect(cloudShellLocalLiftKm([0.3, 0], [10, 5])).toBeCloseTo(10, 1);
    expect(cloudShellLocalLiftKm([0, -0.3], [10, 5])).toBeCloseTo(5, 1);
    expect(cloudShellLocalLiftKm([0.2, -0.2], [10, 5])).toBeCloseTo(7.5, 12);
    expect(cloudShellLocalLiftKm([0.3, 0.1], [10, 0])).toBeCloseTo(7.5, 1);
    // No anomaly at all: halfway (continuous: the shares are smoothed).
    expect(cloudShellLocalLiftKm([0, 0], [10, 0])).toBeCloseTo(5, 12);
  });

  it("stays between the two lifts and is continuous", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        (a, b, l0, l1) => {
          const lift = cloudShellLocalLiftKm([a, b], [l0, l1]);
          expect(lift).toBeGreaterThanOrEqual(Math.min(l0, l1) - 1e-9);
          expect(lift).toBeLessThanOrEqual(Math.max(l0, l1) + 1e-9);
          const near = cloudShellLocalLiftKm([a + 1e-7, b], [l0, l1]);
          expect(Math.abs(near - lift)).toBeLessThan(1e-2);
        },
      ),
    );
  });

  it("refuses a value that is not finite or a lift below 0", () => {
    expect(() => cloudShellLocalLiftKm([Number.NaN, 0], [1, 0])).toThrow(
      RangeError,
    );
    expect(() => cloudShellLocalLiftKm([0, 0], [1, -1])).toThrow(RangeError);
  });
});

describe("cloudShellLayerLiftsKm", () => {
  // WHY (round-5 plan §11, DEC-R5-5, the owner's B): with two real layers
  // each field draws its own column at its own height. A field must keep
  // its height in both pairs it belongs to, or the clouds jump up or down
  // where one pair hands to the next; the slab's own field stays at 0 (C4).
  const cascadeOf = (km: number) =>
    cloudShellNoiseCascade(km, {
      topKm: 1_050,
      bottomKm: 40,
      fields: 3,
      topScale: 4,
    });
  const options = { stepKm: 5, fields: 3, topScale: 4 };

  it("puts each field a whole number of steps up, the slab's own at 0", () => {
    expect(cloudShellLayerLiftsKm(cascadeOf(1_050), options)[0]).toBeCloseTo(
      15,
      9,
    );
    expect(cloudShellLayerLiftsKm(cascadeOf(40), options)[0]).toBe(0);
    for (let km = 1_050; km >= 40; km /= 1.05) {
      for (const lift of cloudShellLayerLiftsKm(cascadeOf(km), options)) {
        expect(Math.abs(lift / 5 - Math.round(lift / 5))).toBeLessThan(1e-9);
      }
    }
  });

  it("keeps a field's height as the pair it is in changes", () => {
    // Every lift each field was given on the way down, by its scale.
    const seen = new Map<number, number[]>();
    for (let km = 1_050; km >= 40; km /= 1.02) {
      const cascade = cascadeOf(km);
      const lifts = cloudShellLayerLiftsKm(cascade, options);
      cascade.fields.forEach(({ scale }, k) => {
        const key = Math.round(scale * 1e6);
        seen.set(key, [...(seen.get(key) ?? []), lifts[k] ?? Number.NaN]);
      });
    }
    expect(seen.size).toBe(4);
    const spreads = [...seen.values()].map(
      (ls) => Math.max(...ls) - Math.min(...ls),
    );
    expect(Math.max(...spreads)).toBeLessThan(1e-9);
  });

  it("is 0 everywhere at a step of 0 and refuses a step below 0", () => {
    expect(
      cloudShellLayerLiftsKm(cascadeOf(300), { ...options, stepKm: 0 }),
    ).toEqual([0, 0]);
    expect(() =>
      cloudShellLayerLiftsKm(cascadeOf(300), { ...options, stepKm: -1 }),
    ).toThrow(RangeError);
  });
});

describe("CLOUD_HIGH_LAYER", () => {
  // WHY (round-5 plan §11, DEC-R5-6, the owner's A): a thin, wispy, coarse
  // layer well above the clouds, so clouds sit over clouds at every height.
  it("sits well above the deck, coarse, wispy and thinner than the map", () => {
    expect(CLOUD_HIGH_LAYER.altitudeKm).toBe(9);
    expect(CLOUD_HIGH_LAYER.cellScale).toBe(6);
    expect(CLOUD_HIGH_LAYER.noiseShare).toBeLessThan(0.5);
    expect(CLOUD_HIGH_LAYER.cover).toBeLessThan(1);
    // Its own patch of the lattice, not any cascade field's.
    expect(CLOUD_HIGH_LAYER.offsetCells).not.toEqual([0, 0]);
  });
});

describe("cloudLayerOver", () => {
  // WHY: the high layer is a separate drawing, put in front of the clouds
  // from above and behind them from below. Premultiplied "over": an opaque
  // front hides the back, a clear front shows it, the alpha never passes 1,
  // and the order matters (the reason the composite picks it by height).
  it("lays a premultiplied front over a back", () => {
    const red = [0.8, 0, 0, 0.8] as const;
    const blue = [0, 0, 0.5, 0.5] as const;
    expect(cloudLayerOver([1, 1, 1, 1], blue)).toEqual([1, 1, 1, 1]);
    expect(cloudLayerOver([0, 0, 0, 0], blue)).toEqual([0, 0, 0.5, 0.5]);
    const a = cloudLayerOver(red, blue);
    const b = cloudLayerOver(blue, red);
    expect(a[3]).toBeCloseTo(0.9, 12);
    expect(b[3]).toBeCloseTo(0.9, 12);
    expect(a[0]).toBeGreaterThan(b[0]);
    expect(a[2]).toBeLessThan(b[2]);
  });

  it("never passes an alpha of 1", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (fa, ba) => {
          const out = cloudLayerOver([fa, fa, fa, fa], [ba, ba, ba, ba]);
          expect(out[3]).toBeLessThanOrEqual(1 + 1e-12);
          expect(out[3]).toBeGreaterThanOrEqual(Math.max(fa, ba) - 1e-12);
        },
      ),
    );
  });
});
