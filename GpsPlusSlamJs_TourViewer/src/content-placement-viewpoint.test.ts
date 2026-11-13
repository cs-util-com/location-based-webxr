/**
 * Why these tests matter: a picture in a view seen from a viewpoint is
 * drawn by its world part only when it has a viewpoint; without one the
 * format reads it as a plane and the renderer must draw it so, or the
 * picture would vanish. `drawnKindOf` is what tells a view switch whether
 * anything drawn changed.
 */
import type { TourPictureBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { TOUR_PICTURE_VIEWPOINT_VIEWS } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { describe, expect, it } from "vitest";

import { drawnKindOf } from "./content-placement.js";

const BASE: TourPictureBlock = {
  id: "p1",
  kind: "picture",
  view: "plane",
  image: "img",
  widthM: 1,
  pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
};
const VIEWPOINT = {
  position: [0, 1.6, 0],
  rotation: [0, 0, 0, 1],
  hfovDeg: 60,
  distanceM: 10,
} as const;

describe("drawnKindOf for pictures", () => {
  it("draws a viewpoint view as a plane only without a viewpoint", () => {
    for (const view of TOUR_PICTURE_VIEWPOINT_VIEWS) {
      expect(drawnKindOf({ ...BASE, view }, view)).toBe("plane");
      expect(drawnKindOf({ ...BASE, view, viewpoint: VIEWPOINT }, view)).toBe(
        view,
      );
    }
  });

  it("keeps the plane a plane and the standing views their own", () => {
    expect(drawnKindOf(BASE, "plane")).toBe("plane");
    expect(drawnKindOf({ ...BASE, viewpoint: VIEWPOINT }, "plane")).toBe(
      "plane",
    );
    expect(drawnKindOf(BASE, "framed")).toBe("framed");
    expect(drawnKindOf(BASE, "cutout")).toBe("cutout");
  });
});
