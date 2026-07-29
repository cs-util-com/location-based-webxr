/**
 * Heightfield invariants over arbitrary terrain and arbitrary sample points.
 *
 * Why these tests matter:
 * The example tests pin the slopes someone thought to write down. These pin the
 * two properties every consumer relies on without checking: that `heightAt`
 * always returns a finite number — a `NaN` vertex silently deletes a triangle
 * rather than reporting anything — and that bilinear interpolation never
 * overshoots the data, which is how a sampler invents a spire or a pit that
 * the DEM never contained.
 *
 * @see heightfield.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { enuFrameAt } from "gps-plus-slam-osm";
import type { ElevationProvider, LatLng } from "gps-plus-slam-osm";

import { buildHeightfield } from "./heightfield.js";

const FRAME = enuFrameAt({ lat: 50.9413, lng: 6.9583 });
const OPTIONS = { frame: FRAME, extentM: 300, spacingM: 75 };

/** Heights drawn from a pool, including the "no data" hole. */
const heightArb = fc.option(fc.double({ min: -400, max: 4000, noNaN: true }), {
  nil: undefined,
  freq: 6,
});

/** Anywhere on or well outside the field. */
const pointArb = fc.record({
  x: fc.double({ min: -5000, max: 5000, noNaN: true }),
  y: fc.double({ min: -5000, max: 5000, noNaN: true }),
});

function providerOf(
  heights: readonly (number | undefined)[],
): ElevationProvider {
  let n = 0;
  return {
    attribution: "",
    sourceId: "prop",
    elevationAt: (positions: readonly LatLng[]) =>
      Promise.resolve(positions.map(() => heights[n++ % heights.length])),
  };
}

describe("heightfield invariants", () => {
  it("returns a finite height for ANY point, inside or outside the extent", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(heightArb, { minLength: 1, maxLength: 40 }),
        fc.array(pointArb, { minLength: 1, maxLength: 20 }),
        async (heights, points) => {
          const field = await buildHeightfield(providerOf(heights), OPTIONS);
          for (const point of points) {
            expect(Number.isFinite(field.heightAt(point))).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("never exceeds the range of the data it was given", async () => {
    // Bilinear interpolation is a weighted average, so it cannot overshoot —
    // but the datum subtraction and the missing-post fill both shift the
    // numbers, and either could push a sample outside the real relief. A
    // sampler that invents a peak the DEM never had is a sampler nobody can
    // use to judge whether the terrain looks right.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.double({ min: -400, max: 4000, noNaN: true }), {
          minLength: 2,
          maxLength: 40,
        }),
        fc.array(pointArb, { minLength: 1, maxLength: 20 }),
        async (heights, points) => {
          const field = await buildHeightfield(providerOf(heights), OPTIONS);
          const span = Math.max(...heights) - Math.min(...heights);
          for (const point of points) {
            expect(Math.abs(field.heightAt(point))).toBeLessThanOrEqual(
              span + 1e-6,
            );
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("is always exactly zero at the origin", async () => {
    // The relative-surface contract. If this drifts, every building in the
    // scene is offset by the local orthometric height.
    await fc.assert(
      fc.asyncProperty(
        fc.array(heightArb, { minLength: 1, maxLength: 40 }),
        async (heights) => {
          const field = await buildHeightfield(providerOf(heights), OPTIONS);
          expect(field.heightAt({ x: 0, y: 0 })).toBeCloseTo(0, 6);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("counts missing posts without ever exceeding the total", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(heightArb, { minLength: 1, maxLength: 40 }),
        async (heights) => {
          const field = await buildHeightfield(providerOf(heights), OPTIONS);
          expect(field.missing).toBeGreaterThanOrEqual(0);
          expect(field.missing).toBeLessThanOrEqual(field.total);
          expect(field.hasData).toBe(field.missing < field.total);
        },
      ),
      { numRuns: 40 },
    );
  });
});
