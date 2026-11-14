import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  defaultDockLayout,
  DOCK_PANELS,
  dockWidths,
  keyboardMaximizes,
  phoneDockLayout,
  phoneGroupPx,
} from "./dock-layout.js";

describe("the default layout at any docking window", () => {
  // Why: the host adds the steps in order; a step placed against a panel
  // not yet added, or a panel missing or added twice, breaks the layout.
  // Swept over every docking window size, phones held sideways included.
  it("adds every panel once, each against one added before it, and leaves the view room", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 701, max: 4000 }),
        fc.integer({ min: 300, max: 3000 }),
        (w, h) => {
          const steps = defaultDockLayout(w, h);
          expect(steps.map((s) => s.id).sort()).toEqual(
            DOCK_PANELS.map((p) => p.id).sort(),
          );
          expect(steps[0]).toEqual({ id: "view" });
          // Only the first is placed against nothing.
          expect(steps.slice(1).every((s) => s.against !== undefined)).toBe(
            true,
          );
          const added = new Set<string>(["view"]);
          for (const step of steps) {
            // Placed against a panel already added (the first against none).
            expect(added.has(step.against?.id ?? "view")).toBe(true);
            added.add(step.id);
          }
          const sizes = dockWidths(w);
          // The 3D view keeps at least 220 px between the side panels.
          expect(w - sizes.list - sizes.column).toBeGreaterThanOrEqual(220);
          // ...and at least two thirds of the height above the bottom one.
          const bottom = steps.find((s) => s.id === "problems")?.heightPx;
          expect(bottom).toBeLessThanOrEqual(Math.max(90, h / 3));
        },
      ),
    );
  });
});

describe("the phone's default layout at any phone", () => {
  // Why: whatever the phone, the layout adds every panel once against
  // one added before it, and the 3D view keeps more than half of the
  // axis the group shares with it.
  it("adds every panel once and leaves the view more than half", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("upright" as const, "sideways" as const),
        fc.integer({ min: 200, max: 1400 }),
        fc.integer({ min: 200, max: 1400 }),
        (shape, w, h) => {
          const steps = phoneDockLayout(shape, w, h);
          expect(steps.map((s) => s.id).sort()).toEqual(
            DOCK_PANELS.map((p) => p.id).sort(),
          );
          const added = new Set<string>(["view"]);
          for (const step of steps) {
            expect(added.has(step.against?.id ?? "view")).toBe(true);
            added.add(step.id);
          }
          const px = phoneGroupPx(shape, w, h);
          const axis = shape === "upright" ? h : w;
          expect(px).toBeGreaterThan(0);
          expect(px).toBeLessThan(axis / 2);
        },
      ),
    );
  });
});

describe("a keyboard over the docked layout, at any window", () => {
  // Why: a keyboard that grows must never give the groups back their
  // layout, and a shorter window with the same keyboard must never keep
  // more of it: either would flip the layout while the creator types.
  it("maximizes for a taller keyboard or a shorter window once it does", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 2000 }),
        fc.integer({ min: 1, max: 1500 }),
        fc.integer({ min: 0, max: 500 }),
        (h, k, more) => {
          if (!keyboardMaximizes(h, k)) return;
          expect(keyboardMaximizes(h, k + more)).toBe(true);
          expect(keyboardMaximizes(Math.max(1, h - more), k)).toBe(true);
        },
      ),
    );
  });

  // Why: a group further down keeps less over the same keyboard; once its
  // room is too little, a group lower still must never get the layout back.
  it("maximizes for a group lower down once it does", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 2000 }),
        fc.integer({ min: 1, max: 1500 }),
        fc.integer({ min: 0, max: 1500 }),
        fc.integer({ min: 0, max: 500 }),
        (h, k, top, more) => {
          if (!keyboardMaximizes(h, k, top)) return;
          expect(keyboardMaximizes(h, k, top + more)).toBe(true);
        },
      ),
    );
  });
});
