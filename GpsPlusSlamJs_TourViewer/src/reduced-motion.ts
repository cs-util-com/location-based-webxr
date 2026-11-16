/**
 * Whether the visitor asked for less motion, for a reader asked every
 * frame: the media query is made once, on the first ask, and its live
 * answer read after that.
 *
 * @see reduced-motion.ts.md
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** What the reader needs of a window. */
export interface MotionWindow {
  readonly matchMedia?:
    ((query: string) => { readonly matches: boolean }) | undefined;
}

/** A reader of `win`'s reduced-motion setting: false without a window or
 *  without `matchMedia`. */
export function reducedMotionReader(
  win: MotionWindow | null | undefined,
): () => boolean {
  let query: { readonly matches: boolean } | null | undefined;
  return () => {
    if (query === undefined) {
      query =
        typeof win?.matchMedia === "function"
          ? win.matchMedia(REDUCED_MOTION)
          : null;
    }
    return query?.matches === true;
  };
}
