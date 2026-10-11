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

import { describe, expect, it } from "vitest";

import { cloudVolumeShare } from "./globe-cloud-volume.js";
import {
  CLOUD_SHELL_VOLUME,
  type CloudShellStation,
  cloudShellFieldWeights,
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
    expect(s(1_000).shell).toBe(0);
    expect(s(1_000).flat).toBe(1);
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
