/**
 * The 3D view's card pictures: a station card's picture is read from the
 * tour only when its card scrolls into view, checked as the card's photo
 * is (`pictureProblem`: a picture too large to decode is left out), and
 * kept as one object URL per picture until the shell lets them all go.
 *
 * @see shell-pictures.ts.md
 */
import { pictureProblem } from "../../image-cap.js";

export interface ShellPictures {
  /** Show the picture at `path` (a content path of the tour) as `el`'s
   *  background once `el` is in view; a picture that cannot be read or
   *  shown leaves `el` as it is (its placeholder colour). */
  show(el: HTMLElement, path: string): void;
  /** Stop watching and let every picture go (the shell hidden, or the
   *  tour another). */
  clear(): void;
}

export function createShellPictures(deps: {
  /** The picture's bytes from the open tour. */
  readonly load: (path: string) => Promise<Blob>;
}): ShellPictures {
  /** A path's URL once read; null for one that cannot be shown. */
  const urls = new Map<string, Promise<string | null>>();
  const wanted = new WeakMap<Element, string>();
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
      .catch(() => null);
    urls.set(path, url);
    return url;
  };

  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        seen.unobserve(el);
        const path = wanted.get(el);
        if (path === undefined) continue;
        void read(path).then((url) => {
          if (url !== null && wanted.get(el) === path) {
            el.style.backgroundImage = `url("${url}")`;
          }
        });
      }
    },
    // The window: a card scrolled out of its dock is clipped by the dock,
    // so it counts as out of view too.
    { rootMargin: "120px 0px" },
  );

  return {
    show(el, path) {
      wanted.set(el, path);
      seen.observe(el);
    },
    clear() {
      seen.disconnect();
      generation += 1;
      const all = [...urls.values()];
      urls.clear();
      for (const url of all) {
        void url.then((u) => {
          if (u !== null) URL.revokeObjectURL(u);
        });
      }
    },
  };
}
