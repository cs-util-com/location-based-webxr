/**
 * Why these tests matter: a recording's walk may hold two captures or
 * thousands. Whatever its length, the layer must stay at most two objects
 * (one instanced mesh, one line) - a draw per capture would sink the
 * globe's frame - give every capture an atlas cell inside the atlas and
 * apart from every other, and leave nothing behind once cleared.
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  atlasCell,
  atlasLayout,
  createGlobeDebugLayer,
  type AtlasSurface,
} from "./globe-debug-layer.js";

const surface: AtlasSurface = {
  image: { width: 1, height: 1 },
  reset: () => undefined,
  draw: () => undefined,
};

describe("globe debug layer (properties)", () => {
  it("draws any walk as at most one mesh and one line, and a clear leaves nothing", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.boolean(),
        (n, line) => {
          const parent = new THREE.Group();
          const layer = createGlobeDebugLayer(parent, surface);
          const freed: string[] = [];
          layer.set(
            Array.from({ length: n }, (_, i) => ({
              image: String(i),
              at: new THREE.Vector3(i, 0, -i),
            })),
            line,
          );
          const group = parent.getObjectByName("debug-layer")!;
          const expected = (n > 0 ? 1 : 0) + (line && n >= 2 ? 1 : 0);
          expect(group.children).toHaveLength(expected);
          for (const child of group.children) {
            (child as THREE.Mesh).geometry.addEventListener("dispose", () =>
              freed.push(child.name),
            );
          }
          layer.set(null, line);
          expect(group.children).toHaveLength(0);
          expect(freed).toHaveLength(expected);
          layer.dispose();
          expect(parent.children).toHaveLength(0);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("gives every capture its own cell inside the atlas", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6000 }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 400 }),
        (n, w, h) => {
          const layout = atlasLayout(n);
          const seen = new Set<string>();
          // The first, the last and a spread between.
          const picks = new Set([
            0,
            n - 1,
            Math.floor(n / 2),
            Math.floor(n / 3),
          ]);
          for (const i of picks) {
            const c = atlasCell(layout, i, w, h);
            expect(c.x + c.w).toBeLessThanOrEqual(layout.px);
            expect(c.y + c.h).toBeLessThanOrEqual(layout.px);
            expect(c.w).toBeLessThanOrEqual(layout.cellPx);
            expect(c.h).toBeLessThanOrEqual(layout.cellPx);
            expect(Math.abs(c.w / c.h - w / h)).toBeLessThan(
              Math.max(1 / c.h, 1 / c.w) * (w / h + 1) + 1e-9,
            );
            const key = `${String(c.x)},${String(c.y)}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
        },
      ),
    );
  });
});
