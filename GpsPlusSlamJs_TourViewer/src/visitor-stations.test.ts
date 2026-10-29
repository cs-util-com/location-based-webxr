import { describe, expect, it, vi } from "vitest";
import { Object3D } from "three";
import {
  reportUpdated,
  type TrackingQualityReport,
} from "gps-plus-slam-app-framework/state";

import { createTourViewerStore } from "./tour-viewer-session";
import {
  characterTapOf,
  createCallGuard,
  declaredCharactersOf,
  routeVisitorTap,
  sayFailureInToast,
  stationAlignmentSignals,
  walkDebugLines,
  walkDirectionsOf,
  wirePortraitTap,
} from "./visitor-stations";
import { createWalkDirections } from "./walk-direction";

/**
 * Why these tests matter: the station guide trusts a position and judges
 * it on the aligned frame only by these two signals, read from the page's
 * session object and the real tracking-quality slice. A wrong wire (the
 * wrong slice, a stale field) would leave the guide on the raw fix for
 * ever, or trust a GPS-only alignment like a code's.
 */

function report(state: TrackingQualityReport["state"]): TrackingQualityReport {
  return {
    state,
    confidence: state === "ok" ? 0.9 : 0.3,
    subScores: {
      convergence: 1,
      residualConsensus: 1,
      gpsAccuracy: 1,
      coverage: 1,
    },
    diagnostics: {},
  } as TrackingQualityReport;
}

describe("stationAlignmentSignals", () => {
  it("GPS only: ready exactly while the tracking-quality slice reads ok, and never code-lined-up", () => {
    const store = createTourViewerStore();
    const ctx = { viewerLockedText: null, viewerVotedLocks: 0 };
    const signals = stationAlignmentSignals(ctx, store);
    // No report yet: not ready (the guide judges by the raw fix).
    expect(signals.alignmentReady()).toBe(false);
    store.dispatch(reportUpdated(report("ok")));
    expect(signals.alignmentReady()).toBe(true);
    store.dispatch(reportUpdated(report("degraded")));
    expect(signals.alignmentReady()).toBe(false);
    store.dispatch(reportUpdated(report("warming-up")));
    expect(signals.alignmentReady()).toBe(false);
    expect(signals.codeLinedUp()).toBe(false);
  });

  it("a voted lock lines the alignment up and makes it ready whatever tracking reads; read live from the session", () => {
    const store = createTourViewerStore();
    const ctx: { viewerLockedText: string | null; viewerVotedLocks: number } = {
      viewerLockedText: null,
      viewerVotedLocks: 0,
    };
    const signals = stationAlignmentSignals(ctx, store);
    store.dispatch(reportUpdated(report("degraded")));
    ctx.viewerLockedText = "https://example.test/code";
    ctx.viewerVotedLocks = 1;
    expect(signals.codeLinedUp()).toBe(true);
    expect(signals.alignmentReady()).toBe(true);
    // A lock that cast no vote lines nothing up.
    ctx.viewerVotedLocks = 0;
    expect(signals.codeLinedUp()).toBe(false);
    expect(signals.alignmentReady()).toBe(false);
  });

  // Why: the guide decides what a lined-up code means for its latch, so
  // this signal must read the tracking slice and nothing else - neither
  // hide the report behind a lined-up code nor count a lock as ready.
  it("trackingReady reads the tracking report, not the lock state", () => {
    const store = createTourViewerStore();
    const ctx = {
      viewerLockedText: "https://example.test/code",
      viewerVotedLocks: 1,
    };
    const signals = stationAlignmentSignals(ctx, store);
    expect(signals.trackingReady()).toBe(false);
    store.dispatch(reportUpdated(report("degraded")));
    expect(signals.trackingReady()).toBe(false);
    store.dispatch(reportUpdated(report("ok")));
    expect(signals.trackingReady()).toBe(true);
    ctx.viewerVotedLocks = 0;
    expect(signals.trackingReady()).toBe(true);
  });

  // Why: the radar's north is confirmed only by the alignment's own
  // confidence (tracking, a code). The signals the guide reads must stay the
  // alignment's three: a sensor read here directly (a compass verdict) would
  // let a disturbed compass confirm a wrong north for the whole AR session.
  it("hands the guide the alignment's signals only, no sensor reading", () => {
    const ctx = { viewerLockedText: null, viewerVotedLocks: 0 };
    const store = createTourViewerStore();
    expect(Object.keys(stationAlignmentSignals(ctx, store)).sort()).toEqual([
      "alignmentReady",
      "codeLinedUp",
      "trackingReady",
    ]);
  });
});

