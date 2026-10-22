/**
 * Why these tests matter: the card that explains a selected marker must
 * stay beside it and inside the free part of the window - never under the
 * rail or the top bar, never off screen - and must hand over to the "off
 * the map view" chip when its marker leaves the view (the chosen
 * prototype's behaviour, M6 E1). The property sweeps anchors and window
 * sizes the examples cannot.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { placePopover, revealPadding } from "./popover-place.js";

const FREE = { left: 330, top: 80, right: 1268, bottom: 788 };
const SIZE = { width: 320, height: 240 };

describe("placePopover", () => {
  // Why (PR #609 review): a free area narrower than the card (a narrow
  // window with the rail open) put the card left of the free area, over
  // the rail; it starts at the free area's edge and overflows on the
  // right instead.
  it("never puts the card left of the free area, even when it cannot fit", () => {
    const p = placePopover({
      anchor: { x: 330, y: 400 },
      lift: 24,
      gap: 30,
      size: { width: 200, height: 240 },
      free: { left: 276, top: 80, right: 378, bottom: 788 },
    });
    expect(p.visible).toBe(true);
    if (!p.visible) return;
    expect(p.x).toBeGreaterThanOrEqual(276);
  });

  it("sits to the right of the marker when there is room, its arrow at the marker", () => {
    const p = placePopover({
      anchor: { x: 600, y: 400 },
      lift: 24,
      gap: 30,
      size: SIZE,
      free: FREE,
    });
    expect(p).toEqual({
      visible: true,
      x: 630,
      y: 330,
      side: "right",
      arrow: 39,
    });
  });

  it("flips to the left near the right edge", () => {
    const p = placePopover({
      anchor: { x: 1100, y: 400 },
      lift: 24,
      gap: 30,
      size: SIZE,
      free: FREE,
    });
    expect(p).toMatchObject({ visible: true, side: "left", x: 750 });
  });

  it("goes below when neither side fits (a narrow free area)", () => {
    const p = placePopover({
      anchor: { x: 500, y: 300 },
      lift: 0,
      gap: 26,
      size: SIZE,
      free: { left: 330, top: 80, right: 700, bottom: 788 },
    });
    expect(p).toMatchObject({ visible: true, side: "below", y: 314 });
  });

  it("hides when the marker is under the rail, above the top bar or off screen", () => {
    for (const anchor of [
      { x: 200, y: 400 },
      { x: 600, y: 40 },
      { x: 1400, y: 400 },
      { x: 600, y: 900 },
    ]) {
      expect(
        placePopover({ anchor, lift: 0, gap: 30, size: SIZE, free: FREE }),
      ).toEqual({ visible: false });
    }
  });

  // Why (r901 review #4): the debug panel sits in the window's lower
  // right corner, where a card near the edge lands too; with the panel on
  // top it covered the card's buttons, and a z-index swap only trades
  // which of the two is hidden. The card moves up, clear of the panel.
  const PANEL = { left: 936, top: 700, right: 1268, bottom: 772 };

  it("moves up, clear of a box it must not cover, and keeps its arrow at the marker", () => {
    const p = placePopover({
      anchor: { x: 1100, y: 760 },
      lift: 24,
      gap: 30,
      size: SIZE,
      free: FREE,
      avoid: PANEL,
    });
    expect(p).toMatchObject({ visible: true, side: "left" });
    if (!p.visible) throw new Error("hidden");
    expect(p.y + SIZE.height).toBeLessThanOrEqual(PANEL.top);
    // Clamped to the card's edge, the arrow still points down its side.
    expect(p.arrow).toBe(SIZE.height - 28);
    // Without the box the card sits over it, as it did.
    const before = placePopover({
      anchor: { x: 1100, y: 760 },
      lift: 24,
      gap: 30,
      size: SIZE,
      free: FREE,
    });
    expect(before.visible && before.y + SIZE.height > PANEL.top).toBe(true);
  });

  it("leaves a card that does not reach the box where it was", () => {
    const input = {
      anchor: { x: 600, y: 400 },
      lift: 24,
      gap: 30,
      size: SIZE,
      free: FREE,
    };
    expect(placePopover({ ...input, avoid: PANEL })).toEqual(
      placePopover(input),
    );
  });

  it("never covers the box when the card fits above it, and stays inside the free area (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 330, max: 1268 }),
        fc.integer({ min: 80, max: 788 }),
        fc.integer({ min: 200, max: 360 }),
        fc.integer({ min: 120, max: 400 }),
        fc.integer({ min: 40, max: 200 }),
        fc.integer({ min: 120, max: 360 }),
        (x, y, width, height, panelHeight, panelWidth) => {
          const avoid = {
            left: FREE.right - panelWidth,
            top: FREE.bottom - 16 - panelHeight,
            right: FREE.right,
            bottom: FREE.bottom - 16,
          };
          const p = placePopover({
            anchor: { x, y },
            lift: 0,
            gap: 30,
            size: { width, height },
            free: FREE,
            avoid,
          });
          expect(p.visible).toBe(true);
          if (!p.visible) return;
          expect(p.x).toBeGreaterThanOrEqual(FREE.left);
          expect(p.y).toBeGreaterThanOrEqual(FREE.top);
          expect(p.y + height).toBeLessThanOrEqual(FREE.bottom + 1);
          const covers =
            p.x < avoid.right &&
            p.x + width > avoid.left &&
            p.y < avoid.bottom &&
            p.y + height > avoid.top;
          const fitsAbove = avoid.top - 8 - height >= FREE.top;
          expect(fitsAbove && covers).toBe(false);
        },
      ),
    );
  });

  it("always lies inside the free area when shown (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 330, max: 1268 }),
        fc.integer({ min: 80, max: 788 }),
        fc.integer({ min: 200, max: 360 }),
        fc.integer({ min: 120, max: 400 }),
        (x, y, width, height) => {
          const p = placePopover({
            anchor: { x, y },
            lift: 0,
            gap: 30,
            size: { width, height },
            free: FREE,
          });
          expect(p.visible).toBe(true);
          if (!p.visible) return;
          expect(p.x).toBeGreaterThanOrEqual(FREE.left);
          expect(p.x + width).toBeLessThanOrEqual(FREE.right + 1);
          expect(p.y).toBeGreaterThanOrEqual(FREE.top);
          expect(p.y + height).toBeLessThanOrEqual(FREE.bottom + 1);
        },
      ),
    );
  });
});

describe("revealPadding (E1 review #2)", () => {
  // Why: Leaflet pans a marker inside the window minus this padding. A
  // fixed 380 px on the right turned that box inside out on a phone (it
  // landed over the rail), so "Show it" and a row click left the marker
  // hidden. The box must stay right of the rail and keep some size.
  it("keeps room for the card on the right of a desktop window", () => {
    expect(
      revealPadding({ width: 1280, height: 800 }, { left: 316, top: 80 }),
    ).toEqual({ topLeft: [356, 120], bottomRight: [380, 60] });
  });

  it("shrinks the right padding on a phone so the box stays clear of the rail", () => {
    const p = revealPadding({ width: 390, height: 844 }, { left: 82, top: 80 });
    const boxLeft = p.topLeft[0];
    const boxRight = 390 - p.bottomRight[0];
    expect(boxLeft).toBeGreaterThanOrEqual(82);
    expect(boxRight - boxLeft).toBeGreaterThanOrEqual(60);
  });

  it("never turns the box inside out (property)", () => {
    fc.assert(
      fc.property(
        // Wide enough for a 60 px box right of a rail up to 400 px.
        fc.integer({ min: 520, max: 2560 }),
        fc.integer({ min: 320, max: 1600 }),
        fc.integer({ min: 0, max: 400 }),
        (width, height, left) => {
          const p = revealPadding({ width, height }, { left, top: 80 });
          expect(p.bottomRight[0]).toBeGreaterThanOrEqual(0);
          expect(p.bottomRight[1]).toBeGreaterThanOrEqual(0);
          // The windows swept always leave room for one: the box is at
          // least 60 px wide.
          expect(
            width - p.bottomRight[0] - p.topLeft[0],
          ).toBeGreaterThanOrEqual(60);
        },
      ),
    );
  });
});
