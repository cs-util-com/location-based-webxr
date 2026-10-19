import { describe, expect, it, vi } from "vitest";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import {
  createSlamAppStore,
  poseReceived,
  recordGpsEvent,
  selectAlignmentMatrix,
  selectGpsPositions,
  selectTrackingQuality,
  selectZeroReference,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";

import { judgedStationBands, stationBands } from "./station-bands";
import { skipSuggestAfterMs } from "./station-run";
import {
  FIX_MAX_AGE_MS,
  SKIP_UNDO_MS,
  wireStationGuide,
  type StationTour,
} from "./station-guide";
import { visitorPosition, type VisitorPosition } from "./visitor-position";
import { createTourViewerStore } from "./tour-viewer-session";
import { stationAlignmentSignals } from "./visitor-stations";

/**
 * Why these tests matter: this is where the visitor's real position, the
 * tour's stations and the HUD meet. A station is reached by its radius alone
 * (tour editor plan D16): the phone's best position - the alignment's while
 * it is ready, else the fresh device fix - inside the
 * authored found radius; a code lock only improves that position, and with
 * no position nothing is reached. The raw fixes' accuracy judges every
 * position but one a code lined up. The HUD must say "arrived" exactly there, the skip must be there
 * on demand and suggested after its clock, and the progress must survive
 * leaving AR and coming back.
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
    geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [step],
    items: [],
    ...extra,
  };
}

function harness(
  tourValue: StationTour,
  options: { fixMaxAgeMs?: number } = {},
) {
  let now = 1_000;
  let visitor: VisitorPosition = {
    nue: [0, 401.5, 0],
    accuracyM: 4,
    fixNue: [0, 400, 0],
    aligned: true,
    fixAtMs: now,
    fixAccuracyM: 4,
  };
  let allowed = true;
  /** The alignment is ready (`alignmentReady`); a code lined it up. */
  let ready = true;
  let lined = false;
  let zeroNow: typeof zero | null = zero;
  const found: string[] = [];
  const approaches: [string, number, number][] = [];
  const dones: string[] = [];
  const upcomings: string[] = [];
  const ended: string[] = [];
  const guides: (string | null)[] = [];
  /** Where the figure was turned to (`onVisitor`), per tick. */
  const visitors: (readonly [number, number, number])[] = [];
  /** Where the breadcrumbs start (`onGuide`'s visitor; null: none). */
  const crumbsFrom: (readonly [number, number, number] | null)[] = [];
  const huds: { getTargets: () => WayfindingTarget[]; disposed: boolean }[] =
    [];
  /** How often the guide wrote the line and read its inputs (R13). */
  const calls = { lineWrites: 0, visitor: 0, zero: 0 };
  let lineText = "";
  const dom = {
    line: {
      get textContent(): string {
        return lineText;
      },
      set textContent(v: string) {
        calls.lineWrites += 1;
        lineText = v;
      },
      hidden: true,
    },
    skip: { textContent: "" as string, hidden: true },
  };
  let tour: StationTour | null = tourValue;
  const guide = wireStationGuide({
    dom,
    tour: () => tour,
    placementAllowed: () => allowed,
    zero: () => {
      calls.zero += 1;
      return zeroNow;
    },
    visitor: () => {
      calls.visitor += 1;
      return visitor;
    },
    codeLinedUp: () => lined,
    alignmentReady: () => ready,
    startHud: (getTargets) => {
      const h = { getTargets, disposed: false };
      huds.push(h);
      return { dispose: () => (h.disposed = true) };
    },
    now: () => now,
    ...(options.fixMaxAgeMs === undefined
      ? {}
      : { fixMaxAgeMs: options.fixMaxAgeMs }),
    onFound: (s) => found.push(s.id),
    onApproach: (s, d, exit) => approaches.push([s.id, Math.round(d), exit]),
    onDone: (id) => dones.push(id),
    onUpcoming: (s) => upcomings.push(s.id),
    // The story panel, as the page wires it: ending a story ends it.
    onEndStory: (id) => {
      ended.push(id);
      guide.storyEnded(id);
    },
    onVisitor: (nue) => visitors.push(nue),
    onGuide: (from, target) => {
      crumbsFrom.push(from);
      guides.push(
        target === null
          ? null
          : `${target.id}@${Math.round(target.to[0])},${Math.round(target.to[2])}/${target.stopM}`,
      );
    },
  });
  return {
    guide,
    dom,
    found,
    approaches,
    dones,
    upcomings,
    ended,
    calls,
    guides,
    visitors,
    crumbsFrom,
    huds,
    at: (north: number, east: number, accuracyM: number | null = 4) => {
      visitor = {
        nue: [north, 401.5, east],
        accuracyM,
        fixNue: [north, 400, east],
        aligned: true,
        fixAtMs: now,
        fixAccuracyM: accuracyM,
      };
      guide.tick();
    },
    /** The aligned position (where codes and GPS put the phone) and the
     *  latest raw device fix apart. */
    atFix: (
      north: number,
      east: number,
      fixN: number,
      fixE: number,
      accuracyM: number | null = 4,
      /** The fix's own accuracy; default the median's. */
      fixAccuracyM: number | null = accuracyM,
    ) => {
      visitor = {
        nue: [north, 401.5, east],
        accuracyM,
        fixNue: [fixN, 400, fixE],
        aligned: true,
        fixAtMs: now,
        fixAccuracyM,
      };
      guide.tick();
    },
    /** A device fix and no alignment yet (no code scanned, too few fixes). */
    fixOnly: (
      north: number,
      east: number,
      accuracyM: number | null = 4,
      ageMs = 0,
      /** The fix's own accuracy; default the median's. */
      fixAccuracyM: number | null = accuracyM,
    ) => {
      visitor = {
        nue: null,
        accuracyM,
        fixNue: [north, 400, east],
        aligned: false,
        fixAtMs: now - ageMs,
        fixAccuracyM,
      };
      guide.tick();
    },
    /** An aligned session whose tracking dropped (no AR pose this frame):
     *  no camera position, and the latest raw fix somewhere else. */
    trackingLost: (fixN: number, fixE: number, accuracyM = 4) => {
      visitor = {
        nue: null,
        accuracyM,
        fixNue: [fixN, 400, fixE],
        aligned: true,
        fixAtMs: now,
        fixAccuracyM: accuracyM,
      };
      guide.tick();
    },
    /** Placed by a code alone: an aligned position, no device fix at all. */
    byCodeOnly: (north: number, east: number) => {
      lined = true;
      visitor = {
        nue: [north, 401.5, east],
        accuracyM: null,
        fixNue: null,
        aligned: true,
        fixAtMs: null,
        fixAccuracyM: null,
      };
    },
    lost: () => {
      visitor = {
        nue: null,
        accuracyM: 4,
        fixNue: null,
        aligned: false,
        fixAtMs: null,
        fixAccuracyM: null,
      };
      guide.tick();
    },
    advance: (ms: number) => (now += ms),
    allow: (v: boolean) => (allowed = v),
    /** The alignment ready or not, a code lined it up or not. */
    ready: (v: boolean) => (ready = v),
    lined: (v: boolean) => (lined = v),
    setZero: (z: typeof zero | null) => (zeroNow = z),
    setTour: (t: StationTour | null) => (tour = t),
  };
}

