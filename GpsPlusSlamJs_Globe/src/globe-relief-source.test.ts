/**
 * The relief's height sources (tour editor plan 2026-10-17-1816 §13, G1
 * step 2; G0 spikes Q1).
 *
 * Why this test matters: Mapterhorn is the relief the 3D editor needs (its
 * data within 0.5 m of the national LiDAR models at 96-100 % of points,
 * where AWS Terrarium is 5-11 m off in towns), but it differs from AWS in
 * three ways the globe must be told: its tiles are 512 px, its fine zooms
 * (13 and finer) exist only where a national model does (404 elsewhere),
 * and it is credited differently. A source wrongly described draws the
 * relief at the wrong place, leaves holes, or ships without its credit.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  RELIEF_SOURCES,
  awsTerrariumRelief,
  mapterhornRelief,
  meshLevelForSpacing,
  reliefCredits,
  reliefTerrainOptions,
  vertexSpacingM,
} from "./globe-relief-source.js";

const AWS = {
  url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  attribution: "Elevation data © Mapzen / AWS Open Data Terrain Tiles",
};
const MAPTERHORN = {
  url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
  attribution: "Elevation data © Mapterhorn (national LiDAR sources)",
};
const DEG = Math.PI / 180;

describe("the relief sources", () => {
  it("describes AWS Terrarium as the globe has always drawn it", () => {
    const aws = awsTerrariumRelief(AWS);
    expect(aws).toMatchObject({
      id: "aws-terrarium",
      url: AWS.url,
      maxZoom: 12,
      globalZoom: 12,
      tileDimension: 256,
      fallback: null,
    });
    expect(aws.credit.full).toBe(AWS.attribution);
  });

  // Why: the credit the brief names, with the link Mapterhorn's own
  // TileJSON gives; the fallback's credit too, since its tiles may draw.
  it("describes Mapterhorn: 512 px, z14, AWS where it answers 404, both credited", () => {
    const aws = awsTerrariumRelief(AWS);
    const m = mapterhornRelief(MAPTERHORN, aws);
    expect(m).toMatchObject({
      id: "mapterhorn",
      url: MAPTERHORN.url,
      maxZoom: 14,
      globalZoom: 12,
      tileDimension: 512,
      fallback: aws,
    });
    expect(m.credit).toEqual({
      short: "Mapterhorn",
      full: MAPTERHORN.attribution,
      href: "https://mapterhorn.com/attribution",
    });
    expect(m.credit.full).toContain("Elevation data © Mapterhorn");
    expect(reliefCredits(m)).toEqual([m.credit, aws.credit]);
    expect(reliefCredits(aws)).toEqual([aws.credit]);
    expect(reliefCredits(mapterhornRelief(MAPTERHORN, null))).toEqual([
      m.credit,
    ]);
  });

  it("refuses a template without {z}/{x}/{y}, an empty credit or a chained fallback", () => {
    expect(() =>
      awsTerrariumRelief({ ...AWS, url: "https://x/{z}.png" }),
    ).toThrow(RangeError);
    expect(() =>
      mapterhornRelief({ ...MAPTERHORN, attribution: " " }, null),
    ).toThrow(RangeError);
    const chained = mapterhornRelief(MAPTERHORN, awsTerrariumRelief(AWS));
    expect(() => mapterhornRelief(MAPTERHORN, chained)).toThrow(RangeError);
  });

  it("freezes what it returns", () => {
    const m = mapterhornRelief(MAPTERHORN, awsTerrariumRelief(AWS));
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.credit)).toBe(true);
    expect(Object.isFrozen(RELIEF_SOURCES.mapterhorn)).toBe(true);
  });
});

describe("reliefTerrainOptions", () => {
  // Why: createGlobeTerrain takes plain options; the source decides them,
  // so an app cannot pair Mapterhorn's url with AWS's tile size.
  it("gives createGlobeTerrain the source's url, zoom, tile size and fallback", () => {
    const aws = awsTerrariumRelief(AWS);
    expect(reliefTerrainOptions(aws)).toEqual({
      url: AWS.url,
      maxZoom: 12,
      tileDimension: 256,
      fallbackUrl: undefined,
    });
    expect(reliefTerrainOptions(mapterhornRelief(MAPTERHORN, aws))).toEqual({
      url: MAPTERHORN.url,
      maxZoom: 14,
      tileDimension: 512,
      fallbackUrl: AWS.url,
    });
  });
});

describe("the mesh's vertex spacing", () => {
  // Why: the G0 spikes measured the drawn error by vertex spacing, not by
  // zoom: z14 drawn at level 17 (about 6.5 m at Munich) passes at 0.75 m
  // on all eight sites, at level 15 (25.5 m) only on flat ground. These
  // pin the arithmetic that turns "about 6.5 m" into a tree level.
  it("matches the spikes' spacings at Munich (48.14 N)", () => {
    expect(vertexSpacingM(15, 48.14 * DEG)).toBeCloseTo(25.5, 0);
    expect(vertexSpacingM(17, 48.14 * DEG)).toBeCloseTo(6.4, 1);
    expect(meshLevelForSpacing(6.5, 48.14 * DEG)).toBe(17);
    // Further south a level is wider: at 46.5 N level 17 is 6.58 m, so
    // "at most 6.5 m" takes level 18 there, and 6.6 m takes 17.
    expect(vertexSpacingM(17, 46.5 * DEG)).toBeCloseTo(6.58, 2);
    expect(meshLevelForSpacing(6.5, 46.5 * DEG)).toBe(18);
    expect(meshLevelForSpacing(6.6, 46.5 * DEG)).toBe(17);
  });

  it("gives the coarsest level at or below the spacing asked for", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 50_000, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        (spacing, latDeg) => {
          const lat = latDeg * DEG;
          const level = meshLevelForSpacing(spacing, lat);
          expect(vertexSpacingM(level, lat)).toBeLessThanOrEqual(
            spacing * (1 + 1e-9),
          );
          // The level above is coarser than asked (none above level 0).
          const above =
            level > 0
              ? vertexSpacingM(level - 1, lat)
              : Number.POSITIVE_INFINITY;
          expect(above).toBeGreaterThan(spacing);
        },
      ),
    );
  });

  it("refuses a spacing or latitude it cannot use", () => {
    expect(() => meshLevelForSpacing(0, 0)).toThrow(RangeError);
    expect(() => meshLevelForSpacing(Number.NaN, 0)).toThrow(RangeError);
    expect(() => vertexSpacingM(-1, 0)).toThrow(RangeError);
    expect(() => vertexSpacingM(17, Math.PI / 2)).toThrow(RangeError);
  });
});
