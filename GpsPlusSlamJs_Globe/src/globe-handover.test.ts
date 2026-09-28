/**
 * Why this test matters: the pin's dive ends by opening the OSM demo's
 * city where the user is (round-2 plan 2026-09-26-2055 DEC-FB2-3, M3g).
 * The link is the whole hand-over, and every part of it can go wrong
 * without an error:
 * - the site layout: the lab lives at `/labs/globe/` on the dev server and
 *   at `/lookdev/labs/globe/` on the site, the city at `/osm/`; a link
 *   built from a literal absolute path would be rewritten under
 *   `/lookdev/` by the deploy (build-lookdev's route rebase) and land on
 *   the demo's source files;
 * - the demo's contract: `lat`/`lng` move the user, `clat`/`clng`/`cdist`
 *   place the camera, and a `cdist` above its 4,800 m ceiling is refused,
 *   silently opening the default view;
 * - the time: the demo reads `date` (the solar date at the place) and
 *   `time` (apparent solar time), and renders the sky reliably only down to
 *   civil twilight, so a night-time globe hands over without a time.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OSM_HANDOVER, handOverUrl, osmDemoBase } from "./globe-handover.js";

const COLOGNE = { lat: 50.94128, lng: 6.95817 };

describe("osmDemoBase", () => {
  it("finds the city beside the lab on the site and on the dev server", () => {
    expect(
      osmDemoBase(
        "https://r800-gps-plus-slam.csutil.workers.dev/lookdev/labs/globe/#at=1,2",
      ),
    ).toBe("https://r800-gps-plus-slam.csutil.workers.dev/osm/");
    expect(osmDemoBase("http://127.0.0.1:5198/labs/globe/")).toBe(
      "http://127.0.0.1:5198/osm/",
    );
    // The page's own file name and a query change nothing.
    expect(
      osmDemoBase("http://127.0.0.1:5198/labs/globe/index.html?x=1#y"),
    ).toBe("http://127.0.0.1:5198/osm/");
  });

  it("keeps a site that is itself served under a sub-path", () => {
    expect(osmDemoBase("https://example.org/preview/lookdev/labs/globe/")).toBe(
      "https://example.org/preview/osm/",
    );
  });

  it("falls back to the origin's city for a page served anywhere else", () => {
    expect(osmDemoBase("https://example.org/some/where/")).toBe(
      "https://example.org/osm/",
    );
  });
});

// WHY (milestone review of the pin, finding M1): OsmDemo's camera looks at
// its target from `cdist` metres, and its linear fog runs from
// fogNearRatio x far to the far plane. At the demo's maximum `cdist` (4800
// m, its far plane) the user's own spot sat exactly at the far plane, fully
// fogged, and the fetched tile beyond it was lost in the fog. The bound is
// derived from the demo's far plane and fog ratio (held to its source by
// tests/repo-config/globe-handover-contract.test.js), not from a literal.
describe("the hand-over distance", () => {
  const fogNearM = OSM_HANDOVER.fogNearRatio * OSM_HANDOVER.farPlaneM;

  it("keeps the spot and the far side of its data tile in front of the fog", () => {
    expect(
      OSM_HANDOVER.cameraDistanceM + OSM_HANDOVER.tileHalfM,
    ).toBeLessThanOrEqual(fogNearM);
  });

  it("is a distance the demo accepts, and far enough to see the tile", () => {
    expect(OSM_HANDOVER.cameraDistanceM).toBeLessThanOrEqual(
      OSM_HANDOVER.maxCameraDistanceM,
    );
    expect(OSM_HANDOVER.cameraDistanceM).toBeGreaterThanOrEqual(
      OSM_HANDOVER.tileHalfM,
    );
  });
});

describe("handOverUrl", () => {
  const page = "https://example.org/lookdev/labs/globe/";

  it("moves the user and the camera to the target, the camera at the hand-over distance", () => {
    const url = new URL(handOverUrl({ pageHref: page, target: COLOGNE }));
    expect(url.origin + url.pathname).toBe("https://example.org/osm/");
    const q = url.searchParams;
    expect(q.get("lat")).toBe("50.94128");
    expect(q.get("lng")).toBe("6.95817");
    expect(q.get("clat")).toBe("50.94128");
    expect(q.get("clng")).toBe("6.95817");
    expect(q.get("cdist")).toBe(String(OSM_HANDOVER.cameraDistanceM));
    // No time given: the demo boots at its own afternoon sun.
    expect(q.has("date")).toBe(false);
    expect(q.has("time")).toBe(false);
  });

  it("writes five decimals (about a metre), as the demo itself writes them", () => {
    const url = new URL(
      handOverUrl({
        pageHref: page,
        target: { lat: -33.8567844, lng: 151.2152967 },
      }),
    );
    expect(url.searchParams.get("lat")).toBe("-33.85678");
    expect(url.searchParams.get("lng")).toBe("151.21530");
    const zero = new URL(
      handOverUrl({ pageHref: page, target: { lat: -0, lng: -0 } }),
    );
    expect(zero.searchParams.get("lat")).toBe("0.00000");
  });

  it("hands the globe's time over as the demo's solar date and time while the sun is up", () => {
    const url = new URL(
      handOverUrl({
        pageHref: page,
        target: COLOGNE,
        sun: {
          date: { year: 2026, month: 3, day: 20 },
          solarHours: 11.5,
          elevationDeg: 38,
        },
      }),
    );
    expect(url.searchParams.get("date")).toBe("2026-03-20");
    expect(url.searchParams.get("time")).toBe("11:30");
    // Readable as typed (the demo's parser decodes either form).
    expect(url.href).toContain("time=11:30");
  });

  it("keeps the minute a time was booted at (floating point a hair below it)", () => {
    const url = new URL(
      handOverUrl({
        pageHref: page,
        target: COLOGNE,
        sun: {
          date: { year: 2026, month: 9, day: 7 },
          solarHours: 15 + 47 / 60 - 1e-12,
          elevationDeg: 20,
        },
      }),
    );
    expect(url.searchParams.get("time")).toBe("15:47");
  });

  it("drops the time when the sun is below civil twilight, which the demo cannot draw reliably", () => {
    for (const elevationDeg of [-6.01, -20, -90]) {
      const url = new URL(
        handOverUrl({
          pageHref: page,
          target: COLOGNE,
          sun: {
            date: { year: 2026, month: 3, day: 20 },
            solarHours: 0.5,
            elevationDeg,
          },
        }),
      );
      expect(url.searchParams.has("date")).toBe(false);
      expect(url.searchParams.has("time")).toBe(false);
    }
    const dusk = new URL(
      handOverUrl({
        pageHref: page,
        target: COLOGNE,
        sun: {
          date: { year: 2026, month: 3, day: 20 },
          solarHours: 18.6,
          elevationDeg: OSM_HANDOVER.minSunElevationDeg,
        },
      }),
    );
    expect(dusk.searchParams.get("time")).toBe("18:36");
  });

  it("refuses a target that is not a place", () => {
    for (const target of [
      { lat: 91, lng: 0 },
      { lat: 0, lng: -181 },
      { lat: Number.NaN, lng: 0 },
    ]) {
      expect(() => handOverUrl({ pageHref: page, target })).toThrow(RangeError);
    }
  });

  it("round-trips any place through the demo's own parsing rules", () => {
    // The demo reads `lat`/`lng` and `clat`/`clng` with Number() and a
    // range check: whatever is written must read back within half a unit
    // of the fifth decimal.
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lng) => {
          const q = new URL(
            handOverUrl({ pageHref: page, target: { lat, lng } }),
          ).searchParams;
          for (const [key, value] of [
            ["lat", lat],
            ["clat", lat],
            ["lng", lng],
            ["clng", lng],
          ] as const) {
            const read = Number(q.get(key));
            expect(Number.isFinite(read)).toBe(true);
            expect(Math.abs(read - value)).toBeLessThanOrEqual(5e-6 + 1e-12);
          }
        },
      ),
    );
  });
});
