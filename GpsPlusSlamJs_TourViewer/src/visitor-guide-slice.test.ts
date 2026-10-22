import { describe, expect, it } from "vitest";

import type { PositionPrecision } from "gps-plus-slam-app-framework/state/position-precision";

import { createTourViewerStore } from "./tour-viewer-session";
import type { PresenceCandidate } from "./station-presence";
import {
  guideTourChanged,
  headingPendingSet,
  presenceAfter,
  presenceCleared,
  precisionKindSet,
  presenceJudged,
  selectHeadingPending,
  selectPrecisionKind,
  selectWalkChipKind,
  selectPresentStationId,
  selectShowAllContent,
  selectStationContentShown,
  showAllContentSet,
  showAllStationsFromSearch,
  trackingLostSet,
} from "./visitor-guide-slice";

/**
 * Why these tests matter: the visitor's present station is store state
 * (root CLAUDE.md, the Redux rule; visitor plan §3 "State in Redux"): the
 * reducer applies the pure presence rule, so the page's views (M2 draws
 * per station) read one answer, and the guide dispatches only when it
 * changes. The page's own store must carry the slice.
 */

/** Precisions as the guide judges them: a code's, a GPS one's. */
const CODE: PositionPrecision = {
  source: "code",
  accuracyM: null,
  tooWeak: false,
};
function gps(accuracyM: number): PositionPrecision {
  return { source: "gps", accuracyM, tooWeak: accuracyM > 25 };
}

function at(id: string, d: number): PresenceCandidate {
  return { id, distanceM: d, foundM: 2, foundExitM: 3.5 };
}

