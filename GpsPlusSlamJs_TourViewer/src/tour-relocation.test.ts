import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";

import {
  createStationRelocator,
  RELOCATE_LEAD_NORTH_M,
  relocateStations,
  relocationRequested,
  type RelocationTarget,
} from "./tour-relocation";

// Why these tests matter: the sample tour sits at a public place (owner
// decision S-D9: no private location in the public repository), and a
// test-only switch moves it to wherever the phone is. A wrong move would put
// the stations on top of each other, stretch the walk, or touch stations a
// printed code anchors - and a field test would then measure the move, not
// the tour.

const M_PER_DEG_LAT = 111_320;

function geoStation(
  id: string,
  lat: number,
  lon: number,
  alt = 519,
): TourStation {
  return {
    id,
    anchor: { geo: { lat, lon, alt, headingDeg: 90 } },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [],
  };
}

function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const north = (b.lat - a.lat) * M_PER_DEG_LAT;
  const east = (b.lon - a.lon) * M_PER_DEG_LAT * Math.cos(midLat);
  return Math.hypot(north, east);
}

describe("createStationRelocator", () => {
  const stations = [geoStation("a", 48.1374, 11.5755)];

  it("passes the stations through when relocation is off", () => {
    const relocate = createStationRelocator(false);
    expect(relocate(stations, null)).toBe(stations);
  });

  it("holds the stations back until the first fix, then keeps that fix", () => {
    const moves: RelocationTarget[] = [];
    const relocate = createStationRelocator(true, (t) => moves.push(t));
    expect(relocate(stations, null)).toBeNull();
    const first = relocate(stations, { lat: 52.52, lon: 13.4, alt: 30 });
    const later = relocate(stations, { lat: 40.7, lon: -74, alt: 10 });
    // Moved once, at the first fix; a later fix does not drag the tour.
    expect(moves).toEqual([{ lat: 52.52, lon: 13.4, alt: 30 }]);
    expect(later?.[0]?.anchor.geo?.lat).toBeCloseTo(
      first?.[0]?.anchor.geo?.lat ?? Number.NaN,
      9,
    );
  });

  it("returns the same moved list for the same stations (read every frame)", () => {
    const relocate = createStationRelocator(true);
    const fix = { lat: 52.52, lon: 13.4, alt: 30 };
    const a = relocate(stations, fix);
    const b = relocate(stations, fix);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it("keeps the stations' own heights when the fix has no altitude", () => {
    const moved = relocateStations(stations, {
      lat: 52.52,
      lon: 13.4,
      alt: Number.NaN,
    });
    expect(moved[0]?.anchor.geo?.alt).toBe(519);
  });

  it("moves a new tour again from the kept fix", () => {
    const relocate = createStationRelocator(true);
    relocate(stations, { lat: 52.52, lon: 13.4, alt: 30 });
    const other = [geoStation("b", 40, 0)];
    const moved = relocate(other, null);
    expect(moved?.[0]?.anchor.geo?.lat).toBeGreaterThan(52.52);
  });
});

describe("relocationRequested", () => {
  it("is on only for ?relocate=here", () => {
    expect(relocationRequested("?relocate=here")).toBe(true);
    expect(relocationRequested("?qr=abc&relocate=here")).toBe(true);
    expect(relocationRequested("")).toBe(false);
    expect(relocationRequested("?relocate=1")).toBe(false);
    expect(relocationRequested("?relocate")).toBe(false);
  });
});

describe("relocateStations", () => {
  const marienplatz = [
    geoStation("column", 48.137393, 11.575493),
    geoStation("fountain", 48.137193, 11.575793),
    geoStation("steps", 48.137663, 11.575553),
  ];
  const here = { lat: 52.52, lon: 13.405, alt: 34 };

  it("puts the first station a few metres north of the phone", () => {
    const moved = relocateStations(marienplatz, here);
    const first = moved[0]?.anchor.geo;
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.lat).toBeGreaterThan(here.lat);
    expect(metresBetween(here, first)).toBeCloseTo(RELOCATE_LEAD_NORTH_M, 1);
    expect(first.alt).toBeCloseTo(here.alt, 6);
  });

  it("keeps every distance between stations", () => {
    const moved = relocateStations(marienplatz, here);
    for (let i = 0; i < marienplatz.length; i += 1) {
      for (let j = i + 1; j < marienplatz.length; j += 1) {
        const before = metresBetween(
          marienplatz[i]!.anchor.geo!,
          marienplatz[j]!.anchor.geo!,
        );
        const after = metresBetween(
          moved[i]!.anchor.geo!,
          moved[j]!.anchor.geo!,
        );
        expect(Math.abs(after - before)).toBeLessThan(0.05);
      }
    }
  });

  it("keeps each station's heights relative to the first and its heading", () => {
    const tall = [
      geoStation("a", 48.1374, 11.5755, 519),
      geoStation("b", 48.1376, 11.5755, 523),
    ];
    const moved = relocateStations(tall, here);
    expect(moved[1]!.anchor.geo!.alt - moved[0]!.anchor.geo!.alt).toBeCloseTo(
      4,
      6,
    );
    expect(moved[1]!.anchor.geo!.headingDeg).toBe(90);
  });

  it("leaves a station anchored only to a printed code untouched", () => {
    const codeOnly: TourStation = {
      id: "gate",
      anchor: { code: "qr-level-1" },
      activateRadiusM: 30,
      foundRadiusM: 5,
      hint: "arrow",
      steps: [],
    };
    const moved = relocateStations([codeOnly, ...marienplatz], here);
    expect(moved[0]).toBe(codeOnly);
    // The first GEO station is the one placed north of the phone.
    expect(metresBetween(here, moved[1]!.anchor.geo!)).toBeCloseTo(
      RELOCATE_LEAD_NORTH_M,
      1,
    );
  });

  it("returns the stations unchanged when none has a geo pose", () => {
    const none: TourStation[] = [];
    expect(relocateStations(none, here)).toEqual([]);
  });

  it("keeps pairwise distances for any layout and any target (property)", () => {
    const station = fc.record({
      north: fc.double({ min: -500, max: 500, noNaN: true }),
      east: fc.double({ min: -500, max: 500, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(station, { minLength: 2, maxLength: 6 }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (offsets, targetLat, targetLon) => {
          const baseLat = 48.1374;
          const baseLon = 11.5755;
          const cosBase = Math.cos(baseLat * (Math.PI / 180));
          const stations = offsets.map((o, i) =>
            geoStation(
              `s${String(i)}`,
              baseLat + o.north / M_PER_DEG_LAT,
              baseLon + o.east / (M_PER_DEG_LAT * cosBase),
            ),
          );
          const moved = relocateStations(stations, {
            lat: targetLat,
            lon: targetLon,
            alt: 0,
          });
          for (let i = 1; i < stations.length; i += 1) {
            const before = metresBetween(
              stations[0]!.anchor.geo!,
              stations[i]!.anchor.geo!,
            );
            const after = metresBetween(
              moved[0]!.anchor.geo!,
              moved[i]!.anchor.geo!,
            );
            // 1 % of the distance plus 5 cm: the local flat-earth step over
            // up to about 700 m.
            expect(Math.abs(after - before)).toBeLessThan(before * 0.01 + 0.05);
          }
        },
      ),
    );
  });
});
