/**
 * Replay e2e (TASK.md §2.3 component 7, second test level): feed a REAL
 * outdoor walk recorded in Task 1 through the map and assert the position
 * marker follows the track — deterministic, on a desktop, no phone.
 *
 * The expected track is derived via the framework's already-tested
 * `computeFusedPath` (odometry + alignment matrix + zero reference →
 * lat/lng) — no new geo math is written here (TASK §2.5.1). This is the
 * SAME conversion `buildMapData`/`MapData.fusedPath` would use in the
 * composed app; the map itself only ever consumes lat/lon (D5).
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { replayRecording } from "gps-plus-slam-app-framework/state";
import { computeFusedPath } from "gps-plus-slam-app-framework/utils/fused-path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Leaflet — same pattern as tour-map.test.ts. `setGpsPosition` centers via
// `setView` on the first fix and `panTo` on every one after (so a manual zoom
// mid-playback isn't fought) — both are recorded into one ordered `moveCalls`
// so "the position follows the track" doesn't care which method moved it.
// ---------------------------------------------------------------------------

let moveCalls: Array<[number, number]>;

vi.mock("leaflet", () => {
  return {
    default: {
      map: vi.fn(() => ({
        setView: vi.fn((latlng: [number, number]) => {
          moveCalls.push(latlng);
        }),
        panTo: vi.fn((latlng: [number, number]) => {
          moveCalls.push(latlng);
        }),
        getZoom: vi.fn(() => 17),
        remove: vi.fn(),
        invalidateSize: vi.fn(),
      })),
      tileLayer: vi.fn(() => ({
        addTo: vi.fn().mockReturnThis(),
        on: vi.fn(),
        remove: vi.fn(),
      })),
      marker: vi.fn(() => ({
        addTo: vi.fn().mockReturnThis(),
        bindPopup: vi.fn().mockReturnThis(),
        remove: vi.fn(),
      })),
      divIcon: vi.fn(() => ({})),
      polyline: vi.fn(() => ({
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn(),
      })),
      circle: vi.fn(() => ({
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn(),
      })),
      latLngBounds: vi.fn(() => ({
        extend: vi.fn().mockReturnThis(),
        isValid: vi.fn(() => false),
      })),
    },
  };
});

import { createTourMap } from "./tour-map.js";

describe("tour-map replay e2e — real Task 1 walk", () => {
  let expectedTrack: Array<{ lat: number; lng: number }>;

  beforeAll(async () => {
    // Not `new URL(relative, import.meta.url)` (proximity's e2e pattern) —
    // under `@vitest-environment jsdom`, jsdom's global `URL` breaks relative
    // resolution against a file: base even though `import.meta.url` itself is
    // a correct file: URL. Resolve the path with `node:path` instead.
    const here = fileURLToPath(import.meta.url);
    const zipPath = resolve(
      dirname(here),
      "../../../../recordings/2026-06-22_16-06-59utc.zip",
    );
    const state = await replayRecording(new Uint8Array(readFileSync(zipPath)));
    const gpsData = state.gpsData!;

    expectedTrack = computeFusedPath({
      odometryPositions: gpsData.gpsEvents.odometryPositions,
      alignmentMatrix: gpsData.gpsEvents.alignmentMatrix,
      zeroRef: gpsData.zero,
    });
  });

  it("the position marker follows the real track, in order", () => {
    expect(expectedTrack.length).toBeGreaterThan(50);

    moveCalls = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = createTourMap(container)!;
    expect(map).not.toBeNull();

    for (const point of expectedTrack) {
      map.setGpsPosition(point.lat, point.lng);
    }

    expect(moveCalls.length).toBe(expectedTrack.length);
    expectedTrack.forEach((point, i) => {
      expect(moveCalls[i]).toEqual([point.lat, point.lng]);
    });

    container.remove();
  });
});
