// @vitest-environment jsdom
/**
 * Why these tests matter: the landing's moving parts are dynamic imports
 * so that a visitor's page, opened from a printed code on a phone in a
 * park, never downloads them. A shim that loaded them for a visitor would
 * cost every visitor the landing's weight; one that let a failed chunk
 * throw would leave a creator with a broken page after a deploy, where
 * the static text and still are a perfectly good page. A part that loads
 * after the page let go of the landing must not stay mounted (its timers
 * and observers would run on).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountLanding,
  watchArStarting,
  type LandingDom,
  type LandingLoaders,
  type LandingPart,
} from "./landing-mount.js";

function makeDom(): LandingDom {
  document.body.innerHTML = `
    <div id="landing-film"><img alt="still"></div>
    <ol id="cards">
      <li class="landing-card"><div class="landing-pic"><div class="lc-dock" data-kind="scene"></div></div></li>
      <li class="landing-card"><div class="landing-pic"><div class="lc-dock" data-kind="place" data-look="510"></div>
        <button class="landing-hold" hidden></button></div><button class="landing-again" hidden></button></li>
    </ol>
    <div id="landing-uses"><h2>What people make with it</h2></div>
    <button id="enter-ar"><span class="inner">Start</span></button>`;
  const get = (id: string) => {
    const found = document.getElementById(id);
    if (found === null) throw new Error(id);
    return found;
  };
  return {
    film: get("landing-film"),
    cards: get("cards"),
    uses: get("landing-uses"),
  };
}

type Part = keyof LandingLoaders;

/** Loaders that record their calls and hand back destroy spies. */
function spyLoaders(fail: Partial<Record<Part, boolean>> = {}) {
  const calls: { part: Part; host: HTMLElement; options?: unknown }[] = [];
  const destroyed: Part[] = [];
  const part = (name: Part): LandingPart => ({
    destroy: () => {
      destroyed.push(name);
    },
  });
  const refuse = () => Promise.reject(new Error("chunk"));
  const loaders: LandingLoaders = {
    cards: () =>
      fail.cards === true
        ? refuse()
        : Promise.resolve({
            mountLandingCards: (host, options) => {
              calls.push({ part: "cards", host, options });
              return part("cards");
            },
          }),
    film: () =>
      fail.film === true
        ? refuse()
        : Promise.resolve({
            mountLandingFilm: (host, options) => {
              calls.push({ part: "film", host, options });
              return part("film");
            },
          }),
    uses: () =>
      fail.uses === true
        ? refuse()
        : Promise.resolve({
            mountUseCases: (host) => {
              calls.push({ part: "uses", host });
              return part("uses");
            },
          }),
  };
  return { loaders, calls, destroyed };
}

const noAr = () => () => undefined;

afterEach(() => {
  document.body.innerHTML = "";
  delete document.body.dataset["arActive"];
});

