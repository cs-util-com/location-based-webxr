import { describe, expect, it } from "vitest";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";
import type { PrecisionGpsPoint } from "gps-plus-slam-app-framework/state/position-precision";

import {
  SKIP_UNDO_MS,
  skipActionOf,
  wireStationGuide,
  type StationTour,
} from "./station-guide";
import { createTourViewerStore } from "./tour-viewer-session";
import { selectHeadingPending } from "./visitor-guide-slice";
import type { VisitorPosition } from "./visitor-position";
import { WALK_NO_GUESS_HOLD_MS } from "./walk-no-guess";

/**
 * Why these tests matter (visitor walk W4 build plan 2026-10-21-1105, M4,
 * §1.9 R-0 to R-5): the walk's rules as the guide applies them. With no
 * distance shown nothing may show one (R-0) and an any-order tour may not
 * guess a station (R-2): the old guide named "nearest: <title>" by a
 * position nobody vouched for, laid a trail to it and put distance labels
 * on the HUD under too-weak GPS. "Can't get there?" opens the list; a
 * skipped station comes back at any time (R-3); the visitor may choose a
 * target (R-4); a story can always be ended (R-5).
 */

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };
const step = {
  id: "s",
  block: { kind: "text", text: "Hi" },
  advance: { mode: "tap" },
} as const;

function station(id: string, north: number, east: number): TourStation {
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
  };
}

const fixes = (accuracyM: number | null): PrecisionGpsPoint[] =>
  accuracyM === null ? [] : [{ latLongAccuracy: accuracyM }];

/** Three stations: the well nearest (30 m), the gate (50 m), the tower. */
const ANY: StationTour = {
  stations: [
    station("gate", 50, 0),
    station("well", 0, 30),
    station("tower", -80, 0),
  ],
  order: "any",
};

function harness(tour: StationTour, options: { end?: boolean } = {}) {
  let now = 1_000;
  const lined = false;
  let playing: string | null = null;
  let visitor: VisitorPosition = {
    nue: [0, 401.5, 0],
    gpsPoints: fixes(4),
    fixNue: [0, 400, 0],
    aligned: true,
    fixAtMs: now,
    fixAccuracyM: 4,
  };
  const store = createTourViewerStore();
  const huds: { getTargets: () => WayfindingTarget[]; disposed: boolean }[] =
    [];
  const crumbs: (string | null)[] = [];
  const faced: number[] = [];
  const dones: string[] = [];
  const undones: string[] = [];
  const found: string[] = [];
  const dom = {
    line: { textContent: "", hidden: true },
    skip: { textContent: "", hidden: true, dataset: {} as DOMStringMap },
    ...(options.end === true
      ? {
          end: {
            textContent: "",
            hidden: true,
            dataset: {} as DOMStringMap,
          },
        }
      : {}),
  };
  let tick = 0;
  const guide = wireStationGuide({
    dom,
    tour: () => tour,
    placementAllowed: () => true,
    zero: () => zero,
    visitor: () => visitor,
    codeLinedUp: () => lined,
    alignmentReady: () => true,
    trackingReady: () => !lined,
    startHud: (getTargets) => {
      const h = { getTargets, disposed: false };
      huds.push(h);
      return { dispose: () => (h.disposed = true) };
    },
    now: () => now,
    guideStore: store,
    walkStore: store,
    storyPlaying: () => playing,
    onFound: (s) => {
      found.push(s.id);
      playing ??= s.id;
    },
    onDone: (id) => dones.push(id),
    onUndone: (id) => undones.push(id),
    onEndStory: (id) => {
      if (playing === id) playing = null;
      guide.storyEnded(id);
    },
    onVisitor: () => faced.push(tick),
    onGuide: (from, target) =>
      crumbs.push(target === null || from === null ? null : target.id),
  });
  const walk = () => store.getState().visitorWalk;
  const place = (
    north: number,
    east: number,
    accuracyM: number | null,
  ): void => {
    visitor = {
      nue: [north, 401.5, east],
      gpsPoints: fixes(accuracyM),
      fixNue: accuracyM === null ? null : [north, 400, east],
      aligned: true,
      fixAtMs: now,
      fixAccuracyM: accuracyM,
    };
    tick += 1;
    guide.tick();
  };
  return {
    guide,
    dom,
    store,
    walk,
    huds,
    crumbs,
    faced,
    dones,
    undones,
    found,
    /** A GPS position at this accuracy (above 25 m: too weak). */
    at: (north: number, east: number, accuracyM = 4) =>
      place(north, east, accuracyM),
    /** An aligned position nothing vouches for (`'none'`: no code holds
     *  it and no fix states an accuracy, as after a frame change). */
    unvouched: (north: number, east: number) => place(north, east, null),
    advance: (ms: number) => (now += ms),
    view: () => guide.view()!,
    targets: () =>
      huds
        .at(-1)
        ?.getTargets()
        .map((t) => t.id ?? "?") ?? [],
    tapQuick: () => guide.skipTapped(dom.skip),
    tapEnd: () => guide.skipTapped(dom.end),
    endStory: (id: string) => {
      if (playing === id) playing = null;
      guide.storyEnded(id);
    },
  };
}

