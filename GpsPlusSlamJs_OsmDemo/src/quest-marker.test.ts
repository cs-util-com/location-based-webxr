/**
 * WHY THESE TESTS MATTER (DEC-G6).
 *
 * The marker is drawn by Leaflet into a live map, so the only other way to
 * check it is an e2e screenshot — which can tell you a marker appeared but not
 * that it is the right colour, and certainly not that it stopped being an
 * exclamation mark. Both are silent failures: a gold disc with no glyph looks
 * deliberate.
 *
 * The colour is asserted against the CONSTANT rather than against a literal, so
 * a palette change moves the marker with it instead of leaving a test that
 * passes on a colour nothing uses.
 */

import { describe, expect, it } from "vitest";

import { QUEST_MARKER_PX, questMarkerSvg } from "./quest-marker.js";
import { GEO_WINNER_COLOUR, cssColour } from "./surface-colours.js";

describe("questMarkerSvg", () => {
  it("is gold, from the shared constant", () => {
    // Against the constant, not `#ffc93c`: `marker-palette.test.ts` owns the
    // value, and this owns "the marker uses it".
    expect(questMarkerSvg()).toContain(
      `fill="${cssColour(GEO_WINNER_COLOUR)}"`,
    );
  });

  it("draws the glyph as geometry, not as a text node", () => {
    // A `<text>` element renders in whatever font the device has, and centres
    // differently on each — so the marker would be subtly wrong on exactly the
    // phones this demo is tested on. The bar and the dot are a rect and a
    // circle for that reason.
    const svg = questMarkerSvg();
    expect(svg).not.toContain("<text");
    expect(svg).toContain("<rect");
    // Three circles in total: the disc, the dot of the "!", and nothing else.
    expect(svg.match(/<circle/g)).toHaveLength(2);
  });

  it("sizes the viewBox to the icon box, so it is not scaled twice", () => {
    // Leaflet sizes the icon element from `iconSize` and the SVG scales itself
    // from `viewBox`. If the two disagree the glyph is drawn at one size and
    // clipped at another — which looks like a rendering bug rather than a
    // number being wrong in two places.
    const svg = questMarkerSvg();
    expect(svg).toContain(`width="${QUEST_MARKER_PX}"`);
    expect(svg).toContain(`height="${QUEST_MARKER_PX}"`);
    expect(svg).toContain('viewBox="0 0 22 22"');
  });

  it("carries a rim, so it survives landing on a bright heat cell", () => {
    // The basemap is dark, which makes a bare gold disc perfectly readable —
    // until the winner lands on a yellow-end Viridis cell, which is where it
    // most often lands, since the climb walks towards high heat.
    expect(questMarkerSvg()).toContain('stroke="#1b1e27"');
  });

  it("is decorative to assistive technology", () => {
    // The information is in the tooltip and in the button's label; a bare
    // "image" announcement adds nothing and interrupts.
    expect(questMarkerSvg()).toContain('aria-hidden="true"');
  });
});
