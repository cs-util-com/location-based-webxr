/**
 * Why these tests matter: the empty tour's view is computed from the
 * browser's time zone (its name and offset), which a page cannot vouch
 * for. Whatever arrives, the centre must be a place on the globe (the view
 * core places a camera only there), and the view must look down at it. And
 * it is meant to show the creator's own part of the world: for real zones,
 * checked against their cities' real places (not against the module's own
 * table), the city must lie near the centre (an arc bound the offset alone
 * does not meet), inside what the start height sees, and on a landscape
 * screen inside the picture itself.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { meteorStartAltitudeM } from "./globe-approach-meteor.js";
import { GLOBE_EDITOR_LOOK } from "./globe-editor-look.js";
import { emptyTourCentre, emptyTourView } from "./empty-tour-view.js";

const EARTH_RADIUS_KM = 6_371;
const DEG = Math.PI / 180;

/** The height (km) the globe editor opens an empty tour at, on a screen of
 *  `aspect` with no `startKm` in the link: the approach's start. */
function startKm(aspect: number): number {
  return (
    meteorStartAltitudeM({
      radiusM: EARTH_RADIUS_KM * 1000,
      fovYDeg: GLOBE_EDITOR_LOOK.fovYDeg,
      aspect,
      startKm: null,
    }) / 1000
  );
}

/** How far (deg of arc) a real zone's city may lie from the centre. The
 *  start height sees the whole visible half of the Earth, so the cap and
 *  the picture checks pass even a wrong region table; this bound does not:
 *  with the table the farthest city is Jakarta at about 36 deg, with the
 *  offset alone (the fallback latitude for every zone) Reykjavik at about
 *  56 deg. */
const NEAR_ARC_DEG = 40;

/** The lowest of those over the shapes tested here (the widest screen
 *  starts nearest), for the cap check. */
const START_KM = Math.min(startKm(2.4), startKm(390 / 844));

/**
 * Real zones with a city's place (rounded, from the zone's own city) and
 * the zone's standard and summer offsets (hours east of Greenwich). The
 * ground truth is independent of the module: a region table that put a
 * zone in the wrong part of the world fails here.
 */
const CITIES: readonly (readonly [
  zone: string,
  stdH: number,
  summerH: number,
  lat: number,
  lng: number,
])[] = [
  ["Europe/Oslo", 1, 2, 59.91, 10.75],
  ["Europe/London", 0, 1, 55.95, -3.19], // Edinburgh
  ["Europe/Lisbon", 0, 1, 38.72, -9.14],
  ["Europe/Moscow", 3, 3, 55.76, 37.62],
  ["Europe/Istanbul", 3, 3, 41.01, 28.98],
  ["Atlantic/Reykjavik", 0, 0, 64.15, -21.94],
  ["Africa/Cairo", 2, 3, 30.04, 31.24],
  ["Africa/Lagos", 1, 1, 6.52, 3.38],
  ["Africa/Nairobi", 3, 3, -1.29, 36.82],
  ["Africa/Johannesburg", 2, 2, -26.2, 28.05],
  ["Asia/Tokyo", 9, 9, 35.68, 139.69],
  ["Asia/Kolkata", 5.5, 5.5, 22.57, 88.36],
  ["Asia/Singapore", 8, 8, 1.35, 103.82],
  ["Asia/Jakarta", 7, 7, -6.2, 106.85],
  ["Asia/Shanghai", 8, 8, 31.23, 121.47],
  ["Asia/Dubai", 4, 4, 25.2, 55.27],
  ["Asia/Novosibirsk", 7, 7, 55.03, 82.92],
  ["Australia/Sydney", 10, 11, -33.87, 151.21],
  ["Australia/Perth", 8, 8, -31.95, 115.86],
  ["Australia/Darwin", 9.5, 9.5, -12.46, 130.84],
  ["Pacific/Auckland", 12, 13, -36.85, 174.76],
  ["Pacific/Honolulu", -10, -10, 21.31, -157.86],
  ["America/Los_Angeles", -8, -7, 34.05, -118.24],
  ["America/New_York", -5, -4, 40.71, -74.01],
  ["America/Chicago", -6, -5, 41.88, -87.63],
  ["America/Mexico_City", -6, -6, 19.43, -99.13],
  ["America/Anchorage", -9, -8, 61.22, -149.9],
  ["America/Sao_Paulo", -3, -3, -23.55, -46.63],
  ["America/Argentina/Buenos_Aires", -3, -3, -34.6, -58.38],
  ["America/Buenos_Aires", -3, -3, -34.6, -58.38],
  ["America/Bogota", -5, -5, 4.71, -74.07],
  ["America/Santiago", -4, -3, -33.45, -70.67],
  ["America/Lima", -5, -5, -12.05, -77.04],
];

