import { describe, expect, it } from "vitest";

import { gridPositions } from "./gallery.js";

/**
 * The gallery's layout arithmetic (W7).
 *
 * WHY THIS IS THE ONLY UNIT-TESTED PART. `buildGallery` needs a `WebGLRenderer`
 * and cannot be constructed here — the same constraint `building-view` lives
 * under. What CAN be wrong without a GPU is the grid: models overlapping each
 * other, or the whole sheet drifting off-centre so the default camera frames
 * half of it. Both look like "the page is broken" rather than like a layout bug.
 *
 * The e2e half — that the page loads, draws something, and logs no error — is in
 * `osm-demo.spec.js`.
 */

describe("gridPositions", () => {
  it("gives every model its own place", () => {
    const positions = gridPositions(50);
    expect(positions).toHaveLength(50);
    const keys = new Set(positions.map((at) => `${at.x},${at.z}`));
    expect(keys.size).toBe(50);
  });

  it("keeps pads from overlapping", () => {
    // The pad is 6.4 m and the pitch is 8 m, so no two centres may be closer
    // than the pad width. A fuel-station canopy overhanging its neighbour's
    // bench is exactly the confusion this page exists to remove.
    const positions = gridPositions(50);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i];
        const b = positions[j];
        if (a === undefined || b === undefined) continue;
        const distance = Math.hypot(a.x - b.x, a.z - b.z);
        expect(distance).toBeGreaterThanOrEqual(6.4);
      }
    }
  });

  it("centres the sheet on the origin", () => {
    // The default camera looks at (0,0,0). A grid laid out from the origin
    // OUTWARD rather than around it puts three quarters of the models off screen
    // on first load, which reads as "only twelve models exist".
    const positions = gridPositions(50);
    const xs = positions.map((at) => at.x);
    const zs = positions.map((at) => at.z);
    const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centreZ = (Math.min(...zs) + Math.max(...zs)) / 2;
    expect(Math.abs(centreX)).toBeLessThan(0.001);
    // The last row may be partial, so z can be off by at most half a pitch.
    expect(Math.abs(centreZ)).toBeLessThanOrEqual(4);
  });

  it("stays roughly square rather than a single long row", () => {
    // A 1x50 strip is a valid grid and a useless one: it cannot be framed, and
    // comparing the first model with the last needs a camera journey.
    const positions = gridPositions(50);
    const width =
      Math.max(...positions.map((at) => at.x)) -
      Math.min(...positions.map((at) => at.x));
    const depth =
      Math.max(...positions.map((at) => at.z)) -
      Math.min(...positions.map((at) => at.z));
    expect(width / Math.max(1, depth)).toBeLessThan(2);
  });

  it("handles the degenerate counts without dividing by zero", () => {
    // Not hypothetical: `POI_MODELS` is data, and a filter applied upstream one
    // day could hand this a 0 or a 1.
    expect(gridPositions(0)).toEqual([]);
    expect(gridPositions(1)).toEqual([{ x: 0, z: 0 }]);
  });
});
