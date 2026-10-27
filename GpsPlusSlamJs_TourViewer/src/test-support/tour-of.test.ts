/**
 * Why this test matters: many Tour Viewer tests compare records exactly
 * (drafts, saves, the editor's undo) and build their tours with
 * `tourOf`, whose premise is that an object alone in a station anchored
 * at it reads back with its own numbers. If that premise broke, those
 * tests would fail for a reason that is the helper's, not the code's.
 */

import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mintPin } from "../content-placement.js";
import { inOwnStation, tourOf } from "./tour-of.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

describe("tourOf", () => {
  it("reads every object back with its own numbers, in its own station (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        (lat, lon, n, e, alt) => {
          const pin = mintPin({
            id: "p",
            label: "Gate",
            worldNuePosition: { x: n, y: alt, z: e },
            zero: { lat, lon },
            nowIso: "2026-10-18T06:00:00.000Z",
          })!;
          // Compared as stored text: a zero longitude can come back as 0
          // where the pin had -0 (the frame conversion), and toEqual tells
          // them apart. Nothing downstream does - JSON writes both as 0,
          // the content key is JSON, and === holds - so it is no error.
          const asText = (value: unknown): unknown =>
            JSON.parse(JSON.stringify(value));
          expect(asText(tourObjects(tourOf([pin])))).toEqual(
            asText([inOwnStation(pin)]),
          );
        },
      ),
      // The counterexample of the r874 fast gate (seed 1757663527).
      { numRuns: 200, examples: [[0, -0, 0, -0, 0]] },
    );
  });

  it("lists a picture's image asset once and reads the picture back with it", () => {
    const picture = {
      id: "ph",
      kind: "picture" as const,
      view: "plane" as const,
      image: "ph",
      widthM: 1,
      geo: {
        lat: 1,
        lon: 2,
        alt: 3,
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      imageAsset: {
        id: "ph",
        path: "content/ph.jpg",
        kind: "image" as const,
        width: 4,
        height: 3,
      },
    };
    const tour = tourOf([picture], { assets: [picture.imageAsset] });
    expect(tour.assets).toEqual([picture.imageAsset]);
    // Read back, its geo also carries the heading its rotation implies.
    expect(tourObjects(tour)).toEqual([
      inOwnStation({ ...picture, geo: { ...picture.geo, headingDeg: 0 } }),
    ]);
  });
});
