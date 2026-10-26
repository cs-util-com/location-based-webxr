/**
 * The landing's step cards in the page: builds R3-4's drawn phone into
 * each card's dock, frames each phone's screen on its part of the drawn
 * place, and lets `card-play.ts` decide which picture moves. Loaded by
 * `landing-mount.ts` with `import()`, for a creator only: a visitor never
 * downloads the drawing, its CSS or this module.
 *
 * The page's markup (`index.html`, "The landing") holds each card's text,
 * an empty dock (`.lc-dock[data-kind]`, its height reserved by the page's
 * CSS) and, for the four animated cards, the pause button (`.lc-hold`) and
 * "Show again" (`.lc-again`).
 *
 * @see landing-cards.ts.md
 */
import "./landing-cards.css";

import { createCardPlay, type CardState } from "./card-play.js";
import { clamp01 } from "./clamp01.js";
import type { LandingCardsOptions, LandingPart } from "./landing-mount.js";
import { LC_DEFS, LC_PHONE, paintTextures } from "./landing-cards-drawing.js";

const NS = "http://www.w3.org/2000/svg";

/** The animated pictures and how long each one's sequence runs (R3-4's
 *  timings: the last entry ends at about these times). */
export const CARD_DURATIONS_MS = {
  place: 2000,
  add: 3300,
  hang: 2600,
  scan: 2600,
} as const;

export type CardKind = keyof typeof CARD_DURATIONS_MS;

const isCardKind = (kind: string | undefined): kind is CardKind =>
  kind !== undefined && Object.hasOwn(CARD_DURATIONS_MS, kind);

/**
 * How much of a picture is in view, of as much of it as can be: the
 * intersection ratio divided by the share of the picture the view can hold
 * at most. A picture taller than the view counts as fully in view once it
 * fills the view. 0 for a size that is not a positive number.
 */
export function shareInView(
  ratio: number,
  viewportHeight: number,
  pictureHeight: number,
): number {
  if (!(viewportHeight > 0) || !(pictureHeight > 0)) return 0;
  return clamp01(ratio / Math.min(1, viewportHeight / pictureHeight));
}

/** The world units a phone's screen shows across, and the band of the
 *  drawn place it keeps in view (from R3-4). */
const FOCUS = { w: 440, y0: 250, y1: 760 };

/** The intersection steps the cards are watched at. */
const STEPS = Array.from({ length: 21 }, (_, k) => k / 20);

interface Dock {
  readonly dock: HTMLElement;
  readonly look: number;
  readonly back: SVGSVGElement;
  readonly phone: HTMLElement;
  readonly screen: HTMLElement;
  readonly worlds: SVGSVGElement[];
  readonly anchors: HTMLElement[];
}

/** The first card's picture: the place itself, at full colour, with the
 *  old photo and a note laid on it (no phone, nothing moves). */
const SCENE = `<svg class="lc-scene-art" viewBox="270 70 500 600" preserveAspectRatio="xMidYMid slice"><use href="#lc-scene"/></svg>
<div class="lc-note">Built in 1820. The stream drove the wheel for a hundred years.</div>
<div class="lc-oldphoto"><svg viewBox="0 0 120 90"><use href="#lc-millPhoto"/></svg><span>The mill, 1910</span></div>`;

/** Draws one dock: the place behind, paler, and the phone over it. */
function buildDock(doc: Document, dock: HTMLElement): Dock | null {
  const back = doc.createElementNS(NS, "svg");
  back.setAttribute("class", "lc-back");
  back.setAttribute("aria-hidden", "true");
  const scene = doc.createElementNS(NS, "use");
  scene.setAttribute("href", "#lc-scene");
  const poster = doc.createElementNS(NS, "use");
  poster.setAttribute("href", "#lc-poster");
  poster.setAttribute("class", "lc-bposter");
  back.append(scene, poster);
  const pale = doc.createElement("div");
  pale.className = "lc-pale";
  const template = doc.createElement("template");
  template.innerHTML = LC_PHONE;
  dock.replaceChildren(back, pale, template.content);
  const phone = dock.querySelector<HTMLElement>(".lc-phone");
  const screen = dock.querySelector<HTMLElement>(".lc-screen");
  if (phone === null || screen === null) return null;
  const look = Number(dock.dataset["look"]);
  return {
    dock,
    look: Number.isFinite(look) ? look : 510,
    back,
    phone,
    screen,
    worlds: Array.from(dock.querySelectorAll<SVGSVGElement>(".lc-world")),
    anchors: Array.from(dock.querySelectorAll<HTMLElement>(".lc-anc")),
  };
}

