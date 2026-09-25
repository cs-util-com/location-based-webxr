import { describe, expect, it, vi } from "vitest";

import type { GpsPosition } from "gps-plus-slam-app-framework/sensors";
import { createLiveGpsPositionSource } from "./gps-position-source.js";

/**
 * Why this matters: the framework exposes "current position" only as a
 * callback (`startGpsWatch`), not a selector. This wrapper is the ONLY place
 * in component 10 that touches that browser dependency directly — everything
 * else (the session orchestrator, the demo's replay mode) talks to the
 * injectable `PositionSource` interface instead (plan AU6).
 */

function gpsPosition(overrides: Partial<GpsPosition> = {}): GpsPosition {
  return {
    lat: 50.7753,
    lon: 6.0839,
    altitude: null,
    accuracy: 5,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    timestamp: 0,
    ...overrides,
  };
}

describe("createLiveGpsPositionSource", () => {
  it("subscribe wires the injected startGpsWatch and maps lat/lon/altitude to TourCoord", () => {
    const startGpsWatch = vi.fn();
    const stopGpsWatch = vi.fn();
    const source = createLiveGpsPositionSource({ startGpsWatch, stopGpsWatch });

    const received: unknown[] = [];
    source.subscribe((pos) => received.push(pos));

    expect(startGpsWatch).toHaveBeenCalledTimes(1);
    const onPosition = startGpsWatch.mock.calls[0]?.[0] as (
      p: GpsPosition,
    ) => void;
    onPosition(gpsPosition({ altitude: 123 }));
    expect(received).toEqual([{ lat: 50.7753, lon: 6.0839, altitude: 123 }]);
  });

  it("omits altitude from TourCoord when the fix has none (null)", () => {
    const startGpsWatch = vi.fn();
    const source = createLiveGpsPositionSource({
      startGpsWatch,
      stopGpsWatch: vi.fn(),
    });

    const received: unknown[] = [];
    source.subscribe((pos) => received.push(pos));
    const onPosition = startGpsWatch.mock.calls[0]?.[0] as (
      p: GpsPosition,
    ) => void;
    onPosition(gpsPosition({ altitude: null }));

    expect(received).toEqual([{ lat: 50.7753, lon: 6.0839 }]);
  });

  it("passes the fix's accuracy and timestamp along as a second argument", () => {
    const startGpsWatch = vi.fn();
    const source = createLiveGpsPositionSource({
      startGpsWatch,
      stopGpsWatch: vi.fn(),
    });

    const fixes: unknown[] = [];
    source.subscribe((_pos, fix) => fixes.push(fix));
    const onPosition = startGpsWatch.mock.calls[0]?.[0] as (
      p: GpsPosition,
    ) => void;
    onPosition(gpsPosition({ accuracy: 42, timestamp: 1234 }));

    expect(fixes).toEqual([{ accuracy: 42, timestamp: 1234 }]);
  });

  it("the unsubscribe function calls the injected stopGpsWatch", () => {
    const stopGpsWatch = vi.fn();
    const source = createLiveGpsPositionSource({
      startGpsWatch: vi.fn(),
      stopGpsWatch,
    });

    const unsubscribe = source.subscribe(() => undefined);
    expect(stopGpsWatch).not.toHaveBeenCalled();
    unsubscribe();
    expect(stopGpsWatch).toHaveBeenCalledTimes(1);
  });
});
