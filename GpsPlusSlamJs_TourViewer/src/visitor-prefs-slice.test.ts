import { describe, expect, it } from "vitest";

import { createTourViewerStore } from "./tour-viewer-session.js";
import { guideTourChanged } from "./visitor-guide-slice.js";
import {
  selectVisitorPrefs,
  visitorPrefsLoaded,
  visitorViewChosen,
} from "./visitor-prefs-slice.js";
import { preferredView } from "./visitor-prefs.js";

describe("the visitor's preference in the page's store", () => {
  // Why this test matters: the store holds the value read from the device
  // and every choice after it; the renderer and the switch read it there.
  it("starts empty, takes the device's value, and sets and clears a choice", () => {
    const store = createTourViewerStore();
    expect(selectVisitorPrefs(store.getState())).toBeNull();
    const fromDevice = { views: { picture: { world: "framed" } }, x: 1 };
    store.dispatch(visitorPrefsLoaded(fromDevice));
    store.dispatch(
      visitorViewChosen({
        kind: "longText",
        placement: "world",
        view: "lectern",
      }),
    );
    const chosen = selectVisitorPrefs(store.getState());
    expect(preferredView(chosen, "longText", "world")).toBe("lectern");
    // Another app version's keys survive the choice.
    expect(chosen).toMatchObject(fromDevice);
    store.dispatch(
      visitorViewChosen({ kind: "longText", placement: "world", view: null }),
    );
    expect(
      preferredView(selectVisitorPrefs(store.getState()), "longText", "world"),
    ).toBeNull();
    expect(selectVisitorPrefs(store.getState())).toMatchObject(fromDevice);
  });

  // Why this test matters: the preference is per device across every tour
  // (design §4); opening another tour in the same page resets the
  // guide, and must not reset the choice.
  it("keeps the choice when another tour opens", () => {
    const store = createTourViewerStore();
    store.dispatch(
      visitorViewChosen({
        kind: "longText",
        placement: "world",
        view: "lectern",
      }),
    );
    store.dispatch(guideTourChanged());
    expect(
      preferredView(selectVisitorPrefs(store.getState()), "longText", "world"),
    ).toBe("lectern");
  });
});