/** Frames a phone's screen on its look point, the place behind it to
 *  match, and pins the AR content to its spots (R3-4's `layout`). */
function frame(d: Dock): void {
  const sw = d.screen.clientWidth;
  const sh = d.screen.clientHeight;
  if (sw === 0 || sh === 0) return;
  const w = FOCUS.w;
  const h = (FOCUS.w * sh) / sw;
  const x = d.look - w / 2;
  const y = FOCUS.y0 - (h - (FOCUS.y1 - FOCUS.y0)) * 0.62;
  const s = sw / w;
  const box = (...v: number[]): string => v.map((n) => n.toFixed(2)).join(" ");
  for (const world of d.worlds) world.setAttribute("viewBox", box(x, y, w, h));
  const ox = d.phone.offsetLeft + d.screen.offsetLeft;
  const oy = d.phone.offsetTop + d.screen.offsetTop;
  d.back.setAttribute(
    "viewBox",
    box(
      x - ox / s,
      y - oy / s,
      d.dock.clientWidth / s,
      d.dock.clientHeight / s,
    ),
  );
  for (const a of d.anchors) {
    const wx = Number(a.dataset["wx"]);
    const wy = Number(a.dataset["wy"]);
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
    a.style.left = `${((wx - x) * s).toFixed(1)}px`;
    a.style.top = `${((wy - y) * s).toFixed(1)}px`;
  }
}

/**
 * Builds the cards' pictures under `root` and starts their play
 * controller. Docks it cannot build are left empty (their reserved box
 * stays); a card without its buttons still plays. Where the browser has no
 * IntersectionObserver every picture keeps its last frame ("Show again"
 * still plays it). While the film's host carries `data-playing="true"`, or
 * the tab is hidden, no picture moves by itself.
 */
