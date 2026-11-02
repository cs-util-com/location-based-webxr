/**
 * The tour's own recorded walk as the page keeps it for the 3D view,
 * across the debug layer's starts and drawings. The layer may show debug
 * data added from elsewhere (possibly another tour's walk), which never
 * becomes the tour's walk.
 *
 * @see tour-walk-kept.ts.md
 */

/**
 * The walk kept when the debug layer starts: the one drawn before while
 * added debug data is shown (that layer never draws the tour's walk), none
 * otherwise (the tour's own layer draws it again).
 */
export function walkAtLayerStart<T>(
  walk: T | null,
  addedDebugShown: boolean,
): T | null {
  return addedDebugShown ? walk : null;
}

/**
 * The walk kept after the layer drew `captures` from `source`: their
 * places, a new array, when `source` is the tour's own walk `tourWalk`
 * (by identity); `walk` unchanged for any other source, and while the
 * tour has no walk.
 */
export function walkAfterDraw<G, S>(
  walk: readonly G[] | null,
  source: S,
  tourWalk: S | null,
  captures: readonly { readonly geo: G }[],
): readonly G[] | null {
  return tourWalk !== null && source === tourWalk
    ? captures.map((c) => c.geo)
    : walk;
}
