/**
 * Why these tests matter: the drawn park is the film on a phone without
 * WebGL and after a lost context, on the same timeline and bar. It must
 * show what the part shows (the pins that stand, the route drawn so far,
 * the person and the line to the phone in a close view), fit the box it
 * is given, and be rebuilt only when something visible changes: a playing
 * film without WebGL must not rebuild a large SVG on every frame.
 */
import { describe, expect, it } from "vitest";

import { drawFloor, floorSignature } from "./film-floor.js";
import { filmLayout } from "./film-layout.js";
import { frameAt } from "./film-story.js";

const LY = filmLayout(358, 448, 390);

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("film floor: what it draws", () => {
  it("draws a pin head and a numbered label for each standing pin", () => {
    const end = frameAt(7, 12.6).s;
    const d = drawFloor(end, false, LY);
    expect(count(d.markup, 'r=".6"')).toBe(5);
    expect(count(d.markup, 'data-n="1"')).toBeGreaterThanOrEqual(4);
    expect(d.markup).toContain("Start: the code");
  });

  it("draws no pins in the empty park, and the route only as far as it is drawn", () => {
    const empty = drawFloor(frameAt(2, 2.1).s, false, LY);
    expect(count(empty.markup, 'r=".6"')).toBe(0);
    const half = frameAt(0, 0).s;
    half.route = 20;
    const full = frameAt(7, 12.6).s;
    const dots = (m: string) => count(m, 'rx=".17"');
    expect(dots(drawFloor(half, false, LY).markup)).toBeLessThan(
      dots(drawFloor(full, false, LY).markup),
    );
  });

  it("starts the line to the phone at the person only in a close view with the phone up", () => {
    const visit = frameAt(1, 2.7);
    expect(visit.u.on).toBe(true);
    const d = drawFloor(visit.s, true, LY);
    expect(d.lead).not.toBeNull();
    const [x, y] = d.lead!;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(LY.phone.x);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(LY.H);
    expect(drawFloor(visit.s, false, LY).lead).toBeNull();
    expect(drawFloor(frameAt(5, 3).s, true, LY).lead).toBeNull();
  });

  it("returns a viewBox of four finite numbers with the box's aspect", () => {
    for (const ly of [LY, filmLayout(1100, 619, 1440)]) {
      const vb = drawFloor(frameAt(0, 4.3).s, false, ly)
        .viewBox.split(" ")
        .map(Number);
      expect(vb).toHaveLength(4);
      expect(vb.every(Number.isFinite)).toBe(true);
      expect(vb[2]! / vb[3]!).toBeCloseTo(ly.W / ly.H, 2);
    }
  });
});

describe("film floor: when to redraw", () => {
  it("keeps the signature while nothing visible changes, and changes it when a pin rises", () => {
    const a = frameAt(3, 0.5);
    const b = frameAt(3, 0.6);
    expect(floorSignature(a.s, a.u.on)).toBe(floorSignature(b.s, b.u.on));
    const placed = frameAt(3, 3.9);
    expect(floorSignature(placed.s, placed.u.on)).not.toBe(
      floorSignature(a.s, a.u.on),
    );
  });

  it("redraws a few dozen times over the whole route draw, not once per frame", () => {
    const sigs = new Set<string>();
    for (let i = 0; i <= 258; i++) {
      const f = frameAt(0, (i / 258) * 4.3);
      sigs.add(floorSignature(f.s, f.u.on));
    }
    expect(sigs.size).toBeGreaterThan(10);
    expect(sigs.size).toBeLessThan(80);
  });
});
