/**
 * Why these tests matter: a version 3 tour (tour editor plan
 * 2026-10-17-1816, W3) has no loose pins: every pin, photo and recorded
 * photo the creator saves must land in a station, at a local pose, by the
 * automatic-station rule (D20, D21). The Tour Viewer edits a world view
 * (each object with its geo pose) and writes through `withTourContent`, so
 * these tests pin the write: an object nobody moved keeps its local pose
 * bit for bit (D17's "never changes a child's local pose" starts here), a
 * moved one is re-expressed in its own station, a new one joins the
 * nearest station within R or starts one, recorded photos are assigned in
 * capture order, and a saved object compares equal to its stored copy
 * (`asStored`), which is what keeps a draft from being offered back after
 * its save.
 */

import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type {
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { objectContentKey } from "./authoring-draft.js";
import { STATION_RADIUS_M } from "./station-assign.js";
import {
  AUTO_STATION_ACTIVATE_M,
  asStored,
  withTourContent,
  worldCaptureSpots,
} from "./tour-content.js";

// The core's geodesy runs only under an activated licence.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const M_PER_DEG = 111_320;
const LAT = 48.1;
const LON = 11.5;

/** A geo pose `n` metres north and `e` metres east of the origin. */
function geo(n: number, e: number, alt = 520, yawDeg = 0) {
  const half = (-yawDeg * Math.PI) / 360;
  return {
    lat: LAT + n / M_PER_DEG,
    lon: LON + e / (M_PER_DEG * Math.cos((LAT * Math.PI) / 180)),
    alt,
    rotation: [0, Math.sin(half), 0, Math.cos(half)] as [
      number,
      number,
      number,
      number,
    ],
  };
}

function station(id: string, n: number, e: number): TourStation {
  return {
    id,
    geo: geo(n, e, 520, 30),
    activateRadiusM: 40,
    foundRadiusM: 10,
    hint: "arrow",
    steps: [],
    items: [],
  };
}

function pin(id: string, n: number, e: number, label = id): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-18T06:00:00.000Z",
    geo: geo(n, e, 521.5),
  };
}

function tour(stations: TourStation[]): TourManifest {
  return { version: 3, minor: 0, order: "fixed", assets: [], stations };
}

/** Station ids in order: `s1`, `s2`, ... */
function counter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `s${String(n)}`;
  };
}

