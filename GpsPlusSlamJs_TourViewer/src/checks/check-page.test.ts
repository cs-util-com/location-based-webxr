// @vitest-environment jsdom
import fc from "fast-check";
import { guardSlidersIn } from "gps-plus-slam-app-framework/utils/slider-scroll-guard";
import { describe, expect, it, vi } from "vitest";

import { CHECK_VIEWS, checkViewOf, startCheckPage } from "./check-page.js";
import { startThenNowCheck } from "./then-now-check.js";

// The then-now view draws with WebGL, which jsdom has not; its start is
// stood in for so the page around it can be tested.
vi.mock("./then-now-check.js", () => ({ startThenNowCheck: vi.fn() }));
vi.mock("gps-plus-slam-app-framework/utils/slider-scroll-guard", () => ({
  guardSlidersIn: vi.fn(() => () => undefined),
}));

const NAMES = Object.keys(CHECK_VIEWS);

function hosts(doc: Document): { root: HTMLElement; cardHost: HTMLElement } {
  const root = doc.createElement("div");
  const cardHost = doc.createElement("div");
  doc.body.replaceChildren(root, cardHost);
  return { root, cardHost };
}

describe("checkViewOf", () => {
  // Why: the one page serves every parity view by `?view=`; the specs open
  // each view by these names, so a renamed or lost key breaks them.
  it("knows exactly the six parity views", () => {
    expect([...NAMES].sort()).toEqual([
      "character-views",
      "lectern",
      "long-text",
      "model-views",
      "then-now",
      "travelling-box",
    ]);
  });

  it("reads the view among other query keys", () => {
    expect(checkViewOf("?view=model-views&hook=1")).toBe("model-views");
    expect(checkViewOf("?text=rich&view=long-text&ar=1")).toBe("long-text");
  });

  // Why: a missing, empty or unknown name, or one only an object's
  // prototype has, must fall to the index, never to a view or a throw.
  it("is null without a known view", () => {
    for (const search of [
      "",
      "?",
      "?view=",
      "?view=nope",
      "?view=toString",
      "?view=__proto__",
      "?look=captions",
    ]) {
      expect(checkViewOf(search)).toBeNull();
    }
  });

  it("returns a registry name or null for any query", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (key, value) => {
        const search = `?${new URLSearchParams([[key, value]]).toString()}`;
        const known = key === "view" && NAMES.includes(value);
        expect(checkViewOf(search)).toBe(known ? value : null);
      }),
    );
  });

  it("finds every registry name however it is placed in the query", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NAMES),
        fc.array(
          fc.tuple(
            fc.string().filter((k) => k !== "view"),
            fc.string(),
          ),
        ),
        fc.nat(),
        (name, others, at) => {
          const pairs: [string, string][] = [...others];
          pairs.splice(at % (pairs.length + 1), 0, ["view", name]);
          const search = `?${new URLSearchParams(pairs).toString()}`;
          expect(checkViewOf(search)).toBe(name);
        },
      ),
    );
  });
});

describe("startCheckPage", () => {
  // Why: a person who opens the bare page must be able to pick a view, and
  // the index must start no scene.
  it("lists every view as a link without a known view", async () => {
    const page = hosts(document);
    await expect(
      startCheckPage(document, "?view=nope", page),
    ).resolves.toBeNull();
    const { root } = page;
    const links = [...root.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toEqual(NAMES.map((name) => `?view=${name}`));
    expect(document.title).toBe("Check pages");
    expect(document.body.dataset["view"]).toBeUndefined();
  });

  // Why: a view whose module fails must surface as a rejection (a page
  // error the specs see), not as a page that silently stays blank.
  it("rejects when the view's start fails", async () => {
    const own = document.implementation.createHTMLDocument("x");
    const { root, cardHost } = hosts(own);
    const view = CHECK_VIEWS.lectern as { start: unknown };
    const start = view.start;
    view.start = () => Promise.reject(new Error("no scene"));
    try {
      await expect(
        startCheckPage(own, "?view=lectern", { root, cardHost }),
      ).rejects.toThrow("no scene");
      expect(own.body.dataset["view"]).toBe("lectern");
      expect(own.title).toBe("Reading stand check");
    } finally {
      view.start = start;
    }
  });

  // Why: the then-now view builds a range input (the Swipe line), and a
  // vertical swipe that starts on a slider must scroll, not move it, on
  // every page with one; the page-wide guard is what does that.
  it("guards the then-now view's slider before it starts", async () => {
    const own = document.implementation.createHTMLDocument("x");
    const page = hosts(own);
    await expect(startCheckPage(own, "?view=then-now", page)).resolves.toBe(
      "then-now",
    );
    expect(guardSlidersIn).toHaveBeenCalledWith(own);
    expect(startThenNowCheck).toHaveBeenCalledWith(page.root, page.cardHost);
  });
});
