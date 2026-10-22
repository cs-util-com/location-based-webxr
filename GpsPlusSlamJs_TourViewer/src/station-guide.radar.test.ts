/**
 * What the station guide hands the radar and the precision chip (visitor
 * walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M3, §1.2, §1.3, §2.2): the precision kind, published to the store only
 * on a change (the store gets events, never frames); the camera's heading
 * once this AR entry earned one (the latch the HUD's arrows use); every
 * station's bearing; and the last judged snapshot of that geometry, which
 * a frozen radar draws from - so under `'none'` or a tracking loss the
 * radar never moves with a position nobody vouches for.
 */
import { describe, expect, it } from "vitest";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { UnknownAction } from "@reduxjs/toolkit";

import { wireStationGuide } from "./station-guide";
import { createTourViewerStore } from "./tour-viewer-session";
import {
  precisionKindSet,
  selectPrecisionKind,
  trackingLostSet,
} from "./visitor-guide-slice";
import type { VisitorPosition } from "./visitor-position";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };

function station(id: string, north: number, east: number): TourStation {
  const geo = calcGpsCoords(zero, [north, 0, east]);
  return {
    id,
    title: id.toUpperCase(),
    geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [
      {
        id: "s",
        block: { kind: "text", text: "Hi" },
        advance: { mode: "tap" },
      },
    ],
    items: [],
  };
}

const TOUR = [
  station("gate", 0, 0),
  station("well", 30, 0),
  station("tower", 0, 300),
];

/** A unit forward in NUE at a bearing (degrees from north). */
function facing(deg: number): [number, number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), 0, Math.sin(r)];
}

function harness() {
  const store = createTourViewerStore();
  const dispatched: UnknownAction[] = [];
  const guideStore = {
    getState: () => store.getState(),
    dispatch(action: UnknownAction) {
      dispatched.push(action);
      return store.dispatch(action);
    },
  };
  let visitor: VisitorPosition | null = null;
  let lined = false;
  let ready = true;
  let tracking = true;
  const guide = wireStationGuide({
    dom: {
      line: { textContent: "", hidden: true },
      skip: { textContent: "", hidden: true },
    },
    tour: () => ({ stations: TOUR, order: "any" }),
    placementAllowed: () => true,
    zero: () => zero,
    visitor: () =>
      visitor ?? {
        nue: null,
        gpsPoints: [],
        fixNue: null,
        aligned: false,
        fixAtMs: null,
        fixAccuracyM: null,
      },
    codeLinedUp: () => lined,
    alignmentReady: () => ready,
    trackingReady: () => tracking,
    startHud: () => ({ dispose: () => undefined }),
    now: () => 1_000,
    guideStore,
    walkStore: store,
    onFound: () => undefined,
  });
  return {
    guide,
    store,
    dispatched,
    /** Stand `north`/`east` facing `bearing`, the fixes stating
     *  `accuracyM` (null: none). */
    at(
      north: number,
      east: number,
      accuracyM: number | null = 4,
      bearing: number | "down" | null = 0,
    ) {
      visitor = {
        nue: [north, 401.5, east],
        gpsPoints: accuracyM === null ? [] : [{ latLongAccuracy: accuracyM }],
        fixNue: [north, 400, east],
        aligned: true,
        fixAtMs: 1_000,
        fixAccuracyM: accuracyM,
        forwardNue:
          bearing === null
            ? null
            : bearing === "down"
              ? [0, -1, 0]
              : facing(bearing),
      };
      guide.tick();
    },
    setLined(value: boolean) {
      lined = value;
    },
    setReady(value: boolean) {
      ready = value;
    },
    setTracking(value: boolean) {
      tracking = value;
    },
    kindDispatches() {
      return dispatched.filter((a) => a.type === precisionKindSet.type);
    },
  };
}

describe("the guide's precision kind (W4 build plan M3, §1.3)", () => {
  // Why: the chip and the radar read one kind from the store; it must be
  // the guide's own judgement (the line's rules), and reach the store only
  // when it changes - a dispatch per frame is what the store rule forbids.
  it("is pending, GPS, too weak, none or a code's, as the line judges", () => {
    const h = harness();
    h.guide.tick();
    expect(h.guide.view()?.precision).toBe("pending");
    h.at(20, 0);
    expect(h.guide.view()).toMatchObject({ precision: "gps", accuracyM: 4 });
    h.at(20, 0, 60);
    expect(h.guide.view()).toMatchObject({ precision: "weak", accuracyM: 60 });
    h.at(20, 0, null);
    expect(h.guide.view()).toMatchObject({
      precision: "none",
      accuracyM: null,
    });
    h.setLined(true);
    h.at(20, 0, 60);
    expect(h.guide.view()).toMatchObject({
      precision: "code",
      accuracyM: null,
    });
  });

  it("publishes the kind to the store on a change only", () => {
    const h = harness();
    h.guide.tick();
    expect(h.kindDispatches()).toHaveLength(0);
    for (let i = 0; i < 5; i += 1) h.at(20, 0);
    expect(selectPrecisionKind(h.store.getState())).toBe("gps");
    expect(h.kindDispatches()).toHaveLength(1);
    h.at(20, 0, 60);
    h.at(20, 1, 60);
    h.at(20, 0, null);
    expect(h.kindDispatches().map((a) => a.payload)).toEqual([
      "gps",
      "weak",
      "none",
    ]);
  });

  it("goes back to pending at the session's end", () => {
    const h = harness();
    h.at(20, 0);
    h.guide.endSession();
    expect(selectPrecisionKind(h.store.getState())).toBe("pending");
  });
});

