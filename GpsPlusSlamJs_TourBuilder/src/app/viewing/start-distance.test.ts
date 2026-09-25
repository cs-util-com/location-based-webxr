import { describe, expect, it } from "vitest";

import type { TourCoord } from "../../store/types.js";
import {
  classifyStartDistance,
  deriveEntryView,
  distanceToStartM,
  formatStartDistance,
  isDecisive,
  type StartProximity,
  type VisitorFix,
} from "./start-distance.js";

const START: TourCoord = { lat: 48.137, lon: 11.575 };
/** ~1 m of latitude, and of longitude at 48°N. */
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((48.137 * Math.PI) / 180));

function fixAt(northM: number, eastM: number, accuracy = 5): VisitorFix {
  return {
    lat: START.lat + northM * M_LAT,
    lon: START.lon + eastM * M_LON,
    accuracy,
  };
}

describe("classifyStartDistance", () => {
  it("is near under 50 m", () => {
    expect(classifyStartDistance(49.9, 5)).toEqual({ kind: "near" });
  });

  it("is mid from 50 m up to and including 300 m", () => {
    expect(classifyStartDistance(50, 5)).toEqual({
      kind: "mid",
      distanceM: 50,
    });
    expect(classifyStartDistance(300, 0)).toEqual({
      kind: "mid",
      distanceM: 300,
    });
  });

  it("is far beyond 300 m", () => {
    expect(classifyStartDistance(300.1, 0)).toEqual({
      kind: "far",
      distanceM: 300.1,
    });
  });

  it("is unknown when the fix is too coarse to place the visitor near or mid", () => {
    expect(classifyStartDistance(100, 51)).toEqual({ kind: "unknown" });
    expect(classifyStartDistance(10, 51)).toEqual({ kind: "unknown" });
    expect(classifyStartDistance(350, 200)).toEqual({ kind: "unknown" });
  });

  it("is still far when even the best case is beyond 300 m", () => {
    // Indoors at home: a Wi-Fi fix of ±5 km, 4,000 km from the start.
    expect(classifyStartDistance(4_000_000, 5_000)).toEqual({
      kind: "far",
      distanceM: 4_000_000,
    });
  });

  it("is mid, not far, when accuracy is good but the reading is just over 300 m", () => {
    expect(classifyStartDistance(320, 30)).toEqual({
      kind: "mid",
      distanceM: 320,
    });
  });

  it("is unknown for a non-finite distance or accuracy", () => {
    expect(classifyStartDistance(Number.NaN, 5)).toEqual({ kind: "unknown" });
    expect(classifyStartDistance(100, Number.NaN)).toEqual({ kind: "unknown" });
  });
});

describe("distanceToStartM", () => {
  it("measures 100 m north and 100 m east alike", () => {
    expect(distanceToStartM(fixAt(100, 0), START)).toBeCloseTo(100, 0);
    expect(distanceToStartM(fixAt(0, 100), START)).toBeCloseTo(100, 0);
  });

  it("is horizontal: a recorded altitude on either side changes nothing", () => {
    const withAltitude = { ...START, altitude: 900 };
    expect(distanceToStartM(fixAt(30, 40), withAltitude)).toBeCloseTo(50, 0);
  });

  it("classifies a transatlantic visitor as far", () => {
    const newYork: VisitorFix = { lat: 40.7128, lon: -74.006, accuracy: 20 };
    expect(
      classifyStartDistance(distanceToStartM(newYork, START), newYork.accuracy)
        .kind,
    ).toBe("far");
  });

  it("does not call two points either side of the antimeridian far apart", () => {
    const start: TourCoord = { lat: 0, lon: 179.9999 };
    const fix: VisitorFix = { lat: 0, lon: -179.9999, accuracy: 5 };
    expect(distanceToStartM(fix, start)).toBeLessThan(50);
  });
});

describe("isDecisive", () => {
  it("is true for a fix that proves far even with poor accuracy", () => {
    expect(
      isDecisive({ lat: 40.7128, lon: -74.006, accuracy: 5_000 }, START),
    ).toBe(true);
  });

  it("is true for an accurate fix anywhere", () => {
    expect(isDecisive(fixAt(10, 0, 8), START)).toBe(true);
  });

  it("is false for a coarse fix that cannot yet tell", () => {
    expect(isDecisive(fixAt(100, 0, 120), START)).toBe(false);
  });
});