describe("withTourContent", () => {
  it("an object nobody moved keeps its local pose bit for bit, its station, and its order", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [pin("a", 3, 4), pin("b", -2, 1)],
    });
    const again = withTourContent(base, { objects: tourObjects(base) });
    expect(JSON.stringify(again.stations)).toBe(JSON.stringify(base.stations));
  });

  it("an edited label keeps the pose; a moved object is re-expressed in its own station", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [pin("a", 3, 4), pin("b", -2, 1)],
    });
    const [a, b] = tourObjects(base);
    const moved = { ...b!, geo: geo(5, 5, 521.5) };
    const next = withTourContent(base, {
      objects: [{ ...a!, label: "renamed" }, moved],
    });
    const items = next.stations[0]!.items;
    expect(items[0]).toMatchObject({ label: "renamed" });
    expect(items[0]!.pose).toBe(base.stations[0]!.items[0]!.pose);
    expect(items[1]!.pose).toEqual(
      localPoseOf(moved.geo, base.stations[0]!.geo),
    );
  });

  it("a moved object stays in its station even beyond R: only a new one is assigned", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [pin("a", 3, 4)],
    });
    const far = { ...tourObjects(base)[0]!, geo: geo(200, 0, 521.5) };
    const next = withTourContent(base, { objects: [far] });
    expect(next.stations.map((s) => s.id)).toEqual(["gate"]);
    expect(next.stations[0]!.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("a new object joins the nearest station within R; beyond R it starts a station where it stands", () => {
    const next = withTourContent(
      tour([station("gate", 0, 0), station("well", 0, 40)]),
      {
        objects: [pin("near-well", 0, 30), pin("lone", 100, 0)],
        newStationId: counter(),
      },
    );
    expect(next.stations.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ["gate", []],
      ["well", ["near-well"]],
      ["s1", ["lone"]],
    ]);
    const started = next.stations[2]!;
    // Anchored at its first element, turned like north (D20), automatic:
    // no story, found at R, activated further out.
    expect(started).toMatchObject({
      geo: { ...geo(100, 0, 521.5), rotation: [0, 0, 0, 1] },
      foundRadiusM: STATION_RADIUS_M,
      activateRadiusM: AUTO_STATION_ACTIVATE_M,
      hint: "arrow",
      steps: [],
    });
    expect(started.items[0]!.pose.position).toEqual([0, 0, 0]);
  });

  it("a chain of new objects becomes a chain of stations, in the caller's order", () => {
    const next = withTourContent(tour([]), {
      objects: [0, 20, 40, 60].map((n) => pin(`p${String(n)}`, n, 0)),
      newStationId: counter(),
    });
    expect(next.stations.map((s) => s.items.map((i) => i.id))).toEqual([
      ["p0", "p20"],
      ["p40", "p60"],
    ]);
  });

  it("an object absent from the list leaves its station; the station stays", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [pin("a", 3, 4), pin("b", -2, 1)],
    });
    const next = withTourContent(base, {
      objects: tourObjects(base).filter((o) => o.id !== "a"),
    });
    expect(next.stations.map((s) => s.items.map((i) => i.id))).toEqual([["b"]]);
  });

  it("a station emptied by this write goes when it carries nothing else; a titled, storied or photographed one stays", () => {
    // Why this test matters (tour editor plan D20): an automatic station
    // exists for the elements it holds. Deleting its last pin used to
    // leave an untitled, empty station behind, which the visitor's guide
    // still offered ("Next: Station 2, 30 m") - a walk to nothing. A
    // station with its own title, story steps or recorded photos is the
    // creator's, one another station routes to stays so the route still
    // resolves, and an empty station the tour already had is left alone.
    const titled = { ...station("titled", 100, 0), title: "Old well" };
    const storied: TourStation = {
      ...station("storied", 200, 0),
      steps: [
        {
          id: "t",
          block: { kind: "text", text: "Hi" },
          advance: { mode: "tap" },
        },
      ],
      next: "routed",
    };
    const base = withTourContent(
      tour([
        station("auto", 0, 0),
        titled,
        storied,
        station("photographed", 300, 0),
        station("was-empty", 400, 0),
        station("routed", 500, 0),
      ]),
      {
        objects: [
          pin("a", 1, 0),
          pin("b", 101, 0),
          pin("c", 201, 0),
          pin("d", 301, 0),
          pin("e", 501, 0),
        ],
        captureSpots: {
          fixes: 3,
          gpsAccuracyMedianM: 4,
          captures: [{ image: "images/frame-1.jpg", geo: geo(302, 0, 521) }],
        },
      },
    );
    expect(base.captureSpots?.captures[0]?.station).toBe("photographed");
    const next = withTourContent(base, { objects: [] });
    expect(next.stations.map((s) => s.id)).toEqual([
      "titled",
      "storied",
      "photographed",
      "was-empty",
      "routed",
    ]);
  });

  it("an object naming a station the tour lacks is assigned as a new one", () => {
    const next = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [{ ...pin("a", 1, 1), station: "gone" }],
    });
    expect(next.stations[0]!.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("recorded photos are assigned in capture order, before the objects; the tour's own spots are kept", () => {
    const captures = [0, 30, 60].map((n) => ({
      image: `images/frame-${String(n)}.jpg`,
      geo: geo(n, 0, 521),
    }));
    const next = withTourContent(tour([]), {
      objects: [pin("pin", 32, 0)],
      captureSpots: { fixes: 9, gpsAccuracyMedianM: 4, captures },
      newStationId: counter(),
    });
    expect(next.captureSpots?.captures.map((c) => c.station)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(next.stations[1]!.items.map((i) => i.id)).toEqual(["pin"]);
    expect(next.captureSpots).toMatchObject({
      fixes: 9,
      gpsAccuracyMedianM: 4,
    });
    // Spots are baked once: a later save keeps the tour's, verbatim.
    const later = withTourContent(next, {
      objects: tourObjects(next),
      captureSpots: { fixes: 1, gpsAccuracyMedianM: 1, captures: [] },
    });
    expect(later.captureSpots).toBe(next.captureSpots);
    // And their world view reads back where they were baked.
    const world = worldCaptureSpots(next)!;
    expect(world.captures.map((c) => c.image)).toEqual(
      captures.map((c) => c.image),
    );
    for (const [i, c] of world.captures.entries()) {
      expect(c.geo.lat).toBeCloseTo(captures[i]!.geo.lat, 9);
      expect(c.geo.alt).toBeCloseTo(521, 3);
    }
  });

  it("refuses an R that is not a positive number", () => {
    expect(() =>
      withTourContent(tour([]), { objects: [pin("a", 0, 0)], radiusM: 0 }),
    ).toThrow(RangeError);
  });
});

describe("asStored", () => {
  it("is what the written tour holds for an object, by content key", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -24, max: 24, noNaN: true }),
        fc.double({ min: -24, max: 24, noNaN: true }),
        fc.double({ min: 500, max: 540, noNaN: true }),
        (n, e, alt) => {
          const base = tour([station("gate", 0, 0)]);
          const placed = { ...pin("a", n, e), geo: geo(n, e, alt, 70) };
          const written = withTourContent(base, { objects: [placed] });
          const read = tourObjects(written)[0]!;
          // In whichever station the rule put it (a far one starts its own).
          const home = written.stations.find((s) => s.id === read.station)!;
          expect(objectContentKey(asStored(placed, home))).toBe(
            objectContentKey(read),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