describe("R-0 and R-2: no distance shown, nothing shows one, and no station is guessed", () => {
  it("too-weak GPS: no HUD targets, no 'nearest', no trail, no focus - and the guess back after the hold", () => {
    const h = harness(ANY);
    h.at(0, 0);
    expect(h.targets()).toEqual(["gate", "well", "tower"]);
    expect(h.view().focusId).toBe("well");
    h.at(0, 0, 40);
    expect(h.targets()).toEqual([]);
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - GPS too weak to guide you (±40 m); step into the open.",
    );
    expect(h.view().focusId).toBeNull();
    expect(h.view().noGuess).toBe(true);
    expect(h.crumbs.at(-1)).toBeNull();
    // The distance back: no guess until it held for the hold.
    h.at(0, 0);
    expect(h.view().focusId).toBeNull();
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - waiting for a steady position…",
    );
    h.advance(WALK_NO_GUESS_HOLD_MS - 1);
    h.at(0, 0);
    expect(h.view().focusId).toBeNull();
    h.advance(1);
    h.at(0, 0);
    expect(h.view().focusId).toBe("well");
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - nearest: WELL, 30 m",
    );
    expect(h.crumbs.at(-1)).toBe("well");
  });

  it("'none': no station named, the quick action names none, and the figure holds its turn", () => {
    const h = harness(ANY);
    h.at(0, 0);
    const turnsBefore = h.faced.length;
    h.unvouched(0, 0);
    expect(h.view().focusId).toBeNull();
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - scan one of the tour's codes so the guide knows where you are.",
    );
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    expect(skipActionOf(h.dom.skip)).toEqual({ kind: "ask-skip", id: null });
    expect(h.faced.length).toBe(turnsBefore);
    expect(h.targets()).toEqual([]);
  });

  it("fixed order keeps its station and its skip under too-weak GPS (W-D3 is any order only)", () => {
    const h = harness({ stations: ANY.stations, order: "fixed" });
    h.at(0, 0, 40);
    expect(h.view().focusId).toBe("gate");
    expect(h.dom.line.textContent).toBe(
      "Next: GATE - GPS too weak to guide you (±40 m); step into the open.",
    );
    expect(h.targets()).toEqual([]);
  });
});

describe("R-2's taps: the list opens, armed or to choose", () => {
  it("outside R-2 'Can't get there?' arms the focus's row; its confirm is the second tap", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.tapQuick();
    expect(h.walk()).toMatchObject({ sheet: "list", rowArmedId: "well" });
    expect(h.dom.skip.textContent).toBe("Skip WELL - I can't get there");
    h.guide.rowTapped("well", "confirm");
    expect(h.walk().progress?.stations[1]).toMatchObject({ skipped: true });
    expect(h.walk().rowArmedId).toBeNull();
  });

  it("in R-2 it opens the chooser: a row's Skip acts on one tap; outside it, a row asks first", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("tower", "skip");
    expect(h.walk().rowArmedId).toBe("tower");
    expect(h.walk().progress?.stations[2]?.skipped).toBe(false);
    h.guide.rowTapped("tower", "cancel");
    h.unvouched(0, 0);
    h.tapQuick();
    expect(h.walk()).toMatchObject({ sheet: "list", chooser: true });
    expect(h.view().chooser).toBe(true);
    h.guide.rowTapped("tower", "skip");
    expect(h.walk().progress?.stations[2]?.skipped).toBe(true);
    expect(h.walk().chooser).toBe(false);
  });

  it("an armed row survives a degradation into R-2, and its confirm still applies", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("gate", "skip");
    h.unvouched(0, 0);
    expect(h.walk().rowArmedId).toBe("gate");
    h.guide.rowTapped("gate", "confirm");
    expect(h.walk().progress?.stations[0]?.skipped).toBe(true);
  });

  // Why: a row's Skip is for a station still to find; a found station's
  // story is ended on its card (R-5). Skipped, a found station could be
  // brought back as unfound - its find undone - so a tap that names one,
  // in chooser mode or not, changes nothing.
  it("a found station is never skipped or armed from a row", () => {
    const h = harness({
      stations: [station("here", 0, 0), ...ANY.stations],
      order: "any",
    });
    h.at(0, 0);
    expect(h.found).toEqual(["here"]);
    h.guide.rowTapped("here", "skip");
    expect(h.walk().rowArmedId).toBeNull();
    h.unvouched(0, 0);
    h.tapQuick();
    expect(h.walk().chooser).toBe(true);
    h.guide.rowTapped("here", "skip");
    h.guide.rowTapped("here", "confirm");
    expect(h.walk().progress?.stations[0]).toMatchObject({
      state: "found",
      skipped: false,
    });
  });

  it("a story ending clears the end's ask, never a row's arm", () => {
    const h = harness(
      {
        stations: [station("here", 0, 0), ...ANY.stations],
        order: "any",
      },
      { end: true },
    );
    h.at(0, 0);
    expect(h.found).toEqual(["here"]);
    h.guide.rowTapped("gate", "skip");
    h.tapEnd();
    expect(h.walk().quickArmedId).toBe("here");
    // The story ends elsewhere: its ask goes; the row stays armed.
    h.endStory("here");
    h.at(0, 0);
    expect(h.walk().quickArmedId).toBeNull();
    expect(h.walk().rowArmedId).toBe("gate");
  });
});