export function mountLandingCards(
  root: HTMLElement,
  options: LandingCardsOptions,
): LandingPart {
  const doc = root.ownerDocument;

  const defs = doc.createElementNS(NS, "svg");
  defs.setAttribute("class", "lc-defs");
  defs.setAttribute("aria-hidden", "true");
  defs.setAttribute("focusable", "false");
  defs.innerHTML = `<defs>${LC_DEFS}</defs>`;
  // Beside the list, not in it: a list holds only its cards.
  root.before(defs);
  paintTextures(defs);

  for (const scene of Array.from(
    root.querySelectorAll<HTMLElement>('.lc-dock[data-kind="scene"]'),
  )) {
    scene.innerHTML = SCENE;
  }
  const cards = Array.from(
    root.querySelectorAll<HTMLElement>(".lc-dock[data-kind]"),
  )
    .filter((dock) => isCardKind(dock.dataset["kind"]))
    .map((dock) => buildDock(doc, dock))
    .filter((d): d is Dock => d !== null);
  for (const d of cards) frame(d);
  const resize =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          for (const d of cards) frame(d);
        })
      : null;
  for (const d of cards) resize?.observe(d.dock);

  const card = (d: Dock) => d.dock.closest<HTMLElement>(".landing-card");
  const holds = cards.map(
    (d) => card(d)?.querySelector<HTMLButtonElement>(".landing-hold") ?? null,
  );
  const agains = cards.map(
    (d) => card(d)?.querySelector<HTMLButtonElement>(".landing-again") ?? null,
  );

  const runs = cards.map(() => 0);
  function render(i: number, state: CardState): void {
    const d = cards[i];
    if (d === undefined) return;
    const { dock } = d;
    if (state.phase === "still") dock.classList.remove("lc-play");
    else if (state.run !== runs[i] || !dock.classList.contains("lc-play")) {
      // A new run restarts the CSS sequence from its first frame.
      dock.classList.remove("lc-play");
      void dock.offsetWidth;
      dock.classList.add("lc-play");
    }
    runs[i] = state.run;
    dock.dataset["phase"] = state.phase;
    dock.dataset["paused"] = String(state.paused);
    holds[i]?.setAttribute("aria-pressed", String(state.paused));
  }

  const play = createCardPlay({
    durationsMs: cards.map((d) => {
      const kind = d.dock.dataset["kind"];
      return isCardKind(kind)
        ? CARD_DURATIONS_MS[kind]
        : CARD_DURATIONS_MS.place;
    }),
    reducedMotion: options.reducedMotion,
    timer: {
      now: () => performance.now(),
      set: (fn, ms) => window.setTimeout(fn, ms),
      clear: (id) => {
        window.clearTimeout(id);
      },
    },
    render,
  });
  for (const d of cards) {
    d.dock.dataset["phase"] = "still";
    d.dock.dataset["paused"] = "false";
  }

  const listeners: (() => void)[] = [];
  const listen = (
    target: EventTarget | null,
    type: string,
    fn: () => void,
  ): void => {
    if (target === null) return;
    target.addEventListener(type, fn);
    listeners.push(() => {
      target.removeEventListener(type, fn);
    });
  };
  // The page authors the pause hidden and "Show again" not ready (it is
  // invisible but keeps its place): before this module they would do
  // nothing. Under reduced motion nothing moves by itself, so there is no
  // pause to offer; "Show again" stays an explicit play.
  holds.forEach((button, i) => {
    if (button === null) return;
    button.hidden = options.reducedMotion;
    listen(button, "click", () => {
      play.tap(i);
    });
  });
  agains.forEach((button, i) => {
    if (button !== null) button.dataset["ready"] = "true";
    listen(button, "click", () => {
      play.showAgain(i);
    });
  });

  const watch =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(seenEntries, { threshold: STEPS })
      : null;
  function seenEntries(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const i = cards.findIndex((d) => d.dock === entry.target);
      if (i < 0) continue;
      play.seen(
        i,
        entry.isIntersecting
          ? shareInView(
              entry.intersectionRatio,
              window.innerHeight,
              entry.boundingClientRect.height,
            )
          : 0,
      );
    }
  }
  for (const d of cards) watch?.observe(d.dock);

  // One moving thing at a time: the film, or a card; and nothing behind a
  // hidden tab.
  const film = options.filmHost ?? null;
  const blocked = (): boolean =>
    doc.hidden || film?.dataset["playing"] === "true";
  const filmWatch = new MutationObserver(() => {
    play.setBlocked(blocked());
  });
  if (film !== null) {
    filmWatch.observe(film, {
      attributes: true,
      attributeFilter: ["data-playing"],
    });
  }
  listen(doc, "visibilitychange", () => {
    play.setBlocked(blocked());
  });
  play.setBlocked(blocked());

  root.dataset["landingCards"] = "mounted";
  return {
    destroy() {
      play.destroy();
      watch?.disconnect();
      resize?.disconnect();
      filmWatch.disconnect();
      for (const off of listeners) off();
      // Back to the page's static boxes: the drawing goes with its defs.
      for (const dock of Array.from(
        root.querySelectorAll<HTMLElement>(".lc-dock[data-kind]"),
      )) {
        dock.replaceChildren();
        dock.classList.remove("lc-play");
        delete dock.dataset["phase"];
        delete dock.dataset["paused"];
      }
      for (const button of holds) {
        if (button !== null) button.hidden = true;
      }
      for (const button of agains) {
        if (button !== null) delete button.dataset["ready"];
      }
      defs.remove();
      delete root.dataset["landingCards"];
    },
  };
}
