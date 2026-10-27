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
import type { UsesHeightEnv } from "./uses-height.js";

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
  /** The use cases and their height keeper, in one chunk. */
  uses(): Promise<{
    mountUseCases(host: HTMLElement): LandingPart;
    keepUsesHeight(host: HTMLElement, env: UsesHeightEnv): () => void;
  }>;
}

const LANDING_LOADERS: LandingLoaders = {
  cards: () => import("./landing-cards.js"),
  film: () => import("./landing-film.js"),
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
  /** Calls `onChange` with the new value whenever the reader's
   *  reduced-motion setting changes while the page is open; returns the
   *  unregistration. The film and the cards are mounted again with it. */
  readonly watchReducedMotion?: (
    onChange: (reduced: boolean) => void,
  ) => () => void;
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

/** The tab's session storage, or null where reading it throws (site data
 *  blocked). */
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
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
  /** The part mounted in each host, and the latest mount asked of it: a
   *  mount that lands after a newer one was asked for is destroyed. */
  const parts = new Map<HTMLElement, LandingPart>();
  const asked = new Map<HTMLElement, number>();
  let reduced = options.reducedMotion;
  let destroyed = false;

  const mount = async (
    host: HTMLElement,
    load: () => Promise<LandingPart>,
    onFailed?: () => void,
  ): Promise<void> => {
    const turn = (asked.get(host) ?? 0) + 1;
    asked.set(host, turn);
    try {
      const mounted = await load();
      if (destroyed || asked.get(host) !== turn) {
        mounted.destroy();
        return;
      }
      parts.set(host, mounted);
      host.dataset["mount"] = "ready";
    } catch {
      // A chunk that did not load (no network, a stale chunk after a
      // deploy): the static content stays, which is the whole fallback.
      if (!destroyed && asked.get(host) === turn) {
        host.dataset["mount"] = "failed";
        onFailed?.();
      }
    }
  };
  const unmount = (host: HTMLElement): void => {
    parts.get(host)?.destroy();
    parts.delete(host);
  };

  const mountFilm = () =>
    mount(dom.film, async () =>
      (await loaders.film()).mountLandingFilm(dom.film, {
        reducedMotion: reduced,
        onArStarting: options.onArStarting,
        // Why the film draws flat, on its host (no WebGL, or a lost
        // context): for the page's styles, a debug look and the e2e.
        onFallback: (reason) => {
          if (!destroyed) dom.film.dataset["filmFallback"] = reason;
        },
      }),
    );
  const mountCards = () =>
    mount(dom.cards, async () =>
      (await loaders.cards()).mountLandingCards(dom.cards, {
        reducedMotion: reduced,
        filmHost: dom.film,
      }),
    );

  const ready = Promise.all([
    mountFilm(),
    mountCards(),
    mount(
      dom.uses,
      async () => {
        // the keeper comes in the section's own chunk, never in the page's
        // first load, and cannot fail apart from the section
        const uses = await loaders.uses();
        const part = uses.mountUseCases(dom.uses);
        // kept for the next load: a reload reserves the height measured here
        const unkeep = uses.keepUsesHeight(dom.uses, {
          storage: sessionStore(),
          width: () => window.innerWidth,
          onWindowResize: (listener) => {
            window.addEventListener("resize", listener);
            return () => {
              window.removeEventListener("resize", listener);
            };
          },
        });
        return {
          destroy() {
            unkeep();
            part.destroy();
          },
        };
      },
      // the page reserved the kept height inline before the chunk arrived;
      // a section that never mounts must not leave that much blank page
      () => {
        dom.uses.style.removeProperty("min-height");
      },
    ),
  ]).then(() => undefined);

  // The parts that move follow the reader's setting while the page is
  // open: mounted again with it (the use cases do not move).
  const unwatch = options.watchReducedMotion?.((next) => {
    if (destroyed || next === reduced) return;
    reduced = next;
    unmount(dom.film);
    unmount(dom.cards);
    // the old film's reason for drawing flat goes with it; the new one
    // reports its own
    delete dom.film.dataset["filmFallback"];
    void mountFilm();
    void mountCards();
  });

  return {
    ready,
    destroy() {
      destroyed = true;
      unwatch?.();
      for (const host of [...parts.keys()]) unmount(host);
      for (const host of [dom.film, dom.cards, dom.uses]) {
        delete host.dataset["mount"];
      }
      delete dom.film.dataset["filmFallback"];
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
    const live = (): boolean => doc.body.dataset["arActive"] === "true";
    const watch = new MutationObserver(() => {
      if (live()) stop();
    });
    watch.observe(doc.body, {
      attributes: true,
      attributeFilter: ["data-ar-active"],
    });
    // a part registered during a live session never sees the change
    if (live()) stop();
    return () => {
      doc.removeEventListener("click", onTap, { capture: true });
      watch.disconnect();
    };
  };
}
