/**
 * Why these tests matter: the 3D view draws the walk the page hands it as
 * the TOUR's own walk. Debug data added from elsewhere may be another
 * tour's walk, so it must never become that walk; and while it is shown
 * the tour's own walk, drawn before, must not be dropped. Both rules lived
 * inline in the page with no test, and a mutant of each survived.
 */
import { describe, expect, it } from "vitest";

import { walkAfterDraw, walkAtLayerStart } from "./tour-walk-kept.js";

const own = [{ lat: 1, lon: 2 }];
const captures = [{ geo: { lat: 3, lon: 4 } }, { geo: { lat: 5, lon: 6 } }];

describe("walkAtLayerStart", () => {
  it("keeps the tour's walk while added debug data is shown", () => {
    // Why: the added data's layer never redraws the tour's walk, so
    // dropping it here would leave the 3D view with none.
    expect(walkAtLayerStart(own, true)).toBe(own);
  });

  it("drops it otherwise, until the layer draws the walk again", () => {
    // Why: a new tour, or the tour's own layer restarting, must not show
    // the walk of before.
    expect(walkAtLayerStart(own, false)).toBeNull();
    expect(walkAtLayerStart(null, true)).toBeNull();
  });
});

describe("walkAfterDraw", () => {
  it("takes the drawn captures' places when the layer shows the tour's walk", () => {
    // Why: one new array per drawing, so the view sees a new walk by its
    // identity.
    const walk = walkAfterDraw(own, true, captures);
    expect(walk).toEqual([
      { lat: 3, lon: 4 },
      { lat: 5, lon: 6 },
    ]);
    expect(walk).not.toBe(own);
  });

  it("never takes another source's captures", () => {
    // Why: added debug data may be another tour's walk; the tour's own
    // (or none) stays.
    expect(walkAfterDraw(own, false, captures)).toBe(own);
    expect(walkAfterDraw(null, false, captures)).toBeNull();
  });
});
