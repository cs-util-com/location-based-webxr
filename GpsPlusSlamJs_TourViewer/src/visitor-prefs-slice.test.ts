import { describe, expect, it } from "vitest";

import { createTourViewerStore } from "./tour-viewer-session.js";
import { guideTourChanged } from "./visitor-guide-slice.js";
import {
  selectTrackerCaptureForceOn,
  selectVisitorPrefs,
  visitorPrefsLoaded,
  type VisitorPrefsState,
} from "./visitor-prefs-slice.js";
import {
  preferredView,
  storeVisitorChoice,
  VISITOR_PREFS_KEY,
  type PrefsStorage,
} from "./visitor-prefs.js";

/** A device storage held in memory. */
function memoryStorage(initial: unknown): PrefsStorage {
  const items = new Map<string, string>([
    [VISITOR_PREFS_KEY, JSON.stringify(initial)],
  ]);
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** What a choice needs of the page store. */
type Store = {
  getState(): { readonly visitorPrefs: VisitorPrefsState };
  dispatch(action: ReturnType<typeof visitorPrefsLoaded>): unknown;
};

/** A choice the way the page makes it: merged into a fresh read of the
 *  device, saved, and the merged value dispatched. */
function choose(
  store: Store,
  storage: PrefsStorage | undefined,
  view: string | null,
): void {
  const { value } = storeVisitorChoice(
    storage,
    selectVisitorPrefs(store.getState()),
    "longText",
    "world",
    view,
  );
  store.dispatch(visitorPrefsLoaded(value));
}

describe("the visitor's preference in the page's store", () => {
  // Why this test matters: the store holds the value read from the device
  // and every choice after it; the renderer and the switch read it there.
  it("starts empty, takes the device's value, and sets and clears a choice", () => {
    const store = createTourViewerStore();
    expect(selectVisitorPrefs(store.getState())).toBeNull();
    const fromDevice = { views: { picture: { world: "framed" } }, x: 1 };
    const storage = memoryStorage(fromDevice);
    store.dispatch(visitorPrefsLoaded(fromDevice));
    choose(store, storage, "lectern");
    const chosen = selectVisitorPrefs(store.getState());
    expect(preferredView(chosen, "longText", "world")).toBe("lectern");
    // Another app version's keys survive the choice.
    expect(chosen).toMatchObject(fromDevice);
    choose(store, storage, null);
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
    choose(store, undefined, "lectern");
    store.dispatch(guideTourChanged());
    expect(
      preferredView(selectVisitorPrefs(store.getState()), "longText", "world"),
    ).toBe("lectern");
  });
});

describe("the tracker capture force-on setting", () => {
  // Why this test matters: the setting keeps QR at full cadence all
  // session; a stored value of another shape must not switch it on.
  it("is on only for a stored true", () => {
    const store = createTourViewerStore();
    expect(selectTrackerCaptureForceOn(store.getState())).toBe(false);
    for (const [stored, on] of [
      [{ trackerCaptureForceOn: true }, true],
      [{ trackerCaptureForceOn: "true" }, false],
      [{ trackerCaptureForceOn: 1 }, false],
      [[true], false],
      ["x", false],
      [{ views: {} }, false],
    ] as const) {
      store.dispatch(visitorPrefsLoaded(stored));
      expect(selectTrackerCaptureForceOn(store.getState())).toBe(on);
    }
  });
});
