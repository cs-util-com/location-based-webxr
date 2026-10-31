import { describe, expect, it } from "vitest";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  bodyHasPictures,
  loadVisitorPrefs,
  preferredView,
  saveVisitorPrefs,
  shownMember,
  shownView,
  storeVisitorChoice,
  VISITOR_PREFS_KEY,
  viewNeedsFail,
  viewSetOf,
  withPreferredView,
} from "./visitor-prefs.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

function longText(view: string, body = "Plain words."): TourBlock {
  return {
    id: "t",
    kind: "longText",
    view,
    title: "The gate",
    body,
    pose: POSE,
  } as TourBlock;
}

const WITH_PICTURE = "Before.\n\n![The gate](asset:gate)\n\nAfter.";

describe("the view sets", () => {
  // Why this test matters: the switch offers exactly a set, and a view in
  // no set (the story's `card`) must never be swapped (design §2.4, §3.2).
  it("puts reading, lectern and captions in one world set, with reading as its floor", () => {
    expect(viewSetOf("longText", "lectern")).toEqual({
      kind: "longText",
      placement: "world",
      members: ["reading", "lectern", "captions"],
      floor: "reading",
    });
    expect(viewSetOf("longText", "card")).toBeNull();
    expect(viewSetOf("shortText", "pin")).toBeNull();
    expect(viewSetOf("picture", "plane")).toBeNull();
  });
});

describe("a view's needs", () => {
  // Why this test matters: the lectern shows the plain text only, so a
  // body with a picture anywhere (a list item, a quote included) would
  // lose it there (design §3.2: "shows no pictures").
  it("fails the lectern for a body with a picture at any depth", () => {
    expect(bodyHasPictures("Just words.")).toBe(false);
    expect(bodyHasPictures(WITH_PICTURE)).toBe(true);
    expect(bodyHasPictures("- one\n\n  ![x](asset:a)")).toBe(true);
    expect(bodyHasPictures("> ![x](asset:a)")).toBe(true);
    // An inline picture is not a picture block: it shows its alt text.
    expect(bodyHasPictures("Look ![x](asset:a) here.")).toBe(false);
    expect(viewNeedsFail(longText("reading", WITH_PICTURE), "lectern")).toBe(
      "shows no pictures",
    );
    expect(viewNeedsFail(longText("reading", WITH_PICTURE), "reading")).toBe(
      null,
    );
    expect(viewNeedsFail(longText("reading"), "lectern")).toBe(null);
  });
});

describe("the captions' needs", () => {
  const narrated = (timing?: string): TourBlock =>
    ({
      ...longText("reading"),
      narration: {
        audio: "voice",
        synthetic: false,
        ...(timing === undefined ? {} : { timing }),
      },
    }) as TourBlock;

  // Why this test matters: captions follow the voice by its read-along
  // timing, so a text without one, or whose timing was found stale, must
  // never show the strip; and since the timing is read only when its text
  // opens, a verdict not known yet must count as holding, or captions
  // could never be chosen before a first visit read it.
  it("needs a timing that is not found stale", () => {
    expect(viewNeedsFail(longText("reading"), "captions")).toBe(
      "needs a timing",
    );
    expect(viewNeedsFail(narrated(), "captions")).toBe("needs a timing");
    const timed = narrated("timing/t.json");
    expect(viewNeedsFail(timed, "captions")).toBe(null);
    for (const v of ["unread", "pending", "live"] as const) {
      expect(viewNeedsFail(timed, "captions", v)).toBe(null);
    }
    expect(viewNeedsFail(timed, "captions", "stale")).toBe("needs a timing");
    // The verdict concerns captions only.
    expect(viewNeedsFail(timed, "reading", "stale")).toBe(null);
  });

  // Why this test matters: a visitor who chose captions sees them on a
  // text whose timing holds, and the creator's view on one whose timing
  // is stale (rules 3-4), never an empty strip.
  it("shows captions where chosen and the timing holds, else the creator's view", () => {
    const stored = withPreferredView(null, "longText", "world", "captions");
    const block = narrated("timing/t.json");
    expect(shownView({ audience: "visitor", block, stored })).toBe("captions");
    expect(
      shownView({ audience: "visitor", block, stored, verdict: "live" }),
    ).toBe("captions");
    expect(
      shownView({ audience: "visitor", block, stored, verdict: "stale" }),
    ).toBe("reading");
    expect(
      shownView({ audience: "visitor", block: longText("lectern"), stored }),
    ).toBe("lectern");
    expect(shownView({ audience: "creator", block, stored })).toBe("reading");
  });
});

