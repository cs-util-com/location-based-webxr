/**
 * How a merged region is drawn on the 2D map (W15).
 *
 * WHY THIS IS ITS OWN MODULE. `map-view.ts` imports Leaflet, so anything living
 * there can only be tested through a map instance. The decision here is pure —
 * a region, a scale and a flag in, a style object out — and it is the half that
 * can actually be wrong: the wrong colour, or a fill that does not appear.
 *
 * WHY REGIONS WERE UNDERSTATED, and what changed. They shipped as a 2 px dashed
 * white stroke with `fill: false`, deliberately quiet so they would not compete
 * with the affordance cells. The round-1 testing session then missed them
 * entirely — the owner's note was that the flood fill "might be exactly this",
 * about a feature that had been on screen the whole time. Understatement is a
 * choice with a cost, and this is that cost.
 *
 * THE OUTLINE STAYS EITHER WAY. The fill answers "how good is this region"; the
 * dashed boundary answers "where does it end", and the second question does not
 * stop mattering when the first is answered. They are also visually different
 * jobs: a fill is washed out at the boundary precisely where the edge matters.
 *
 * @see region-style.ts.md
 */

import { heatColour, type HeatScale } from "./heat-colours.js";

/** The Leaflet path options this module decides. */
export interface RegionStyle {
  readonly color: string;
  readonly weight: number;
  readonly fill: boolean;
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  readonly dashArray: string;
  readonly className: string;
}

/**
 * Fill opacity for a region.
 *
 * BELOW the cells' 0.55, on purpose. A region is drawn over the very cells that
 * produced it, and DEC-R2-10 exists so a user can see both at once — the whole
 * reason a two-state `cells ↔ areas` switch was rejected. A fill as strong as
 * the cells would make the pair useless exactly when it is wanted.
 */
const FILL_OPACITY = 0.3;

/** `#rrggbb` for a score, through the map's own ramp. */
function hexFor(score: number, scale: HeatScale): string {
  const { r, g, b } = heatColour(score, scale);
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * The style for one region's outline, filled or not.
 *
 * The colour comes from `heatColour` — the SAME function the cells, the legend
 * and the 3D slabs use. A region cannot read as "good" in one place and "poor"
 * in another, which is the cross-view disagreement the store exists to prevent.
 *
 * `className` differs between the two states so an e2e can count what is
 * actually on screen: Leaflet renders every polygon as an indistinguishable
 * `<path>`, and a test asserting "regions are filled" would otherwise match the
 * unfilled outline and pass while nothing had changed.
 */
export function regionStyle(
  medianScore: number,
  scale: HeatScale,
  filled: boolean,
): RegionStyle {
  const base = {
    color: "#ffffff",
    weight: 2,
    dashArray: "4 4",
  };
  if (!filled) {
    return { ...base, fill: false, className: "region-outline" };
  }
  return {
    ...base,
    fill: true,
    fillColor: hexFor(medianScore, scale),
    fillOpacity: FILL_OPACITY,
    className: "region-outline region-fill",
  };
}
