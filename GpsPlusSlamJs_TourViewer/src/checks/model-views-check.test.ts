/**
 * Why these tests matter: the check page is driven by a test and by a
 * person comparing it with the views' prototype. A block it quietly
 * repaired would show something the caller never asked for, and a field of
 * view other than the prototype's would make every side-by-side
 * comparison differ for a reason that is not the view's.
 */
import { describe, expect, it } from "vitest";

import { checkModelBlock, viewerFovDeg } from "./model-views-check.js";

const good = {
  id: "bell",
  kind: "model",
  view: "hotspots",
  asset: "bell",
  sizeM: 2.7,
  createdAtIso: "2026-10-28T12:00:00.000Z",
  pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
};

describe("checkModelBlock", () => {
  it("passes a model block in every world view", () => {
    for (const view of ["placed", "ghost", "hotspots", "cutaway", "toy"]) {
      expect(checkModelBlock({ ...good, view }).view).toBe(view);
    }
  });

  it("refuses what is not a model block in a world view, naming the field", () => {
    expect(() => checkModelBlock(null)).toThrow(/object/);
    expect(() => checkModelBlock({ ...good, kind: "picture" })).toThrow(/kind/);
    expect(() => checkModelBlock({ ...good, view: "stage" })).toThrow(/view/);
    expect(() => checkModelBlock({ ...good, sizeM: 0 })).toThrow(/sizeM/);
    expect(() => checkModelBlock({ ...good, sizeM: Number.NaN })).toThrow(
      /sizeM/,
    );
    expect(() => checkModelBlock({ ...good, id: "" })).toThrow(/id/);
  });
});

describe("viewerFovDeg", () => {
  it("spans 45 degrees across the screen's short side", () => {
    expect(viewerFovDeg(1440, 900)).toBe(45);
    expect(viewerFovDeg(844, 390)).toBe(45);
    const portrait = viewerFovDeg(390, 844);
    // The horizontal span of a portrait screen is the 45 degrees.
    const horizontal =
      2 * Math.atan(Math.tan((portrait * Math.PI) / 360) * (390 / 844));
    expect((horizontal * 180) / Math.PI).toBeCloseTo(45, 9);
    expect(viewerFovDeg(0, 100)).toBe(45);
  });
});