// Why these tests matter: the AR tap on the story's character is the
// visitor's way to hear him (the prototype's rule), and it competes with
// a model's card and the pin sheet for the same tap. A tap must reach the
// story only when it hits a part of him that shows, never when nothing
// of him stands, and the order decides which target takes a tap.
describe("the visitor's tap on the story's character", () => {
  const part = (name: string): Object3D => {
    const o = new Object3D();
    o.name = name;
    return o;
  };

  it("casts the tap at his visible parts and hands a hit to the story", () => {
    const figure = part("character-front");
    const bubble = part("character-bubble");
    const stage = { characterTapTargets: vi.fn(() => [figure, bubble]) };
    const view = { characterTapped: vi.fn(() => true) };
    const seen: Object3D[][] = [];
    const pick = vi.fn((targets: ReadonlyMap<string, Object3D>) => {
      seen.push([...targets.values()]);
      return [...targets.keys()][1] ?? null;
    });
    const tapped = characterTapOf({ stage, pick, view });
    expect(tapped(null)).toBe(true);
    expect(seen).toEqual([[figure, bubble]]);
    expect(view.characterTapped).toHaveBeenCalledTimes(1);
    // A miss is not his.
    pick.mockReturnValueOnce(null);
    expect(tapped(null)).toBe(false);
    expect(view.characterTapped).toHaveBeenCalledTimes(1);
    // A hit the story does not take (no character of a story view) is
    // not his either.
    view.characterTapped.mockReturnValueOnce(false);
    expect(tapped(null)).toBe(false);
  });

  it("casts nothing while none of him stands", () => {
    const pick = vi.fn(() => "x");
    const view = { characterTapped: vi.fn(() => true) };
    const tapped = characterTapOf({
      stage: { characterTapTargets: () => [] },
      pick,
      view,
    });
    expect(tapped(null)).toBe(false);
    expect(pick).not.toHaveBeenCalled();
    expect(view.characterTapped).not.toHaveBeenCalled();
  });

  it("takes a click on his portrait in the card as a tap on him", () => {
    const portrait = new EventTarget();
    const view = { characterTapped: vi.fn(() => true) };
    wirePortraitTap(portrait, view);
    portrait.dispatchEvent(new Event("click"));
    expect(view.characterTapped).toHaveBeenCalledTimes(1);
    // A page without the portrait wires nothing and does not throw.
    expect(() => {
      wirePortraitTap(undefined, view);
    }).not.toThrow();
  });

  it("gives a tap to the character first, then a model's card, then a reading stand, then the pin sheet", () => {
    const calls: string[] = [];
    const targets = (character: boolean, model: boolean, lectern = false) => ({
      character: () => {
        calls.push("character");
        return character;
      },
      model: () => {
        calls.push("model");
        return model;
      },
      lectern: () => {
        calls.push("lectern");
        return lectern;
      },
      pinSheet: {
        close: () => calls.push("close"),
        tapped: () => calls.push("pin"),
      },
    });
    routeVisitorTap(null, targets(true, true));
    expect(calls).toEqual(["character", "close"]);
    calls.length = 0;
    routeVisitorTap(null, targets(false, true));
    expect(calls).toEqual(["character", "model", "close"]);
    calls.length = 0;
    routeVisitorTap(null, targets(false, false, true));
    // A turned page closes the pin sheet, as a model's card does.
    expect(calls).toEqual(["character", "model", "lectern", "close"]);
    calls.length = 0;
    routeVisitorTap(null, targets(false, false));
    expect(calls).toEqual(["character", "model", "lectern", "pin"]);
  });

  it("reads the tour's declared characters by id, once per manifest", () => {
    const one = {
      characters: [{ id: "kay", name: "Sir Kay", image: "knight" }],
    };
    let manifest: typeof one | null = one;
    const byId = declaredCharactersOf(() => manifest);
    const first = byId();
    expect([...first.keys()]).toEqual(["kay"]);
    expect(byId()).toBe(first);
    manifest = { characters: [] };
    expect(byId().size).toBe(0);
    manifest = null;
    expect(byId().size).toBe(0);
  });
});

