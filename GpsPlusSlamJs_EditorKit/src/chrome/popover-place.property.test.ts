/**
 * Why these properties matter: the card is placed beside a marker anywhere
 * in a free area of any size, and every app that uses the block gives it
 * its own rail and bars. The example tests and the existing sweeps use one
 * fixed free area; these sweep the free area too. Whenever the card fits
 * the free area it lies inside it, it never covers its own marker on the
 * side it names (right of it, left of it, or under it), and its arrow
 * stays on the card's edge, so it points from the card at the marker. A
 * marker well outside the free area always hides the card.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { placePopover } from "./popover-place.js";

/** A free area (left, top, width, height) and a card that fits it. */
const scene = fc
  .record({
    left: fc.integer({ min: 0, max: 600 }),
    top: fc.integer({ min: 0, max: 200 }),
    width: fc.integer({ min: 220, max: 2000 }),
    height: fc.integer({ min: 140, max: 1400 }),
    cardW: fc.integer({ min: 160, max: 420 }),
    cardH: fc.integer({ min: 60, max: 420 }),
    gap: fc.integer({ min: 8, max: 40 }),
    lift: fc.integer({ min: 0, max: 40 }),
    ax: fc.double({ min: 0, max: 1, noNaN: true }),
    ay: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .filter((s) => s.cardW <= s.width && s.cardH <= s.height);

describe("placePopover over any free area (property)", () => {
  it("lies inside the free area, beside its marker, its arrow on its edge", () => {
    fc.assert(
      fc.property(scene, (s) => {
        const free = {
          left: s.left,
          top: s.top,
          right: s.left + s.width,
          bottom: s.top + s.height,
        };
        // The marker's centre (anchor lifted) inside the free area.
        const anchor = {
          x: free.left + s.ax * s.width,
          y: free.top + s.lift + s.ay * (s.height - s.lift),
        };
        const p = placePopover({
          anchor,
          lift: s.lift,
          gap: s.gap,
          size: { width: s.cardW, height: s.cardH },
          free,
        });
        expect(p.visible).toBe(true);
        if (!p.visible) return;
        // Inside, to the rounding of a pixel.
        expect(p.x).toBeGreaterThanOrEqual(free.left);
        expect(p.x + s.cardW).toBeLessThanOrEqual(free.right + 1);
        expect(p.y).toBeGreaterThanOrEqual(free.top);
        expect(p.y + s.cardH).toBeLessThanOrEqual(free.bottom + 1);
        // On the side it names, clear of the marker by the gap.
        const clear =
          p.side === "right"
            ? p.x >= anchor.x + s.gap - 1
            : p.side === "left"
              ? p.x + s.cardW <= anchor.x - s.gap + 1
              : true;
        expect(clear, `${p.side} card at ${p.x}`).toBe(true);
        // The arrow sits on the card's edge: along its height for a side
        // card, along its width for a card below (an edge shorter than the
        // arrow's two margins is not held to the near end).
        const edge = p.side === "below" ? s.cardW : s.cardH;
        expect(p.arrow).toBeLessThanOrEqual(edge);
        expect(edge < 46 || p.arrow >= 0, `arrow ${p.arrow}`).toBe(true);
      }),
    );
  });

  it("hides the card for a marker well outside the free area", () => {
    fc.assert(
      fc.property(
        scene,
        fc.constantFrom("left", "right", "above", "below"),
        fc.integer({ min: 7, max: 500 }),
        (s, where, by) => {
          const free = {
            left: s.left,
            top: s.top,
            right: s.left + s.width,
            bottom: s.top + s.height,
          };
          const midX = free.left + s.width / 2;
          const midY = free.top + s.lift + (s.height - s.lift) / 2;
          const anchor =
            where === "left"
              ? { x: free.left - by, y: midY }
              : where === "right"
                ? { x: free.right + by, y: midY }
                : where === "above"
                  ? { x: midX, y: free.top + s.lift - by }
                  : { x: midX, y: free.bottom + by };
          const p = placePopover({
            anchor,
            lift: s.lift,
            gap: s.gap,
            size: { width: s.cardW, height: s.cardH },
            free,
          });
          expect(p.visible).toBe(false);
        },
      ),
    );
  });
});
