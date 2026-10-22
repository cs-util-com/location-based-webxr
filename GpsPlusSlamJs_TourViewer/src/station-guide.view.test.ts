/**
 * The station guide's view for the sheet (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M2, §1.5): the sheet's peek splits today's station line into eyebrow,
 * title, distance and tail, so it reads what the line was written from - the
 * station in focus and the position's kind - from the guide itself rather
 * than parsing the line. The story card carries the end control (the guide
 * writes "End this story?" there when the page hands it one), "Keep
 * listening" takes the ask back, and a call while the scan gate is shut
 * writes nothing (the follow-up "a stale line while the scan gate is shut",
 * §10 of the plan).
 */
import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { wireStationGuide } from "./station-guide";
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

function harness(
  order: TourOrder,
  options: { end?: boolean; stations?: readonly TourStation[] } = {},
) {
  let now = 1_000;
  let allowed = true;
  let visitor: VisitorPosition | null = null;
  const dom = {
    line: { textContent: "", hidden: true },
    skip: { textContent: "", hidden: true },
    ...(options.end === true ? { end: { textContent: "", hidden: true } } : {}),
  };
  const stations = options.stations ?? TOUR;
  const guide = wireStationGuide({
    dom,
    tour: () => ({ stations, order }),
    placementAllowed: () => allowed,
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
    codeLinedUp: () => false,
    alignmentReady: () => true,
    trackingReady: () => true,
    startHud: () => ({ dispose: () => undefined }),
    now: () => now,
    onFound: () => undefined,
    onEndStory: (id) => {
      guide.storyEnded(id);
    },
  });
  return {
    guide,
    dom,
    /** Stand `north`/`east` from the zero, the fixes stating `accuracyM`
     *  (null: none, so nothing vouches for the position). */
    at(north: number, east: number, accuracyM: number | null = 4) {
      visitor = {
        nue: [north, 401.5, east],
        gpsPoints: accuracyM === null ? [] : [{ latLongAccuracy: accuracyM }],
        fixNue: [north, 400, east],
        aligned: true,
        fixAtMs: now,
        fixAccuracyM: accuracyM,
      };
      guide.tick();
    },
    advance(ms: number) {
      now += ms;
    },
    setAllowed(value: boolean) {
      allowed = value;
    },
  };
}

describe("the guide's view (W4 build plan M2)", () => {
  // Why this test matters: the peek and the hidden line must name the same
  // station and say the same thing about the position; the view is that
  // shared answer, so the sheet never re-derives (and drifts from) the
  // line's rules.
  it("is null until a run exists and while the scan gate is shut", () => {
    const h = harness("fixed");
    expect(h.guide.view()).toBeNull();
    h.at(0, 100);
    expect(h.guide.view()).not.toBeNull();
    h.setAllowed(false);
    expect(h.guide.view()).toBeNull();
  });

  it("names the line's station and the position's kind: distance, pending, weak, none", () => {
    const h = harness("any");
    h.guide.tick();
    expect(h.guide.view()).toMatchObject({
      focusId: "gate",
      position: "pending",
    });
    expect(h.dom.line.textContent).toMatch(/waiting for your position…$/);

    h.at(20, 0);
    expect(h.guide.view()).toMatchObject({
      focusId: "well",
      position: "distance",
    });
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - nearest: WELL, 10 m",
    );
    expect(h.guide.view()?.distances.get("tower")).toBeCloseTo(
      Math.hypot(20, 300),
      0,
    );

    h.at(20, 0, 60);
    expect(h.guide.view()).toMatchObject({ position: "weak", accuracyM: 60 });
    expect(h.dom.line.textContent).toMatch(
      /GPS too weak to guide you \(±60 m\)/,
    );

    h.at(20, 0, null);
    expect(h.guide.view()).toMatchObject({ position: "none" });
    expect(h.dom.line.textContent).toMatch(/scan one of the tour's codes/);
  });

  it("carries the quick action the skip button shows", () => {
    const h = harness("fixed");
    h.at(0, 100);
    expect(h.guide.view()?.quick).toEqual({ kind: "ask-skip", id: "gate" });
    h.guide.skipTapped();
    expect(h.guide.view()?.quick).toEqual({ kind: "skip", id: "gate" });
    h.guide.skipTapped();
    expect(h.guide.view()?.quick).toEqual({ kind: "undo", id: "gate" });
  });

  // Why: W4 says what a skip did in a toast, not in the line. The view
  // carries the note while its moment lasts, so the page can say it once.
  it("carries the note of what just happened, while its moment lasts", () => {
    const h = harness("fixed");
    h.at(0, 100);
    expect(h.guide.view()?.note).toBeNull();
    h.guide.skipTapped();
    h.guide.skipTapped();
    expect(h.guide.view()?.note).toMatch(/^Skipped .+.$/);
    h.guide.skipTapped();
    expect(h.guide.view()?.note).toMatch(/^Brought back .+.$/);
  });
});