describe("visitorGuide slice", () => {
  it("is part of the page's store, nothing present and nothing forced on at the start", () => {
    const store = createTourViewerStore();
    expect(selectPresentStationId(store.getState())).toBeNull();
    expect(selectShowAllContent(store.getState())).toBe(false);
    expect(selectHeadingPending(store.getState())).toBe(false);
  });

  // Why (D34): the status line reads whether the guide waits for a
  // heading from the store, so the flag must be set, cleared, and gone
  // with the tour.
  it("records whether the guide waits for a heading, and a new tour forgets it", () => {
    const store = createTourViewerStore();
    store.dispatch(headingPendingSet(true));
    expect(selectHeadingPending(store.getState())).toBe(true);
    store.dispatch(headingPendingSet(false));
    expect(selectHeadingPending(store.getState())).toBe(false);
    store.dispatch(headingPendingSet(true));
    store.dispatch(guideTourChanged());
    expect(selectHeadingPending(store.getState())).toBe(false);
  });

  // Why (W4 build plan M3, §1.3): the precision chip and the radar read
  // one kind from the store, each source with its one publisher - the
  // guide's judged precision, and the tracking loss from the readiness
  // phase - and the chip says the loss over any precision.
  it("records the precision kind and the tracking loss; the chip's kind is lost over any precision", () => {
    const store = createTourViewerStore();
    expect(selectPrecisionKind(store.getState())).toBe("pending");
    expect(selectWalkChipKind(store.getState())).toBe("pending");
    store.dispatch(precisionKindSet("gps"));
    expect(selectWalkChipKind(store.getState())).toBe("gps");
    store.dispatch(trackingLostSet(true));
    expect(selectPrecisionKind(store.getState())).toBe("gps");
    expect(selectWalkChipKind(store.getState())).toBe("lost");
    store.dispatch(trackingLostSet(false));
    expect(selectWalkChipKind(store.getState())).toBe("gps");
    store.dispatch(precisionKindSet("code"));
    store.dispatch(trackingLostSet(true));
    store.dispatch(guideTourChanged());
    expect(selectPrecisionKind(store.getState())).toBe("pending");
    expect(selectWalkChipKind(store.getState())).toBe("pending");
  });

  it("applies the presence rule on a judged position, with the margin of its accuracy", () => {
    const store = createTourViewerStore();
    store.dispatch(
      presenceJudged({
        candidates: [at("a", 1)],
        precision: CODE,
      }),
    );
    expect(selectPresentStationId(store.getState())).toBe("a");
    // B nearer by 1.2 m: over the 1 m floor (a code's position, null), so
    // B takes over; at a raw 4 m accuracy the margin is 4 m and A stays.
    const nearer = [at("a", 1.9), at("b", 0.7)];
    expect(
      presenceAfter(store.getState().visitorGuide, {
        candidates: nearer,
        precision: gps(4),
      }),
    ).toBe("a");
    store.dispatch(
      presenceJudged({
        candidates: nearer,
        precision: CODE,
      }),
    );
    expect(selectPresentStationId(store.getState())).toBe("b");
  });

  it("a fix too weak to guide by only ends presence, by the present station's exit and its accuracy", () => {
    // Why (PR review S1): above the accuracy ceiling nothing enters or
    // takes over, but a fix that is past the exit even by its accuracy
    // ends presence (an underpass).
    const store = createTourViewerStore();
    const weak = (candidates: PresenceCandidate[]) =>
      presenceJudged({ candidates, precision: gps(40) });
    store.dispatch(weak([at("a", 0)]));
    expect(selectPresentStationId(store.getState())).toBeNull();
    store.dispatch(
      presenceJudged({
        candidates: [at("a", 1)],
        precision: gps(3),
      }),
    );
    store.dispatch(weak([at("a", 30), at("b", 0)]));
    expect(selectPresentStationId(store.getState())).toBe("a");
    store.dispatch(weak([at("a", 60), at("b", 0)]));
    expect(selectPresentStationId(store.getState())).toBeNull();
  });

  // Why (shared position-precision plan §12, S2/S3): `tooWeak` on 'none'
  // is a fail-safe, not a GPS verdict - nothing to judge by must never end
  // or move presence the way a weak GPS fix past the exit does.
  it("holds on nothing to judge by ('none'), whatever the candidates say", () => {
    const store = createTourViewerStore();
    store.dispatch(
      presenceJudged({ candidates: [at("a", 1)], precision: gps(3) }),
    );
    const none: PositionPrecision = {
      source: "none",
      accuracyM: null,
      tooWeak: true,
    };
    store.dispatch(
      presenceJudged({
        candidates: [at("a", 60), at("b", 0)],
        precision: none,
      }),
    );
    expect(selectPresentStationId(store.getState())).toBe("a");
  });

  it("holds on no judged position and clears at the session's end", () => {
    const store = createTourViewerStore();
    store.dispatch(
      presenceJudged({
        candidates: [at("a", 1)],
        precision: gps(3),
      }),
    );
    store.dispatch(presenceJudged({ candidates: null, precision: CODE }));
    expect(selectPresentStationId(store.getState())).toBe("a");
    store.dispatch(presenceCleared());
    expect(selectPresentStationId(store.getState())).toBeNull();
  });

  it("'show all' shows every station's content; a new tour forgets it and its presence", () => {
    const store = createTourViewerStore();
    store.dispatch(
      presenceJudged({
        candidates: [at("a", 1)],
        precision: gps(3),
      }),
    );
    expect(selectStationContentShown(store.getState(), "a")).toBe(true);
    expect(selectStationContentShown(store.getState(), "b")).toBe(false);
    store.dispatch(showAllContentSet(true));
    expect(selectStationContentShown(store.getState(), "b")).toBe(true);
    store.dispatch(guideTourChanged());
    expect(selectShowAllContent(store.getState())).toBe(false);
    expect(selectPresentStationId(store.getState())).toBeNull();
    expect(selectStationContentShown(store.getState(), "a")).toBe(false);
  });
});

describe("showAllStationsFromSearch (the test switch)", () => {
  it("is on for ?allstations=1 only", () => {
    // Why this matters: a visitor link with any other value must keep the
    // one-station rule; only the exact test switch shows every station.
    expect(showAllStationsFromSearch("?allstations=1")).toBe(true);
    expect(showAllStationsFromSearch("?qr=x&allstations=1")).toBe(true);
    expect(showAllStationsFromSearch("")).toBe(false);
    expect(showAllStationsFromSearch("?allstations=true")).toBe(false);
    expect(showAllStationsFromSearch("?allstations=0")).toBe(false);
  });
});
