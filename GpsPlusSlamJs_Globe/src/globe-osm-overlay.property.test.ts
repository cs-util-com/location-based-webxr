/**
 * Why these properties matter: the request ceiling is what keeps the
 * editor inside the OSM tile usage policy whatever the camera does. Over
 * random bursts of requests (any count, any spacing, any ceiling), every
 * request made through the ceiling's wait, as the overlay's fetch makes
 * it, leaves no sliding minute with more than the ceiling, and none is
 * dropped: each one is made, later if it must.
 *
 * And the relief's wait for the map (`mapReady`, asked by the patched
 * traversal of every child tile): over random tiles (any place, size,
 * map, failed request) and camera heights, it holds a tile back exactly
 * when the map is on and `coverage` counts that tile as near and waiting
 * for its map (not given up). The two are the same rule read twice, the
 * loading state the editor shows and the hold the traversal makes; a
 * drift between them would show a waiting count for tiles drawn bare, or
 * hold tiles nothing says are waiting.
 */
import fc from "fast-check";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGlobeOsmOverlay,
  createRequestCeiling,
} from "./globe-osm-overlay.js";

const DEG = Math.PI / 180;

describe("createRequestCeiling over random bursts", () => {
  it("never lets a sliding minute exceed the ceiling, and makes every request", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.integer({ min: 0, max: 20_000 }), {
          minLength: 1,
          maxLength: 80,
        }),
        (perMinute, gaps) => {
          let t = 0;
          const ceiling = createRequestCeiling(perMinute, () => t);
          const made: number[] = [];
          for (const gap of gaps) {
            t += gap;
            // The overlay's fetch: wait until one more fits, then take.
            for (let w = ceiling.waitMs(); w > 0; w = ceiling.waitMs()) t += w;
            ceiling.take();
            made.push(t);
          }
          expect(made).toHaveLength(gaps.length);
          expect(ceiling.total()).toBe(gaps.length);
          let worst = 0;
          for (let i = 0; i < made.length; i++) {
            let j = i;
            while (j < made.length && made[j]! < made[i]! + 60_000) j++;
            worst = Math.max(worst, j - i);
          }
          expect(worst).toBeLessThanOrEqual(perMinute);
        },
      ),
    );
  });
});

describe("mapReady against coverage over random tiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("holds a tile back exactly when the map is on and coverage counts it waiting", async () => {
    const osm = createGlobeOsmOverlay({
      url: "https://tiles.example.test/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      renderer: {} as THREE.WebGLRenderer,
      fadeM: 1000,
    });
    await (osm.overlay as unknown as { init(): Promise<unknown> }).init();
    // Failed tiles that stay failed over consecutive runs reach the retry,
    // whose reset relocks on the next animation frame: Node has none, and
    // the relock is not what this property is about.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const visibleTiles = new Set<object>();
    osm.attach({
      tiles: {
        group: new THREE.Group(),
        ellipsoid: WGS84_ELLIPSOID,
        registerPlugin: () => {},
        forEachLoadedModel: () => {},
        addEventListener: () => {},
        visibleTiles,
      },
      plugin: { sampleCartographicElevation: () => 0 },
    });
    osm.setEnabled(true);
    const projection = osm.overlay.projection as {
      fromCartographicToNormalizedRange(r: number[]): number[];
    };
    const tileInfo = (
      osm.plugin as unknown as {
        overlayInfo: Map<object, { tileInfo: Map<object, unknown> }>;
      }
    ).overlayInfo.get(osm.overlay)!.tileInfo;
    let now = 0;
    fc.assert(
      fc.property(
        // Within about 1.3 km, so many tiles fall about the fade's edges.
        fc.double({ min: -0.012, max: 0.012, noNaN: true }),
        fc.double({ min: -0.012, max: 0.012, noNaN: true }),
        // Sizes spread evenly over the zoom levels (z11 to z19 or so).
        fc.double({ min: -4.3, max: -1.3, noNaN: true }).map((u) => 10 ** u),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 20, max: 400 }),
        (dLat, dLon, halfDeg, hasMap, failed, aboveGroundM) => {
          tileInfo.clear();
          visibleTiles.clear();
          const lat = 48.137 + dLat;
          const lon = 11.575 + dLon;
          const tile = {};
          tileInfo.set(tile, {
            range: projection.fromCartographicToNormalizedRange([
              (lon - halfDeg) * DEG,
              (lat - halfDeg) * DEG,
              (lon + halfDeg) * DEG,
              (lat + halfDeg) * DEG,
            ]),
            target: hasMap ? { texture: 1 } : null,
            failed: hasMap ? false : failed,
            meshInfo: new Map([[1, 1]]),
          });
          visibleTiles.add(tile);
          // A new 500 ms look each time: no answer cached from a run before.
          now += 600;
          osm.update({
            position: WGS84_ELLIPSOID.getCartographicToPosition(
              48.137 * DEG,
              11.575 * DEG,
              aboveGroundM,
              new THREE.Vector3(),
            ),
            aboveGroundM,
            speedMps: 0,
            nowMs: now,
          });
          const c = osm.coverage();
          const held = osm.stats().active && c.waiting - c.givenUp === 1;
          expect(osm.mapReady(tile)).toBe(!held);
        },
      ),
      { numRuns: 300 },
    );
  });
});