describe("the guide's heading and bearings (W4 build plan M3, §1.2)", () => {
  // Why: the radar is heading-up; its heading is the camera's forward
  // through the alignment, and only once this AR entry earned a heading
  // (the latch the HUD's arrows use) - before that a GPS-only alignment
  // has no heading and the radar draws distances only.
  it("carries the camera's bearing once the heading latched", () => {
    const h = harness();
    h.setReady(false);
    h.setTracking(false);
    h.at(20, 0, 4, 90);
    expect(h.guide.view()?.headingDeg).toBeNull();
    h.setTracking(true);
    h.at(20, 0, 4, 90);
    expect(h.guide.view()?.headingDeg).toBeCloseTo(90, 9);
    // A dip of the tracking keeps the latched heading.
    h.setTracking(false);
    h.at(20, 0, 4, 45);
    expect(h.guide.view()?.headingDeg).toBeCloseTo(45, 9);
  });

  it("keeps the last bearing while the camera points straight down", () => {
    const h = harness();
    h.at(20, 0, 4, 30);
    h.guide.tick();
    h.at(20, 0, 4, "down");
    expect(h.guide.view()?.headingDeg).toBeCloseTo(30, 9);
    // A pose without an orientation (a drop) keeps it too.
    h.at(20, 0, 4, null);
    expect(h.guide.view()?.headingDeg).toBeCloseTo(30, 9);
  });

  it("measures every station's bearing from the visitor", () => {
    const h = harness();
    h.at(20, 0);
    const bearings = h.guide.view()?.bearings;
    expect(bearings?.get("well")).toBeCloseTo(0, 9);
    expect(bearings?.get("gate")).toBeCloseTo(180, 9);
    expect(bearings?.get("tower")).toBeCloseTo(
      (Math.atan2(300, -20) * 180) / Math.PI,
      9,
    );
  });
});

describe("the frozen radar's snapshot (W4 build plan M3, §1.2)", () => {
  // Why: under 'none' and a tracking loss the radar draws the LAST judged
  // geometry, grey; a snapshot that kept following the live position
  // would draw the stations where an untrusted position puts them.
  it("follows the live geometry while a position is trusted", () => {
    const h = harness();
    h.at(20, 0, 4, 10);
    expect(h.guide.view()?.snapshot).toMatchObject({ headingDeg: 10 });
    expect(h.guide.view()?.snapshot?.distances.get("well")).toBeCloseTo(10, 6);
    h.at(25, 0, 40, 20);
    // Too weak is drawn live too (the amber blur).
    expect(h.guide.view()?.snapshot?.distances.get("well")).toBeCloseTo(5, 6);
  });

  it("freezes under 'none': the visitor moves, the snapshot does not", () => {
    const h = harness();
    h.at(20, 0, 4, 10);
    h.at(0, 200, null, 80);
    const view = h.guide.view();
    expect(view?.precision).toBe("none");
    expect(view?.distances.get("well")).toBeCloseTo(Math.hypot(30, 200), 6);
    expect(view?.snapshot?.distances.get("well")).toBeCloseTo(10, 6);
    expect(view?.snapshot?.bearings.get("well")).toBeCloseTo(0, 9);
    expect(view?.snapshot?.headingDeg).toBeCloseTo(10, 9);
  });

  it("freezes while the store says the tracking is lost", () => {
    const h = harness();
    h.at(20, 0, 4, 10);
    h.store.dispatch(trackingLostSet(true));
    h.at(0, 200, 4, 80);
    expect(h.guide.view()?.snapshot?.distances.get("well")).toBeCloseTo(10, 6);
    h.store.dispatch(trackingLostSet(false));
    h.at(0, 200, 4, 80);
    expect(h.guide.view()?.snapshot?.headingDeg).toBeCloseTo(80, 9);
  });

  it("starts each AR entry without one", () => {
    const h = harness();
    h.at(20, 0, 4, 10);
    h.guide.endSession();
    h.at(20, 0, null, 10);
    expect(h.guide.view()?.snapshot).toBeNull();
  });
});
