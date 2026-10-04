import { describe, expect, it, vi } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";

import { stationBands } from "./station-bands";
import { skipSuggestAfterMs } from "./station-run";
import { wireStationGuide, type StationTour } from "./station-guide";

/**
 * Why these tests matter: this is where the visitor's real position, the
 * tour's stations and the HUD meet. The HUD must say "arrived" exactly where
 * a station is found, a code the moved-code check ignores must not count as
 * found, a code-only station must still be pointed at, the skip must be
 * there on demand and suggested after its clock, and the progress must
 * survive leaving AR and coming back.
 */

// The core's geodesy needs an activated store (the framework's factory).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };
const step = {
  id: "s",
  block: { kind: "text", text: "Hi" },
  advance: { mode: "tap" },
} as const;

/** A station `north`/`east` metres from the zero. */
function station(
  id: string,
  north: number,
  east: number,
  extra: Partial<TourStation> = {},
): TourStation {
  const geo = calcGpsCoords(zero, [north, 0, east]);
  return {
    id,
    title: id.toUpperCase(),
    anchor: { geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 } },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [step],
    ...extra,
  };
}

function harness(tourValue: StationTour) {
  let now = 1_000;
  let visitor = {
    nue: [0, 401.5, 0] as [number, number, number] | null,
    accuracyM: 4 as number | null,
  };
  let allowed = true;
  const ignored = new Set<string>();
  const found: string[] = [];
  const approaches: [string, number, number][] = [];
  const dones: string[] = [];
  const huds: { getTargets: () => WayfindingTarget[]; disposed: boolean }[] =
    [];
  const dom = {
    line: { textContent: "" as string, hidden: true },
    skip: { textContent: "" as string, hidden: true },
  };
  let tour: StationTour | null = tourValue;
  const guide = wireStationGuide({
    dom,
    tour: () => tour,
    placementAllowed: () => allowed,
    zero: () => zero,
    visitor: () => visitor,
    isIgnoredCode: (id) => ignored.has(id),
    startHud: (getTargets) => {
      const h = { getTargets, disposed: false };
      huds.push(h);
      return { dispose: () => (h.disposed = true) };
    },
    now: () => now,
    onFound: (s) => found.push(s.id),
    onApproach: (s, d, exit) => approaches.push([s.id, Math.round(d), exit]),
    onDone: (id) => dones.push(id),
  });
  return {
    guide,
    dom,
    found,
    approaches,
    dones,
    huds,
    ignored,
    at: (north: number, east: number, accuracyM: number | null = 4) => {
      visitor = { nue: [north, 401.5, east], accuracyM };
      guide.tick();
    },
    lost: () => {
      visitor = { nue: null, accuracyM: 4 };
      guide.tick();
    },
    advance: (ms: number) => (now += ms),
    allow: (v: boolean) => (allowed = v),
    setTour: (t: StationTour | null) => (tour = t),
  };
}

