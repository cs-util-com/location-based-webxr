/**
 * `createTourMap` tests — plain 2D Leaflet map (no Three.js/CSS3D), component 7
 * (TASK.md §2.3). Leaflet is mocked (same pattern as the framework's
 * `leaflet-map-overlay.test.ts` / recorder's `summary-map.test.ts`) so these
 * tests assert Leaflet call args rather than pixels.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Leaflet — same pattern as leaflet-map-overlay.test.ts / summary-map.test.ts
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
  const listeners: Record<string, Array<() => void>> = {};
  return {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    bindPopup: vi.fn().mockReturnThis(),
    openPopup: vi.fn().mockReturnThis(),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
    on: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    _fire(event: string) {
      for (const cb of listeners[event] ?? []) cb();
    },
  };
}

/** A minimal stand-in for Leaflet's own `Point`: just enough chained
 *  `.add()` for `offsetTargetForObscuredBottom`'s pixel math to run, with
 *  plain {x,y} so assertions can compare it directly. */
function mockPoint(x: number, y: number) {
  return {
    x,
    y,
    add(other: [number, number] | { x: number; y: number }) {
      const [ox, oy] = Array.isArray(other) ? other : [other.x, other.y];
      return mockPoint(x + ox, y + oy);
    },
  };
}

function createMockMap() {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    setView: vi.fn().mockReturnThis(),
    panTo: vi.fn().mockReturnThis(),
    fitBounds: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    invalidateSize: vi.fn(),
    getZoom: vi.fn(() => 17),
    getSize: vi.fn(() => mockPoint(800, 600)),
    // Identity-ish: real Leaflet's project/unproject do real Mercator
    // math this test has no reason to re-verify — only that
    // `offsetTargetForObscuredBottom` calls them and adds the right
    // number of pixels, which round-tripping lat/lng through x/y proves
    // just as well.
    project: vi.fn((latlng: { lat: number; lng: number }) =>
      mockPoint(latlng.lat, latlng.lng),
    ),
    unproject: vi.fn((point: { x: number; y: number }) => ({
      lat: point.x,
      lng: point.y,
    })),
    zoomControl: { setPosition: vi.fn() },
    on: vi.fn((event: string, cb: (e: unknown) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    _fire(event: string, payload: unknown) {
      for (const cb of listeners[event] ?? []) cb(payload);
    },
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
      latLng: vi.fn((v: [number, number] | { lat: number; lng: number }) =>
        Array.isArray(v) ? { lat: v[0], lng: v[1] } : v,
      ),
    },
  };
});

import { createTourMap } from "./tour-map.js";
import type { WaypointMarkerViewModel } from "../core/map-marker-state.js";
import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";

function createContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("createTourMap", () => {
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
    expect(createTourMap(null)).toBeNull();
  });

  it("creates a Leaflet map with an OSM tile layer", () => {
    createTourMap(container);
    expect(tileLayerCalls.length).toBe(1);
    expect(tileLayerCalls[0]!.url).toContain("openstreetmap.org");
  });

  it("setGpsPosition centers the map at the given lat/lon", () => {
    const map = createTourMap(container)!;
    map.setGpsPosition(52.5163, 13.3777);
    expect(lastMapInstance.setView).toHaveBeenCalledWith(
      [52.5163, 13.3777],
      expect.any(Number),
    );
  });

  it("setGpsPosition shifts the initial setView center down by half the obscured bottom height, so it lands at the CENTER OF THE VISIBLE STRIP above it", () => {
    const getObscuredBottomPx = vi.fn(() => 200);
    const map = createTourMap(container, { getObscuredBottomPx })!;

    map.setGpsPosition(52.5163, 13.3777);

    // project/unproject round-trip lat<->x and lng<->y in the mock, so the
    // +100 (half of 200) landing in `lng` is the offset actually applying.
    expect(lastMapInstance.setView).toHaveBeenCalledWith(
      { lat: 52.5163, lng: 13.3777 + 100 },
      expect.any(Number),
    );
  });

  it("setGpsPosition applies the same shift to a later panTo, re-read fresh (not cached from the first fix)", () => {
    const getObscuredBottomPx = vi.fn(() => 0);
    const map = createTourMap(container, { getObscuredBottomPx })!;
    map.setGpsPosition(1, 1); // no shift yet: nothing obscured on this fix

    getObscuredBottomPx.mockReturnValue(60); // e.g. the sheet grew since
    map.setGpsPosition(2, 2);

    expect(lastMapInstance.panTo).toHaveBeenCalledWith({
      lat: 2,
      lng: 2 + 30,
    });
  });

  it("setGpsPosition does not touch the target's shape at all when nothing is obscured", () => {
    const map = createTourMap(container, {
      getObscuredBottomPx: () => 0,
    })!;
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
    const map = createTourMap(container)!;
    map.setGpsPosition(1, 1);
    expect(lastMapInstance.setView).toHaveBeenCalledTimes(1);

    map.setGpsPosition(2, 2);
    expect(lastMapInstance.setView).toHaveBeenCalledTimes(1);
    expect(lastMapInstance.panTo).toHaveBeenCalledWith([2, 2]);
  });

  it("setWaypoints places one marker per view-model at the expected lat/lon", () => {
    const map = createTourMap(container)!;
    const models: WaypointMarkerViewModel[] = [
      {
        id: "wp-1",
        position: { lat: 1, lon: 2 },
        status: "unvisited",
        order: 1,
      },
      { id: "wp-2", position: { lat: 3, lon: 4 }, status: "visited", order: 2 },
    ];

    map.setWaypoints(models);

    expect(markerCallArgs.length).toBe(2);
    expect(markerCallArgs[0]!.latlng).toEqual([1, 2]);
    expect(markerCallArgs[1]!.latlng).toEqual([3, 4]);
  });

  it("gives each marker status its own icon color", () => {
    const map = createTourMap(container)!;
    const models: WaypointMarkerViewModel[] = [
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
      { id: "wp-2", position: { lat: 2, lon: 2 }, status: "next", order: 2 },
      { id: "wp-3", position: { lat: 3, lon: 3 }, status: "visited", order: 3 },
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

  it("labels an unvisited/next marker with its 1-based list position, not visited (which keeps the checkmark)", () => {
    const map = createTourMap(container)!;
    map.setWaypoints([
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
      { id: "wp-2", position: { lat: 2, lon: 2 }, status: "next", order: 2 },
      { id: "wp-3", position: { lat: 3, lon: 3 }, status: "visited", order: 3 },
    ]);

    const htmls = divIconCallArgs.map((d) => d.html);
    expect(htmls[0]).toContain(">1<");
    expect(htmls[1]).toContain(">2<");
    expect(htmls[2]).not.toContain(">3<");
  });

  it("markers are not draggable when no onWaypointDragEnd is given", () => {
    const map = createTourMap(container)!;
    map.setWaypoints([
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
    ]);

    expect(
      (markerCallArgs[0]!.options as { draggable: boolean }).draggable,
    ).toBe(false);
  });

  it("markers become draggable and report their dropped position when onWaypointDragEnd is given", () => {
    const onWaypointDragEnd = vi.fn();
    const map = createTourMap(container, { onWaypointDragEnd })!;
    map.setWaypoints([
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
    ]);

    expect(
      (markerCallArgs[0]!.options as { draggable: boolean }).draggable,
    ).toBe(true);

    markerInstances[0]!.getLatLng.mockReturnValue({ lat: 9, lng: 8 });
    markerInstances[0]!._fire("dragend");

    expect(onWaypointDragEnd).toHaveBeenCalledWith("wp-1", 9, 8);
  });

  it("moves the zoom control out of the GPS badge's corner when interactive", () => {
    createTourMap(container, { interactive: true });
    expect(lastMapInstance.zoomControl.setPosition).toHaveBeenCalledWith(
      "bottomright",
    );
  });

  it("leaves the zoom control alone when non-interactive", () => {
    createTourMap(container, { interactive: false });
    expect(lastMapInstance.zoomControl.setPosition).not.toHaveBeenCalled();
  });

  it("does nothing on a map click when no onDropWaypointHere is given", () => {
    createTourMap(container);
    lastMapInstance._fire("click", { latlng: { lat: 1, lng: 2 } });
    expect(markerCallArgs.length).toBe(0);
  });

  it("clicking the map drops a preview pin with an open 'Drop Waypoint' popup, and confirming it reports the clicked position", () => {
    const onDropWaypointHere = vi.fn();
    createTourMap(container, { onDropWaypointHere });

    lastMapInstance._fire("click", { latlng: { lat: 1, lng: 2 } });

    expect(markerCallArgs.length).toBe(1);
    expect(markerCallArgs[0]!.latlng).toEqual({ lat: 1, lng: 2 });
    const pin = markerInstances[0]!;
    expect(pin.openPopup).toHaveBeenCalledOnce();

    const card = pin.bindPopup.mock.calls[0]![0] as HTMLElement;
    expect(card.textContent).toContain("New waypoint");
    expect(card.textContent).toContain("1.00000, 2.00000");
    const button = card.querySelector("button")!;
    expect(button.textContent).toBe("+ Drop Waypoint");
    button.click();

    expect(onDropWaypointHere).toHaveBeenCalledWith(1, 2);
    expect(pin.remove).toHaveBeenCalledOnce();
  });

  it("the preview pin's popup auto-pan padding grows with the obscured bottom height, so a popup near it doesn't open underneath it", () => {
    createTourMap(container, {
      onDropWaypointHere: vi.fn(),
      getObscuredBottomPx: () => 300,
    });

    lastMapInstance._fire("click", { latlng: { lat: 1, lng: 2 } });

    const popupOptions = markerInstances[0]!.bindPopup.mock.calls[0]![1] as {
      autoPanPaddingBottomRight: [number, number];
    };
    expect(popupOptions.autoPanPaddingBottomRight).toEqual([20, 320]);
  });

  it("clicking the map again replaces the previous preview pin", () => {
    createTourMap(container, { onDropWaypointHere: vi.fn() });

    lastMapInstance._fire("click", { latlng: { lat: 1, lng: 2 } });
    const firstPin = markerInstances[0]!;
    lastMapInstance._fire("click", { latlng: { lat: 3, lng: 4 } });

    expect(firstPin.remove).toHaveBeenCalledOnce();
    expect(markerCallArgs.length).toBe(2);
  });

  it("closing the preview pin's popup clears it without reporting a position", () => {
    const onDropWaypointHere = vi.fn();
    createTourMap(container, { onDropWaypointHere });

    lastMapInstance._fire("click", { latlng: { lat: 1, lng: 2 } });
    const pin = markerInstances[0]!;
    pin._fire("popupclose");

    expect(pin.remove).toHaveBeenCalledOnce();
    expect(onDropWaypointHere).not.toHaveBeenCalled();
  });

  it("setWaypoints centers the map on the waypoints before any GPS fix arrives", () => {
    const map = createTourMap(container)!;
    map.setWaypoints([
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
      {
        id: "wp-2",
        position: { lat: 2, lon: 2 },
        status: "unvisited",
        order: 2,
      },
    ]);

    expect(lastMapInstance.fitBounds).toHaveBeenCalledOnce();
  });

  it("setWaypoints' initial fitBounds adds the obscured bottom height to its own bottom-right padding, on top of the base padding", () => {
    const map = createTourMap(container, {
      getObscuredBottomPx: () => 250,
    })!;
    map.setWaypoints([
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
    ]);

    const fitBoundsOptions = lastMapInstance.fitBounds.mock.calls[0]![1] as {
      padding: [number, number];
      paddingBottomRight: [number, number];
    };
    expect(fitBoundsOptions.padding).toEqual([40, 40]);
    expect(fitBoundsOptions.paddingBottomRight).toEqual([40, 290]);
  });

  it("does not re-center on waypoints once a GPS fix already centered the map", () => {
    const map = createTourMap(container)!;
    map.setGpsPosition(52.5163, 13.3777);
    map.setWaypoints([
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
    ]);

    expect(lastMapInstance.fitBounds).not.toHaveBeenCalled();
  });

  it("setWaypoints replaces the previous marker layer wholesale", () => {
    const map = createTourMap(container)!;
    map.setWaypoints([
      {
        id: "wp-1",
        position: { lat: 1, lon: 1 },
        status: "unvisited",
        order: 1,
      },
    ]);
    const firstMarker = markerInstances[0]!;

    map.setWaypoints([
      {
        id: "wp-2",
        position: { lat: 2, lon: 2 },
        status: "unvisited",
        order: 1,
      },
    ]);

    expect(firstMarker.remove).toHaveBeenCalledOnce();
    expect(markerCallArgs.length).toBe(2);
  });

  it("render draws the user-position dot via the shared MapData path", () => {
    const map = createTourMap(container)!;
    const data = buildMapData({ userPosition: { lat: 5, lng: 6 } });

    map.render(data);

    expect(markerCallArgs.length).toBe(1);
    expect(markerCallArgs[0]!.latlng).toEqual([5, 6]);
  });

  it("toggle shows then hides the map container", () => {
    const map = createTourMap(container)!;
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
    const map = createTourMap(container)!;
    map.show();
    expect(lastMapInstance.invalidateSize).toHaveBeenCalledOnce();
  });

  it("show()'s re-center of the last known fix also shifts for the obscured bottom height", () => {
    const map = createTourMap(container, { getObscuredBottomPx: () => 80 })!;
    map.setGpsPosition(1, 1);
    lastMapInstance.setView.mockClear();

    map.show();

    expect(lastMapInstance.setView).toHaveBeenCalledWith(
      { lat: 1, lng: 1 + 40 },
      expect.any(Number),
    );
  });

  it("resize() invalidates the map size on demand", () => {
    const map = createTourMap(container)!;
    map.resize();
    expect(lastMapInstance.invalidateSize).toHaveBeenCalledOnce();
  });

  it("destroy() removes the map and is idempotent", () => {
    const map = createTourMap(container)!;
    map.destroy();
    expect(lastMapInstance.remove).toHaveBeenCalledOnce();
    map.destroy();
    expect(lastMapInstance.remove).toHaveBeenCalledOnce();
  });

  it("getLeafletMap() returns null after destroy", () => {
    const map = createTourMap(container)!;
    expect(map.getLeafletMap()).not.toBeNull();
    map.destroy();
    expect(map.getLeafletMap()).toBeNull();
  });

  it("invokes onTileError when a tile fails to load", () => {
    const onTileError = vi.fn();
    createTourMap(container, { onTileError });

    const error = new Error("tile fetch failed");
    lastTileLayerInstance._fire("tileerror", { error });

    expect(onTileError).toHaveBeenCalledWith(error);
  });
});