describe("wireStationGuide", () => {
  it("waits for the scan gate, then guides to the next station and finds it on the spot", () => {
    const h = harness({
      stations: [station("gate", 50, 0)],
      order: "fixed",
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
    });
    h.at(0, 0, 6);
    const targets = h.huds[0]!.getTargets();
    expect(targets.map((t) => t.id)).toEqual(["gate", "well"]);
    const gate = targets[0]!;
    expect(gate.position.x).toBeCloseTo(50, 1);
    expect(gate.position.y).toBe(401.5);
    expect(gate.position.z).toBeCloseTo(20, 1);
    const bands = judgedStationBands(s, 6, false);
    expect([gate.distanceMin, gate.distanceMax]).toEqual([
      bands.foundM,
      bands.foundExitM,
    ]);
    expect(h.dom.line.textContent).toBe(
      "2 stations to find - nearest: WELL, 30 m",
    );
  });

  it("says when it has no position yet, or the GPS is too weak to guide", () => {
    const h = harness({
      stations: [station("gate", 50, 0)],
      order: "fixed",
    });
    h.lost();
    expect(h.dom.line.textContent).toBe(
      "Next: GATE - waiting for your position…",
    );
    // The raw fix is the position: its own accuracy speaks for it.
    h.fixOnly(0, 0, 60);
    expect(h.dom.line.textContent).toMatch(
      /GPS too weak to guide you \(±60 m\)/,
    );
    // Aligned with no code (r881, changed): the library aligns a session
    // from its first fix, so the alignment's position is the fixes' own,
    // and their accuracy speaks for it.
    h.at(0, 0, 60);
    expect(h.dom.line.textContent).toMatch(
      /GPS too weak to guide you \(±60 m\)/,
    );
    // A code lined it up (M5c review #1): the accuracy is the raw fixes'
    // and says nothing about the code's position, which guides as usual.
    h.lined(true);
    h.at(0, 0, 60);
    expect(h.dom.line.textContent).toBe("Next: GATE, 50 m");
  });

  it("skip: on demand in two taps, suggested in one after its clock, and the order moves on", () => {
    const h = harness({
      stations: [station("gate", 100, 0), station("well", 0, 100)],
      order: "fixed",
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
    expect(h.huds[0]!.disposed).toBe(true);
    // The skip can be undone for a moment; then the button goes.
    expect(h.dom.skip.textContent).toBe("Undo: bring back WELL");
    h.advance(SKIP_UNDO_MS);
    h.at(0, 0);
    expect(h.dom.skip.hidden).toBe(true);
  });

  it("undo: a skip can be taken back for a moment, its station offered again; after the moment it cannot (R14)", () => {
    // Why this test matters (K4 review R14): a one-tap skip with no undo
    // lost a station to one stray tap. The confirmation and the undo are
    // the async-feedback rule's final state for this (synchronous) action.
    const h = harness({
      stations: [station("gate", 100, 0), station("well", 0, 100)],
      order: "fixed",
    });
    h.at(0, 0);
    h.guide.skipTapped();
    h.guide.skipTapped();
    expect(h.dom.line.textContent).toBe("Skipped GATE. Next: WELL, 100 m");
    expect(h.dom.skip.textContent).toBe("Undo: bring back GATE");
    // The prefetch is told only once the skip can no longer be undone.
    expect(h.dones).toEqual([]);
    h.advance(SKIP_UNDO_MS - 1);
    h.at(0, 0);
    h.guide.skipTapped();
    expect(h.dom.line.textContent).toBe("Brought back GATE. Next: GATE, 100 m");
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    expect(h.dones).toEqual([]);
    // Skipped again, and the moment passes: no undo any more.
    h.guide.skipTapped();
    h.guide.skipTapped();
    h.advance(SKIP_UNDO_MS);
    h.at(0, 0);
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    expect(h.dones).toEqual(["gate"]);
    h.guide.skipTapped();
    expect(h.dom.skip.textContent).toBe("Skip WELL - I can't get there");
  });

  it("under any order a station's skip clock starts when it becomes the focus, not at the tour's start (R14)", () => {
    // Why this test matters (K4 review R14): every clock started at the
    // tour's start, so two minutes in every new focus was a one-tap skip.
    const h = harness({
      stations: [station("gate", 30, 0), station("well", -40, 0)],
      order: "any",
    });
    h.at(0, 0);
    h.advance(skipSuggestAfterMs(40) + 1);
    h.at(0, 0);
    expect(h.dom.skip.textContent).toBe("Skip GATE - I can't get there");
    h.guide.skipTapped();
    h.advance(SKIP_UNDO_MS);
    h.at(0, 0);
    // The well is the focus only now: its clock has just started.
    expect(h.dom.line.textContent).toBe("Next: WELL, 40 m");
    expect(h.dom.skip.textContent).toBe("Can't get there?");
  });

  it("a tap acts on the station and the action its label showed, even when the clock ran out since (R14)", () => {
    const h = harness({
      stations: [station("gate", 100, 0), station("well", 0, 100)],
      order: "fixed",
    });
    h.at(0, 0);
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    // The clock runs out with no render in between: the label still asks.
    h.advance(skipSuggestAfterMs(100) + 1);
    h.guide.skipTapped();
    expect(h.dom.skip.textContent).toBe("Skip GATE - I can't get there");
    expect(h.dom.line.textContent).toBe("Next: GATE, 100 m");
  });

  it("under branch order the completion line says the path was completed, not that every station was visited", () => {
    // Why this test matters (K4 review R16): a branch tour ends when the
    // visitor's path ends, with stations of the other branches never
    // offered; "every station visited" would be a false claim.
    const h = harness({
      stations: [
        station("gate", 0, 0, { next: "tower" }),
        station("well", 0, 80),
        station("tower", 0, 0),
      ],
      order: "branch",
    });
    h.at(0, 0);
    h.guide.storyEnded("gate");
    h.at(0, 0);
    h.guide.storyEnded("tower");
    expect(h.dom.line.textContent).toBe(
      "Tour complete - you reached the end of your path.",
    );
  });

  it("a found station's story can be ended in two taps, so a story that never ends cannot block the tour (R9)", () => {
    // Why this test matters (K4 review R9): a found station could not be
    // skipped, and a story whose choices all loop back never ends - under
    // a fixed order the tour stopped there for good.
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed",
    });
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    expect(h.dom.skip).toEqual({
      hidden: false,
      textContent: "End this story?",
    });
    h.guide.skipTapped();
    expect(h.dom.skip.textContent).toBe("End the story of GATE now");
    h.guide.skipTapped();
    expect(h.ended).toEqual(["gate"]);
    expect(h.dom.line.textContent).toBe("Next: WELL, 80 m");
  });

  it("a story's end makes the station done and offers the next", () => {
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed",
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
    });
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    h.guide.endSession();
    h.at(0, 0);
    expect(h.found).toEqual(["gate", "gate"]);
    h.at(0, 0);
    expect(h.found).toEqual(["gate", "gate"]);
  });

  it("a later AR session waits behind its own scan gate: no line, no HUD, nothing found until it passes (R8)", () => {
    // Why this test matters (K4 review R8): the gate was checked only when
    // the run was created, so a second AR session guided and found
    // stations before its scan gate had passed.
    const h = harness({
      stations: [station("gate", 50, 0), station("well", 0, 0)],
      order: "fixed",
    });
    h.at(0, 0);
    expect(h.dom.line.textContent).toBe("Next: GATE, 50 m");
    h.guide.endSession();
    h.allow(false);
    h.at(50, 0);
    expect(h.dom.line.hidden).toBe(true);
    expect(h.dom.skip.hidden).toBe(true);
    expect(h.huds).toHaveLength(1);
    expect(h.found).toEqual([]);
    h.allow(true);
    h.at(50, 0);
    expect(h.found).toEqual(["gate"]);
    expect(h.huds).toHaveLength(2);
  });

  it("a story cut short replays only once the visitor has a position and the GPS zero exists (R8)", () => {
    // Why this test matters (K4 review R8): a replay at the first tick of a
    // new session, before the zero was set, mounted the figure with no
    // pose, and the story said "could not be loaded" for good.
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed",
    });
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    h.guide.endSession();
    h.setZero(null);
    h.lost();
    expect(h.found).toEqual(["gate"]);
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    h.setZero(zero);
    h.lost();
    expect(h.found).toEqual(["gate"]);
    h.at(0, 0);
    expect(h.found).toEqual(["gate", "gate"]);
  });

  it("measures from where the visitor is NOW when a code lock and its story come before any tick", () => {
    // On the page the lock that passes the scan gate can re-judge before
    // the guide has ticked once (D16: the lock improved the position); the
    // line after the story must still give the next station's distance,
    // not "waiting".
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed",
    });
    h.guide.codeLocked();
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
    });
    h.at(0, 0);
    expect(h.approaches).toEqual([
      ["gate", 0, judgedStationBands(s, 4, false).activateM],
    ]);
    h.guide.storyEnded("gate");
    h.at(0, 0);
    expect(h.approaches.at(-1)?.slice(0, 2)).toEqual(["well", 80]);
    h.guide.skipTapped();
    h.guide.skipTapped();
    // A skip reaches the prefetch once it can no longer be undone (R14).
    h.advance(SKIP_UNDO_MS);
    h.at(0, 0);
    expect(h.dones).toEqual(["gate", "well"]);
  });

  it("names the next station in order to the prefetch as soon as the current one is found (R5)", () => {
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 30)],
      order: "fixed",
    });
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    expect(h.upcomings.at(-1)).toBe("well");
  });

  it("lays the breadcrumbs towards the nearest unfound station, stopping at its arrival band, and none once it is found", () => {
    const s = station("well", 0, 80);
    const h = harness({
      stations: [s, station("tower", 0, 300)],
      order: "fixed",
    });
    h.at(0, 0);
    expect(h.guides.at(-1)).toBe(
      `well@0,80/${judgedStationBands(s, 4, false).foundExitM}`,
    );
    h.at(0, 79);
    expect(h.guides.at(-1)).toBeNull();
    h.guide.endSession();
    expect(h.guides.at(-1)).toBeNull();
  });

  it("per tick: measures the visitor once, reads the zero once, and writes the line only when its text changes (R13)", () => {
    // Why this test matters (K4 review R13): every tick rewrote the polite
    // live region, so a screen reader re-announced the line on every
    // camera frame, and each tick repeated the geodesy several times per
    // offered station.
    const h = harness({
      stations: [station("gate", 50, 0), station("well", -30, 0)],
      order: "any",
    });
    h.at(0, 0);
    const before = { ...h.calls };
    for (let i = 0; i < 10; i += 1) h.at(0, 0);
    expect(h.calls.visitor - before.visitor).toBe(10);
    expect(h.calls.zero - before.zero).toBe(10);
    expect(h.calls.lineWrites - before.lineWrites).toBe(0);
    h.at(-10, 0); // 20 m from the well now: the line changes once
    expect(h.calls.lineWrites - before.lineWrites).toBe(1);
  });

  it("finds nothing that is not offered, and calls onFound once per station", () => {
    const h = harness({
      stations: [station("gate", 100, 0), station("well", 0, 0)],
      order: "fixed",
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

// Why (tour editor plan D16): a station is reached by its radius alone, on
// the phone's current best position - the alignment's, fed by GPS and codes
// alike; before any alignment the device fix. A code scan is no arrival of
// its own, only a better position; with no position nothing is reached. The
// rule replaced the code-only station, the held code lock and the visitor's
// own "I'm here", which the codes-only case used to need.
describe("arrival by the station radius alone (D16)", () => {
  it("codes only: reached after a scan, by the distance the scan gives", () => {
    const h = harness({
      stations: [station("well", 30, 0)],
      order: "fixed",
    });
    h.lost();
    expect(h.found).toEqual([]);
    // A scan 10 m from the station: placed, but outside its 5 m radius.
    h.byCodeOnly(20, 0);
    h.guide.codeLocked();
    expect(h.found).toEqual([]);
    expect(h.dom.line.textContent).toBe("Next: WELL, 10 m");
    // A scan 3 m from it: the lock re-judges at once and the station is
    // found, without a device fix and without any tap.
    h.byCodeOnly(27, 0);
    h.guide.codeLocked();
    expect(h.found).toEqual(["well"]);
  });

  it("poor GPS: a weak fix never widens the radius, and a RAW fix too weak to guide by finds nothing until the GPS recovers", () => {
    const weak = harness({
      stations: [station("well", 30, 0)],
      order: "fixed",
    });
    // 15 m accuracy, 10 m away: the old rule found the station here.
    weak.at(20, 0, 15);
    expect(weak.found).toEqual([]);
    // No alignment, the raw fix ±60 m, 2 m away: the line says the GPS is
    // too weak, and the run agrees - no arrival (PR #640 review).
    weak.fixOnly(28, 0, 60);
    expect(weak.dom.line.textContent).toMatch(/GPS too weak to guide you/);
    expect(weak.found).toEqual([]);
    // The GPS recovers at the same spot: found.
    weak.fixOnly(28, 0, 5);
    expect(weak.found).toEqual(["well"]);
  });

  // Why (M5c review #1): `accuracyM` is the raw fixes' median and says
  // nothing about a position a code lined up. An indoor or courtyard tour
  // placed by one code with a ±40-60 m Wi-Fi fix was never found and was
  // told to step into the open, though its position was the code's.
  // Changed (r881): this test used to grant the same to ANY aligned
  // visitor, code or not. The library aligns a session from its first fix
  // (the identity at the zero, at any accuracy), so "aligned" alone said
  // nothing, and a ±500 m cold-start fix latched "found" (the PR #640
  // case). Only a code earns the trust now.
  it("a visitor a code lined up is found inside the radius however weak the raw fix; one without a code is not", () => {
    const h = harness({
      stations: [station("well", 30, 0)],
      order: "fixed",
    });
    h.lined(true);
    h.at(28, 0, 60);
    expect(h.found).toEqual(["well"]);
    expect(h.dom.line.textContent).not.toMatch(/too weak/);
    const gpsOnly = harness({
      stations: [station("well", 30, 0)],
      order: "fixed",
    });
    gpsOnly.at(28, 0, 60);
    expect(gpsOnly.found).toEqual([]);
    expect(gpsOnly.dom.line.textContent).toMatch(/too weak/);
    // The GPS recovers at the same spot: found.
    gpsOnly.at(28, 0, 5);
    expect(gpsOnly.found).toEqual(["well"]);
  });

  // Why (PR #642 review): the run and the line judged a code-placed visitor
  // without the raw fixes' accuracy, but the prefetch, the HUD's band and
  // the breadcrumbs' stop still read it - so a ±40 m Wi-Fi fix beside a
  // code-placed position moved where the arrow came back and the crumbs
  // stopped. One rule decides all of them. Swept over the raw accuracy
  // (and none at all), with a code, without one, and with no alignment.
  // Changed (r881): "aligned" used to be the condition; a code is now.
  it("widens nothing for a visitor a code lined up however weak the raw fix; any other position keeps the raw accuracy's band", () => {
    // An activation radius inside the widest band, so the prefetch shows it.
    const s = station("gate", 50, 0, { activateRadiusM: 6, foundRadiusM: 5 });
    const tour: StationTour = { stations: [s], order: "fixed" };
    const coded = judgedStationBands(s, null, true);
    expect(coded.foundExitM).toBe(5 + 1.5);
    for (const accuracyM of [5, 25, 40, 100, null]) {
      const h = harness(tour);
      h.lined(true);
      h.at(0, 0, accuracyM);
      expect(h.approaches.at(-1)).toEqual(["gate", 50, coded.activateM]);
      expect(h.guides.at(-1)).toBe(`gate@50,0/${coded.foundExitM}`);
      const [target] = h.huds[0]!.getTargets();
      expect([target!.distanceMin, target!.distanceMax]).toEqual([
        coded.foundM,
        coded.foundExitM,
      ]);
      // Aligned with no code: the raw accuracy's band, as a raw fix's.
      const own = stationBands(s, accuracyM);
      const gpsOnly = harness(tour);
      gpsOnly.at(0, 0, accuracyM);
      expect(gpsOnly.approaches.at(-1)).toEqual(["gate", 50, own.activateM]);
      expect(gpsOnly.guides.at(-1)).toBe(`gate@50,0/${own.foundExitM}`);
      const [own0] = gpsOnly.huds[0]!.getTargets();
      expect([own0!.distanceMin, own0!.distanceMax]).toEqual([
        own.foundM,
        own.foundExitM,
      ]);
      // No alignment: the raw fix IS the position, and its accuracy its band.
      const raw = harness(tour);
      raw.fixOnly(0, 0, accuracyM);
      expect(raw.approaches.at(-1)).toEqual(["gate", 50, own.activateM]);
      expect(raw.guides.at(-1)).toBe(`gate@50,0/${own.foundExitM}`);
      // The HUD needs a camera position: none from a raw fix alone.
      expect(raw.huds[0]?.getTargets() ?? []).toEqual([]);
    }
  });

  it("none before any position: no fix, no alignment, nothing is reached, a code lock included", () => {
    const h = harness({
      stations: [station("gate", 0, 0)],
      order: "fixed",
    });
    h.lost();
    h.guide.codeLocked();
    h.lost();
    expect(h.found).toEqual([]);
    expect(h.dom.line.textContent).toBe(
      "Next: GATE - waiting for your position…",
    );
  });

  it("before any alignment the device fix decides; once aligned, the alignment's position does", () => {
    const early = harness({
      stations: [station("gate", 30, 0)],
      order: "fixed",
    });
    early.fixOnly(28, 0);
    expect(early.found).toEqual(["gate"]);
    // Aligned 30 m away while the raw fix stands on the station: the
    // aligned position is the better one, and it is not there.
    const aligned = harness({
      stations: [station("gate", 30, 0)],
      order: "fixed",
    });
    aligned.atFix(0, 0, 30, 0);
    expect(aligned.found).toEqual([]);
    aligned.atFix(29, 0, 0, 0);
    expect(aligned.found).toEqual(["gate"]);
  });

  // Why (M5a review M3): `nue` is null whenever the AR pose is, so an
  // aligned session that lost tracking for a frame fell back to the raw
  // latest fix - with no accuracy or age check - while the line might say
  // the GPS is too weak, and "found" latches. The fix stands in only while
  // there is no alignment at all.
  // Why (PR #640 review): the line said "GPS too weak to guide you" while
  // the run latched "found" on the same ±500 m cold-start fix. The two
  // must agree: no arrival on a fix the line calls too weak.
  it("a ±500 m fix inside a 10 m station says the GPS is too weak and finds nothing; a ±5 m one finds it", () => {
    const h = harness({
      stations: [station("gate", 3, 0, { foundRadiusM: 10 })],
      order: "fixed",
    });
    h.fixOnly(0, 0, 500);
    expect(h.dom.line.textContent).toMatch(/GPS too weak to guide you/);
    expect(h.found).toEqual([]);
    h.fixOnly(0, 0, 5);
    expect(h.found).toEqual(["gate"]);
  });

  it("a tracking drop in an aligned session does not find a station on the raw fix", () => {
    const h = harness({
      stations: [station("gate", 30, 0)],
      order: "fixed",
    });
    h.at(0, 0);
    expect(h.found).toEqual([]);
    // Tracking lost; the latest raw fix happens to read the station.
    h.trackingLost(30, 0);
    expect(h.found).toEqual([]);
    expect(h.dom.line.textContent).toBe(
      "Next: GATE - waiting for your position…",
    );
    // Tracking back, still far: still not found; then at the station: found.
    h.at(0, 0);
    expect(h.found).toEqual([]);
    h.at(29, 0);
    expect(h.found).toEqual(["gate"]);
  });

  // Why (M5a review M3): before any alignment the fix is the only
  // position, and a fix the GPS stopped renewing says where the visitor
  // WAS. A run that starts later (a scan gate passed, a tour opened) must
  // not find a station on it.
  it("a stale fix is ignored before any alignment: no arrival, and the line waits", () => {
    expect(FIX_MAX_AGE_MS).toBe(5_000);
    const h = harness({
      stations: [station("gate", 30, 0)],
      order: "fixed",
    });
    h.fixOnly(29, 0, 4, FIX_MAX_AGE_MS + 1);
    expect(h.found).toEqual([]);
    expect(h.dom.line.textContent).toBe(
      "Next: GATE - waiting for your position…",
    );
    // A fresh fix at the same spot finds it.
    h.fixOnly(29, 0, 4, 0);
    expect(h.found).toEqual(["gate"]);
  });

  // The age limit is a judgement (FIX_MAX_AGE_MS's comment), so the rule is
  // checked across the plausible range, 2-10 s: the limit itself still
  // counts, anything older does not, and a fix from a clock ahead of the
  // page's (a negative age) is fresh.
  it.each([2_000, 3_000, 5_000, 7_000, 10_000])(
    "the fix's age decides at a limit of %i ms",
    (limitMs) => {
      const fresh = harness(
        { stations: [station("gate", 30, 0)], order: "fixed" },
        { fixMaxAgeMs: limitMs },
      );
      fresh.fixOnly(29, 0, 4, limitMs);
      expect(fresh.found).toEqual(["gate"]);
      const stale = harness(
        { stations: [station("gate", 30, 0)], order: "fixed" },
        { fixMaxAgeMs: limitMs },
      );
      stale.fixOnly(29, 0, 4, limitMs + 1);
      expect(stale.found).toEqual([]);
      const ahead = harness(
        { stations: [station("gate", 30, 0)], order: "fixed" },
        { fixMaxAgeMs: limitMs },
      );
      ahead.fixOnly(29, 0, 4, -500);
      expect(ahead.found).toEqual(["gate"]);
    },
  );
});

// Why (plan review of the QR-votes plan, r881): the library creates the
// session's GPS data with the IDENTITY alignment at the first zero, and the
// zero is the first fix at any accuracy. So a live session is "aligned" from
// its first fix, and an aligned position used to be trusted outright: the
// raw fixes' accuracy was never read, the "GPS too weak" line could not
// show, and a ±500 m cold-start fix inside a station latched "found" - the
// very case the PR #640 guard was written for. These tests drive the real
// store, so they fail again if the library's cold start changes shape.
describe("a cold start's first fix (the library's identity alignment)", () => {
  /** A real store with its zero at the one fix it has, of `accuracyM`. */
  function coldStart(accuracyM: number) {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    store.dispatch(setZeroPos(zero));
    store.dispatch(
      recordGpsEvent({
        odomPosition: [0, 1.5, 0],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: "first",
          latitude: zero.lat,
          longitude: zero.lon,
          altitude: 400,
          latLongAccuracy: accuracyM,
          timestamp: 1_790_000_000_000,
        },
      }),
    );
    return store;
  }

  function guideOn(
    store: ReturnType<typeof coldStart>,
    stations: TourStation[],
    signals: { codeLinedUp: boolean; alignmentReady: boolean },
  ) {
    const found: string[] = [];
    const targets: (() => WayfindingTarget[])[] = [];
    const guides: (string | null)[] = [];
    const dom = {
      line: { textContent: "" as string, hidden: true },
      skip: { textContent: "" as string, hidden: true },
    };
    const guide = wireStationGuide({
      dom,
      tour: () => ({ stations, order: "fixed" }),
      placementAllowed: () => true,
      zero: () => selectZeroReference(store.getState()),
      visitor: () =>
        visitorPosition({
          alignment: selectAlignmentMatrix(store.getState()),
          arPose: { position: { x: 0, y: 1.5, z: 0 } },
          gpsPositions: selectGpsPositions(store.getState()),
          zero: selectZeroReference(store.getState()),
        }),
      codeLinedUp: () => signals.codeLinedUp,
      alignmentReady: () => signals.alignmentReady,
      startHud: (getTargets) => {
        targets.push(getTargets);
        return { dispose: () => undefined };
      },
      now: () => 1_790_000_000_000,
      onFound: (s) => found.push(s.id),
      onGuide: (v, target) =>
        guides.push(v === null || target === null ? null : target.id),
    });
    return { guide, dom, found, targets, guides };
  }

  it("the precondition: one fix makes the session aligned, with no rotation", () => {
    const store = coldStart(500);
    const alignment = selectAlignmentMatrix(store.getState());
    expect(alignment).not.toBeNull();
    // Column-major: the rotation is the identity (no heading yet), and the
    // translation only lifts the odometry to the fix's altitude.
    const m = Array.from(alignment!);
    expect(m.slice(0, 12)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect([m[12], m[14], m[15]]).toEqual([0, 0, 1]);
    const visitor = visitorPosition({
      alignment,
      arPose: { position: { x: 0, y: 1.5, z: 0 } },
      gpsPositions: selectGpsPositions(store.getState()),
      zero: selectZeroReference(store.getState()),
    });
    expect(visitor.aligned).toBe(true);
    expect(visitor.nue).not.toBeNull();
    expect(visitor.accuracyM).toBe(500);
  });

  it("a ±500 m first fix inside a 10 m station finds nothing and says the GPS is too weak, ready or not", () => {
    for (const alignmentReady of [false, true]) {
      const g = guideOn(
        coldStart(500),
        [station("gate", 3, 0, { foundRadiusM: 10 })],
        { codeLinedUp: false, alignmentReady },
      );
      g.guide.tick();
      expect(g.found).toEqual([]);
      expect(g.dom.line.textContent).toMatch(
        /GPS too weak to guide you \(±500 m\)/,
      );
    }
  });

  // Changed (r881 review H1): an alignment not yet ready used to judge
  // nothing at all. Readiness (tracking-quality `ok`) needs a walk with
  // turns, so a visitor standing at a station, or walking straight, could
  // wait for ever with no guidance. Before readiness the fresh device fix
  // stands in, judged by the raw accuracy, as before any alignment; only
  // what needs a heading (the HUD's arrows, the breadcrumbs) waits.
  it("an alignment that is not ready yet judges by the fresh raw fix: found, but no arrows and no breadcrumbs", () => {
    const store = coldStart(4);
    const signals = { codeLinedUp: false, alignmentReady: false };
    const g = guideOn(
      store,
      [station("gate", 3, 0, { foundRadiusM: 10 })],
      signals,
    );
    g.guide.tick();
    expect(g.found).toEqual(["gate"]);
    const far = guideOn(
      coldStart(4),
      [station("gate", 30, 0, { foundRadiusM: 10 })],
      { codeLinedUp: false, alignmentReady: false },
    );
    far.guide.tick();
    expect(far.found).toEqual([]);
    expect(far.dom.line.textContent).toBe("Next: GATE, 30 m");
    expect(far.targets.at(-1)?.() ?? []).toEqual([]);
    expect(far.guides.at(-1)).toBeNull();
  });

  it("a code that lined the alignment up is trusted whatever the raw fix: the courtyard tour is found at ±40 m", () => {
    // M5c review #1: a one-code courtyard tour with a ±40 m Wi-Fi fix.
    const g = guideOn(
      coldStart(40),
      [station("well", 3, 0, { foundRadiusM: 5 })],
      { codeLinedUp: true, alignmentReady: true },
    );
    g.guide.tick();
    expect(g.found).toEqual(["well"]);
    expect(g.dom.line.textContent).not.toMatch(/too weak/);
  });
});

// Why (r881 review H1): the stations' readiness is the tracking-quality
// `ok` phase or a code. `ok` needs at least ten fixes, a walk of some
// metres AND a spread of directions, so a visitor without a code who
// stands at the first station, or walks straight to it, never reaches it.
// This drives the real store and the page's own signals through such
// walks: the readiness never comes, and the fresh device fix still finds
// the station (before the review fix it was never found).
describe("a visitor without a code while tracking is not ready (real store)", () => {
  const T = 1_790_000_000_000;

  /** One fix a second along `path` (north, east m at second s), the AR
   *  pose and the fix agreeing, accuracy ±5 m; the guide ticks each
   *  second. Returns when the station was found (s), and whether the
   *  alignment was ever ready. */
  function walk(
    path: (s: number) => readonly [number, number],
    target: TourStation,
    seconds = 120,
  ) {
    // The page's own store (the tracking-quality middleware included).
    const store = createTourViewerStore();
    const ctx = { viewerLockedText: null, viewerVotedLocks: 0 };
    const signals = stationAlignmentSignals(ctx, store);
    let now = T;
    let pose = { x: 0, y: 1.5, z: 0 };
    let foundAt: number | null = null;
    let second = 0;
    let everReady = false;
    let everTargets = false;
    const hud: { targets: (() => WayfindingTarget[]) | null } = {
      targets: null,
    };
    const guide = wireStationGuide({
      dom: {
        line: { textContent: "", hidden: true },
        skip: { textContent: "", hidden: true },
      },
      tour: () => ({ stations: [target], order: "fixed" }),
      placementAllowed: () => true,
      zero: () => selectZeroReference(store.getState()),
      visitor: () =>
        visitorPosition({
          alignment: selectAlignmentMatrix(store.getState()),
          arPose: { position: pose },
          gpsPositions: selectGpsPositions(store.getState()),
          zero: selectZeroReference(store.getState()),
        }),
      ...signals,
      startHud: (getTargets) => {
        hud.targets = getTargets;
        return { dispose: () => undefined };
      },
      now: () => now,
      onFound: () => {
        foundAt ??= second;
      },
    });
    store.dispatch(setZeroPos(zero));
    for (second = 0; second <= seconds; second += 1) {
      const [n, e] = path(second);
      now = T + second * 1000;
      // WebXR: x east, y up, z south.
      pose = { x: e, y: 1.5, z: -n };
      store.dispatch(
        poseReceived({
          pose: { position: pose, orientation: { x: 0, y: 0, z: 0, w: 1 } },
          sensorOrientation: null,
        }),
      );
      const geo = calcGpsCoords(zero, [n, 0, e]);
      store.dispatch(
        recordGpsEvent({
          odomPosition: [e, 1.5, -n],
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: `fix-${String(second)}`,
            latitude: geo.lat,
            longitude: geo.lon,
            altitude: 400,
            latLongAccuracy: 5,
            timestamp: now,
          },
        }),
      );
      everReady ||= signals.alignmentReady();
      guide.tick();
      if ((hud.targets?.() ?? []).length > 0) everTargets = true;
    }
    // The report itself: "never ready" must not be "never measured".
    const report = selectTrackingQuality(store.getState());
    return { foundAt, everReady, everTargets, report };
  }

  it("standing at the sample's 5 m station: never ready, found at once on the fix", () => {
    const r = walk(() => [0, 0], station("column", 3, 0, { foundRadiusM: 5 }));
    expect(r.report).not.toBeNull();
    expect(r.everReady).toBe(false);
    expect(r.foundAt).toBe(0);
    expect(r.everTargets).toBe(false);
  });

  it("walking straight to a 5 m station 40 m away: never ready, found on arrival", () => {
    const r = walk(
      (s) => [Math.min(1.4 * s, 40), 0],
      station("column", 40, 0, { foundRadiusM: 5 }),
    );
    expect(r.report).not.toBeNull();
    expect(r.everReady).toBe(false);
    // 1.4 m/s: inside 5 m of the station from 35 m on, second 25.
    expect(r.foundAt).toBe(25);
    // No arrows on the way: they need a heading the walk never gave.
    expect(r.everTargets).toBe(false);
  });

  // Why (r881 re-review L-G): the two walks above prove "never ready" only
  // if this simulation CAN become ready. A walk round a 15 m square (turns,
  // distance, ten fixes and more) is the positive control: it reaches the
  // tracking-quality `ok` phase, and the HUD's arrows appear.
  it("the positive control: walking round a square reaches readiness, and the arrows appear", () => {
    const side = 15;
    const square = (s: number): readonly [number, number] => {
      const d = (1.4 * s) % (4 * side);
      if (d < side) return [d, 0];
      if (d < 2 * side) return [side, d - side];
      if (d < 3 * side) return [3 * side - d, side];
      return [0, 4 * side - d];
    };
    const r = walk(square, station("tower", 200, 0, { foundRadiusM: 5 }));
    expect(r.everReady).toBe(true);
    expect(r.everTargets).toBe(true);
    expect(r.foundAt).toBeNull();
  });
});

describe("review findings on the guide (r881)", () => {
  // Why (r881 review L1): the trust a code earned was dropped with the
  // camera position, so a tracking drop in a code-placed courtyard tour
  // flipped the line to "GPS too weak (±60 m)" for the visitor whose
  // position is the code's. The trust is the code's, not the frame's.
  it("a tracking drop in a code-placed session waits for the position; it never says the GPS is too weak", () => {
    const h = harness({
      stations: [station("well", 30, 0)],
      order: "fixed",
    });
    h.lined(true);
    h.at(0, 0, 60);
    expect(h.dom.line.textContent).toBe("Next: WELL, 30 m");
    h.trackingLost(0, 0, 60);
    expect(h.dom.line.textContent).toBe(
      "Next: WELL - waiting for your position…",
    );
  });

  // Why (r881 review M2): the skip clock started on the first render with
  // no distance, and a clock with no distance suggests the skip after the
  // bare allowance (2 min), so a visitor still waiting for a position was
  // told to skip. The clock starts with the first distance, sized by it.
  it("the skip clock waits for a distance: no suggestion while there is no position, then sized by the first distance", () => {
    const h = harness({
      stations: [station("tower", 300, 0)],
      order: "fixed",
    });
    h.lost();
    h.advance(skipSuggestAfterMs(null) + 1);
    h.lost();
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    h.at(0, 0);
    h.advance(skipSuggestAfterMs(null) + 1);
    h.at(0, 0);
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    h.advance(skipSuggestAfterMs(300) - skipSuggestAfterMs(null));
    h.at(0, 0);
    expect(h.dom.skip.textContent).toBe("Skip TOWER - I can't get there");
  });
});

describe("re-review findings on the guide (r881)", () => {
  const tooWeak = (m: number) => `GPS too weak to guide you (±${String(m)} m)`;

  // Why (re-review M-A): before readiness the latest fix alone is the
  // position, but it was judged by the median of the last ten fixes. One
  // ±60 m Wi-Fi fix right after a run of ±5 m GPS left the median at 5 m,
  // and that one fix could latch a station found. A lone fix is judged by
  // the worse of the median and its own accuracy.
  it("a lone weak fix after a run of good ones finds nothing and says the GPS is too weak", () => {
    const h = harness({ stations: [station("gate", 0, 0)], order: "fixed" });
    h.fixOnly(0, 0, 5, 0, 60);
    expect(h.found).toEqual([]);
    expect(h.dom.line.textContent).toContain(tooWeak(60));
    // The same on an aligned session that is not ready yet (a cold start).
    const cold = harness({
      stations: [station("gate", 0, 0)],
      order: "fixed",
    });
    cold.ready(false);
    cold.atFix(30, 0, 0, 0, 5, 60);
    expect(cold.found).toEqual([]);
    expect(cold.dom.line.textContent).toContain(tooWeak(60));
    // Its own accuracy good again: found on it.
    cold.atFix(30, 0, 0, 0, 5, 5);
    expect(cold.found).toEqual(["gate"]);
  });

  // Why (re-review M-A, the other side): once the alignment is ready the
  // position is the alignment's, fed by every fix, and one outlier fix
  // says nothing about it: the median judges, as before.
  it("a ready alignment is judged by the median, not by the latest fix's own accuracy", () => {
    const h = harness({ stations: [station("gate", 0, 0)], order: "fixed" });
    h.atFix(0, 0, 30, 0, 5, 60);
    expect(h.found).toEqual(["gate"]);
  });

  // Why (re-review L-A): a code's trust is for the position it lined up.
  // A lone raw fix (no camera position) took the code's trust too, so a
  // ±60 m fix was judged with no accuracy at all.
  it("a code's trust stays with the aligned position: a lone ±60 m fix still says the GPS is too weak", () => {
    const h = harness({ stations: [station("gate", 0, 0)], order: "fixed" });
    h.lined(true);
    h.fixOnly(0, 0, 60);
    expect(h.found).toEqual([]);
    expect(h.dom.line.textContent).toContain(tooWeak(60));
  });

  // Why (re-review L-G): before readiness the camera through the identity
  // alignment and the raw fix can lie far apart. The find must follow the
  // fix, never the headingless camera position.
  it("before readiness the find follows the fix, not the aligned camera", () => {
    const h = harness({ stations: [station("gate", 30, 0)], order: "fixed" });
    h.ready(false);
    h.atFix(30, 0, 0, 0);
    expect(h.found).toEqual([]);
    expect(h.dom.line.textContent).toBe("Next: GATE, 30 m");
    h.atFix(0, 0, 30, 0);
    expect(h.found).toEqual(["gate"]);
  });

  // Why (re-review M-C, a regression of the first fix): the replay waited
  // for a camera position, which a session that never becomes ready never
  // has. A story cut short by leaving AR then never played again, while
  // the line said "its story is playing". It replays on the same position
  // the first play was found on.
  it("a story cut short replays in a session that never becomes ready, on the fresh fix", () => {
    const h = harness({
      stations: [station("gate", 0, 0), station("well", 0, 80)],
      order: "fixed",
    });
    h.ready(false);
    h.atFix(30, 0, 0, 0);
    expect(h.found).toEqual(["gate"]);
    h.guide.endSession();
    h.atFix(30, 0, 0, 0);
    expect(h.found).toEqual(["gate", "gate"]);
    h.atFix(30, 0, 0, 0);
    expect(h.found).toEqual(["gate", "gate"]);
  });

  // Why (re-review L-B): readiness can dip (a degraded phase) and come
  // back. The arrows, the breadcrumbs and the figure's turn need a heading,
  // and the alignment keeps the one it had: they must not flicker away
  // with the dip. They wait for the first readiness of each AR entry. The
  // find re-reads readiness every tick, so in a dip it judges by the fix.
  it("a dip in readiness keeps the arrows, the breadcrumbs and the figure's turn; the find falls back to the fix", () => {
    const h = harness({ stations: [station("gate", 30, 0)], order: "fixed" });
    h.ready(false);
    h.at(0, 0);
    expect(h.huds.at(-1)!.getTargets()).toEqual([]);
    expect(h.crumbsFrom.at(-1)).toBeNull();
    expect(h.visitors).toEqual([]);
    h.ready(true);
    h.at(0, 0);
    expect(
      h.huds
        .at(-1)!
        .getTargets()
        .map((t) => t.id),
    ).toEqual(["gate"]);
    expect(h.crumbsFrom.at(-1)).toEqual([0, 401.5, 0]);
    expect(h.visitors).toHaveLength(1);
    h.ready(false);
    h.at(0, 0);
    expect(
      h.huds
        .at(-1)!
        .getTargets()
        .map((t) => t.id),
    ).toEqual(["gate"]);
    expect(h.crumbsFrom.at(-1)).toEqual([0, 401.5, 0]);
    expect(h.visitors).toHaveLength(2);
    // The find, in the dip: the camera on the spot finds nothing, the fix does.
    h.atFix(30, 0, 0, 0);
    expect(h.found).toEqual([]);
    // A new AR entry waits for its own readiness again.
    h.guide.endSession();
    h.at(0, 0);
    expect(h.huds.at(-1)!.getTargets()).toEqual([]);
    expect(h.crumbsFrom.at(-1)).toBeNull();
    expect(h.visitors).toHaveLength(3);
    h.atFix(0, 0, 30, 0);
    expect(h.found).toEqual(["gate"]);
  });

  // Why (re-review M-B): a station found on the raw fix plays its story;
  // its figure, mounted on an alignment with no heading, stood up to 180°
  // off and jumped when the heading came. The stage's pose waits for the
  // first readiness of the AR entry (the stage parks the figure and
  // retries); the caption and the voice play as before.
  it("the figure's pose waits for readiness; the station's own pose does not", () => {
    const h = harness({ stations: [station("gate", 0, 0)], order: "fixed" });
    h.ready(false);
    h.at(0, 0);
    expect(h.found).toEqual(["gate"]);
    expect(h.guide.poseOf("gate")).not.toBeNull();
    expect(h.guide.figurePoseOf("gate")).toBeNull();
    h.ready(true);
    h.at(0, 0);
    expect(h.guide.figurePoseOf("gate")).toEqual(h.guide.poseOf("gate"));
    h.ready(false);
    h.at(0, 0);
    expect(h.guide.figurePoseOf("gate")).not.toBeNull();
    h.guide.endSession();
    expect(h.guide.figurePoseOf("gate")).toBeNull();
  });

  // Why (re-review L-G): the skip clock waits for a distance (M2), so a
  // visitor who never gets a position never sees the suggestion. The
  // on-demand skip must still work in two taps, or such a visitor could
  // never get past the station.
  it("the two-tap skip works when no distance ever arrives", () => {
    const h = harness({
      stations: [station("tower", 300, 0), station("well", 0, 80)],
      order: "fixed",
    });
    h.lost();
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    h.guide.skipTapped();
    expect(h.dom.skip.textContent).toBe("Skip TOWER - I can't get there");
    h.guide.skipTapped();
    expect(h.dom.line.textContent).toMatch(/^Skipped TOWER\. Next: WELL/);
  });

  // Why (r881 third review L2): the heading latch outlived its only
  // source. Ready only because a code lined the alignment up, a veto that
  // takes the code's votes back while tracking is not `ok` leaves an
  // alignment with no heading again - the arrows and the figure must go
  // with it. A heading tracking earned stays (the dip test above).
  it("a heading that only a code gave goes when the code is lifted while tracking is not ready", () => {
    const h = harness({ stations: [station("gate", 30, 0)], order: "fixed" });
    // The page's readiness is tracking OR a code: here the code alone.
    h.ready(true);
    h.lined(true);
    h.at(0, 0);
    expect(
      h.huds
        .at(-1)!
        .getTargets()
        .map((t) => t.id),
    ).toEqual(["gate"]);
    expect(h.guide.figurePoseOf("gate")).not.toBeNull();
    h.lined(false);
    h.ready(false);
    h.at(0, 0);
    expect(h.huds.at(-1)!.getTargets()).toEqual([]);
    expect(h.crumbsFrom.at(-1)).toBeNull();
    expect(h.guide.figurePoseOf("gate")).toBeNull();
  });
});
