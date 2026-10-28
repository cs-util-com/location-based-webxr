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
import { selectHeadingPending, trackingLostSet } from "./visitor-guide-slice";
import type { VisitorPosition } from "./visitor-position";
import type { WalkFocusCue } from "./walk-focus-cues";
import { WALK_NO_GUESS_HOLD_MS } from "./walk-no-guess";

/**
 * Why these tests matter: the walk's rules as the guide applies them. With no
 * distance shown nothing may show one and an any-order tour may not
 * guess a station: the old guide named "nearest: <title>" by a
 * position nobody vouched for, laid a trail to it and put distance labels
 * on the HUD under too-weak GPS. "Can't get there?" opens the list; a
 * skipped station comes back at any time; the visitor may choose a
 * target; a story can always be ended.
 */

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };
const step = {
  id: "s",
  action: { kind: "show", block: "hi" },
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
    blocks: [],
  };
}

const fixes = (accuracyM: number | null): PrecisionGpsPoint[] =>
  accuracyM === null ? [] : [{ latLongAccuracy: accuracyM }];

/** Three stations: the well nearest (30 m), the gate (50 m), the tower. */
const ANY: StationTour = {
  assets: new Set(),
  stations: [
    station("gate", 50, 0),
    station("well", 0, 30),
    station("tower", -80, 0),
  ],
  order: "any",
};

