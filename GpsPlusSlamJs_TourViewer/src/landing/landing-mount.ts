/**
 * The landing's one static module: mounts the landing's moving parts (the
 * cards' pictures, the hero film, the use cases) with dynamic imports, for
 * a creator only, so a visitor's page never downloads them. The landing's
 * text, its reserved boxes and the film's still are in `index.html` and
 * show without any of this; a part whose chunk fails to load (no network,
 * a stale chunk after a deploy) keeps that static content.
 *
 * @see landing-mount.ts.md
 */
import type { ViewerMode } from "../mode.js";

/** What every mounted part hands back. */
export interface LandingPart {
  destroy(): void;
}

/** The film's options (the interface the film module implements). */
export interface LandingFilmOptions {
  readonly reducedMotion: boolean;
  /** Registers `stop`, called when an AR session is starting; returns the
   *  unregistration. */
  readonly onArStarting: (stop: () => void) => () => void;
  readonly requestFrame?: (cb: FrameRequestCallback) => number;
  readonly onFallback?: (reason: "no-webgl" | "context-lost") => void;
}

/** The cards' options (`landing-cards.ts`). */
export interface LandingCardsOptions {
  readonly reducedMotion: boolean;
  readonly filmHost?: HTMLElement | null;
}

/** The three chunks, injectable for the tests. */
export interface LandingLoaders {
  cards(): Promise<{
    mountLandingCards(
      root: HTMLElement,
      options: LandingCardsOptions,
    ): LandingPart;
  }>;
  film(): Promise<{
    mountLandingFilm(
      host: HTMLElement,
      options: LandingFilmOptions,
    ): LandingPart;
  }>;
  uses(): Promise<{ mountUseCases(host: HTMLElement): LandingPart }>;
}

export const LANDING_LOADERS: LandingLoaders = {
  cards: () => import("./landing-cards.js"),
  film: () => import("./film-placeholder.js"),
  uses: () => import("./use-cases.js"),
};

export interface LandingDom {
  /** The cards' list: each card's dock and buttons. */
  readonly cards: HTMLElement;
  /** The film's host, its aspect reserved, the still inside. */
  readonly film: HTMLElement;
  /** The use cases' host, a static list inside until they mount. */
  readonly uses: HTMLElement;
}

export interface MountLandingOptions {
  readonly mode: ViewerMode;
  /** null where the page has no landing (nothing is loaded then). */
  readonly dom: LandingDom | null;
  readonly reducedMotion: boolean;
  readonly onArStarting: (stop: () => void) => () => void;
  readonly loaders?: LandingLoaders;
}

export interface MountedLanding {
  /** Settles once every part has mounted or failed; never rejects. */
  readonly ready: Promise<void>;
  /** Destroys what mounted; a part that mounts after this is destroyed at
   *  once. */
  destroy(): void;
}

/**
 * Mounts the landing's parts for a creator; a visitor's page loads none.
 * Each part's host says how its mount went in `data-mount`: "ready", or
 * "failed" (its chunk did not load, or its mount threw; the host keeps
 * its static content).
 */
export function mountLanding(options: MountLandingOptions): MountedLanding {
  const { dom } = options;
  if (options.mode !== "creator" || dom === null) {
    return { ready: Promise.resolve(), destroy: () => undefined };
  }
  const loaders = options.loaders ?? LANDING_LOADERS;
  const parts: LandingPart[] = [];
  let destroyed = false;

  const mount = async (
    host: HTMLElement,
    load: () => Promise<LandingPart>,
  ): Promise<void> => {
    try {
      const mounted = await load();
      if (destroyed) {
        mounted.destroy();
        return;
      }
      parts.push(mounted);
      host.dataset["mount"] = "ready";
    } catch {
      // A chunk that did not load (no network, a stale chunk after a
      // deploy): the static content stays, which is the whole fallback.
      if (!destroyed) host.dataset["mount"] = "failed";
    }
  };

  const ready = Promise.all([
    mount(dom.film, async () =>
      (await loaders.film()).mountLandingFilm(dom.film, {
        reducedMotion: options.reducedMotion,
        onArStarting: options.onArStarting,
      }),
    ),
    mount(dom.cards, async () =>
      (await loaders.cards()).mountLandingCards(dom.cards, {
        reducedMotion: options.reducedMotion,
        filmHost: dom.film,
      }),
    ),
    mount(dom.uses, async () => (await loaders.uses()).mountUseCases(dom.uses)),
  ]).then(() => undefined);

  return {
    ready,
    destroy() {
      destroyed = true;
      for (const part of parts.splice(0)) part.destroy();
      for (const host of [dom.film, dom.cards, dom.uses]) {
        delete host.dataset["mount"];
      }
    },
  };
}

/**
 * The page's "AR is starting" signal for the film: a tap on the Start
 * button (`#enter-ar`), caught before its own handler asks for the
 * session, and the page's `body[data-ar-active="true"]` as a second, later
 * signal for a session started another way. Each registered `stop` is
 * called on either.
 */
export function watchArStarting(
  doc: Document,
): (stop: () => void) => () => void {
  return (stop) => {
    const onTap = (event: Event): void => {
      const target = event.target;
      if (target instanceof Element && target.closest("#enter-ar") !== null) {
        stop();
      }
    };
    doc.addEventListener("click", onTap, { capture: true });
    const watch = new MutationObserver(() => {
      if (doc.body.dataset["arActive"] === "true") stop();
    });
    watch.observe(doc.body, {
      attributes: true,
      attributeFilter: ["data-ar-active"],
    });
    return () => {
      doc.removeEventListener("click", onTap, { capture: true });
      watch.disconnect();
    };
  };
}