describe("wireStationGuide", () => {
  it("waits for the scan gate, then guides to the next station and finds it on the spot", () => {
    const h = harness({
      stations: [station("gate", 50, 0)],
      order: "fixed",
      levels: null,
    });
    h.allow(false);
    h.at(0, 0);
    expect(h.dom.line.hidden).toBe(true);
    expect(h.huds).toHaveLength(0);
    h.allow(true);
    h.at(0, 0);
    expect(h.dom.line.textContent).toBe("Next: GATE, 50 m");
    expect(h.huds).toHaveLength(1);
    h.at(48, 1);
    expect(h.found).toEqual(["gate"]);
    expect(h.dom.line.textContent).toMatch(/found/);
  });

  it("points the HUD at each offered station at the visitor's height, its arrival band the found band", () => {
    const s = station("gate", 50, 20);
    const h = harness({
      stations: [s, station("well", -30, 0)],
      order: "any",
      levels: null,
    });
    h.at(0, 0, 6);
    const targets = h.huds[0]!.getTargets();
    expect(targets.map((t) => t.id)).toEqual(["gate", "well"]);
    const gate = targets[0]!;
    expect(gate.position.x).toBeCloseTo(50, 1);
    expect(gate.position.y).toBe(401.5);
    expect(gate.position.z).toBeCloseTo(20, 1);
    const bands = stationBands(s, 6);
    expect([gate.distanceMin, gate.distanceMax]).toEqual([
      bands.foundM,
      bands.foundExitM,
    ]);
    expect(h.dom.line.textContent).toBe(
      "2 stations to find - nearest: WELL, 30 m",
    );
  });

  it("a code-only station stands where its code was saved, and is found by a lock of that code", () => {
    const geo = calcGpsCoords(zero, [0, 0, 40]);
    const levels = new Map<string, QrLevel>([
      [
        "lvl-a",
        {
          version: 1,
          qr: {
            physicalSizeM: 0.2,
            geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
          },
        },
      ],
    ]);
    const s: TourStation = {
      ...station("tower", 0, 0),
      anchor: { code: "lvl-a" },
    };
    const h = harness({ stations: [s], order: "fixed", levels });
    h.at(0, 0);
    expect(h.dom.line.textContent).toBe("Next: TOWER, 40 m");
    h.guide.codeLocked("lvl-a");
    expect(h.found).toEqual(["tower"]);
  });

  it("a code the moved-code check ignores does not count as found (D20)", () => {
    const s: TourStation = {
      ...station("tower", 100, 0),
      anchor: { code: "lvl-a", geo: station("x", 100, 0).anchor.geo! },
    };
    const h = harness({ stations: [s], order: "fixed", levels: null });
    h.ignored.add("lvl-a");
    h.at(0, 0);
    h.guide.codeLocked("lvl-a");
    expect(h.found).toEqual([]);
    h.ignored.clear();
    h.guide.codeLocked("lvl-a");
    expect(h.found).toEqual(["tower"]);
  });

  it("a station with neither a spot nor a known code asks for its printed code", () => {
    const s: TourStation = {
      ...station("cellar", 0, 0),
      anchor: { code: "unknown" },
    };
    const h = harness({ stations: [s], order: "fixed", levels: null });
    h.at(0, 0);
    expect(h.dom.line.textContent).toBe(
      "Next: CELLAR - find its printed code.",
    );
    expect(h.huds[0]!.getTargets()).toEqual([]);
  });

  it("says when it has no position yet, or the GPS is too weak to guide", () => {
    const h = harness({
      stations: [station("gate", 50, 0)],
      order: "fixed",
      levels: null,
    });
    h.lost();
    expect(h.dom.line.textContent).toBe(
      "Next: GATE - waiting for your position…",
    );
    h.at(0, 0, 60);
    expect(h.dom.line.textContent).toMatch(
      /GPS too weak to guide you \(±60 m\)/,
    );
    // ... and a weak fix finds nothing, even standing on it.
    h.at(50, 0, 60);
    expect(h.found).toEqual([]);
  });

  it("skip: on demand in two taps, suggested in one after its clock, and the order moves on", () => {
    const h = harness({
      stations: [station("gate", 100, 0), station("well", 0, 100)],
      order: "fixed",
      levels: null,
    });
    h.at(0, 0);
    expect(h.dom.skip).toEqual({
      hidden: false,
      textContent: "Can't get there?",
    });
    h.guide.skipTapped();
    expect(h.dom.skip.textContent).toBe("Skip GATE - I can't get there");
    h.guide.skipTapped();
    expect(h.dom.line.textContent).toBe("Skipped GATE. Next: WELL, 100 m");
    // The next station's clock: suggested once it ran out.
    h.advance(skipSuggestAfterMs(100) + 1);
    h.at(0, 0);
    expect(h.dom.skip.textContent).toBe("Skip WELL - I can't get there");
    h.guide.skipTapped();
    expect(h.dom.line.textContent).toBe("Tour complete - 2 skipped.");
    expect(h.dom.skip.hidden).toBe(true);
    expect(h.huds[0]!.disposed).toBe(true);
  });

  it("a story's end makes the station done and offers the next", () => {
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed",
      levels: null,
    });
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    h.guide.storyEnded("gate");
    expect(h.dom.line.textContent).toBe("Next: WELL, 80 m");
  });

  it("keeps the progress across AR entries; a different tour starts again", () => {
    const tour = {
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed" as const,
      levels: null,
    };
    const h = harness(tour);
    h.at(0, 0);
    h.guide.storyEnded("gate");
    h.guide.endSession();
    expect(h.huds[0]!.disposed).toBe(true);
    expect(h.dom.line.hidden).toBe(true);
    h.at(0, 0);
    expect(h.huds).toHaveLength(2);
    expect(h.dom.line.textContent).toBe("Next: WELL, 80 m");
    h.setTour({ ...tour, stations: [station("tower", 0, 30)] });
    h.at(0, 0);
    expect(h.dom.line.textContent).toBe("Next: TOWER, 30 m");
    h.setTour(null);
    h.at(0, 0);
    expect(h.dom.line.hidden).toBe(true);
  });

  it("a story cut short by the session's end plays again when the visitor comes back to AR", () => {
    // The session end stops the story (no screen to show it on); its
    // station stays found, so without a replay a fixed-order tour could
    // never get past it.
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed",
      levels: null,
    });
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    h.guide.endSession();
    h.at(0, 0);
    expect(h.found).toEqual(["gate", "gate"]);
    h.at(0, 0);
    expect(h.found).toEqual(["gate", "gate"]);
  });

  it("measures from where the visitor is NOW when a code lock and its story come before any tick", () => {
    // On the page the lock that passes the scan gate can find the first
    // station before the guide has ticked once; the line after its story
    // must still give the next station's distance, not "waiting".
    const levels = new Map<string, QrLevel>([
      [
        "lvl-a",
        {
          version: 1,
          qr: { physicalSizeM: 0.2, geo: station("x", 0, 0).anchor.geo! },
        },
      ],
    ]);
    const first: TourStation = {
      ...station("gate", 0, 0),
      anchor: { code: "lvl-a" },
    };
    const h = harness({
      stations: [first, station("well", 0, 80)],
      order: "fixed",
      levels,
    });
    h.guide.codeLocked("lvl-a");
    expect(h.found).toEqual(["gate"]);
    h.guide.storyEnded("gate");
    expect(h.dom.line.textContent).toBe("Next: WELL, 80 m");
    // ... and the HUD points at the well already.
    expect(h.huds).toHaveLength(1);
    expect(h.huds[0]!.getTargets().map((t) => t.id)).toEqual(["well"]);
  });

  it("tells the prefetch how far each offered station is, and which stations are done (skipped or finished)", () => {
    const s = station("gate", 0, 0);
    const h = harness({
      stations: [s, station("well", 0, 80), station("tower", 0, 300)],
      order: "fixed",
      levels: null,
    });
    h.at(0, 0);
    expect(h.approaches).toEqual([
      ["gate", 0, stationBands(s, 4).activateExitM],
    ]);
    h.guide.storyEnded("gate");
    h.at(0, 0);
    expect(h.approaches.at(-1)?.slice(0, 2)).toEqual(["well", 80]);
    h.guide.skipTapped();
    h.guide.skipTapped();
    expect(h.dones).toEqual(["gate", "well"]);
  });

  it("finds nothing that is not offered, and calls onFound once per station", () => {
    const h = harness({
      stations: [station("gate", 100, 0), station("well", 0, 0)],
      order: "fixed",
      levels: null,
    });
    vi.useFakeTimers();
    h.at(0, 0);
    h.at(0, 0);
    vi.useRealTimers();
    expect(h.found).toEqual([]);
    h.at(100, 0);
    h.at(100, 0);
    expect(h.found).toEqual(["gate"]);
  });
});
