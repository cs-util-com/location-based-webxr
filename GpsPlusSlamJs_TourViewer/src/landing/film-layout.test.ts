/**
 * Why these tests matter: the prototype's drawn phone and its close views are laid
 * out against the picture's own box, and the film now fills a box P gives
 * it (about 4:5 on an upright phone, 16:9 elsewhere). The phone must stay
 * inside the box, clear of its soft top and bottom edges, and the close
 * views must fit into the free space left of the phone, so the phone never
 * covers the person, the pin or the code.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { closeRect, filmLayout, ndcRect, viewParams } from "./film-layout.js";

describe("film layout: the phone", () => {
  it("is 47 % of the width on an upright phone, at the prototype's proportions", () => {
    const ly = filmLayout(358, 448, 390);
    expect(ly.portrait).toBe(true);
    expect(ly.phone.w).toBe(Math.round(358 * 0.47));
    expect(ly.phone.h).toBe(Math.round(358 * 0.47 * 1.83));
    expect(ly.phone.x + ly.phone.w).toBe(358 - 12);
    expect(ly.screen).toEqual({
      x: ly.phone.x + 9,
      y: ly.phone.y + 9,
      w: ly.phone.w - 18,
      h: ly.phone.h - 18,
    });
  });

  it("is height-limited in a wide box", () => {
    const ly = filmLayout(800, 450, 1440);
    expect(ly.portrait).toBe(false);
    expect(ly.phone.h).toBeLessThanOrEqual(450 - 52);
    expect(ly.phone.w).toBeLessThanOrEqual(290);
  });

  it("stays inside the box and clear of its soft edges, for every plausible box", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 240, max: 1600 }),
        fc.integer({ min: 200, max: 1000 }),
        fc.integer({ min: 320, max: 2000 }),
        (w, h, vw) => {
          const ly = filmLayout(w, h, vw);
          expect(ly.phone.x).toBeGreaterThanOrEqual(0);
          expect(ly.phone.x + ly.phone.w).toBeLessThanOrEqual(w);
          expect(ly.phone.y).toBeGreaterThanOrEqual(25);
          expect(ly.phone.y + ly.phone.h).toBeLessThanOrEqual(h - 25);
          expect(ly.free.x1).toBeGreaterThan(ly.free.x0);
        },
      ),
    );
  });

  it("reads a zero or garbage size as 1 px, never NaN", () => {
    const ly = filmLayout(0, Number.NaN, 390);
    expect(Number.isFinite(ly.phone.x)).toBe(true);
    expect(ly.W).toBe(1);
    expect(ly.H).toBe(1);
  });
});

describe("film layout: the views", () => {
  it("fits a close view left of the phone, at most 400 x 470 px", () => {
    const ly = filmLayout(1200, 675, 1440);
    const r = closeRect(ly);
    expect(r.x1).toBeLessThanOrEqual(ly.phone.x);
    expect(r.x1 - r.x0).toBeLessThanOrEqual(400);
    expect(r.y1 - r.y0).toBeLessThanOrEqual(470);
  });

  it("gives the overview the whole box and a close view its rectangle, in device coordinates", () => {
    const ly = filmLayout(358, 448, 390);
    expect(ndcRect("over", ly)).toEqual([-0.91, 0.91, -0.9, 0.86]);
    const [x0, x1, y0, y1] = ndcRect("mill", ly);
    expect(x0).toBeGreaterThanOrEqual(-1);
    expect(x1).toBeLessThan((ly.phone.x / ly.W) * 2 - 1);
    expect(y0).toBeLessThan(y1);
  });

  it("looks steeper at an upright box than at a wide one, the prototype's elevations", () => {
    expect(viewParams("over", filmLayout(358, 448, 390)).el).toBeCloseTo(
      (56 * Math.PI) / 180,
      12,
    );
    expect(viewParams("over", filmLayout(800, 450, 1440)).el).toBeCloseTo(
      (40 * Math.PI) / 180,
      12,
    );
    expect(viewParams("mill", filmLayout(800, 450, 1440))).toEqual({
      az: (4 * Math.PI) / 180,
      el: (40 * Math.PI) / 180,
      fov: 18,
    });
  });
});