describe("createCallGuard", () => {
  // Why: a story's change (its `onChange`) can fire from inside a guide
  // call - a find starts the story - and a sheet drawn then reads the
  // guide's half-made view beside a store its batch has not reached yet.
  // The render waits for the outermost call and happens once after it.
  it("defers a render asked for inside a call until the outermost call ends, once", () => {
    let renders = 0;
    const guard = createCallGuard(() => {
      renders += 1;
    });
    guard.request();
    expect(renders).toBe(1);
    guard.during(() => {
      guard.request();
      guard.during(() => {
        guard.request();
      });
      expect(renders).toBe(1);
    });
    expect(renders).toBe(2);
    guard.during(() => undefined);
    expect(renders).toBe(2);
  });

  it("still ends the call and renders when the call throws", () => {
    let renders = 0;
    const guard = createCallGuard(() => {
      renders += 1;
    });
    expect(() => {
      guard.during(() => {
        guard.request();
        throw new Error("boom");
      });
    }).toThrow("boom");
    expect(renders).toBe(1);
    guard.request();
    expect(renders).toBe(2);
  });
});

describe("walkDirectionsOf", () => {
  // Why: the peek and the rows say which way each station is only with a
  // heading and a position to point from (a code's or GPS); the angle is
  // the station's bearing from the camera's, positive to the right; and
  // the words keep their hysteresis across renders but start anew once
  // the directions lapse (a frozen radar, a lost heading).
  const view = (headingDeg: number | null) => ({
    headingDeg,
    bearings: new Map([
      ["a", 10],
      ["b", 100],
      ["c", 350],
      ["d", 190],
    ]),
  });

  it("measures each station from the camera's heading", () => {
    const m = walkDirectionsOf(view(0), "gps", createWalkDirections());
    expect([...m]).toEqual([
      ["a", { word: "ahead", angleDeg: 10 }],
      ["b", { word: "right", angleDeg: 100 }],
      ["c", { word: "ahead", angleDeg: -10 }],
      ["d", { word: "behind", angleDeg: -170 }],
    ]);
    expect(
      walkDirectionsOf(view(90), "code", createWalkDirections()).get("a"),
    ).toEqual({ word: "left", angleDeg: -80 });
  });

  it("says nothing without a heading or a position to point from", () => {
    const memory = createWalkDirections();
    expect(walkDirectionsOf(view(null), "gps", memory).size).toBe(0);
    for (const chip of ["weak", "none", "lost", "pending"] as const) {
      expect(walkDirectionsOf(view(0), chip, memory).size).toBe(0);
    }
  });

  it("holds a word by its hysteresis, and forgets it once they lapse", () => {
    const memory = createWalkDirections();
    // 30 deg: "right" from cold; held at 26 (inside the 5 deg band).
    const at = (deg: number) => ({
      headingDeg: 0,
      bearings: new Map([["a", deg]]),
    });
    expect(walkDirectionsOf(at(30), "gps", memory).get("a")?.word).toBe(
      "right",
    );
    expect(walkDirectionsOf(at(26), "gps", memory).get("a")?.word).toBe(
      "right",
    );
    walkDirectionsOf(at(26), "lost", memory);
    expect(walkDirectionsOf(at(26), "gps", memory).get("a")?.word).toBe(
      "ahead",
    );
  });
});

describe("walkDebugLines (the ?debug=1 readout)", () => {
  // Why this test matters: the radar and its frame line are the visitor
  // walk's; a creator with ?debug=1 has no radar, and two lines reading
  // "-" for ever would be dead weight in the readout the creator works by.
  const radar = { drawStats: () => ({ mean: 0.5, worst: 1, count: 3 }) };
  const frames = { summary: () => ({ mean: 16, worst: 20, count: 9 }) };

  it("a visitor's radar reads its draw and frame lines", () => {
    expect(walkDebugLines("visitor", radar, frames, 0)).toEqual([
      "radar draw: 0.50 ms mean, 1.00 ms worst (3 in 2 s)",
      "frame: 16.0 ms mean, 20.0 ms worst (9 in 2 s)",
    ]);
  });

  it("a creator, or a page without a radar, reads none", () => {
    expect(walkDebugLines("creator", radar, frames, 0)).toEqual([]);
    expect(walkDebugLines("visitor", null, frames, 0)).toEqual([]);
  });
});

describe("sayFailureInToast", () => {
  // Why this test matters: a failure the hidden panel cannot show (his
  // voice, tapped after his story) must reach the visitor: shown in the
  // walk's toast and, since the toast's root is aria-hidden, announced.
  it("shows the failure in the toast and announces it; without a toast it says nothing and does not throw", () => {
    const toast = { say: vi.fn(), announce: vi.fn() };
    sayFailureInToast(toast)("The voice could not be played here.");
    expect(toast.say).toHaveBeenCalledWith([
      "The voice could not be played here.",
    ]);
    expect(toast.announce).toHaveBeenCalledWith(
      "The voice could not be played here.",
    );
    expect(() => {
      sayFailureInToast(undefined)("x");
    }).not.toThrow();
  });
});