function harness(tour: StationTour, options: { end?: boolean } = {}) {
  let now = 1_000;
  let lined = false;
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
  const huds: {
    getTargets: () => WayfindingTarget[];
    focusId: (() => string | null) | undefined;
    disposed: boolean;
  }[] = [];
  const cues: (WalkFocusCue | null)[] = [];
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
    startHud: (getTargets, focusId) => {
      const h = { getTargets, focusId, disposed: false };
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
    onFocusCue: (cue) => cues.push(cue),
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
    cues,
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
    /** Whether a code holds the alignment (its precision is a code's). */
    lined: (v: boolean) => (lined = v),
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

describe("no distance shown: nothing shows one, and no station is guessed", () => {
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

  // Why: a code session drops its pose for under a second now and then.
  // With the hold, every drop withheld the guess for 3 s after it; a
  // code's distance does not flicker around a ceiling, so its return
  // names the station again at once (walk-no-guess.sweep.test.ts).
  it("a code's distance coming back after a drop names the station again at once", () => {
    const h = harness(ANY);
    h.lined(true);
    h.unvouched(0, 0);
    expect(h.view().focusId).toBe("well");
    expect(h.store.getState().visitorGuide.precisionKind).toBe("code");
    // The pose drops: nothing vouches for the position.
    h.lined(false);
    h.advance(300);
    h.unvouched(0, 0);
    expect(h.view().focusId).toBeNull();
    h.lined(true);
    h.advance(300);
    h.unvouched(0, 0);
    expect(h.view().focusId).toBe("well");
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - nearest: WELL, 30 m",
    );
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

  // Why: "nearest" claims a distance that ranked the stations. With one
  // station left to find (a found station's story still playing beside
  // it) the guide names it without a distance as the one left, never as
  // the nearest by a position nobody vouches for.
  it("one station left to find and no distance: the line says 'Next', not 'nearest'", () => {
    const h = harness({
      assets: new Set(),
      stations: [station("here", 0, 0), station("well", 0, 30)],
      order: "any",
    });
    h.at(0, 0);
    expect(h.found).toEqual(["here"]);
    expect(h.dom.line.textContent).toBe(
      "2 stations to find - nearest: WELL, 30 m",
    );
    h.unvouched(0, 0);
    expect(h.view().focusId).toBe("well");
    expect(h.dom.line.textContent).toBe(
      "Next: WELL - scan one of the tour's codes so the guide knows where you are.",
    );
    h.at(0, 0, 40);
    expect(h.dom.line.textContent).toBe(
      "Next: WELL - GPS too weak to guide you (±40 m); step into the open.",
    );
  });

  it("fixed order keeps its station and its skip under too-weak GPS (the no-guess rule is any order only)", () => {
    const h = harness({
      assets: new Set(),
      stations: ANY.stations,
      order: "fixed",
    });
    h.at(0, 0, 40);
    expect(h.view().focusId).toBe("gate");
    expect(h.dom.line.textContent).toBe(
      "Next: GATE - GPS too weak to guide you (±40 m); step into the open.",
    );
    expect(h.targets()).toEqual([]);
  });
});

describe("'Can't get there?' opens the list, armed or to choose", () => {
  it("with a station guessed 'Can't get there?' arms the focus's row; its confirm is the second tap", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.tapQuick();
    expect(h.walk()).toMatchObject({ sheet: "list", rowArmedId: "well" });
    expect(h.dom.skip.textContent).toBe("Skip WELL - I can't get there");
    h.guide.rowTapped("well", "confirm");
    expect(h.walk().progress?.stations[1]).toMatchObject({ skipped: true });
    expect(h.walk().rowArmedId).toBeNull();
  });

  it("with no station guessed it opens the chooser: a row's Skip acts on one tap; outside it, a row asks first", () => {
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

  it("an armed row survives the position degrading until no station is guessed, and its confirm still applies", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("gate", "skip");
    h.unvouched(0, 0);
    expect(h.walk().rowArmedId).toBe("gate");
    h.guide.rowTapped("gate", "confirm");
    expect(h.walk().progress?.stations[0]?.skipped).toBe(true);
  });

  // Why: a row's Skip is for a station still to find; a found station's
  // story is ended on its card. Skipped, a found station could be
  // brought back as unfound - its find undone - so a tap that names one,
  // in chooser mode or not, changes nothing.
  it("a found station is never skipped or armed from a row", () => {
    const h = harness({
      assets: new Set(),
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
        assets: new Set(),
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

describe("the focus in the scene", () => {
  // Why: the HUD marks the focus in its own look and the scene stands a
  // beacon and a ring at it; both must follow the guide's focus - the
  // nearest, or the chosen station - and the beacon and the ring must go
  // whenever no station is guessed or no distance is shown, as every
  // other distance cue does (a beacon is a claim of where to walk).
  it("hands the HUD the guide's focus as it is now", () => {
    const h = harness(ANY);
    h.at(0, 0);
    const focusNow = h.huds.at(-1)!.focusId!;
    expect(focusNow()).toBe("well");
    h.guide.rowTapped("tower", "choose");
    expect(focusNow()).toBe("tower");
    h.unvouched(0, 0);
    h.guide.rowTapped("tower", "choose");
    expect(focusNow()).toBeNull();
  });

  // Why: the HUD marks the nearest five; a target the visitor chose
  // farther off must still have its marker, or the one station the walk
  // guides to is the one the HUD does not show.
  it("keeps a chosen target farther than the nearest five among the HUD's targets", () => {
    const near = [1, 2, 3, 4, 5, 6].map((i) =>
      station(`n${String(i)}`, 10 * i, 0),
    );
    const h = harness({
      assets: new Set(),
      stations: [...near, station("far", 300, 0)],
      order: "any",
    });
    h.at(0, 0);
    const ids = () =>
      h.huds
        .at(-1)!
        .getTargets()
        .map((t) => t.id);
    expect(ids()).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    h.guide.rowTapped("far", "choose");
    h.at(0, 0);
    expect(ids()).toEqual(["n1", "n2", "n3", "n4", "far"]);
  });

  it("puts the cue at the focus with its found radius and distance, and takes it away without a guess or a distance", () => {
    const h = harness(ANY);
    h.at(0, 0);
    expect(h.cues.at(-1)).toMatchObject({
      id: "well",
      eye: [0, 401.5, 0],
      foundM: 5,
    });
    const cue = h.cues.at(-1)!;
    expect(cue.at[0]).toBeCloseTo(0, 1);
    expect(cue.at[2]).toBeCloseTo(30, 1);
    expect(cue.distanceM).toBeCloseTo(30, 1);
    h.guide.rowTapped("gate", "choose");
    expect(h.cues.at(-1)?.id).toBe("gate");
    h.guide.rowTapped("gate", "choose");
    // Too weak: no distance is shown, no beacon either (fixed order too).
    h.at(0, 0, 40);
    expect(h.cues.at(-1)).toBeNull();
    h.unvouched(0, 0);
    expect(h.cues.at(-1)).toBeNull();
    const fixed = harness({
      assets: new Set(),
      stations: ANY.stations,
      order: "fixed",
    });
    fixed.at(0, 0);
    expect(fixed.cues.at(-1)?.id).toBe("gate");
    fixed.at(0, 0, 40);
    expect(fixed.cues.at(-1)).toBeNull();
    // The session's end takes it away.
    fixed.at(0, 0);
    fixed.guide.endSession();
    expect(fixed.cues.at(-1)).toBeNull();
  });
});

describe("while tracking is lost", () => {
  // Why: with tracking lost the guide cannot tell where the visitor
  // is; a skip then would be made blind, so the quick action and a row's
  // Skip and confirm are not offered and a tap that still arrives changes
  // nothing. What takes a skip back stays: the undo and Bring back.
  it("hides the quick action and refuses a row's Skip and confirm; the undo and Bring back stay", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("gate", "skip");
    h.store.dispatch(trackingLostSet(true));
    h.at(0, 0);
    expect(h.view().trackingLost).toBe(true);
    expect(h.dom.skip.hidden).toBe(true);
    expect(skipActionOf(h.dom.skip)).toBeNull();
    h.guide.skipTapped({ dataset: { action: "ask-skip" } });
    expect(h.walk().sheet).toBe("peek");
    h.guide.rowTapped("gate", "confirm");
    h.guide.rowTapped("tower", "skip");
    expect(h.walk().progress?.stations.some((s) => s.skipped)).toBe(false);
    expect(h.walk().rowArmedId).toBe("gate");
    // Back: the armed row's confirm applies again.
    h.store.dispatch(trackingLostSet(false));
    h.at(0, 0);
    expect(h.dom.skip.hidden).toBe(false);
    h.guide.rowTapped("gate", "confirm");
    expect(h.walk().progress?.stations[0]?.skipped).toBe(true);
    // Lost again inside the undo's window: the undo stays and acts.
    h.store.dispatch(trackingLostSet(true));
    h.at(0, 0);
    expect(skipActionOf(h.dom.skip)).toEqual({ kind: "undo", id: "gate" });
    h.tapQuick();
    expect(h.walk().progress?.stations[0]?.skipped).toBe(false);
    // ... and Bring back after it.
    h.store.dispatch(trackingLostSet(false));
    h.at(0, 0);
    h.guide.rowTapped("gate", "skip");
    h.guide.rowTapped("gate", "confirm");
    h.advance(SKIP_UNDO_MS);
    h.store.dispatch(trackingLostSet(true));
    h.at(0, 0);
    h.guide.rowTapped("gate", "bring");
    expect(h.walk().progress?.stations[0]?.skipped).toBe(false);
  });
});

describe("a skipped station comes back at any time", () => {
  // Why: the old guide overwrote the last
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
      assets: new Set(),
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

describe("choosing a target", () => {
  it("the chosen station is the focus, whatever the precision, until it is found", () => {
    const h = harness(ANY);
    h.at(0, 0);
    h.guide.rowTapped("tower", "choose");
    expect(h.view().focusId).toBe("tower");
    expect(h.view().chosenId).toBe("tower");
    expect(h.dom.line.textContent).toBe(
      "3 stations to find - your choice: TOWER, 80 m",
    );
    // The trail follows the choice (the focus rule: the breadcrumbs read the focus).
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
    const h = harness({
      assets: new Set(),
      stations: ANY.stations,
      order: "fixed",
    });
    h.at(0, 0);
    h.guide.rowTapped("tower", "choose");
    expect(h.walk().chosenId).toBeNull();
    expect(h.view().canChoose).toBe(false);
  });
});

describe("'End this story?' on the story card whenever a story plays", () => {
  it("with stations still to find, the card's control asks, confirms, and 'Keep listening' takes it back", () => {
    const h = harness(
      {
        assets: new Set(),
        stations: [station("here", 0, 0), ...ANY.stations],
        order: "any",
      },
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

describe("being there at a station, and finishing the tour", () => {
  // Why these tests matter: a station is done when its story ends, which
  // moves the order on, but the visitor still stands among its content.
  // While its presence holds the peek says so ("At station N - take your
  // time") with the next station as its second line, instead of jumping
  // on. The tour finishes - the completion card, the list opening - only
  // once every station is done and the visitor left the last one, or
  // tapped "Finish the tour".
  const FIXED: StationTour = {
    assets: new Set(),
    stations: [station("gate", 0, 0), station("well", 0, 60)],
    order: "fixed",
  };

  it("at a done station the view and the line say the visitor is there, the next station second", () => {
    const h = harness(FIXED, { end: true });
    h.at(0, 0);
    h.endStory("gate");
    h.at(0, 0);
    expect(h.view().there).toEqual({ id: "gate", tail: "Next: WELL, 60 m" });
    expect(h.dom.line.textContent).toBe(
      "At station 1 - take your time: GATE. Next: WELL, 60 m",
    );
    // The quick action still serves the next station.
    expect(h.view().quick).toEqual({ kind: "ask-skip", id: "well" });
    // Walked away: the walk's own line again.
    h.at(0, 30);
    expect(h.view().there).toBeNull();
    expect(h.dom.line.textContent).toBe("Next: WELL, 30 m");
  });

  it("the last story's end completes the tour, which waits there; leaving the station finishes it", () => {
    const h = harness(FIXED, { end: true });
    h.at(0, 0);
    h.endStory("gate");
    h.at(0, 60);
    h.endStory("well");
    h.at(0, 60);
    const p = () => h.walk().progress!;
    expect(p().finished).toBe(false);
    expect(h.walk().sheet).toBe("peek");
    expect(h.view().there).toEqual({
      id: "well",
      tail: "Every station is done.",
    });
    expect(h.view().quick).toEqual({ kind: "finish-tour", id: "well" });
    expect(h.dom.skip.textContent).toBe("Finish the tour");
    expect(h.dom.skip.dataset["action"]).toBe("finish-tour");
    // Still there: it waits.
    h.at(0, 61);
    expect(p().finished).toBe(false);
    h.at(0, 0);
    expect(p().finished).toBe(true);
    expect(h.walk().sheet).toBe("list");
    expect(h.view().there).toBeNull();
    expect(h.dom.line.textContent).toMatch(/^Tour complete/);
  });

  it("'Finish the tour' finishes it where the visitor stands", () => {
    const h = harness(FIXED, { end: true });
    h.at(0, 0);
    h.endStory("gate");
    h.at(0, 60);
    h.endStory("well");
    h.at(0, 60);
    h.tapQuick();
    expect(h.walk().progress?.finished).toBe(true);
    expect(h.walk().sheet).toBe("list");
    expect(
      skipActionOf({ dataset: { action: "finish-tour", station: "well" } }),
    ).toEqual({
      kind: "finish-tour",
      id: "well",
    });
  });

  it("a position nobody can judge holds the wait; the next judged one away from the station finishes it", () => {
    const h = harness(FIXED, { end: true });
    h.at(0, 0);
    h.endStory("gate");
    h.at(0, 60);
    h.endStory("well");
    h.at(0, 60);
    h.guide.endSession();
    // The next AR entry, no position judged yet: nothing finishes.
    h.unvouched(0, 0);
    expect(h.walk().progress?.finished).toBe(false);
    h.at(0, 0);
    expect(h.walk().progress?.finished).toBe(true);
  });

  it("a skipped last station finishes the tour at once: it is never entered", () => {
    const h = harness(FIXED, { end: true });
    h.at(0, 0);
    h.endStory("gate");
    h.at(0, 0);
    h.guide.rowTapped("well", "skip");
    h.guide.rowTapped("well", "confirm");
    expect(h.walk().progress?.finished).toBe(true);
    expect(h.view().there).toBeNull();
  });
});

describe("leaving the last station is judged by its own distance, not by presence", () => {
  // Why these tests matter: presence is one station at a time with
  // hysteresis, so where the last station's circle overlaps the previous
  // station's exit band (the editor's stations: no steps, a 25 m circle),
  // a visitor arriving at the last station is still present at the
  // previous one. Reading "not present at the last station" as "left it"
  // finished the tour on ARRIVAL. The tour finishes only once the last
  // station's own distance is beyond its found exit; a fix too weak to
  // guide by only once even its accuracy nearer is still beyond.
  function stepless(id: string, north: number, east: number): TourStation {
    return {
      ...station(id, north, east),
      activateRadiusM: 50,
      foundRadiusM: 25,
      steps: [],
    };
  }
  const pair = (spacingM: number): StationTour => ({
    assets: new Set(),
    stations: [stepless("a", 0, 0), stepless("b", 0, spacingM)],
    order: "fixed",
  });

  it("walking from A to B 40 m apart does not finish the tour; walking on beyond B's exit does", () => {
    const h = harness(pair(40));
    const finished = () => h.walk().progress?.finished;
    h.at(0, 0);
    // B's circle reached at 15 m: B found and done, the tour complete.
    h.at(0, 15);
    expect(h.walk().progress?.finishWaitId).toBe("b");
    expect(finished()).toBe(false);
    // Still nearer A than B by less than the margin: A's content shows,
    // and the line names the station whose content the visitor sees.
    expect(h.store.getState().visitorGuide.presentStationId).toBe("a");
    expect(h.dom.line.textContent).toBe(
      "At station 1 - take your time: A. Every station is done.",
    );
    expect(h.dom.skip.textContent).toBe("Finish the tour");
    for (let east = 15.5; east <= 40; east += 0.5) {
      h.at(0, east);
      expect(finished()).toBe(false);
    }
    expect(h.store.getState().visitorGuide.presentStationId).toBe("b");
    expect(h.dom.line.textContent).toBe(
      "At station 2 - take your time: B. Every station is done.",
    );
    // B's found exit at ±4 m: 25 + 4 = 29 m.
    h.at(0, 40 + 29);
    expect(finished()).toBe(false);
    h.at(0, 40 + 29.5);
    expect(finished()).toBe(true);
  });

  it("a too-weak fix at the last station on the next AR entry does not finish the tour", () => {
    const h = harness(pair(40));
    h.at(0, 0);
    h.at(0, 40);
    expect(h.walk().progress?.finishWaitId).toBe("b");
    h.guide.endSession();
    // The next AR entry, presence cleared, a ±40 m fix at the station.
    h.at(0, 40, 40);
    h.at(0, 40, 40);
    expect(h.walk().progress?.finished).toBe(false);
    // The weak fix's exit is clamped at the 25 m ceiling: 25 + 25 = 50 m,
    // left only once even 40 m nearer is beyond it.
    h.at(0, 40 + 90, 40);
    expect(h.walk().progress?.finished).toBe(false);
    h.at(0, 40 + 90.5, 40);
    expect(h.walk().progress?.finished).toBe(true);
  });

  it("a too-weak fix at the last station after its code went does not finish the tour", () => {
    const h = harness(pair(40));
    h.lined(true);
    h.unvouched(0, 0);
    h.unvouched(0, 40);
    expect(h.walk().progress?.finishWaitId).toBe("b");
    expect(h.store.getState().visitorGuide.presentStationId).toBe("b");
    // The code is vetoed: only a ±40 m fix is left, at the same spot.
    h.lined(false);
    h.at(0, 40, 40);
    h.at(0, 40, 40);
    h.at(0, 40, 40);
    expect(h.walk().progress?.finished).toBe(false);
  });

  // The sweep: spacings around the overlap (the old rule failed up to about
  // 50 m plus the accuracy) and three precisions. Each cell walks A to B in
  // 0.5 m steps (never finishing), stands at B (the line names B), then
  // walks on (finishing at the first step beyond B's found exit).
  const precisions = [
    { name: "code-held", accuracyM: null, exitM: 25 + 1.5 },
    { name: "GPS ±6 m", accuracyM: 6, exitM: 25 + 6 },
    { name: "GPS ±15 m", accuracyM: 15, exitM: 25 + 15 },
  ] as const;
  const cells = [30, 40, 50, 60, 80].flatMap((spacingM) =>
    precisions.map((p) => ({ spacingM, ...p })),
  );
  it.each(cells)(
    "$spacingM m apart, $name: no finish on the way to B, B named at B, finished just beyond B's exit",
    ({ spacingM, accuracyM, exitM }) => {
      const h = harness(pair(spacingM));
      h.lined(accuracyM === null);
      const go = (east: number) =>
        accuracyM === null ? h.unvouched(0, east) : h.at(0, east, accuracyM);
      const finished = () => h.walk().progress?.finished;
      for (let east = 0; east <= spacingM; east += 0.5) {
        go(east);
        expect(finished(), `finished at ${String(east)} m`).toBe(false);
      }
      expect(h.walk().progress?.finishWaitId).toBe("b");
      expect(h.view().there?.id).toBe("b");
      expect(h.dom.line.textContent).toMatch(/^At station 2 - /);
      for (let d = 0.5; d <= exitM; d += 0.5) {
        go(spacingM + d);
        expect(finished(), `finished ${String(d)} m beyond B`).toBe(false);
      }
      go(spacingM + exitM + 0.5);
      expect(finished()).toBe(true);
    },
  );
});
