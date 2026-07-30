/**
 * How a merged region is drawn on the 2D map (W15).
 *
 * WHY THESE TESTS MATTER. Regions shipped as a quiet dashed outline and the
 * round-1 testing session missed them completely — the owner asked whether the
 * flood fill existed, about a feature that had been on screen throughout. So the
 * thing to assert is not "a style object is returned" but the two properties
 * that made it invisible: it fills, and it fills in the ramp's colour.
 *
 * The colour assertions compare against `heatColour` rather than against literal
 * hex strings on purpose. A literal would pin today's ramp and would keep
 * passing if the map's ramp changed and this one did not — which is precisely
 * the divergence the shared function exists to prevent.
 */

import { describe, expect, it } from "vitest";

import { heatColour, heatScale } from "./heat-colours.js";
import { regionStyle } from "./region-style.js";

const SCALE = heatScale([1, 4, 20, 100], 1);

/** `heatColour` as `#rrggbb`, the form Leaflet takes. */
function expectedHex(score: number): string {
  const { r, g, b } = heatColour(score, SCALE);
  const channel = (v: number): string =>
    Math.round(v).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

describe("regionStyle — unfilled", () => {
  it("keeps the dashed boundary and does not fill", () => {
    const style = regionStyle(20, SCALE, false);
    expect(style.fill).toBe(false);
    expect(style.dashArray).toBe("4 4");
    expect(style.fillColor).toBeUndefined();
  });

  it("is countable as an outline, and NOT as a fill", () => {
    // Leaflet renders every polygon as an indistinguishable `<path>`. Without
    // distinct classes an e2e asserting "regions are filled" would match the
    // unfilled outline and pass while nothing had changed — the same trap the
    // affordance cells already have named classes for.
    const style = regionStyle(20, SCALE, false);
    expect(style.className).toContain("region-outline");
    expect(style.className).not.toContain("region-fill");
  });
});

describe("regionStyle — filled", () => {
  it("fills in the ramp's colour for the region's median score", () => {
    // THE ASSERTION W15 EXISTS FOR. The 2D fill, the 3D slab, the cells and the
    // legend all read one ramp; a region that looks good on the map and poor in
    // the scene is the cross-view disagreement the store was introduced to
    // prevent, and it would be invisible because each view is self-consistent.
    const style = regionStyle(20, SCALE, true);
    expect(style.fill).toBe(true);
    expect(style.fillColor).toBe(expectedHex(20));
  });

  it("tracks the score, so two regions are not painted alike", () => {
    const low = regionStyle(1, SCALE, true);
    const high = regionStyle(100, SCALE, true);
    expect(low.fillColor).not.toBe(high.fillColor);
    expect(low.fillColor).toBe(expectedHex(1));
    expect(high.fillColor).toBe(expectedHex(100));
  });

  it("stays WEAKER than the cells it is drawn over", () => {
    // DEC-R2-10 rejected a two-state `cells <-> areas` switch specifically so a
    // merged area can be seen OVER the cells that produced it — the first check
    // anyone performs when a region looks wrong. A fill as strong as the cells'
    // 0.55 would make that pairing useless exactly when it is wanted.
    const style = regionStyle(20, SCALE, true);
    expect(style.fillOpacity).toBeGreaterThan(0);
    expect(style.fillOpacity ?? 1).toBeLessThan(0.55);
  });

  it("keeps the dashed boundary as well as the fill", () => {
    // Two different questions: the fill says how good, the boundary says where
    // it ends. A fill is washed out at its own edge, which is where the second
    // question is asked.
    const style = regionStyle(20, SCALE, true);
    expect(style.dashArray).toBe("4 4");
    expect(style.color).toBe("#ffffff");
  });

  it("is countable as a fill", () => {
    expect(regionStyle(20, SCALE, true).className).toContain("region-fill");
  });

  it("emits six hex digits even for channels below 16", () => {
    // `toString(16)` gives "5" rather than "05", and "#5a0b0" is a colour
    // Leaflet silently ignores — the region would then draw with the browser
    // default rather than with its score's colour, which reads as a styling
    // choice rather than as a bug.
    for (const score of [1, 2, 5, 20, 100, 1000]) {
      expect(regionStyle(score, SCALE, true).fillColor).toMatch(
        /^#[0-9a-f]{6}$/,
      );
    }
  });
});