describe("the stored preference, read defensively", () => {
  // Why this test matters: another version of the app may share this
  // device's storage; anything this one cannot use is ignored, never an
  // error (design §4 "Read defensively").
  it("ignores every value that is not a member of the set", () => {
    for (const stored of [
      null,
      undefined,
      3,
      "lectern",
      [],
      { views: "lectern" },
      { views: { longText: "lectern" } },
      { views: { longText: { world: 7 } } },
      { views: { longText: { world: "silent" } } },
      { views: { longText: { world: "card" } } },
      { views: { longText: { world: "toString" } } },
      { views: { longText: { screen: "lectern" } } },
    ]) {
      expect(preferredView(stored, "longText", "world")).toBeNull();
    }
    expect(
      preferredView(
        { views: { longText: { world: "lectern" } } },
        "longText",
        "world",
      ),
    ).toBe("lectern");
    expect(
      preferredView(
        { views: { picture: { world: "lectern" } } },
        "picture",
        "world",
      ),
    ).toBeNull();
  });

  // Why this test matters: a newer app's keys (a kind, a placement, the
  // video choices) must survive this app's write, not be deleted by it.
  it("keeps every other key when a choice is set or cleared", () => {
    const stored = {
      views: {
        longText: { world: "reading", screen: "captions" },
        picture: { world: "framed" },
      },
      videoSound: "on",
      future: { x: 1 },
    };
    const before = structuredClone(stored);
    const chosen = withPreferredView(stored, "longText", "world", "lectern");
    expect(chosen).toEqual({
      ...before,
      views: {
        ...before.views,
        longText: { world: "lectern", screen: "captions" },
      },
    });
    expect(stored).toEqual(before);
    const cleared = withPreferredView(chosen, "longText", "world", null);
    expect(cleared).toEqual({
      ...before,
      views: { ...before.views, longText: { screen: "captions" } },
    });
    // From nothing usable: a fresh value.
    expect(withPreferredView("junk", "longText", "world", "lectern")).toEqual({
      views: { longText: { world: "lectern" } },
    });
  });
});

describe("which view shows", () => {
  const prefer = (view: string) => ({ views: { longText: { world: view } } });

  // Why this test matters: the creator places and checks THEIR view; a
  // visitor's preference must never show in the creator's own session
  // (design §4 rule 1).
  it("shows the creator's view to the creator, whatever is stored", () => {
    expect(
      shownView({
        audience: "creator",
        block: longText("reading"),
        stored: prefer("lectern"),
      }),
    ).toBe("reading");
  });

  // Why this test matters: rules 2-5 of design §4, each by one example.
  it("follows the five rules for a visitor", () => {
    const visitor = (block: TourBlock, stored: unknown) =>
      shownView({ audience: "visitor", block, stored });
    // 2: a view in no set is the creator's.
    expect(visitor(longText("card"), prefer("lectern"))).toBe("card");
    // 3: the preference, when its needs hold.
    expect(visitor(longText("reading"), prefer("lectern"))).toBe("lectern");
    expect(visitor(longText("lectern"), prefer("reading"))).toBe("reading");
    // 4: else the creator's view.
    expect(visitor(longText("reading", WITH_PICTURE), prefer("lectern"))).toBe(
      "reading",
    );
    expect(visitor(longText("lectern"), null)).toBe("lectern");
    // 5: else the set's floor.
    expect(visitor(longText("lectern", WITH_PICTURE), null)).toBe("reading");
    expect(visitor(longText("lectern", WITH_PICTURE), prefer("lectern"))).toBe(
      "reading",
    );
  });
});

