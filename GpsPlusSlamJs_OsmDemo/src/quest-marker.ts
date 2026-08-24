/**
 * The gold exclamation mark that marks a chosen geo-event (DEC-G6).
 *
 * WHY A GLYPH AND NOT A COLOURED CIRCLE. The winner and the nine candidates it
 * beat were the same shape at slightly different sizes, so the answer had the
 * same visual weight as the draws it was chosen from. A quest marker is the
 * convention the feedback reached for by name — WoW and Guild Wars both use a
 * gold "!" for "something happens here" — and shape is what survives being one
 * of eleven markers at zoom 18.
 *
 * WHY IT IS INLINE SVG IN A `divIcon`. A Leaflet `circleMarker` is an SVG
 * `<path>`; CSS can recolour it but cannot turn it into a character. `L.marker`
 * with a `divIcon` is the supported way to put arbitrary markup on the map, and
 * inline SVG keeps it in the bundle rather than adding an image request to a
 * demo that has none.
 *
 * WHY THE STRING IS BUILT HERE AND NOT IN `map-view.ts`. It reads a colour
 * constant and it is the one piece of the marker that can be asserted without a
 * browser — the size, the anchor and the layer belong to the map, but "is it
 * actually gold, and is it actually an exclamation mark" does not.
 *
 * @see quest-marker.ts.md
 */

import { GEO_WINNER_COLOUR, cssColour } from "./surface-colours.js";

/**
 * The icon's box, in CSS pixels.
 *
 * Larger than the 7 px circle it replaces, because a glyph needs the room to be
 * a glyph — but not so large that the ~ten candidates around it disappear
 * underneath. `map-view.ts` centres the anchor on this.
 */
export const QUEST_MARKER_PX = 22;

/**
 * The marker's SVG, as a string for `L.divIcon`'s `html`.
 *
 * No interpolation of anything external: the only substitution is a colour
 * constant this module imports, so there is no path by which caller data
 * reaches the markup. (the framework’s `escape-html.ts` exists for the tooltips, which do carry
 * rule-sheet strings.)
 */
export function questMarkerSvg(): string {
  const gold = cssColour(GEO_WINNER_COLOUR);
  return [
    `<svg viewBox="0 0 22 22" width="${QUEST_MARKER_PX}" height="${QUEST_MARKER_PX}" aria-hidden="true">`,
    // The disc first, with a dark rim: the basemap is dark but a gold marker
    // can land on a yellow-end Viridis cell, where an unrimmed disc vanishes.
    `<circle cx="11" cy="11" r="9" fill="${gold}" stroke="#1b1e27" stroke-width="2"/>`,
    // The bar and the dot of the "!", drawn as geometry rather than as a text
    // node: a `<text>` element would render in whatever font the device has and
    // is not centred the same way twice.
    `<rect x="9.6" y="5" width="2.8" height="8" rx="1.2" fill="#1b1e27"/>`,
    `<circle cx="11" cy="16" r="1.7" fill="#1b1e27"/>`,
    `</svg>`,
  ].join("");
}
