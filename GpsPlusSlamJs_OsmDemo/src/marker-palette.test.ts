/**
 * The map's four marker colours, and the two claims they have to keep.
 *
 * WHY THESE TESTS MATTER (G8, DEC-G6). The tester's first complaint about the
 * geo-event was not about the algorithm — it was that the user dot and the event
 * markers were the same red. So were both fetch outlines: FOUR distinct things
 * in one colour, on a map whose job is telling them apart. The colours lived in
 * `index.html`'s CSS and in two literals in `map-view.ts`, where nothing could
 * compare them, which is exactly how they converged.
 *
 * There are two claims and they pull against each other, which is why both are
 * pinned. The candidates and the winner must stay in ONE family, so "these ten
 * produced that one" reads off the map; everything else must stay OUT of that
 * family. A palette edit that satisfies one and breaks the other is the
 * plausible mistake.
 */

import { describe, expect, it } from "vitest";

import {
  FETCH_BOX_COLOUR,
  GEO_CANDIDATE_COLOUR,
  GEO_WINNER_COLOUR,
  GROUND_COLOUR,
  PLATE_COLOUR,
  UNDERGROUND_COLOUR,
  USER_POSITION_COLOUR,
  cssColour,
} from "./surface-colours.js";

/**
 * Hue in degrees, 0–360, for a packed colour.
 *
 * Local to the test on purpose: production never needs it, and a helper in
 * `surface-colours.ts` would invite someone to compute palettes at runtime
 * rather than choose them.
 */
function hueOf(colour: number): number {
  const r = ((colour >> 16) & 0xff) / 255;
  const g = ((colour >> 8) & 0xff) / 255;
  const b = (colour & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / span) % 6;
  else if (max === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;
  return (((hue * 60) % 360) + 360) % 360;
}

/** The shorter way round the colour wheel, 0–180. */
function hueGap(a: number, b: number): number {
  const raw = Math.abs(hueOf(a) - hueOf(b));
  return Math.min(raw, 360 - raw);
}

describe("the map's marker palette", () => {
  it("gives the four map markers four different colours", () => {
    // The reported bug, stated as an invariant. All four were `#ff3860`.
    const palette = [
      USER_POSITION_COLOUR,
      GEO_WINNER_COLOUR,
      GEO_CANDIDATE_COLOUR,
      FETCH_BOX_COLOUR,
    ];
    expect(new Set(palette).size).toBe(palette.length);
  });

  it("keeps the candidates and the winner in ONE hue family", () => {
    // DEC-G6: the candidates are the losing draws from the batch that produced
    // the winner, and that relationship has to be visible. Contrasting colours
    // would read as two unrelated overlays.
    expect(hueGap(GEO_CANDIDATE_COLOUR, GEO_WINNER_COLOUR)).toBeLessThan(20);
  });

  it("keeps everything else OUT of that family", () => {
    // The counterweight, and the half a palette edit is likely to break. A
    // "tidy the reds" change that pulled the fetch boxes towards gold would
    // pass the distinctness test above while undoing the point of it.
    for (const other of [
      USER_POSITION_COLOUR,
      FETCH_BOX_COLOUR,
      UNDERGROUND_COLOUR,
    ]) {
      expect(hueGap(other, GEO_WINNER_COLOUR)).toBeGreaterThan(45);
    }
  });

  it("keeps the user dot clear of every surface and diagnostic colour too", () => {
    // "You are here" is the one marker that is always present, so it is the one
    // that must never be mistaken for anything — including the ground it sits
    // on and the below-surface diagnostic.
    for (const other of [GROUND_COLOUR, PLATE_COLOUR, UNDERGROUND_COLOUR]) {
      expect(USER_POSITION_COLOUR).not.toBe(other);
    }
  });

  it("renders to the six-digit hex Leaflet and the CSS both take", () => {
    // The same drift guard `UNDERGROUND_COLOUR` has: a three.js material wants
    // the number and a Leaflet path option wants the string, and two constants
    // would diverge invisibly.
    expect(cssColour(USER_POSITION_COLOUR)).toBe("#1a73e8");
    expect(cssColour(GEO_WINNER_COLOUR)).toBe("#ffc93c");
    expect(cssColour(GEO_CANDIDATE_COLOUR)).toBe("#ffe08a");
    expect(cssColour(FETCH_BOX_COLOUR)).toBe("#ff3860");
  });
});
