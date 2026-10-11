/**
 * The globe's city draws what OsmDemo draws (round-4 plan 2026-10-11-0122
 * DEC-R4-7, the owner on r812: "no roads; some walls"): at Lucerne, from a
 * routed fixture, the city's worker builds the buildings, a wall and the
 * roads and paths through the Osm library, and the lab draws all of them
 * (the walls among the buildings' chunks, the roads through the library's
 * `roadObjects`), the roads on the ground the relief draws.
 *
 * Nothing leaves 127.0.0.1: Overpass answers with the fixture and every
 * height tile with the relief's synthetic tile (`routeCityFixture`).
 */
import { expect, test } from "@playwright/test";

import { bootGlobe, routeCityFixture } from "./globe-smoke-helpers.mjs";

const LUCERNE = { lat: 47.0502, lng: 8.3093 };
const BASE = `spinMs=0&turnMs=0&time=2026-10-05T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&detail=0&cloudShell=0&cloudVolume=0&at=${LUCERNE.lat},${LUCERNE.lng}`;

/** The ruler of the Osm library's frame (the AR core's), metres a degree. */
const M_LAT = 1 / (39_940_652.7422 / 360);
const M_LNG =
  1 / ((40_075_016.6856 / 360) * Math.cos((LUCERNE.lat * Math.PI) / 180));
/** A point `north`, `east` metres from the target. */
const at = (north, east) => ({
  lat: LUCERNE.lat + north * M_LAT,
  lon: LUCERNE.lng + east * M_LNG,
});

/** The wall's two ends and the road's, metres from the target. */
const WALL = [at(-60, -40), at(-60, 40)];
const ROAD = [at(80, -150), at(80, 150)];
const PATH = [at(-120, -100), at(-90, 100)];

function overpassFixture() {
  const square = (north, east, half) => [
    at(north - half, east - half),
    at(north - half, east + half),
    at(north + half, east + half),
    at(north + half, east - half),
    at(north - half, east - half),
  ];
  return {
    version: 0.6,
    elements: [
      {
        type: "way",
        id: 1,
        tags: { building: "yes", height: "20" },
        geometry: square(0, 0, 15),
      },
      {
        type: "way",
        id: 2,
        tags: { building: "yes", height: "12" },
        geometry: square(0, 200, 12),
      },
      {
        type: "way",
        id: 3,
        tags: { barrier: "wall", height: "3" },
        geometry: WALL,
      },
      {
        type: "way",
        id: 4,
        tags: { highway: "residential", surface: "asphalt" },
        geometry: ROAD,
      },
      { type: "way", id: 5, tags: { highway: "footway" }, geometry: PATH },
      {
        type: "way",
        id: 6,
        tags: { highway: "primary", tunnel: "yes" },
        geometry: [at(150, -150), at(150, 150)],
      },
    ],
  };
}

/** Waits for the city to be drawn and returns the probes. */
async function drawnCity(page) {
  await page.waitForFunction(
    () => {
      const c = window.__globeLab.state().city;
      return c && (c.phase === "ready" || c.phase === "failed");
    },
    null,
    { timeout: 300_000 },
  );
  return page.evaluate(() => ({
    buildings: window.__globeLab.cityProbe(20_000),
    roads: window.__globeLab.cityProbe(20_000, "roads"),
  }));
}

/**
 * The nearest vertex to a place: its horizontal distance and its height
 * along the geodetic up, against the relief's own height there.
 */
function nearest(page, vertices, place) {
  return page.evaluate(
    ({ vertices, place }) => {
      const lab = window.__globeLab;
      const q = lab.cityExpected(place.lat, place.lng, 0);
      const q1 = lab.cityExpected(place.lat, place.lng, 1000);
      const up = q1.map((c, k) => (c - q[k]) / 1000);
      let best = { flat: Infinity, along: 0 };
      for (const p of vertices) {
        const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        const along = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
        const flat = Math.hypot(
          d[0] - along * up[0],
          d[1] - along * up[1],
          d[2] - along * up[2],
        );
        if (flat < best.flat) best = { flat, along };
      }
      return {
        flatM: best.flat,
        aboveReliefM:
          best.along - (lab.reliefHeightAt(place.lat, place.lng) ?? NaN),
      };
    },
    { vertices, place },
  );
}

// WHY (DEC-R4-7): the owner saw no roads and only some walls on the globe,
// where OsmDemo draws both. The worker builds the roads (the library's
// `buildCity({ roads: true })`) and the lab draws them; the wall is drawn
// among the buildings' chunks (it always was: this pins it). A tunnel is
// never drawn on the surface.
test("the city at Lucerne draws its buildings, its wall and its roads and paths", async ({
  page,
  context,
}) => {
  test.setTimeout(500_000);
  const seen = await routeCityFixture(context, page, overpassFixture());
  const errors = await bootGlobe(
    page,
    `${BASE}&view=${LUCERNE.lat - 0.01},${LUCERNE.lng},1.5,0,-35`,
    { plain: false, phase: "user", routeCity: false },
  );
  const { buildings, roads } = await drawnCity(page);
  const wallMid = { lat: WALL[0].lat, lng: LUCERNE.lng };
  const roadMid = { lat: ROAD[0].lat, lng: LUCERNE.lng };
  const wall = await nearest(page, buildings.vertices, wallMid);
  const road = await nearest(page, roads.vertices, roadMid);
  console.log(
    `city at Lucerne: ${JSON.stringify(buildings.counts)}; stages ${JSON.stringify(buildings.load?.stages)}; ${buildings.objects} objects, main thread ${buildings.mainMs} ms; wall nearest ${wall.flatM.toFixed(2)} m; road nearest ${road.flatM.toFixed(2)} m, ${road.aboveReliefM.toFixed(2)} m above the relief; road vertices ${roads.vertices.length}; requests ${JSON.stringify(seen)}`,
  );
  expect(errors).toEqual([]);
  expect(buildings.phase).toBe("ready");
  expect(buildings.counts.volumes).toBe(2);
  expect(buildings.counts.barriers).toBe(1);
  // The residential road and the footway; never the tunnel.
  expect(buildings.counts.roads).toBe(2);
  expect(roads.vertices.length).toBeGreaterThan(20);
  // The wall stands where it is mapped (its centreline, 0.3 m thick at
  // most), the road lies where it is mapped (a 2-lane residential road is
  // about 7 m wide).
  expect(wall.flatM).toBeLessThan(1.5);
  expect(road.flatM).toBeLessThan(5);
  // On the relief: lifted by the lab's `roadLiftM` (2 m), within the
  // library's half-pixel offset against the relief (validation finding
  // F11) on the synthetic slope.
  expect(Math.abs(road.aboveReliefM - 2)).toBeLessThan(6);
});