type Place = { readonly lat: number; readonly lng: number };

/** A place on the unit sphere. */
function unit({ lat, lng }: Place): [number, number, number] {
  return [
    Math.cos(lat * DEG) * Math.cos(lng * DEG),
    Math.cos(lat * DEG) * Math.sin(lng * DEG),
    Math.sin(lat * DEG),
  ];
}

const dot = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

/** The great-circle angle (deg) between two places. */
function arcDeg(a: Place, b: Place): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b))))) / DEG;
}

/** The cap the start height sees: its horizon's angle (deg). */
const HORIZON_DEG =
  Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + START_KM)) / DEG;

/**
 * Whether `city` is in the picture of a camera `km` over `centre`, looking
 * straight down with north up (the view's heading 0), at the editor's
 * vertical lens and `aspect` (width / height), within `share` of the
 * picture's half extents (the view tilts 1 degree off straight down; the
 * share keeps clear of that and of the very edge).
 */
function onScreen(
  centre: Place,
  city: Place,
  km: number,
  aspect: number,
  share = 0.9,
): boolean {
  const n = unit(centre);
  const east = [-Math.sin(centre.lng * DEG), Math.cos(centre.lng * DEG), 0];
  const north = [
    -Math.sin(centre.lat * DEG) * Math.cos(centre.lng * DEG),
    -Math.sin(centre.lat * DEG) * Math.sin(centre.lng * DEG),
    Math.cos(centre.lat * DEG),
  ];
  const r = EARTH_RADIUS_KM;
  const p = unit(city).map((v) => v * r);
  const camera = n.map((v) => v * (r + km));
  const ray = p.map((v, i) => v - (camera[i] ?? 0));
  // Behind the Earth's limb from the camera: not drawn.
  if (dot(unit(city), n) <= r / (r + km)) return false;
  const depth = -dot(ray, n);
  const halfY = Math.tan((GLOBE_EDITOR_LOOK.fovYDeg / 2) * DEG);
  return (
    depth > 0 &&
    Math.abs(dot(ray, north) / depth) <= halfY * share &&
    Math.abs(dot(ray, east) / depth) <= halfY * aspect * share
  );
}