describe("R-3: a skipped station comes back at any time", () => {
  // Why (§1.9 R-3): the old guide overwrote the last
  // skip on a second one inside its 6 s window without settling it, so
  // the first never reached the prefetch as done.
  it("a second skip inside the first's window settles the first", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("gate", "skip");
    h.guide.rowTapped("gate", "confirm");
    expect(h.dones).toEqual([]);
    h.guide.rowTapped("tower", "skip");
    h.guide.rowTapped("tower", "confirm");
    expect(h.dones).toEqual(["gate"]);
    expect(h.view().undo?.id).toBe("tower");
  });

  it("brought back inside the window: an undo, the prefetch never heard; after it: the prefetch hears it", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("gate", "skip");
    h.guide.rowTapped("gate", "confirm");
    h.guide.rowTapped("gate", "bring");
    expect(h.undones).toEqual([]);
    expect(h.dones).toEqual([]);
    h.guide.rowTapped("gate", "skip");
    h.guide.rowTapped("gate", "confirm");
    h.advance(SKIP_UNDO_MS);
    h.at(0, 0);
    expect(h.dones).toEqual(["gate"]);
    expect(h.view().undo).toBeNull();
    h.guide.rowTapped("gate", "bring");
    expect(h.undones).toEqual(["gate"]);
    expect(h.dom.line.textContent).toMatch(/^Brought back GATE\. /);
  });

  it("a complete tour brought back is incomplete everywhere, and complete again once skipped", () => {
    const tour: StationTour = {
      stations: [station("gate", 50, 0), station("well", 0, 30)],
      order: "any",
    };
    const h = harness(tour);
    h.at(0, 0);
    h.guide.rowTapped("gate", "skip");
    h.guide.rowTapped("gate", "confirm");
    h.guide.rowTapped("well", "skip");
    h.guide.rowTapped("well", "confirm");
    h.advance(SKIP_UNDO_MS);
    h.at(0, 0);
    expect(h.dom.line.textContent).toBe("Tour complete - 2 skipped.");
    expect(h.huds.at(-1)?.disposed).toBe(true);
    h.guide.rowTapped("gate", "bring");
    h.at(0, 0);
    expect(h.dom.line.textContent).toMatch(/Next: GATE, 50 m$/);
    expect(h.huds.at(-1)?.disposed).toBe(false);
    expect(h.walk().completionSeen).toBe(false);
    expect(selectHeadingPending(h.store.getState())).toBe(false);
    h.guide.rowTapped("gate", "skip");
    h.guide.rowTapped("gate", "confirm");
    expect(h.dom.line.textContent).toBe("Tour complete - 2 skipped.");
  });
});

describe("R-4: choose a target", () => {
  it("the chosen station is the focus, whatever the precision, until it is found", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("tower", "choose");
    expect(h.view().focusId).toBe("tower");
    expect(h.view().chosenId).toBe("tower");
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - your choice: TOWER, 80 m",
    );
    // The trail follows the choice (R-1: the breadcrumbs read the focus).
    expect(h.crumbs.at(-1)).toBe("tower");
    h.at(0, 0, 40);
    expect(h.view().focusId).toBe("tower");
    // Nothing vouches for the position: the line still names the chosen
    // station, as the peek does (it said only "3 stations to find").
    h.unvouched(0, 0);
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - your choice: TOWER - scan one of the tour's codes so the guide knows where you are.",
    );
    // Tapped again: the choice goes.
    h.guide.rowTapped("tower", "choose");
    expect(h.view().chosenId).toBeNull();
    h.guide.rowTapped("tower", "choose");
    h.at(-80, 0);
    expect(h.found).toEqual(["tower"]);
    expect(h.walk().chosenId).toBeNull();
  });

  it("is not offered under fixed order", () => {
    const h = harness({ stations: ANY.stations, order: "fixed" });
    h.at(0, 0);
    h.guide.rowTapped("tower", "choose");
    expect(h.walk().chosenId).toBeNull();
    expect(h.view().canChoose).toBe(false);
  });
});

describe("R-5: 'End this story?' on the story card whenever a story plays", () => {
  it("with stations still to find, the card's control asks, confirms, and 'Keep listening' takes it back", () => {
    const h = harness(
      { stations: [station("here", 0, 0), ...ANY.stations], order: "any" },
      { end: true },
    );
    h.at(0, 0);
    expect(h.dom.end?.textContent).toBe("End this story?");
    expect(h.dom.skip.textContent).toBe("Can't get there?");
    h.tapEnd();
    expect(h.dom.end?.textContent).toBe("End the story of HERE now");
    h.guide.cancelAsk();
    expect(h.dom.end?.textContent).toBe("End this story?");
    h.tapEnd();
    h.tapEnd();
    expect(h.walk().progress?.stations[0]?.state).toBe("done");
    expect(h.dom.end?.hidden).toBe(true);
  });
});
