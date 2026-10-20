/**
 * Why these tests matter: a version 3 tour (tour editor plan
 * 2026-10-17-1816, W3) has no loose pins: every pin, photo and recorded
 * photo the creator saves must land in a station, at a local pose, by the
 * automatic-station rule (D20, D21). The Tour Viewer edits a world view
 * (each object with its geo pose) and writes through `withTourContent`, so
 * these tests pin the write: an object nobody moved keeps its local pose
 * bit for bit (D17's "never changes a child's local pose" starts here), a
 * moved one is re-expressed in its own station, every object goes into the
 * station it names (the writer starts none), the recorded photos are put
 * into stations at the open by the station rule (`withWalkPhotos`), and a
 * saved object compares equal to its stored copy (`asStored`), which is
 * what keeps a draft from being offered back after its save.
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
  withWalkPhotos,
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

/** `object` naming the station `id`, as the tour document seats it. */
function inStation(object: TourObject, id: string): TourObject {
  return { ...object, station: id };
}

describe("withTourContent", () => {
  it("an object nobody moved keeps its local pose bit for bit, its station, and its order", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [
        inStation(pin("a", 3, 4), "gate"),
        inStation(pin("b", -2, 1), "gate"),
      ],
    });
    const again = withTourContent(base, { objects: tourObjects(base) });
    expect(JSON.stringify(again.stations)).toBe(JSON.stringify(base.stations));
  });

  it("an edited label keeps the pose; a moved object is re-expressed in its own station", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [
        inStation(pin("a", 3, 4), "gate"),
        inStation(pin("b", -2, 1), "gate"),
      ],
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

  // Why this test matters: the tour document seats every object in a
  // station from the moment it is placed or moved, and the page shows that
  // station. A writer that assigned stations again (as it once did for new
  // objects) could write an object somewhere other than the station the
  // creator was shown, so it writes each object into the station it names,
  // wherever it stands.
  it("writes each object into the station it names, however far from it, and starts no station", () => {
    const next = withTourContent(
      tour([station("gate", 0, 0), station("well", 0, 40)]),
      {
        objects: [
          inStation(pin("near-well", 0, 39), "gate"),
          inStation(pin("lone", 100, 0), "well"),
        ],
      },
    );
    expect(next.stations.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ["gate", ["near-well"]],
      ["well", ["lone"]],
    ]);
  });

  it("an object keeps the station the tour holds it in when it names none", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [inStation(pin("a", 3, 4), "gate")],
    });
    const { station: _station, ...unnamed } = tourObjects(base)[0]!;
    const next = withTourContent(base, { objects: [unnamed] });
    expect(next.stations[0]!.items.map((i) => i.id)).toEqual(["a"]);
  });

  // Why this test matters: an object that reaches the writer in no station
  // of the tour is a broken document, not a reason to invent a station: a
  // station made here would be one no page ever showed. The save fails in
  // words instead of writing it somewhere.
  it("refuses an object naming a station the tour lacks, or none at all", () => {
    const base = tour([station("gate", 0, 0)]);
    expect(() =>
      withTourContent(base, { objects: [inStation(pin("a", 0, 0), "gone")] }),
    ).toThrow(/"a".*station/);
    expect(() => withTourContent(base, { objects: [pin("b", 0, 0)] })).toThrow(
      /"b".*station/,
    );
  });

  it("keeps the stations in the order the tour has them", () => {
    const next = withTourContent(
      tour([station("c", 0, 0), station("a", 50, 0), station("b", 100, 0)]),
      {
        objects: [
          inStation(pin("in-b", 100, 0), "b"),
          inStation(pin("in-c", 0, 0), "c"),
        ],
      },
    );
    expect(next.stations.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("an object absent from the list leaves its station; the station stays", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [
        inStation(pin("a", 3, 4), "gate"),
        inStation(pin("b", -2, 1), "gate"),
      ],
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
    const stations = [
      station("auto", 0, 0),
      titled,
      storied,
      station("photographed", 300, 0),
      station("was-empty", 400, 0),
      station("routed", 500, 0),
    ];
    const base = withTourContent(
      withWalkPhotos(tour(stations), {
        fixes: 3,
        gpsAccuracyMedianM: 4,
        captures: [{ image: "images/frame-1.jpg", geo: geo(302, 0, 521) }],
      }),
      {
        objects: [
          inStation(pin("a", 1, 0), "auto"),
          inStation(pin("b", 101, 0), "titled"),
          inStation(pin("c", 201, 0), "storied"),
          inStation(pin("d", 301, 0), "photographed"),
          inStation(pin("e", 501, 0), "routed"),
        ],
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

  it("keeps the tour's recorded photos verbatim", () => {
    const baked = withWalkPhotos(tour([]), {
      fixes: 9,
      gpsAccuracyMedianM: 4,
      captures: [{ image: "images/frame-1.jpg", geo: geo(0, 0, 521) }],
    });
    const later = withTourContent(baked, { objects: [] });
    expect(later.captureSpots).toBe(baked.captureSpots);
  });
});

describe("withWalkPhotos", () => {
  // Why these tests matter: the recording's photos are put into stations
  // once, when the creator opens the recording, by the same rule a
  // placement follows (a station whose own found radius holds the spot,
  // else a new one there). Their stations then exist from the open on,
  // under ids a reload gives again, so nothing the page showed moves at
  // the Finish.
  const spotsAt = (...north: number[]) => ({
    fixes: 9,
    gpsAccuracyMedianM: 4,
    captures: north.map((n, i) => ({
      image: `images/frame-${String(i + 1)}.jpg`,
      geo: geo(n, 0, 521),
    })),
  });

  // Both sides of each boundary: the gate's own 10 m radius (10 m joins,
  // 10.5 m does not) and the new station's 25 m (25.5 m from its anchor
  // starts the next one, 24.5 m joins the nearer of two).
  it("puts each photo, in capture order, in the station whose own radius holds it, else in a new one where it stands", () => {
    const next = withWalkPhotos(
      tour([station("gate", 0, 0)]),
      spotsAt(10, 10.5, 36, 35),
    );
    expect(next.captureSpots?.captures.map((c) => c.station)).toEqual([
      "gate",
      "walk-1",
      "walk-2",
      "walk-2",
    ]);
    expect(next.stations.map((s) => s.id)).toEqual([
      "gate",
      "walk-1",
      "walk-2",
    ]);
    const started = next.stations[1]!;
    // Anchored at its first photo, turned like north, automatic.
    expect(started).toMatchObject({
      geo: { ...geo(10.5, 0, 521), rotation: [0, 0, 0, 1] },
      foundRadiusM: STATION_RADIUS_M,
      activateRadiusM: AUTO_STATION_ACTIVATE_M,
      hint: "arrow",
      steps: [],
      items: [],
    });
    expect(next.captureSpots).toMatchObject({
      fixes: 9,
      gpsAccuracyMedianM: 4,
    });
  });

  it("names its stations the same on every open, skipping ids the tour has", () => {
    const base = tour([station("walk-1", 500, 0)]);
    const once = withWalkPhotos(base, spotsAt(0, 100));
    expect(once.stations.map((s) => s.id)).toEqual([
      "walk-1",
      "walk-2",
      "walk-3",
    ]);
    expect(withWalkPhotos(base, spotsAt(0, 100))).toEqual(once);
  });

  it("reads back where the photos were taken", () => {
    const captures = spotsAt(0, 30, 60).captures;
    const world = worldCaptureSpots(
      withWalkPhotos(tour([]), spotsAt(0, 30, 60)),
    )!;
    expect(world.captures.map((c) => c.image)).toEqual(
      captures.map((c) => c.image),
    );
    for (const [i, c] of world.captures.entries()) {
      expect(c.geo.lat).toBeCloseTo(captures[i]!.geo.lat, 9);
      expect(c.geo.alt).toBeCloseTo(521, 3);
    }
  });

  it("leaves a tour that has its photos, and a walk without photos, as they are", () => {
    const baked = withWalkPhotos(tour([]), spotsAt(0));
    expect(withWalkPhotos(baked, spotsAt(100))).toBe(baked);
    const empty = tour([station("gate", 0, 0)]);
    expect(withWalkPhotos(empty, spotsAt())).toBe(empty);
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
          const placed = {
            ...pin("a", n, e),
            geo: geo(n, e, alt, 70),
            station: "gate",
          };
          const written = withTourContent(base, { objects: [placed] });
          const read = tourObjects(written)[0]!;
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