describe("the end control on the story card (W4 build plan M2, §1.5)", () => {
  // Why this test matters: from M2 the end control lives on the story card,
  // and only there; under today's R9 condition (nothing unfound offered)
  // the card's button asks, a second tap ends, and "Keep listening" takes
  // the ask back - while the peek's quick action stays hidden.
  it("writes the ask to the card, not to the skip button, and a second tap ends", () => {
    const h = harness("fixed", { end: true });
    h.at(0, 0);
    expect(h.dom.end?.textContent).toBe("End this story?");
    expect(h.dom.end?.hidden).toBe(false);
    expect(h.dom.skip.hidden).toBe(true);
    h.guide.skipTapped();
    expect(h.dom.end?.textContent).toBe("End the story of GATE now");
    expect(h.guide.view()?.quick).toEqual({ kind: "end", id: "gate" });
    h.guide.skipTapped();
    expect(h.dom.end?.hidden).toBe(true);
    expect(h.dom.line.textContent).toMatch(/^Next: WELL/);
    expect(h.dom.skip.textContent).toBe("Can't get there?");
  });

  it("'Keep listening' takes the ask back", () => {
    const h = harness("fixed", { end: true });
    h.at(0, 0);
    h.guide.skipTapped();
    h.guide.cancelAsk();
    expect(h.dom.end?.textContent).toBe("End this story?");
    expect(h.guide.view()?.quick).toEqual({ kind: "ask-end", id: "gate" });
  });

  it("without a card the skip button carries it, as before", () => {
    const h = harness("fixed");
    h.at(0, 0);
    expect(h.dom.skip.textContent).toBe("End this story?");
  });
});

describe("a call while the scan gate is shut (plan §10 follow-up)", () => {
  // Why this test matters: a story's end or a tap that lands while the
  // gate is shut (a later AR entry waiting behind its own scan) wrote the
  // line and the button from the last measurement until the next frame
  // hid them again - a stale line, announced by the live region.
  it("a story's end writes nothing while the gate is shut", () => {
    const h = harness("fixed");
    h.at(0, 0);
    h.setAllowed(false);
    h.guide.tick();
    expect(h.dom.line.hidden).toBe(true);
    h.guide.storyEnded("gate");
    expect(h.dom.line.hidden).toBe(true);
    expect(h.dom.skip.hidden).toBe(true);
    // The walk moved on: the gate is done once the guide runs again.
    h.setAllowed(true);
    h.guide.tick();
    expect(h.dom.line.textContent).toMatch(/^Next: WELL/);
  });

  it("a tap writes nothing while the gate is shut", () => {
    const h = harness("fixed");
    h.at(0, 100);
    h.setAllowed(false);
    h.guide.tick();
    h.guide.skipTapped();
    expect(h.dom.line.hidden).toBe(true);
    expect(h.dom.skip.hidden).toBe(true);
  });
});
