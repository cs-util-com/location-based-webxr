import { describe, expect, it } from "vitest";

import { createPreviewFrame } from "./preview-frame.js";

const ORIGIN = { lat: 48.137, lon: 11.575 };

describe("preview frame", () => {
  it("puts the origin at the world origin", () => {
    const frame = createPreviewFrame(ORIGIN);

    const point = frame.toWorld(ORIGIN);

    expect(point.x).toBeCloseTo(0, 3);
    expect(point.z).toBeCloseTo(0, 3);
  });

  it("maps north onto +X and east onto +Z, in metres", () => {
    const frame = createPreviewFrame(ORIGIN);

    // ~111 m north and ~74 m east of the origin at this latitude.
    const north = frame.toWorld({ lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon });
    const east = frame.toWorld({ lat: ORIGIN.lat, lon: ORIGIN.lon + 0.001 });

    expect(north.x).toBeGreaterThan(100);
    expect(north.z).toBeCloseTo(0, 1);
    expect(east.z).toBeGreaterThan(50);
    expect(east.x).toBeCloseTo(0, 1);
  });

  it("converts a walker's world position back to a coordinate the map can show", () => {
    const frame = createPreviewFrame(ORIGIN);
    const coord = { lat: ORIGIN.lat + 0.0004, lon: ORIGIN.lon - 0.0007 };

    const roundTripped = frame.toCoord(frame.toWorld(coord));

    expect(roundTripped.lat).toBeCloseTo(coord.lat, 6);
    expect(roundTripped.lon).toBeCloseTo(coord.lon, 6);
  });

  it("ignores recorded GPS altitude — every point sits on the floor plane (contract D6)", () => {
    const frame = createPreviewFrame(ORIGIN);

    // Real recorded GPS altitude (ASL, ~200 m), not relative to the origin —
    // must not leak into the world Y component.
    const point = frame.toWorld({
      lat: ORIGIN.lat + 0.0001,
      lon: ORIGIN.lon,
      altitude: 216.75,
    });

    expect(point.y).toBe(0);
  });
});
