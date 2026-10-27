// @vitest-environment jsdom
/**
 * Why these tests matter: the cards' pictures are drawn from one shared
 * drawing, referenced by id from every phone. A reference to an id that
 * is not drawn shows nothing and no error, so it is checked here for every
 * reference. The share in view decides when a picture moves: read wrong, a
 * picture taller than a phone's view (the dock is about 440 px) would never
 * count as fully in view and never start. And the page's buttons must only
 * appear once they work: the pause authored hidden and "Show again" not
 * ready (invisible, its place kept so the caption does not grow), both
 * revealed by the mount, the pause left hidden under reduced motion,
 * where nothing moves by itself.
 */
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LC_DEFS, LC_PHONE } from "./landing-cards-drawing.js";
import { mountLandingCards, shareInView } from "./landing-cards.js";

describe("shareInView", () => {
  it("is the visible ratio for a picture that fits the view", () => {
    expect(shareInView(0.5, 844, 440)).toBe(0.5);
    expect(shareInView(1, 844, 440)).toBe(1);
  });

  it("counts a picture taller than the view as fully in view once it fills it", () => {
    // 400 of a 500 px picture in a 400 px view: all that can be seen.
    expect(shareInView(0.8, 400, 500)).toBeCloseTo(1, 12);
    expect(shareInView(0.4, 400, 500)).toBeCloseTo(0.5, 12);
  });

  it("reads sizes that are not positive numbers as nothing in view", () => {
    expect(shareInView(1, 0, 440)).toBe(0);
    expect(shareInView(1, 844, 0)).toBe(0);
    expect(shareInView(1, Number.NaN, 440)).toBe(0);
    expect(shareInView(Number.NaN, 844, 440)).toBe(0);
  });

  it("stays in [0, 1] and grows with the visible ratio (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 4000, noNaN: true }),
        fc.double({ min: 1, max: 4000, noNaN: true }),
        (a, b, view, picture) => {
          const low = shareInView(Math.min(a, b), view, picture);
          const high = shareInView(Math.max(a, b), view, picture);
          expect(low >= 0 && high <= 1 && low <= high).toBe(true);
        },
      ),
    );
  });
});

describe("the shared drawing", () => {
  const ids = [...LC_DEFS.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const refs = (markup: string) => [
    ...[...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
    ...[...markup.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]),
  ];

  it("draws every id once, each prefixed so nothing collides with the page", () => {
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id?.startsWith("lc-") === true)).toBe(true);
  });

  it("resolves every reference from the phones and the drawing itself", () => {
    const missing = [...refs(LC_PHONE), ...refs(LC_DEFS)].filter(
      (ref) => !ids.includes(ref),
    );
    expect(missing).toEqual([]);
  });

  it("prefixes every class of the phone", () => {
    const classes = [...LC_PHONE.matchAll(/class="([^"]+)"/g)].flatMap((m) =>
      (m[1] ?? "").split(/\s+/),
    );
    expect(classes.filter((c) => !c.startsWith("lc-"))).toEqual([]);
  });
});

