import { describe, expect, it } from "vitest";

import {
  cameraReport,
  cameraReportText,
  knownCameraReport,
} from "./camera-report";

/** A track with the settings and capabilities Chrome on Android gives. */
const track = (over: Record<string, unknown> = {}) => ({
  getSettings: () => ({
    width: 1920,
    height: 1080,
    frameRate: 30,
    focusMode: "continuous",
    focusDistance: 0.42,
    zoom: 1,
    deviceId: "secret-id",
  }),
  getCapabilities: () => ({
    focusDistance: { min: 0.1, max: 10, step: 0.01 },
    zoom: { min: 1, max: 8, step: 0.1 },
    focusMode: ["manual", "continuous", 3],
    width: { min: 1, max: 4000 },
  }),
  ...over,
});

// Why these tests matter: the desk wants to know whether Chrome on the
// phone reports a usable focus distance, so each shot records what the
// camera says. Browsers differ: a field may be missing, the methods may
// be missing or throw, and nothing of that may cost the photo.
describe("cameraReport", () => {
  it("reads the settings and the focus and zoom ranges the camera reports", () => {
    expect(cameraReport(track())).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 30,
      focusMode: "continuous",
      focusDistance: 0.42,
      zoom: 1,
      focusDistanceMin: 0.1,
      focusDistanceMax: 10,
      focusDistanceStep: 0.01,
      zoomMin: 1,
      zoomMax: 8,
      zoomStep: 0.1,
      focusModes: "manual,continuous",
    });
  });

  it("keeps what exists and never throws", () => {
    const boom = () => {
      throw new Error("not supported");
    };
    expect(cameraReport(track({ getCapabilities: boom }))).not.toHaveProperty(
      "zoomMin",
    );
    expect(
      cameraReport(
        track({
          getSettings: () => ({ width: 640, zoom: Number.NaN, focusMode: "" }),
          getCapabilities: undefined,
        }),
      ),
    ).toEqual({ width: 640 });
    for (const t of [null, undefined, 3, "x", {}, { getSettings: boom }]) {
      expect(cameraReport(t)).toEqual({});
    }
  });
});

describe("cameraReportText and knownCameraReport", () => {
  it("writes one log line and checks a stored report", () => {
    const r = cameraReport(track());
    expect(cameraReportText(r)).toBe(
      "focusDistance 0.42 (0.1-10), focusMode continuous (manual,continuous), zoom 1 (1-8), 1920x1080 at 30 fps",
    );
    expect(cameraReportText({})).toBe("nothing reported");
    expect(knownCameraReport(r)).toEqual(r);
    expect(knownCameraReport({ zoom: 2, deviceId: "x" })).toEqual({ zoom: 2 });
    for (const bad of [
      {},
      { deviceId: "x" },
      { zoom: Number.POSITIVE_INFINITY },
      { zoom: "1" },
      { focusMode: 3 },
      [],
      null,
    ]) {
      expect(knownCameraReport(bad)).toBeUndefined();
    }
  });
});
