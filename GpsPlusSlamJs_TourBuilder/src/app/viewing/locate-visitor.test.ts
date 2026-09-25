import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { locateVisitor } from "./locate-visitor.js";
import type { VisitorFix } from "./start-distance.js";

/** A stand-in for `navigator.geolocation` that lets a test push fixes. */
function fakeGeolocation() {
  let success: PositionCallback | null = null;
  let failure: PositionErrorCallback | null = null;
  const cleared: number[] = [];
  let nextId = 1;

  const geolocation = {
    watchPosition: vi.fn(
      (onSuccess: PositionCallback, onError?: PositionErrorCallback | null) => {
        success = onSuccess;
        failure = onError ?? null;
        return nextId++;
      },
    ),
    clearWatch: vi.fn((id: number) => {
      cleared.push(id);
    }),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;

  return {
    geolocation,
    cleared,
    emit(lat: number, lon: number, accuracy: number) {
      success?.({
        coords: { latitude: lat, longitude: lon, accuracy },
      } as GeolocationPosition);
    },
    fail(code: number) {
      failure?.({
        code,
        message: "test",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    },
  };
}

const decisiveWhenAccurate = (fix: VisitorFix) => fix.accuracy <= 50;

describe("locateVisitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the first decisive fix and clears its watch", async () => {
    const geo = fakeGeolocation();
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: geo.geolocation,
    });

    geo.emit(48.1, 11.5, 300); // coarse: keep waiting
    geo.emit(48.2, 11.6, 12); // good: done

    await expect(handle.result).resolves.toEqual({
      lat: 48.2,
      lon: 11.6,
      accuracy: 12,
    });
    expect(geo.cleared).toEqual([1]);
  });

  it("resolves with the last fix seen when the timeout runs out", async () => {
    const geo = fakeGeolocation();
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: geo.geolocation,
    });

    geo.emit(48.1, 11.5, 300);
    await vi.advanceTimersByTimeAsync(8000);

    await expect(handle.result).resolves.toEqual({
      lat: 48.1,
      lon: 11.5,
      accuracy: 300,
    });
    expect(geo.cleared).toEqual([1]);
  });

  it("resolves null when no fix ever arrives", async () => {
    const geo = fakeGeolocation();
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: geo.geolocation,
    });

    await vi.advanceTimersByTimeAsync(8000);

    await expect(handle.result).resolves.toBeNull();
  });

  it("gives up at once when permission is denied", async () => {
    const geo = fakeGeolocation();
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: geo.geolocation,
    });

    geo.fail(1);

    await expect(handle.result).resolves.toBeNull();
    expect(geo.cleared).toEqual([1]);
  });

  it("rides out a transient error and still takes a later good fix", async () => {
    const geo = fakeGeolocation();
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: geo.geolocation,
    });

    geo.fail(2); // position unavailable — not fatal
    geo.emit(48.2, 11.6, 9);

    await expect(handle.result).resolves.toEqual({
      lat: 48.2,
      lon: 11.6,
      accuracy: 9,
    });
  });

  it("resolves null immediately when the browser has no geolocation", async () => {
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: undefined,
    });

    await expect(handle.result).resolves.toBeNull();
  });

  it("cancel clears the watch, resolves null, and is safe to call twice", async () => {
    const geo = fakeGeolocation();
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: geo.geolocation,
    });

    handle.cancel();
    handle.cancel();

    await expect(handle.result).resolves.toBeNull();
    expect(geo.cleared).toEqual([1]);
  });

  it("ignores fixes that arrive after it has finished", async () => {
    const geo = fakeGeolocation();
    const handle = locateVisitor({
      timeoutMs: 8000,
      isDecisive: decisiveWhenAccurate,
      geolocation: geo.geolocation,
    });

    geo.emit(48.2, 11.6, 12);
    geo.emit(50, 12, 5);

    await expect(handle.result).resolves.toEqual({
      lat: 48.2,
      lon: 11.6,
      accuracy: 12,
    });
  });
});
