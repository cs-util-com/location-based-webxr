/**
 * Properties of the automatic-station rule (tour editor plan D20, D21).
 *
 * Why these properties matter: every pin, photo and recorded photo of a
 * version 3 tour lives in a station, with its pose relative to the
 * station's anchor. So, for ANY sequence of elements and any radius in the
 * range the plan will measure (15-40 m):
 * - an element within R of an anchor joins the NEAREST such station;
 * - an element beyond R of every anchor starts a new station, anchored
 *   exactly where it is;
 * - an anchor never moves when elements are added (a moved anchor would
 *   move every earlier item of its station);
 * - every element ends within R of its station's anchor.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { horizontalM } from "./move-with-code";
import { assignToStations, type StationSeat } from "./station-assign";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const base = { lat: 47.5, lon: 8.7 };

/** Elements scattered over 200 m x 200 m, so both joins and new stations
 *  occur at every radius in the range. */
const element = fc
  .record({
    north: fc.double({ min: -100, max: 100, noNaN: true }),
    east: fc.double({ min: -100, max: 100, noNaN: true }),
    up: fc.double({ min: -5, max: 5, noNaN: true }),
  })
  .map(({ north, east, up }) => {
    const g = calcGpsCoords(base, [north, 0, east]);
    return { lat: g.lat, lon: g.lon, alt: 400 + up };
  });
const radius = fc.double({ min: 15, max: 40, noNaN: true });

function ids(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `s${String(n)}`;
  };
}

/** The rule's own reading of "within": the same distance, the same `<=`. */
function nearestWithin(
  seats: readonly StationSeat[],
  e: { lat: number; lon: number },
  r: number,
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const s of seats) {
    const d = horizontalM(s.anchor, e);
    if (d <= r && (best === null || d < best.d)) best = { id: s.id, d };
  }
  return best?.id ?? null;
}

describe("automatic-station rule properties", () => {
  it("an element within R joins the nearest station; one beyond R starts a new station at itself", () => {
    fc.assert(
      fc.property(fc.array(element, { maxLength: 25 }), radius, (els, r) => {
        const newId = ids();
        let seats: StationSeat[] = [];
        for (const e of els) {
          const expected = nearestWithin(seats, e, r);
          const result = assignToStations({
            stations: seats,
            elements: [e],
            positionOf: (x) => x,
            newStationId: newId,
            radiusM: r,
          });
          const got = result.stationOf[0]!;
          const created = result.stations.find((s) => s.id === got)!;
          // Joined: the expected station, and no new one. New: a station
          // that did not exist, anchored exactly at the element.
          expect({
            id: expected ?? "new",
            count: result.stations.length,
            anchor: expected === null ? created.anchor : null,
          }).toEqual({
            id:
              expected === null && !seats.some((s) => s.id === got)
                ? "new"
                : got,
            count: seats.length + (expected === null ? 1 : 0),
            anchor: expected === null ? e : null,
          });
          seats = result.stations;
        }
      }),
    );
  });

  it("an anchor never moves when elements are added, and existing stations keep their order", () => {
    fc.assert(
      fc.property(
        fc.array(element, { maxLength: 15 }),
        fc.array(element, { maxLength: 15 }),
        radius,
        (first, more, r) => {
          const newId = ids();
          const before = assignToStations({
            stations: [],
            elements: first,
            positionOf: (x) => x,
            newStationId: newId,
            radiusM: r,
          }).stations;
          const snapshot = before.map((s) => ({
            id: s.id,
            anchor: { ...s.anchor },
          }));
          const after = assignToStations({
            stations: before,
            elements: more,
            positionOf: (x) => x,
            newStationId: newId,
            radiusM: r,
          }).stations;
          // Bit-identical anchors, the same objects, the same order.
          expect(after.slice(0, before.length)).toEqual(snapshot);
          after.slice(0, before.length).forEach((s, i) => {
            expect(s).toBe(before[i]);
          });
        },
      ),
    );
  });

  it("every element ends within R of its station's anchor, and one batch equals adding one element at a time", () => {
    fc.assert(
      fc.property(fc.array(element, { maxLength: 25 }), radius, (els, r) => {
        const batch = assignToStations({
          stations: [],
          elements: els,
          positionOf: (x) => x,
          newStationId: ids(),
          radiusM: r,
        });
        const byId = new Map(batch.stations.map((s) => [s.id, s]));
        els.forEach((e, i) => {
          const station = byId.get(batch.stationOf[i]!)!;
          expect(horizontalM(station.anchor, e)).toBeLessThanOrEqual(r);
        });
        const newId = ids();
        let seats: StationSeat[] = [];
        const oneByOne: string[] = [];
        for (const e of els) {
          const step = assignToStations({
            stations: seats,
            elements: [e],
            positionOf: (x) => x,
            newStationId: newId,
            radiusM: r,
          });
          seats = step.stations;
          oneByOne.push(step.stationOf[0]!);
        }
        expect(oneByOne).toEqual(batch.stationOf);
      }),
    );
  });
});
