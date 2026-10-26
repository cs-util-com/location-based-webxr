/**
 * Why these tests matter: a device that used the setup before opens at
 * the setup, every other load opens at the top. The page decides this in
 * a classic inline script before its first paint (a module would run after
 * the landing was already shown, and the jump would be seen), so the rule
 * exists twice: here and in `index.html`'s `#landing-skip`. These tests
 * hold the copy to the rule; if the two disagreed, the page would skip for
 * one device and not for another for no visible reason. A reload must
 * never skip: the browser restores where the creator was (the wizard is
 * reloaded mid-setup on purpose).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { HOST_KEY } from "../tour-host.js";
import { WIZARD_LAST_URL_KEY } from "../wizard.js";
import {
  holdLandingSkip,
  RETURNING_KEYS,
  reassertLandingSkip,
  skipsLanding,
} from "./landing-skip.js";

const base = {
  mode: "creator",
  stored: ["dropbox", null],
  hash: "",
  navigationType: "navigate",
} as const;

describe("skipsLanding", () => {
  it("skips for a returning creator on a plain navigation", () => {
    expect(skipsLanding(base)).toBe(true);
    expect(
      skipsLanding({ ...base, stored: [null, "https://x.test/t.zip"] }),
    ).toBe(true);
  });

  it("opens at the top for a first visit, and after a deselected tile", () => {
    expect(skipsLanding({ ...base, stored: [null, null] })).toBe(false);
    expect(skipsLanding({ ...base, stored: ["", null] })).toBe(false);
    expect(skipsLanding({ ...base, stored: [] })).toBe(false);
  });

  it("leaves a reload and back/forward to the browser's own restoration", () => {
    expect(skipsLanding({ ...base, navigationType: "reload" })).toBe(false);
    expect(skipsLanding({ ...base, navigationType: "back_forward" })).toBe(
      false,
    );
    expect(skipsLanding({ ...base, navigationType: undefined })).toBe(false);
  });

  it("follows a hash, and never skips for a visitor", () => {
    expect(skipsLanding({ ...base, hash: "#have-tour" })).toBe(false);
    expect(skipsLanding({ ...base, mode: "visitor" })).toBe(false);
    expect(skipsLanding({ ...base, mode: undefined })).toBe(false);
  });
});

describe("the landing-skip script in index.html", () => {
  const packageRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");
  const match = /<script id="landing-skip">([\s\S]*?)<\/script>/.exec(html);
  const stageAt = html.indexOf('<div id="setup-stage"');
  const stageEnd = html.indexOf("<!-- /setup-stage -->");

  it("runs right after the stage's markup, before anything below it", () => {
    expect(match).not.toBeNull();
    expect(stageAt).toBeGreaterThan(0);
    expect(stageEnd).toBeGreaterThan(stageAt);
    const scriptAt = html.indexOf('<script id="landing-skip">');
    expect(scriptAt).toBeGreaterThan(stageEnd);
    // Nothing but white space between the stage's end and the script.
    expect(
      html.slice(stageEnd + "<!-- /setup-stage -->".length, scriptAt).trim(),
    ).toBe("");
  });

  interface Run {
    scrolled: ScrollIntoViewOptions[];
    /** The stand-in stage, its `tabIndex` as the script left it. */
    stage: { tabIndex: number };
    focused: (FocusOptions | undefined)[];
    /** `document.documentElement.dataset` after the script. */
    mark: Record<string, string>;
    /** Fires a page event the script listens for. */
    fire(type: string): void;
  }

  /** Runs the inline script against a stand-in page; what it scrolled. */
  function runInline(input: {
    mode: string | undefined;
    stored: Readonly<Record<string, string | null>>;
    hash: string;
    navigationType: string | undefined;
    storageThrows?: boolean;
  }): Run {
    const scrolled: ScrollIntoViewOptions[] = [];
    const focused: (FocusOptions | undefined)[] = [];
    const stage = {
      tabIndex: 0,
      scrollIntoView: (options: ScrollIntoViewOptions) => {
        scrolled.push(options);
      },
      focus: (options?: FocusOptions) => {
        focused.push(options);
      },
    };
    const mark: Record<string, string> = {};
    const listeners = new Map<string, (() => void)[]>();
    const document = {
      body: { dataset: { mode: input.mode } },
      documentElement: { dataset: mark },
      getElementById: (id: string) => (id === "setup-stage" ? stage : null),
      addEventListener: (type: string, fn: () => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
    };
    const localStorage = {
      getItem: (key: string) => {
        if (input.storageThrows === true) throw new Error("blocked");
        return input.stored[key] ?? null;
      },
    };
    const performance = {
      getEntriesByType: (type: string) =>
        type === "navigation" && input.navigationType !== undefined
          ? [{ type: input.navigationType }]
          : [],
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(
      "document",
      "location",
      "localStorage",
      "performance",
      match?.[1] ?? "",
    ) as (...args: unknown[]) => void;
    run(document, { hash: input.hash }, localStorage, performance);
    return {
      scrolled,
      mark,
      stage,
      focused,
      fire: (type) => {
        for (const fn of listeners.get(type) ?? []) fn();
      },
    };
  }

  it("scrolls the stage to the top, instantly, for a returning device", () => {
    const { scrolled } = runInline({
      mode: "creator",
      stored: { "tour-viewer.wizard.host": "dropbox" },
      hash: "",
      navigationType: "navigate",
    });
    expect(scrolled).toEqual([{ block: "start", behavior: "instant" }]);
  });

  // The page's own scripts reveal the stage's parts and mount the
  // landing's pictures after this ran; the stage is put back at the top
  // then (reassertLandingSkip), but only until the reader moves the page.
  it("marks the page as skipped, and as moved on the reader's first input", () => {
    for (const input of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      const run = runInline({
        mode: "creator",
        stored: { "tour-viewer.wizard.last-url": "https://x.test/t.zip" },
        hash: "",
        navigationType: "navigate",
      });
      expect(run.mark["landingSkip"]).toBe("applied");
      run.fire(input);
      expect(run.mark["landingSkip"]).toBe("moved");
    }
    const first = runInline({
      mode: "creator",
      stored: {},
      hash: "",
      navigationType: "navigate",
    });
    expect(first.mark["landingSkip"]).toBeUndefined();
  });

  // The skip moved the view to the setup; a keyboard reader's first Tab
  // must continue from there, not from the top of the landing (which
  // would scroll the page back and undo the skip). Focus moves without a
  // scroll of its own, and only when the page skipped.
  it("moves the sequential focus start point to the stage with the skip", () => {
    const run = runInline({
      mode: "creator",
      stored: { "tour-viewer.wizard.host": "dropbox" },
      hash: "",
      navigationType: "navigate",
    });
    expect(run.stage.tabIndex).toBe(-1);
    expect(run.focused).toEqual([{ preventScroll: true }]);
    const first = runInline({
      mode: "creator",
      stored: {},
      hash: "",
      navigationType: "navigate",
    });
    expect(first.focused).toEqual([]);
    expect(first.stage.tabIndex).toBe(0);
  });

  // The inline copy types the keys out (a classic script cannot import);
  // the module takes them from their owners, so a renamed key in either
  // owner would be caught here instead of silently disabling the skip.
  it("reads the same keys the setup writes", () => {
    expect(RETURNING_KEYS).toEqual([HOST_KEY, WIZARD_LAST_URL_KEY]);
    const listed = /\[\s*("[^"]+"),\s*("[^"]+"),?\s*\]\.some/.exec(
      match?.[1] ?? "",
    );
    expect(listed?.slice(1).map((key) => JSON.parse(key) as string)).toEqual([
      ...RETURNING_KEYS,
    ]);
  });

  // On a document that arrives in several network chunks the browser may
  // paint the landing before the parser reaches the skip, and the jump
  // would be seen; the head holds the first paint until the script is
  // parsed.
  it("holds the first paint until the skip script is parsed", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(
      /<link\s+rel="expect"\s+href="#landing-skip"\s+blocking="render"\s*\/?>/,
    );
  });

  it("opens at the top where site data is blocked", () => {
    const { scrolled } = runInline({
      mode: "creator",
      stored: {},
      hash: "",
      navigationType: "navigate",
      storageThrows: true,
    });
    expect(scrolled).toEqual([]);
  });

  it(
    "agrees with skipsLanding on any input (property)",
    { timeout: 30_000 },
    () => {
      const value = fc.option(
        fc.oneof(fc.constant(""), fc.constant("own"), fc.string()),
        { nil: null },
      );
      fc.assert(
        fc.property(
          fc.option(fc.constantFrom("creator", "visitor", ""), {
            nil: undefined,
          }),
          value,
          value,
          fc.constantFrom("", "#have-tour", "#x"),
          fc.option(
            fc.constantFrom("navigate", "reload", "back_forward", "prerender"),
            { nil: undefined },
          ),
          (mode, host, last, hash, navigationType) => {
            const [hostKey, lastKey] = RETURNING_KEYS;
            const { scrolled } = runInline({
              mode,
              stored: { [hostKey]: host, [lastKey]: last },
              hash,
              navigationType,
            });
            expect(scrolled.length === 1).toBe(
              skipsLanding({
                mode,
                stored: [host, last],
                hash,
                navigationType,
              }),
            );
          },
        ),
      );
    },
  );
});