describe("formatStartDistance", () => {
  it("rounds metres to the nearest 10", () => {
    expect(formatStartDistance(143)).toBe("140 m");
  });

  it("uses whole kilometres up to 100 km", () => {
    expect(formatStartDistance(1_400)).toBe("about 1 km");
    expect(formatStartDistance(4_200)).toBe("about 4 km");
  });

  it("does not pretend to know a huge distance", () => {
    expect(formatStartDistance(4_200_000)).toBe("more than 100 km");
  });
});

describe("deriveEntryView", () => {
  const base = {
    controllerStatus: "ready" as const,
    controllerError: null,
    forcePreview: false,
    proximity: { kind: "unknown" } as StartProximity | "locating",
  };

  it("near: plain Enter AR, nothing else", () => {
    expect(deriveEntryView({ ...base, proximity: { kind: "near" } })).toEqual({
      arVisible: true,
      arEnabled: true,
      previewOffered: false,
      message: null,
    });
  });

  it("unknown: identical to near", () => {
    expect(deriveEntryView(base)).toEqual(
      deriveEntryView({ ...base, proximity: { kind: "near" } }),
    );
  });

  it("mid: both buttons and the distance", () => {
    expect(
      deriveEntryView({ ...base, proximity: { kind: "mid", distanceM: 143 } }),
    ).toEqual({
      arVisible: true,
      arEnabled: true,
      previewOffered: true,
      message: { text: "The start of this tour is 140 m away.", tone: "info" },
    });
  });

  it("far: AR is removed and preview is the only way in", () => {
    const view = deriveEntryView({
      ...base,
      proximity: { kind: "far", distanceM: 4_200_000 },
    });
    expect(view.arVisible).toBe(false);
    expect(view.arEnabled).toBe(false);
    expect(view.previewOffered).toBe(true);
    expect(view.message).toEqual({
      text: "The start of this tour is more than 100 km away. Preview it from here.",
      tone: "info",
    });
  });

  it("far beats a controller error — the AR error is moot once AR is gone", () => {
    const view = deriveEntryView({
      ...base,
      controllerStatus: "error",
      controllerError: "camera blocked",
      proximity: { kind: "far", distanceM: 900 },
    });
    expect(view.arVisible).toBe(false);
    expect(view.message?.tone).toBe("info");
  });

  it("locating: Enter AR waits, with a banner saying why", () => {
    const view = deriveEntryView({ ...base, proximity: "locating" });
    expect(view).toEqual({
      arVisible: true,
      arEnabled: false,
      previewOffered: false,
      message: {
        text: "Checking how far you are from the start…",
        tone: "info",
      },
    });
  });

  it("unsupported: preview only, no matter what distance says", () => {
    const view = deriveEntryView({
      ...base,
      controllerStatus: "unsupported",
      proximity: { kind: "near" },
    });
    expect(view.arVisible).toBe(true);
    expect(view.arEnabled).toBe(false);
    expect(view.previewOffered).toBe(true);
    expect(view.message?.tone).toBe("error");
  });

  it("checking AR support keeps its own banner and disables Enter AR", () => {
    const view = deriveEntryView({ ...base, controllerStatus: "checking" });
    expect(view.arEnabled).toBe(false);
    expect(view.message).toEqual({
      text: "Checking AR support…",
      tone: "info",
    });
  });

  it("a controller error stays visible and retryable while AR is still offered", () => {
    const view = deriveEntryView({
      ...base,
      controllerStatus: "error",
      controllerError: "camera blocked",
    });
    expect(view.arEnabled).toBe(true);
    expect(view.message).toEqual({ text: "camera blocked", tone: "error" });
  });

  it("a controller error without a message falls back to actionable copy", () => {
    const view = deriveEntryView({ ...base, controllerStatus: "error" });
    expect(view.message?.text).toMatch(/camera and location access/i);
  });

  it("&preview=1 offers preview even where AR works and the tour is near", () => {
    expect(
      deriveEntryView({
        ...base,
        forcePreview: true,
        proximity: { kind: "near" },
      }).previewOffered,
    ).toBe(true);
  });
});