describe("mountLanding", () => {
  it("loads nothing for a visitor, or where the page has no landing", async () => {
    const load = vi.fn(() => Promise.reject(new Error("must not load")));
    const loaders = {
      cards: load,
      film: load,
      uses: load,
    } as unknown as LandingLoaders;
    const base = { reducedMotion: false, onArStarting: noAr, loaders };
    await mountLanding({ ...base, mode: "visitor", dom: makeDom() }).ready;
    await mountLanding({ ...base, mode: "creator", dom: null }).ready;
    expect(load).not.toHaveBeenCalled();
  });

  it("mounts each part into its host for a creator, the cards told about the film", async () => {
    const dom = makeDom();
    const { loaders, calls } = spyLoaders();
    await mountLanding({
      mode: "creator",
      dom,
      reducedMotion: true,
      onArStarting: noAr,
      loaders,
    }).ready;
    const of = (part: Part) => calls.find((c) => c.part === part);
    expect(of("film")?.host).toBe(dom.film);
    expect(of("film")?.options).toEqual({
      reducedMotion: true,
      onArStarting: noAr,
      onFallback: expect.any(Function),
    });
    expect(of("cards")?.host).toBe(dom.cards);
    expect(of("cards")?.options).toEqual({
      reducedMotion: true,
      filmHost: dom.film,
    });
    expect(of("uses")?.host).toBe(dom.uses);
    expect(
      [dom.film, dom.cards, dom.uses].map((h) => h.dataset["mount"]),
    ).toEqual(["ready", "ready", "ready"]);
  });

  it("keeps a part's static content when its chunk fails, and mounts the others", async () => {
    const dom = makeDom();
    const { loaders, calls } = spyLoaders({ film: true });
    await expect(
      mountLanding({
        mode: "creator",
        dom,
        reducedMotion: false,
        onArStarting: noAr,
        loaders,
      }).ready,
    ).resolves.toBeUndefined();
    expect(dom.film.dataset["mount"]).toBe("failed");
    expect(dom.film.querySelector("img")).not.toBeNull();
    expect(calls.map((c) => c.part).sort()).toEqual(["cards", "uses"]);
  });

  it("destroys what mounted, and a part that mounts after destroy at once", async () => {
    const dom = makeDom();
    const early = spyLoaders();
    const first = mountLanding({
      mode: "creator",
      dom,
      reducedMotion: false,
      onArStarting: noAr,
      loaders: early.loaders,
    });
    first.destroy();
    await first.ready;
    expect(early.destroyed.sort()).toEqual(["cards", "film", "uses"]);
    expect(dom.film.dataset["mount"]).toBeUndefined();

    const late = spyLoaders();
    const second = mountLanding({
      mode: "creator",
      dom,
      reducedMotion: false,
      onArStarting: noAr,
      loaders: late.loaders,
    });
    await second.ready;
    expect(late.destroyed).toEqual([]);
    second.destroy();
    expect(late.destroyed.sort()).toEqual(["cards", "film", "uses"]);
  });

  // jsdom has no WebGL and no IntersectionObserver: the real film mounts
  // its drawn floor, reads itself as in view, and says why it draws flat.
  it("mounts the real chunks: the cards' pictures, the use cases, the film", async () => {
    const dom = makeDom();
    const registered: (() => void)[] = [];
    const onArStarting = (stop: () => void) => {
      registered.push(stop);
      return () => undefined;
    };
    const mounted = mountLanding({
      mode: "creator",
      dom,
      reducedMotion: false,
      onArStarting,
    });
    await mounted.ready;
    expect(dom.film.querySelector(".lf-film")).not.toBeNull();
    expect(dom.film.querySelector("img")).toBeNull();
    expect(dom.film.dataset["filmFallback"]).toBe("no-webgl");
    expect(registered).toHaveLength(1);
    // The use cases' section replaces the host's static list, its own
    // heading with it: one "What people make with it", never two.
    expect(dom.uses.querySelectorAll("section.uc")).toHaveLength(1);
    expect(dom.uses.querySelectorAll("h2")).toHaveLength(1);
    expect(
      dom.cards.querySelector('[data-kind="place"] .lc-phone'),
    ).not.toBeNull();
    expect(
      dom.cards.querySelector('[data-kind="scene"] .lc-scene-art'),
    ).not.toBeNull();
    mounted.destroy();
    // The page's still comes back with the film gone.
    expect(dom.film.querySelector(".lf-film")).toBeNull();
    expect(dom.film.querySelector("img")).not.toBeNull();
    expect(dom.film.dataset["filmFallback"]).toBeUndefined();
    expect(dom.cards.querySelector(".lc-phone")).toBeNull();
    expect(dom.uses.querySelector(".uc")).toBeNull();
  });

  // A reader may turn reduced motion on while the page is open (the
  // system setting): the moving parts must follow it then, not only after
  // a reload. The film and the cards are mounted again with the new value;
  // the use cases do not move and stay as they are.
  it("mounts the film and the cards again when the reduced-motion setting changes", async () => {
    const dom = makeDom();
    const { loaders, calls, destroyed } = spyLoaders();
    let notify: (reduced: boolean) => void = () => undefined;
    let unwatched = 0;
    const mounted = mountLanding({
      mode: "creator",
      dom,
      reducedMotion: false,
      watchReducedMotion: (onChange) => {
        notify = onChange;
        return () => {
          unwatched += 1;
        };
      },
      onArStarting: noAr,
      loaders,
    });
    await mounted.ready;
    expect(calls.map((c) => c.part).sort()).toEqual(["cards", "film", "uses"]);
    notify(false);
    expect(destroyed).toEqual([]);
    // The old film's reason for drawing flat must not outlive it: the
    // new film reports its own (here none).
    dom.film.dataset["filmFallback"] = "context-lost";
    notify(true);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(5);
    });
    expect(dom.film.dataset["filmFallback"]).toBeUndefined();
    expect(destroyed.sort()).toEqual(["cards", "film"]);
    const again = calls.slice(3);
    expect(again.map((c) => c.part).sort()).toEqual(["cards", "film"]);
    for (const call of again) {
      expect(call.options).toMatchObject({ reducedMotion: true });
    }
    expect(dom.film.dataset["mount"]).toBe("ready");
    mounted.destroy();
    expect(destroyed.sort()).toEqual([
      "cards",
      "cards",
      "film",
      "film",
      "uses",
    ]);
    expect(unwatched).toBe(1);
    notify(false);
    await Promise.resolve();
    expect(calls).toHaveLength(5);
  });

  // A change that arrives while a part is still loading must not leave
  // two of it mounted: the slower, older one is destroyed when it lands.
  it("keeps one of each part when the setting changes during a load", async () => {
    const dom = makeDom();
    const { loaders, calls, destroyed } = spyLoaders();
    let notify: (reduced: boolean) => void = () => undefined;
    const mounted = mountLanding({
      mode: "creator",
      dom,
      reducedMotion: false,
      watchReducedMotion: (onChange) => {
        notify = onChange;
        return () => undefined;
      },
      onArStarting: noAr,
      loaders,
    });
    notify(true);
    await mounted.ready;
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.part === "film")).toHaveLength(2);
    });
    expect(destroyed.filter((p) => p === "film")).toHaveLength(1);
    expect(
      calls.filter((c) => c.part === "film").at(-1)?.options,
    ).toMatchObject({ reducedMotion: true });
  });
});

describe("watchArStarting", () => {
  // The film must let go of its GPU before AR asks for the camera: a tap
  // on Start is the earliest moment the page knows.
  it("calls stop on a tap on Start (or inside it) and when a session goes live", async () => {
    makeDom();
    const stop = vi.fn();
    const unregister = watchArStarting(document)(stop);
    document.querySelector<HTMLElement>("#enter-ar .inner")?.click();
    expect(stop).toHaveBeenCalledTimes(1);
    document.body.dataset["arActive"] = "true";
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(2);
    document.body.dataset["arActive"] = "false";
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(2);
    unregister();
    document.querySelector<HTMLElement>("#enter-ar")?.click();
    document.body.dataset["arActive"] = "true";
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("ignores taps elsewhere", () => {
    makeDom();
    const stop = vi.fn();
    watchArStarting(document)(stop);
    document.getElementById("landing-uses")?.click();
    expect(stop).not.toHaveBeenCalled();
  });
});
