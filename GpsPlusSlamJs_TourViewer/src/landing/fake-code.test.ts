/**
 * Why these tests matter: the film's poster and the cards' pictures draw
 * the same printed code, from one generator. It must be the same pattern
 * on every load (a code that changed between visits would read as a
 * different code), stay inside its 21 x 21 box, and keep the three finder
 * corners clear of stray modules, which is what makes it read as a code.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FAKE_CODE_SIZE, fakeCodePath, seededRandom } from "./fake-code.js";

/** The path's unit squares ("Mx yh1v1h-1z") as [x, y]. */
function modules(d: string): [number, number][] {
  return [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

describe("fakeCodePath", () => {
  it("draws the same pattern for the same seed", () => {
    expect(fakeCodePath()).toBe(fakeCodePath());
    expect(fakeCodePath(7)).toBe(fakeCodePath(7));
    expect(fakeCodePath(7)).not.toBe(fakeCodePath(8));
  });

  it("keeps every module inside the box and out of the finder corners", () => {
    const n = FAKE_CODE_SIZE;
    const cells = modules(fakeCodePath());
    expect(cells.length).toBeGreaterThan(100);
    for (const [x, y] of cells) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(n);
      expect(y).toBeLessThan(n);
      const corner =
        (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      expect(corner).toBe(false);
    }
  });

  it("draws the three finder squares, each as three nested squares", () => {
    const d = fakeCodePath();
    for (const [x, y] of [
      [0, 0],
      [14, 0],
      [0, 14],
    ] as const) {
      expect(d).toContain(`M${String(x)} ${String(y)}h7v7h-7z`);
      expect(d).toContain(`M${String(x + 1)} ${String(y + 1)}v5h5v-5z`);
      expect(d).toContain(`M${String(x + 2)} ${String(y + 2)}h3v3h-3z`);
    }
  });
});

describe("seededRandom", () => {
  it("stays in [0, 1) and repeats for a seed (property)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = seededRandom(seed);
        const b = seededRandom(seed);
        for (let i = 0; i < 20; i++) {
          const v = a();
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
          expect(b()).toBe(v);
        }
      }),
    );
  });

  // A zero seed would stay zero under xorshift and draw one value forever.
  it("does not stall on a zero seed", () => {
    const r = seededRandom(0);
    expect(r()).not.toBe(r());
  });
});
