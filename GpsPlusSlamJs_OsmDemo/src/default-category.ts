/**
 * Which affordance category the demo opens on (DEC-G3).
 *
 * WHY IT IS `battleArea` AND NOT `walkable`. The demo's headline feature is the
 * geo-event, which models a randomly spawned boss NPC — and a boss belongs on a
 * battle area, not on a pavement. Opening on `walkable` made the feature read as
 * nonsense on first contact ("a geo-event for walkable?"), which is a framing
 * problem rather than a bug, and the cheapest fix is to open on the category the
 * feature is about.
 *
 * WHY IT IS A GUARDED CHOICE AND NOT A LITERAL. The category list comes from the
 * published rule sheet at runtime, and a table without this column is a real,
 * already-shipping case — `data-and-caching.spec.js` boots one whose only
 * category is `walkable`. Falling back to the first column means a degraded or
 * hand-edited table still produces a usable picker instead of an empty one.
 *
 * @see default-category.ts.md
 */

/** The category the demo opens on when the table offers it. */
export const DEFAULT_CATEGORY = "battleArea";

/**
 * The opening category for a table's column list.
 *
 * Returns `""` for an empty list, which is what an empty `<select>` reports —
 * so the caller assigns a value the DOM already agrees with rather than one it
 * will silently discard.
 */
export function pickDefaultCategory(categories: readonly string[]): string {
  if (categories.includes(DEFAULT_CATEGORY)) return DEFAULT_CATEGORY;
  return categories[0] ?? "";
}