/** The observer the cards use, driven by the test. */
class FakeIntersection {
  static last: FakeIntersection | null = null;
  readonly watched: Element[] = [];
  disconnected = false;
  constructor(
    private readonly callback: (entries: IntersectionObserverEntry[]) => void,
  ) {
    FakeIntersection.last = this;
  }
  observe(el: Element) {
    this.watched.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** `el` is `ratio` in view, its height `height` px. */
  see(el: Element, ratio: number, height = 300) {
    this.callback([
      {
        target: el,
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
        boundingClientRect: { height },
      } as unknown as IntersectionObserverEntry,
    ]);
  }
}

function page(): HTMLElement {
  document.body.innerHTML = `
    <div id="film"></div>
    <ol id="cards">
      <li class="landing-card"><div class="landing-pic"><div class="lc-dock" data-kind="scene"></div></div></li>
      <li class="landing-card"><div class="landing-pic">
        <div class="lc-dock" data-kind="place" data-look="510"></div>
        <button class="landing-hold" aria-pressed="false" hidden></button></div>
        <button class="landing-again"></button></li>
      <li class="landing-card"><div class="landing-pic">
        <div class="lc-dock" data-kind="add" data-look="510"></div>
        <button class="landing-hold" aria-pressed="false" hidden></button></div>
        <button class="landing-again"></button></li>
    </ol>`;
  const root = document.getElementById("cards");
  if (root === null) throw new Error("no cards");
  return root;
}

const docks = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".lc-dock[data-look]"));
const holds = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".landing-hold"));
const agains = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".landing-again"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", FakeIntersection);
  FakeIntersection.last = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("mountLandingCards", () => {
  it("draws a phone into each step's dock and the place into the first", () => {
    const root = page();
    mountLandingCards(root, { reducedMotion: false });
    expect(root.querySelectorAll(".lc-phone")).toHaveLength(2);
    expect(
      root.querySelector('[data-kind="scene"] .lc-scene-art'),
    ).not.toBeNull();
    expect(document.querySelector("svg.lc-defs #lc-scene")).not.toBeNull();
    expect(root.dataset["landingCards"]).toBe("mounted");
    // A list holds only its cards: the drawing sits beside it.
    expect([...root.children].every((c) => c.tagName === "LI")).toBe(true);
  });

  it("starts the picture in view after the settle delay, and pauses it on a tap", () => {
    const root = page();
    mountLandingCards(root, { reducedMotion: false });
    const [place] = docks();
    if (place === undefined) throw new Error("no dock");
    FakeIntersection.last?.see(place, 1);
    expect(place.dataset["phase"]).toBe("still");
    vi.advanceTimersByTime(300);
    expect(place.dataset["phase"]).toBe("playing");
    expect(place.classList.contains("lc-play")).toBe(true);
    expect(holds().map((b) => b.hidden)).toEqual([false, false]);
    holds()[0]?.click();
    expect(place.dataset["paused"]).toBe("true");
    expect(holds()[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("moves nothing by itself while the film plays", async () => {
    const root = page();
    const film = document.getElementById("film");
    if (film === null) throw new Error("no film");
    film.dataset["playing"] = "true";
    mountLandingCards(root, { reducedMotion: false, filmHost: film });
    const [place] = docks();
    if (place === undefined) throw new Error("no dock");
    FakeIntersection.last?.see(place, 1);
    vi.advanceTimersByTime(1000);
    expect(place.dataset["phase"]).toBe("still");
    film.dataset["playing"] = "false";
    await Promise.resolve();
    vi.advanceTimersByTime(300);
    expect(place.dataset["phase"]).toBe("playing");
  });

  it("under reduced motion offers no pause, and Show again plays on request", () => {
    const root = page();
    mountLandingCards(root, { reducedMotion: true });
    const [, add] = docks();
    if (add === undefined) throw new Error("no dock");
    FakeIntersection.last?.see(add, 1);
    vi.advanceTimersByTime(1000);
    expect(add.dataset["phase"]).toBe("still");
    expect(holds().map((b) => b.hidden)).toEqual([true, true]);
    expect(agains().map((b) => b.dataset["ready"])).toEqual(["true", "true"]);
    agains()[1]?.click();
    expect(add.dataset["phase"]).toBe("playing");
  });

  it("keeps every picture still where the browser has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const root = page();
    mountLandingCards(root, { reducedMotion: false });
    vi.advanceTimersByTime(5000);
    expect(docks().map((d) => d.dataset["phase"])).toEqual(["still", "still"]);
  });

  it("goes back to the page's static boxes on destroy", () => {
    const root = page();
    const cards = mountLandingCards(root, { reducedMotion: false });
    const watcher = FakeIntersection.last;
    cards.destroy();
    expect(watcher?.disconnected).toBe(true);
    expect(document.querySelector(".lc-phone, .lc-defs")).toBeNull();
    expect(holds().every((b) => b.hidden)).toBe(true);
    expect(agains().every((b) => b.dataset["ready"] === undefined)).toBe(true);
    expect(root.dataset["landingCards"]).toBeUndefined();
  });
});