describe("the empty tour's view (properties)", () => {
  it("always centres on a place on the globe, for any offset and any zone", () => {
    fc.assert(
      fc.property(
        fc.double(),
        fc.oneof(
          fc.constant(undefined),
          fc.string(),
          fc.constantFrom(...Intl.supportedValuesOf("timeZone")),
        ),
        (offset, zone) => {
          const { lat, lng, altM } = emptyTourCentre(offset, zone);
          expect(Number.isFinite(lat) && Number.isFinite(lng)).toBe(true);
          expect(lng).toBeGreaterThanOrEqual(-180);
          expect(lng).toBeLessThan(180);
          expect(Math.abs(lat)).toBeLessThan(90);
          expect(altM).toBe(0);
        },
      ),
    );
  });

  it("looks down at the centre from any positive height", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -900, max: 900 }),
        fc.constantFrom(undefined, ...CITIES.map(([zone]) => zone)),
        fc.double({ min: 0.001, max: 1e5, noNaN: true }),
        (offset, zone, km) => {
          const centre = emptyTourCentre(offset, zone);
          const pose = emptyTourView(centre, km);
          expect([pose.lat, pose.lng]).toEqual([centre.lat, centre.lng]);
          expect(pose.altitudeKm).toBe(km);
          expect(pose.pitchDeg).toBeLessThan(-80);
        },
      ),
    );
  });

  // Why: the creator's own part of the world must be in the first view.
  // A zone's city lies inside the cap the start height sees (its horizon,
  // less a margin so it is not on the very rim), whether the browser
  // reports the standard or the summer offset.
  it("puts a real zone's city inside the start height's cap", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CITIES),
        fc.boolean(),
        ([zone, stdH, summerH, lat, lng], summer) => {
          const hours = summer ? summerH : stdH;
          const centre = emptyTourCentre(-hours * 60, zone);
          expect(arcDeg(centre, { lat, lng })).toBeLessThan(HORIZON_DEG - 8);
        },
      ),
    );
  });

  // Why: a region table that put a zone in the wrong part of the world
  // must fail somewhere, and from the approach's start height the cap and
  // the picture see too much to catch it. The arc from the centre to the
  // zone's own city does, with the standard or the summer offset.
  it("puts a real zone's city near the centre (a wrong region fails)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CITIES),
        fc.boolean(),
        ([zone, stdH, summerH, lat, lng], summer) => {
          const hours = summer ? summerH : stdH;
          const centre = emptyTourCentre(-hours * 60, zone);
          expect(arcDeg(centre, { lat, lng })).toBeLessThan(NEAR_ARC_DEG);
        },
      ),
    );
  });

  // Why: the bound above must be able to fail. Without the zone's region
  // (the offset alone, one fallback latitude for every zone) some city lies
  // beyond it.
  it("puts some city beyond the bound on the offset alone", () => {
    const worst = Math.max(
      ...CITIES.map(([, stdH, , lat, lng]) =>
        arcDeg(emptyTourCentre(-stdH * 60), { lat, lng }),
      ),
    );
    expect(worst).toBeGreaterThan(NEAR_ARC_DEG);
  });

  // Why: the city must also be in the picture itself, at any landscape
  // shape, not only in the cap.
  it("puts a real zone's city in a landscape picture (standard offset)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CITIES),
        fc.double({ min: 1.2, max: 2.4, noNaN: true }),
        ([zone, stdH, , lat, lng], aspect) => {
          const centre = emptyTourCentre(-stdH * 60, zone);
          expect(onScreen(centre, { lat, lng }, startKm(aspect), aspect)).toBe(
            true,
          );
        },
      ),
    );
  });
});

describe("the empty tour's view: representative cities", () => {
  const SIX = [
    "Europe/Oslo",
    "Europe/London",
    "Australia/Sydney",
    "Pacific/Auckland",
    "America/Argentina/Buenos_Aires",
    "America/Los_Angeles",
  ];
  const named = CITIES.filter(([zone]) => SIX.includes(zone));

  it("knows the six", () => {
    expect(named).toHaveLength(SIX.length);
  });

  it.each(named)(
    "shows %s's city on a 1440x900 desktop screen and a 390x844 phone",
    (zone, stdH, _summerH, lat, lng) => {
      const centre = emptyTourCentre(-stdH * 60, zone);
      for (const aspect of [1440 / 900, 390 / 844]) {
        expect(onScreen(centre, { lat, lng }, startKm(aspect), aspect)).toBe(
          true,
        );
      }
    },
  );

  // Why: the picture check itself must be able to fail (a check that
  // passes everything proves nothing). From the approach's start the
  // whole visible half of the Earth is in the picture, so the far side is
  // what it must refuse: Auckland from Oslo's view, and Oslo from
  // Auckland's, at a landscape and a portrait shape.
  it("refuses a city on the far side of the Earth", () => {
    const oslo = emptyTourCentre(-60, "Europe/Oslo");
    const auckland = emptyTourCentre(-720, "Pacific/Auckland");
    for (const aspect of [1.6, 390 / 844]) {
      expect(
        onScreen(oslo, { lat: -36.85, lng: 174.76 }, startKm(aspect), aspect),
      ).toBe(false);
      expect(
        onScreen(auckland, { lat: 59.91, lng: 10.75 }, startKm(aspect), aspect),
      ).toBe(false);
    }
  });
});
