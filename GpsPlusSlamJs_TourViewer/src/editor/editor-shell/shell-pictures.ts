/**
 * The 3D view's card pictures: a station card's picture is read from the
 * tour only when its card scrolls into view, checked as the card's photo
 * is (`pictureProblem`: a picture too large to decode is left out), and
 * kept as one object URL per picture until the shell lets them all go. A
 * picture read once shows at once on every card drawn after, so a redraw
 * never blanks it; the cards a redraw replaced stop being watched. A read
 * that fails is tried again a few times for the card still waiting; a
 * picture with a problem is not: it stays as it is.
 *
 * @see shell-pictures.ts.md
 */
import { pictureProblem } from "../../image-cap.js";

/** How often a picture's read is tried, and the wait between tries. */
const READ_TRIES = 3;
const RETRY_MS = 1500;

export interface ShellPictures {
  /** Show the picture at `path` (a content path of the tour) as `el`'s
   *  background: at once when it was read before, else once `el` is in
   *  view; a picture that cannot be read or shown leaves `el` as it is
   *  (its placeholder colour). */
  show(el: HTMLElement, path: string): void;
  /** Stop watching every card no panel holds any more (a redraw
   *  replaced it): called after each draw. */
  sweep(): void;
  /** Stop watching and let every picture go (the shell hidden, or the
   *  tour another). */
  clear(): void;
}

export function createShellPictures(deps: {
  /** The picture's bytes from the open tour. */
  readonly load: (path: string) => Promise<Blob>;
  /** Whether a panel still holds `el` (default: `el` is in the page). A
   *  docked panel behind another tab is out of the page, and its cards
   *  still wait for their pictures. */
  readonly owns?: (el: Element) => boolean;
}): ShellPictures {
  const owns = deps.owns ?? ((el: Element) => el.isConnected);
  /** A path's URL once read; null for one that cannot be shown. A read
   *  that failed and may be tried again leaves no entry here. */
  const urls = new Map<string, Promise<string | null>>();
  /** The same, for the reads that have finished: shown without waiting. */
  const resolved = new Map<string, string | null>();
  /** How many of a path's reads failed so far. */
  const failed = new Map<string, number>();
  const wanted = new WeakMap<Element, string>();
  /** The cards watched until they come into view. */
  const watched = new Set<Element>();
  /** Bumped by `clear`: a read finishing after it is let go at once. */
  let generation = 0;

  const read = (path: string): Promise<string | null> => {
    const known = urls.get(path);
    if (known !== undefined) return known;
    const mine = generation;
    const url = deps
      .load(path)
      .then(async (blob) => {
        if ((await pictureProblem(blob)) !== null) return null;
        const made = URL.createObjectURL(blob);
        if (mine !== generation) {
          URL.revokeObjectURL(made);
          return null;
        }
        return made;
      })
      .then(
        (made) => {
          if (mine === generation) resolved.set(path, made);
          return made;
        },
        () => {
          if (mine !== generation) return null;
          const tries = (failed.get(path) ?? 0) + 1;
          failed.set(path, tries);
          if (tries >= READ_TRIES) resolved.set(path, null);
          else urls.delete(path);
          return null;
        },
      );
    urls.set(path, url);
    return url;
  };

  /** `el`'s picture read and shown, tried again while it may still come
   *  and `el` still waits for it. */
  const fetchFor = (el: HTMLElement, path: string): void => {
    const mine = generation;
    void read(path).then((url) => {
      if (url !== null) {
        if (wanted.get(el) === path) {
          el.style.backgroundImage = `url("${url}")`;
        }
        return;
      }
      if (mine !== generation || resolved.has(path)) return;
      setTimeout(() => {
        if (mine === generation && owns(el) && wanted.get(el) === path) {
          fetchFor(el, path);
        }
      }, RETRY_MS);
    });
  };

  const forget = (el: Element) => {
    seen.unobserve(el);
    watched.delete(el);
  };

  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        forget(el);
        const path = wanted.get(el);
        if (path === undefined) continue;
        fetchFor(el, path);
      }
    },
    // The window: a card scrolled out of its dock is clipped by the dock,
    // so it counts as out of view too.
    { rootMargin: "120px 0px" },
  );

  return {
    show(el, path) {
      wanted.set(el, path);
      if (resolved.has(path)) {
        const url = resolved.get(path);
        if (url !== null && url !== undefined) {
          el.style.backgroundImage = `url("${url}")`;
        }
        return;
      }
      watched.add(el);
      seen.observe(el);
    },
    sweep() {
      for (const el of [...watched]) {
        if (!owns(el)) forget(el);
      }
    },
    clear() {
      seen.disconnect();
      watched.clear();
      generation += 1;
      const all = [...urls.values()];
      urls.clear();
      resolved.clear();
      failed.clear();
      for (const url of all) {
        void url.then((u) => {
          if (u !== null) URL.revokeObjectURL(u);
        });
      }
    },
  };
}