describe("the preference on the device", () => {
  function memory(): {
    items: Map<string, string>;
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
  } {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    };
  }

  // Why this test matters: one versioned key, written whole and read back
  // as the same value (across tours, the e2e's job in the browser).
  it("round-trips under its one key", () => {
    const storage = memory();
    const value = { views: { longText: { world: "lectern" } } };
    expect(saveVisitorPrefs(storage, value)).toBe(true);
    expect(storage.items.has(VISITOR_PREFS_KEY)).toBe(true);
    expect(loadVisitorPrefs(storage)).toEqual(value);
  });

  // Why this test matters: blocked storage (a private window, site data
  // off) throws; the choice must then last the visit, never break the
  // page (design §4 "Where"; the plan's acceptance).
  it("survives a storage that throws, saying the choice was not kept", () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadVisitorPrefs(throwing)).toBeNull();
    expect(
      saveVisitorPrefs(throwing, { views: { longText: { world: "lectern" } } }),
    ).toBe(false);
    expect(loadVisitorPrefs(undefined)).toBeNull();
    expect(saveVisitorPrefs(undefined, {})).toBe(false);
  });

  // Why this test matters: an unreadable value is ignored, not an error.
  it("reads garbage as nothing", () => {
    const storage = memory();
    storage.items.set(VISITOR_PREFS_KEY, "{not json");
    expect(loadVisitorPrefs(storage)).toBeNull();
    storage.items.set(VISITOR_PREFS_KEY, "[1,2]");
    expect(loadVisitorPrefs(storage)).toEqual([1, 2]);
    expect(preferredView([1, 2], "longText", "world")).toBeNull();
  });
});

describe("the creator's view as the second choice (rule 4)", () => {
  // Why this test matters: with the long text's two-member set the
  // creator's view and the floor coincide whenever rule 4 decides, so
  // nothing there can tell "the creator's view" from "the floor". A
  // three-member set, made for this test, can: a mutant that shows the
  // floor when the preferred view fails must fail here.
  it("shows the creator's view, not the floor, when the preferred view fails", () => {
    const shown = (preferred: string | null, failing: readonly string[]) =>
      shownMember({
        creator: "b",
        preferred,
        floor: "a",
        fails: (view) => failing.includes(view),
      });
    expect(shown("c", []), "rule 3: the preference").toBe("c");
    expect(shown("c", ["c"]), "rule 4: the creator's view").toBe("b");
    expect(shown(null, []), "no preference: the creator's view").toBe("b");
    expect(shown("c", ["c", "b"]), "rule 5: the floor").toBe("a");
    expect(shown(null, ["b"]), "rule 5 without a preference").toBe("a");
  });
});

describe("a choice stored on the device", () => {
  function memory(initial?: unknown): {
    items: Map<string, string>;
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
  } {
    const items = new Map<string, string>();
    if (initial !== undefined) {
      items.set(VISITOR_PREFS_KEY, JSON.stringify(initial));
    }
    return {
      items,
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    };
  }

  // Why this test matters: the page reads the device once, at its start.
  // A choice written from that old snapshot would delete every key
  // another tab (a newer version of the app) wrote since; design §4 keeps
  // keys this app does not know. The choice is merged into a fresh read.
  it("merges into a fresh read, keeping a key another tab wrote since the start", () => {
    const storage = memory({ views: {} });
    const atStart = loadVisitorPrefs(storage);
    storage.setItem(
      VISITOR_PREFS_KEY,
      JSON.stringify({ views: {}, captions: { size: "large" } }),
    );
    const { value, kept } = storeVisitorChoice(
      storage,
      atStart,
      "longText",
      "world",
      "lectern",
    );
    expect(kept).toBe(true);
    const expected = {
      views: { longText: { world: "lectern" } },
      captions: { size: "large" },
    };
    expect(value).toEqual(expected);
    expect(loadVisitorPrefs(storage)).toEqual(expected);
  });

  // Why this test matters: a storage that cannot be read gives nothing
  // fresh; the store's value (with this visit's earlier choices) is then
  // the base, and the device does not keep the new choice.
  it("builds on the store's value when the device cannot be read", () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: (): void => {
        throw new Error("SecurityError");
      },
    };
    const inStore = { views: { picture: { world: "framed" } } };
    const { value, kept } = storeVisitorChoice(
      blocked,
      inStore,
      "longText",
      "world",
      "lectern",
    );
    expect(kept).toBe(false);
    expect(value).toEqual({
      views: { picture: { world: "framed" }, longText: { world: "lectern" } },
    });
    const none = storeVisitorChoice(undefined, null, "longText", "world", null);
    expect(none.kept).toBe(false);
    expect(preferredView(none.value, "longText", "world")).toBeNull();
  });
});
