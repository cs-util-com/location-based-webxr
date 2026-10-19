import { describe, expect, it } from "vitest";

import { createTourViewerStore } from "./tour-viewer-session";
import type { PresenceCandidate } from "./station-presence";
import {
  guideTourChanged,
  headingPendingSet,
  presenceAfter,
  presenceCleared,
  presenceJudged,
  selectHeadingPending,
  selectPresentStationId,
  selectShowAllContent,
  selectStationContentShown,
  showAllContentSet,
} from "./visitor-guide-slice";

/**
 * Why these tests matter: the visitor's present station is store state
 * (root CLAUDE.md, the Redux rule; visitor plan §3 "State in Redux"): the
 * reducer applies the pure presence rule, so the page's views (M2 draws
 * per station) read one answer, and the guide dispatches only when it
 * changes. The page's own store must carry the slice.
 */

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

  it("applies the presence rule on a judged position, with the margin of its accuracy", () => {
    const store = createTourViewerStore();
    store.dispatch(
      presenceJudged({ candidates: [at("a", 1)], accuracyM: null }),
    );
    expect(selectPresentStationId(store.getState())).toBe("a");
    // B nearer by 1.2 m: over the 1 m floor (a code's position, null), so
    // B takes over; at a raw 4 m accuracy the margin is 4 m and A stays.
    const nearer = [at("a", 1.9), at("b", 0.7)];
    expect(
      presenceAfter(store.getState().visitorGuide, {
        candidates: nearer,
        accuracyM: 4,
      }),
    ).toBe("a");
    store.dispatch(presenceJudged({ candidates: nearer, accuracyM: null }));
    expect(selectPresentStationId(store.getState())).toBe("b");
  });

  it("holds on no judged position and clears at the session's end", () => {
    const store = createTourViewerStore();
    store.dispatch(presenceJudged({ candidates: [at("a", 1)], accuracyM: 3 }));
    store.dispatch(presenceJudged({ candidates: null, accuracyM: null }));
    expect(selectPresentStationId(store.getState())).toBe("a");
    store.dispatch(presenceCleared());
    expect(selectPresentStationId(store.getState())).toBeNull();
  });

  it("'show all' shows every station's content; a new tour forgets it and its presence", () => {
    const store = createTourViewerStore();
    store.dispatch(presenceJudged({ candidates: [at("a", 1)], accuracyM: 3 }));
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