describe("reassertLandingSkip", () => {
  function page(mark: string | undefined) {
    const scrolled: ScrollIntoViewOptions[] = [];
    const doc = {
      documentElement: {
        dataset: mark === undefined ? {} : { landingSkip: mark },
      },
      getElementById: (id: string) =>
        id === "setup-stage"
          ? {
              scrollIntoView: (options: ScrollIntoViewOptions) => {
                scrolled.push(options);
              },
            }
          : null,
    };
    return { doc: doc as unknown as Document, scrolled };
  }

  it("puts the stage back at the top while the skip holds", () => {
    const { doc, scrolled } = page("applied");
    reassertLandingSkip(doc);
    expect(scrolled).toEqual([{ block: "start", behavior: "instant" }]);
  });

  it("leaves the page alone once the reader moved it, or without a skip", () => {
    for (const mark of ["moved", undefined]) {
      const { doc, scrolled } = page(mark);
      reassertLandingSkip(doc);
      expect(scrolled).toEqual([]);
    }
  });
});

describe("holdLandingSkip", () => {
  /** A ResizeObserver stand-in the test drives. */
  class FakeResize {
    static last: FakeResize | null = null;
    readonly watched: unknown[] = [];
    disconnected = false;
    constructor(private readonly callback: () => void) {
      FakeResize.last = this;
    }
    observe(el: unknown) {
      this.watched.push(el);
    }
    disconnect() {
      this.disconnected = true;
    }
    resize() {
      this.callback();
    }
  }

  /** The window the hold reads: its scroll position, scroll events and
   *  one timer, all driven by the test. */
  function fakeView() {
    const scrolls: (() => void)[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const view = {
      scrollY: 0,
      addEventListener: (type: string, fn: () => void) => {
        if (type === "scroll") scrolls.push(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        if (type === "scroll") scrolls.splice(scrolls.indexOf(fn), 1);
      },
      setTimeout: (fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return timers.length;
      },
    };
    return {
      view,
      timers,
      listening: () => scrolls.length,
      /** The reader (or the browser) scrolls to `y`. */
      scrollTo(y: number) {
        view.scrollY = y;
        for (const fn of [...scrolls]) fn();
      },
    };
  }

  /** The stage sits 1200 px down the page: putting it back at the top
   *  scrolls the view there. */
  const STAGE_Y = 1200;

  function page(mark: string | undefined) {
    const scrolled: ScrollIntoViewOptions[] = [];
    const dataset: Record<string, string> =
      mark === undefined ? {} : { landingSkip: mark };
    const fake = fakeView();
    const node = (id: string) => ({
      id,
      scrollIntoView: (options: ScrollIntoViewOptions) => {
        scrolled.push(options);
        fake.view.scrollY = STAGE_Y;
      },
    });
    const nodes = new Map(
      ["landing", "setup-stage", "setup-map", "setup-card"].map((id) => [
        id,
        node(id),
      ]),
    );
    const doc = {
      documentElement: { dataset },
      getElementById: (id: string) => nodes.get(id) ?? null,
    };
    return { doc: doc as unknown as Document, scrolled, dataset, fake };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Parts of the setup and the landing appear at their own pace after the
  // page's scripts ran (the AR check, the pictures' chunks): each time the
  // layout around the stage changes, the stage goes back to the top, until
  // the reader's first input.
  it("puts the stage back on every resize while the skip holds, then lets go", () => {
    const { doc, scrolled, dataset, fake } = page("applied");
    holdLandingSkip(doc, {
      Observer: FakeResize as unknown as typeof ResizeObserver,
      view: fake.view,
    });
    expect(scrolled).toHaveLength(1);
    expect(
      FakeResize.last?.watched.map((n) => (n as { id: string }).id),
    ).toEqual(["landing", "setup-stage", "setup-map", "setup-card"]);
    FakeResize.last?.resize();
    expect(scrolled).toHaveLength(2);
    dataset["landingSkip"] = "moved";
    FakeResize.last?.resize();
    expect(scrolled).toHaveLength(2);
    expect(FakeResize.last?.disconnected).toBe(true);
    expect(fake.listening()).toBe(0);
  });

  // The hold must not outlive the page's settling: a reader who scrolls
  // without a wheel, touch, key or pointer event (a scrollbar drag in
  // some browsers, a screen reader's browse mode) would otherwise be
  // pulled back to the stage by any later resize, without end.
  it("ends a grace period after the landing's parts settled, also when one failed", async () => {
    for (const settled of [
      () => Promise.resolve(),
      () => Promise.reject(new Error("a chunk did not load")),
    ]) {
      const until = settled();
      const { doc, scrolled, dataset, fake } = page("applied");
      holdLandingSkip(doc, {
        Observer: FakeResize as unknown as typeof ResizeObserver,
        until,
        graceMs: 1000,
        view: fake.view,
      });
      expect(fake.timers).toEqual([]);
      await settle();
      expect(fake.timers.map((t) => t.ms)).toEqual([1000]);
      FakeResize.last?.resize();
      expect(scrolled).toHaveLength(2);
      fake.timers[0]?.fn();
      expect(dataset["landingSkip"]).toBe("released");
      FakeResize.last?.resize();
      expect(scrolled).toHaveLength(2);
      expect(FakeResize.last?.disconnected).toBe(true);
      expect(fake.listening()).toBe(0);
    }
  });

  // Any scroll the hold did not make is the reader's (or the browser's
  // on the reader's behalf): the page is theirs from then on. The hold's
  // own scrolls, and a scroll event that reports the position the hold
  // set, change nothing.
  it("lets go on a scroll to a position it did not set", () => {
    const { doc, scrolled, dataset, fake } = page("applied");
    holdLandingSkip(doc, {
      Observer: FakeResize as unknown as typeof ResizeObserver,
      view: fake.view,
    });
    fake.scrollTo(STAGE_Y);
    expect(dataset["landingSkip"]).toBe("applied");
    fake.scrollTo(STAGE_Y + 0.5);
    expect(dataset["landingSkip"]).toBe("applied");
    fake.scrollTo(STAGE_Y - 300);
    expect(dataset["landingSkip"]).toBe("moved");
    FakeResize.last?.resize();
    expect(scrolled).toHaveLength(1);
    expect(fake.listening()).toBe(0);
  });

  it("watches nothing without a skip", () => {
    FakeResize.last = null;
    const { doc, scrolled, fake } = page(undefined);
    holdLandingSkip(doc, {
      Observer: FakeResize as unknown as typeof ResizeObserver,
      until: Promise.resolve(),
      view: fake.view,
    });
    expect(scrolled).toEqual([]);
    expect(FakeResize.last).toBeNull();
    expect(fake.listening()).toBe(0);
  });

  it("puts the stage back once without ResizeObserver, and still ends", async () => {
    const { doc, scrolled, dataset, fake } = page("applied");
    holdLandingSkip(doc, {
      Observer: undefined,
      until: Promise.resolve(),
      view: fake.view,
    });
    expect(scrolled).toHaveLength(1);
    await settle();
    fake.timers[0]?.fn();
    expect(dataset["landingSkip"]).toBe("released");
    expect(fake.listening()).toBe(0);
  });
});
