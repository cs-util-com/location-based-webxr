/**
 * Why these tests matter: "Look from the viewpoint" must frame what the
 * picture's camera framed, so the editor's camera takes the viewpoint's
 * lens while it looks from there, and must get its own lens back once the
 * creator leaves (else every later view of the tour is zoomed in or out
 * with nothing on screen saying so).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createLensHold, verticalFovDeg } from "./editor3d-lens.js";

function camera(aspect = 16 / 10, fov = 50) {
  return {
    fov,
    aspect,
    projections: 0,
    updateProjectionMatrix() {
      this.projections++;
    },
  };
}

describe("verticalFovDeg", () => {
  // Why: three's camera takes the vertical field; a square view's is the
  // horizontal one, and a wide one's is narrower by tan(h/2)/aspect.
  it("works the horizontal lens into the vertical one", () => {
    expect(verticalFovDeg(56, 1)).toBeCloseTo(56, 9);
    expect(verticalFovDeg(90, 2)).toBeCloseTo(
      2 * Math.atan(0.5) * (180 / Math.PI),
      9,
    );
  });

  // Why: a lens from the file is data; a broken one must not reach the
  // camera as NaN or a field past 180 degrees.
  it("refuses a lens or an aspect it cannot use", () => {
    for (const h of [0, -5, 180, 200, Number.NaN, Infinity]) {
      expect(verticalFovDeg(h, 1.6), String(h)).toBeNull();
    }
    for (const a of [0, -1, Number.NaN, Infinity]) {
      expect(verticalFovDeg(56, a), String(a)).toBeNull();
    }
  });

  // Why: whatever the lens and the view, the field is in (0, 180) and
  // turns back into the same horizontal lens.
  it("keeps the horizontal lens at any aspect (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 170, noNaN: true }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        (h, aspect) => {
          const v = verticalFovDeg(h, aspect)!;
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThan(180);
          const back =
            2 *
            Math.atan(Math.tan((v * Math.PI) / 360) * aspect) *
            (180 / Math.PI);
          expect(back).toBeCloseTo(h, 6);
        },
      ),
    );
  });
});

describe("createLensHold", () => {
  // Why: both directions of the hold - the lens while looking from the
  // viewpoint, the camera's own field of view once it is released.
  it("lends the lens and gives the camera's own back", () => {
    const cam = camera(1);
    const lens = createLensHold(cam, 50);
    expect(lens.lookThrough("pic", 70)).toBe(true);
    expect(cam.fov).toBeCloseTo(70, 9);
    expect(lens.selection()).toBe("pic");
    expect(cam.projections).toBe(1);
    lens.release();
    expect(cam.fov).toBe(50);
    expect(lens.selection()).toBeNull();
    expect(cam.projections).toBe(2);
  });

  // Why: release runs on every gesture and camera verb; with no lens
  // held it must leave the camera alone (the globe's arrival eases its own
  // field of view, which a stray release would snap).
  it("leaves the camera alone when no lens holds", () => {
    const cam = camera(1, 42);
    const lens = createLensHold(cam, 50);
    lens.release();
    lens.apply();
    expect(cam.fov).toBe(42);
    expect(cam.projections).toBe(0);
  });

  // Why: the horizontal lens is what is fixed; a resize that changes the
  // aspect must change the vertical field so the frame stays the
  // picture's.
  it("follows the aspect each frame", () => {
    const cam = camera(1);
    const lens = createLensHold(cam, 50);
    lens.lookThrough("pic", 60);
    cam.aspect = 2;
    lens.apply();
    expect(cam.fov).toBeCloseTo(verticalFovDeg(60, 2)!, 9);
    const projections = cam.projections;
    lens.apply();
    expect(cam.projections).toBe(projections);
  });

  // Why: a broken lens must not leave the camera on an earlier one.
  it("releases on a lens it cannot use", () => {
    const cam = camera(1);
    const lens = createLensHold(cam, 50);
    lens.lookThrough("pic", 60);
    expect(lens.lookThrough("other", Number.NaN)).toBe(false);
    expect(cam.fov).toBe(50);
    expect(lens.selection()).toBeNull();
  });

  it("refuses an own field of view outside (0, 180)", () => {
    for (const own of [0, 180, Number.NaN]) {
      expect(() => createLensHold(camera(), own), String(own)).toThrow(
        RangeError,
      );
    }
  });
});
