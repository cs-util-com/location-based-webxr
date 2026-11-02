/**
 * Why these tests matter (M4a review #12): the editor's dialogs are
 * modal, but Tab walked out of them into the map and the rail behind.
 * Making the rest of the page `inert` while a dialog shows keeps the
 * focus in it - and letting go must give back exactly what it took, never
 * waking a part of the page that was inert for its own reason.
 */
import { describe, expect, it } from "vitest";

import { holdPageInert } from "./page-inert.js";

describe("holdPageInert", () => {
  it("makes every other part inert, and gives back only what it set", () => {
    const map = { inert: false };
    const rail = { inert: false };
    const hiddenAlready = { inert: true };
    const release = holdPageInert([map, rail, hiddenAlready]);
    expect([map.inert, rail.inert, hiddenAlready.inert]).toEqual([
      true,
      true,
      true,
    ]);
    release();
    expect([map.inert, rail.inert, hiddenAlready.inert]).toEqual([
      false,
      false,
      true,
    ]);
    // A second release changes nothing.
    map.inert = true;
    release();
    expect(map.inert).toBe(true);
  });
});
