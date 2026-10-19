import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { STATION_RADIUS_M } from "./station-assign.js";
import { capturesByStation, nearestStationId } from "./station-captures.js";

/**
 * Why these tests matter (visitor plan 2026-10-18-2349 M2): a
 * walk photo shows only while its station is present, so a photo grouped
 * under the wrong station shows at the wrong exhibit, and a photo grouped
 * under none would never show. Baked photos keep the station the creator's
 * Finish gave them; photos joined live get the same rule the Finish uses
 * (`assignToStations`); the ring around a code goes with the station
 * nearest the code.
 */

// The geodesy is licence-gated; the store's construction activates it.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ZERO = { lat: 47.5, lon: 8.7 };

/** A point `n` m north and `e` m east of the zero, at 400 m. */
function at(n: number, e: number) {
  const g = calcGpsCoords(ZERO, [n, 0, e]);
  return { lat: g.lat, lon: g.lon, alt: 400 };
}

function station(id: string, n: number, e: number) {
  return { id, geo: at(n, e) };
}

const capture = (name: string, n: number, e: number, station?: string) => ({
  name,
  geo: at(n, e),
  ...(station === undefined ? {} : { station }),
});

const names = (list: readonly { name: string }[] | undefined) =>
  (list ?? []).map((c) => c.name);

describe("capturesByStation", () => {
  const stations = [station("a", 0, 0), station("b", 30, 0)];

  it("keeps the station a baked capture names, even where another is nearer", () => {
    const grouped = capturesByStation(
      [capture("p", 29, 0, "a"), capture("q", 1, 0, "b")],
      stations,
    );
    expect(names(grouped.byStation.get("a"))).toEqual(["p"]);
    expect(names(grouped.byStation.get("b"))).toEqual(["q"]);
    expect(grouped.loose).toEqual([]);
  });

  it("gives a live capture the nearest station within the radius, as the Finish does", () => {
    const grouped = capturesByStation(
      [capture("near-a", 10, 0), capture("near-b", 21, 0)],
      stations,
    );
    expect(names(grouped.byStation.get("a"))).toEqual(["near-a"]);
    expect(names(grouped.byStation.get("b"))).toEqual(["near-b"]);
  });

  it("leaves a live capture beyond every station's radius loose, never in a far station", () => {
    const grouped = capturesByStation(
      [capture("far", 0, STATION_RADIUS_M + 5), capture("in", 0, 2)],
      stations,
    );
    expect(names(grouped.loose)).toEqual(["far"]);
    expect(names(grouped.byStation.get("a"))).toEqual(["in"]);
  });

  it("a capture naming a station the tour lacks is judged by the rule", () => {
    const grouped = capturesByStation([capture("p", 31, 0, "gone")], stations);
    expect(names(grouped.byStation.get("b"))).toEqual(["p"]);
  });

  it("with no stations at all, every capture is loose", () => {
    const grouped = capturesByStation([capture("p", 0, 0)], []);
    expect(names(grouped.loose)).toEqual(["p"]);
    expect(grouped.byStation.size).toBe(0);
  });

  it("places every capture exactly once, in a station within the radius or loose (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
          ),
          { maxLength: 20 },
        ),
        (points) => {
          const captures = points.map(([n, e], i) => capture(`c${i}`, n, e));
          const grouped = capturesByStation(captures, stations);
          const all = [
            ...grouped.loose,
            ...[...grouped.byStation.values()].flat(),
          ];
          expect(names(all).sort()).toEqual(names(captures).sort());
          for (const [id, list] of grouped.byStation) {
            const s = stations.find((x) => x.id === id)!;
            for (const c of list) {
              const d = Math.hypot(
                (c.geo.lat - s.geo.lat) * 111_200,
                (c.geo.lon - s.geo.lon) * 75_100,
              );
              expect(d).toBeLessThanOrEqual(STATION_RADIUS_M + 0.5);
            }
          }
        },
      ),
    );
  });
});

describe("nearestStationId (the ring)", () => {
  it("is the station nearest the code within the station radius (25 m, inclusive)", () => {
    const stations = [station("a", 0, 0), station("b", 300, 0)];
    expect(nearestStationId(stations, at(290, 0))).toBe("b");
    expect(nearestStationId(stations, at(24.9, 0))).toBe("a");
    expect(nearestStationId(stations, at(0, 25))).toBe("a");
  });

  // Why: a ring bound to a station 100 m away showed only there, so the
  // visitor standing at the code saw nothing after the lock (M2 review).
  // Beyond the radius the ring has no station and stands always, as a
  // walk photo joined live does by the same rule.
  it("is null for a code beyond every station's radius", () => {
    const stations = [station("a", 0, 0), station("b", 300, 0)];
    expect(nearestStationId(stations, at(26, 0))).toBeNull();
    expect(nearestStationId(stations, at(200, 0))).toBeNull();
    expect(nearestStationId(stations, at(-900, 0))).toBeNull();
  });

  it("is the earlier station on a tie, and null without stations", () => {
    expect(
      nearestStationId([station("a", 0, 10), station("b", 0, -10)], at(0, 0)),
    ).toBe("a");
    expect(nearestStationId([], at(0, 0))).toBeNull();
  });
});
