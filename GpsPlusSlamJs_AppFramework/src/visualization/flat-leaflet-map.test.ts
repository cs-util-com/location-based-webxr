/**
 * `createFlatLeafletMap` tests. Leaflet is mocked (same pattern as
 * `leaflet-map-overlay.test.ts`) so these tests assert Leaflet call args
 * rather than pixels.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Leaflet — same pattern as leaflet-map-overlay.test.ts
// ---------------------------------------------------------------------------

let lastMapInstance: ReturnType<typeof createMockMap>;
let markerInstances: Array<ReturnType<typeof createMockMarker>>;
let markerCallArgs: Array<{ latlng: unknown; options: unknown }>;
let divIconCallArgs: Array<{ html: string; iconSize: unknown }>;
let tileLayerCalls: Array<{ url: unknown; options: unknown }>;
let lastTileLayerInstance: ReturnType<typeof createMockTileLayer>;

function createMockTileLayer() {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    on: vi.fn((event: string, cb: (e: unknown) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    _fire(event: string, payload: unknown) {
      for (const cb of listeners[event] ?? []) cb(payload);
    },
  };
}

function createMockMarker() {
  return {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    bindPopup: vi.fn().mockReturnThis(),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
  };
}

function createMockMap() {
  return {
    setView: vi.fn().mockReturnThis(),
    panTo: vi.fn().mockReturnThis(),
    fitBounds: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    invalidateSize: vi.fn(),
  };
}

vi.mock("leaflet", () => {
  return {
    default: {
      map: vi.fn(() => {
        lastMapInstance = createMockMap();
        return lastMapInstance;
      }),
      tileLayer: vi.fn((url: unknown, options: unknown) => {
        tileLayerCalls.push({ url, options });
        lastTileLayerInstance = createMockTileLayer();
        return lastTileLayerInstance;
      }),
      marker: vi.fn((latlng: unknown, options: unknown) => {
        markerCallArgs.push({ latlng, options });
        const m = createMockMarker();
        markerInstances.push(m);
        return m;
      }),
      divIcon: vi.fn((opts: { html: string; iconSize: unknown }) => {
        divIconCallArgs.push(opts);
        return opts;
      }),
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

import { createFlatLeafletMap } from "./flat-leaflet-map.js";
import type { WaypointMarkerViewModel } from "./waypoint-marker-status.js";
import { buildMapData } from "./map-data.js";

function createContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("createFlatLeafletMap", () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    markerInstances = [];
    markerCallArgs = [];
    divIconCallArgs = [];
    tileLayerCalls = [];
    container = createContainer();
    // Deterministic: run the rAF-scheduled resize synchronously.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it("returns null when container is null", () => {
    expect(createFlatLeafletMap(null)).toBeNull();
  });

  it("creates a Leaflet map with an OSM tile layer", () => {
    createFlatLeafletMap(container);
    expect(tileLayerCalls.length).toBe(1);
    expect(tileLayerCalls[0]!.url).toContain("openstreetmap.org");
  });

  it("setGpsPosition centers the map at the given lat/lon", () => {
    const map = createFlatLeafletMap(container)!;
    map.setGpsPosition(52.5163, 13.3777);
    expect(lastMapInstance.setView).toHaveBeenCalledWith(
      [52.5163, 13.3777],
      expect.any(Number),
    );
  });

  it("does not reset zoom on subsequent setGpsPosition calls (pans instead)", () => {
    // Regression: setView(latlng, DEFAULT_ZOOM) on every call fights any zoom
    // the user did manually mid-playback. Only the first fix should set the
    // initial view; later updates must pan without touching zoom.
    const map = createFlatLeafletMap(container)!;
    map.setGpsPosition(1, 1);
    expect(lastMapInstance.setView).toHaveBeenCalledTimes(1);

    map.setGpsPosition(2, 2);
    expect(lastMapInstance.setView).toHaveBeenCalledTimes(1);
    expect(lastMapInstance.panTo).toHaveBeenCalledWith([2, 2]);
  });

  it("setWaypoints places one marker per view-model at the expected lat/lon", () => {
    const map = createFlatLeafletMap(container)!;
    const models: WaypointMarkerViewModel[] = [
      { id: "wp-1", position: { lat: 1, lon: 2 }, status: "unvisited" },
      { id: "wp-2", position: { lat: 3, lon: 4 }, status: "visited" },
    ];

    map.setWaypoints(models);

    expect(markerCallArgs.length).toBe(2);
    expect(markerCallArgs[0]!.latlng).toEqual([1, 2]);
    expect(markerCallArgs[1]!.latlng).toEqual([3, 4]);
  });

  it("gives each marker status its own icon color", () => {
    const map = createFlatLeafletMap(container)!;
    const models: WaypointMarkerViewModel[] = [
      { id: "wp-1", position: { lat: 1, lon: 1 }, status: "unvisited" },
      { id: "wp-2", position: { lat: 2, lon: 2 }, status: "next" },
      { id: "wp-3", position: { lat: 3, lon: 3 }, status: "visited" },
    ];

    map.setWaypoints(models);

    expect(divIconCallArgs.length).toBe(3);
    const htmls = divIconCallArgs.map((d) => d.html);
    // Three distinct colors — no two statuses render identically.
    expect(new Set(htmls).size).toBe(3);
    // Visited gets a checkmark glyph; the others don't.
    expect(htmls[2]).toContain("✓");
    expect(htmls[0]).not.toContain("✓");
    expect(htmls[1]).not.toContain("✓");
  });

  it("setWaypoints centers the map on the waypoints before any GPS fix arrives", () => {
    const map = createFlatLeafletMap(container)!;
    map.setWaypoints([
      { id: "wp-1", position: { lat: 1, lon: 1 }, status: "unvisited" },
      { id: "wp-2", position: { lat: 2, lon: 2 }, status: "unvisited" },
    ]);

    expect(lastMapInstance.fitBounds).toHaveBeenCalledOnce();
  });

  it("does not re-center on waypoints once a GPS fix already centered the map", () => {
    const map = createFlatLeafletMap(container)!;
    map.setGpsPosition(52.5163, 13.3777);
    map.setWaypoints([
      { id: "wp-1", position: { lat: 1, lon: 1 }, status: "unvisited" },
    ]);

    expect(lastMapInstance.fitBounds).not.toHaveBeenCalled();
  });

  it("setWaypoints replaces the previous marker layer wholesale", () => {
    const map = createFlatLeafletMap(container)!;
    map.setWaypoints([
      { id: "wp-1", position: { lat: 1, lon: 1 }, status: "unvisited" },
    ]);
    const firstMarker = markerInstances[0]!;

    map.setWaypoints([
      { id: "wp-2", position: { lat: 2, lon: 2 }, status: "unvisited" },
    ]);

    expect(firstMarker.remove).toHaveBeenCalledOnce();
    expect(markerCallArgs.length).toBe(2);
  });

  it("render draws the user-position dot via the shared MapData path", () => {
    const map = createFlatLeafletMap(container)!;
    const data = buildMapData({ userPosition: { lat: 5, lng: 6 } });

    map.render(data);

    expect(markerCallArgs.length).toBe(1);
    expect(markerCallArgs[0]!.latlng).toEqual([5, 6]);
  });

  it("toggle shows then hides the map container", () => {
    const map = createFlatLeafletMap(container)!;
    expect(map.isVisible()).toBe(false);
    expect(container.style.display).toBe("none");

    map.toggle();
    expect(map.isVisible()).toBe(true);
    expect(container.style.display).not.toBe("none");

    map.toggle();
    expect(map.isVisible()).toBe(false);
    expect(container.style.display).toBe("none");
  });

  it("show() invalidates the map size (deferred resize)", () => {
    const map = createFlatLeafletMap(container)!;
    map.show();
    expect(lastMapInstance.invalidateSize).toHaveBeenCalledOnce();
  });

  it("resize() invalidates the map size on demand", () => {
    const map = createFlatLeafletMap(container)!;
    map.resize();
    expect(lastMapInstance.invalidateSize).toHaveBeenCalledOnce();
  });

  it("destroy() removes the map and is idempotent", () => {
    const map = createFlatLeafletMap(container)!;
    map.destroy();
    expect(lastMapInstance.remove).toHaveBeenCalledOnce();
    map.destroy();
    expect(lastMapInstance.remove).toHaveBeenCalledOnce();
  });

  it("getLeafletMap() returns null after destroy", () => {
    const map = createFlatLeafletMap(container)!;
    expect(map.getLeafletMap()).not.toBeNull();
    map.destroy();
    expect(map.getLeafletMap()).toBeNull();
  });

  it("invokes onTileError when a tile fails to load", () => {
    const onTileError = vi.fn();
    createFlatLeafletMap(container, { onTileError });

    const error = new Error("tile fetch failed");
    lastTileLayerInstance._fire("tileerror", { error });

    expect(onTileError).toHaveBeenCalledWith(error);
  });
});
