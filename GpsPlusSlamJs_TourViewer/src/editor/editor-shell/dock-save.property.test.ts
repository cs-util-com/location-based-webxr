import fc from "fast-check";
import type { SerializedDockview } from "dockview";
import { describe, expect, it } from "vitest";

import { DOCK_PANELS } from "./dock-layout.js";
import { readSavedDock, writeSavedDock } from "./dock-save.js";

const OTHERS = DOCK_PANELS.map((p) => p.id).filter((id) => id !== "view");

/** The panels other than the 3D view, each given a group number. */
const arrangement = fc.array(fc.integer({ min: 0, max: 4 }), {
  minLength: OTHERS.length,
  maxLength: OTHERS.length,
});

function layoutOf(groups: readonly (readonly string[])[]): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: groups.map((views, n) => ({
          type: "leaf",
          data: { id: String(n), views: [...views] },
          size: 100,
        })),
        size: 600,
      },
      width: 1200,
      height: 600,
      orientation: "HORIZONTAL",
    },
    panels: Object.fromEntries(
      groups.flat().map((id) => [id, { id, contentComponent: id }]),
    ),
  } as unknown as SerializedDockview;
}

/** The groups an arrangement makes, the 3D view alone in its own. */
function groupsOf(slots: readonly number[]): string[][] {
  const groups: string[][] = [["view"]];
  for (let g = 0; g < 5; g++) {
    const views = OTHERS.filter((_, i) => slots[i] === g);
    if (views.length > 0) groups.push(views);
  }
  return groups;
}

describe("a kept layout of any arrangement", () => {
  // Why: whatever a creator drags where, a layout of today's panels must
  // come back; the check refuses only broken ones.
  it("reads back any arrangement of today's panels", () => {
    fc.assert(
      fc.property(arrangement, (slots) => {
        const layout = layoutOf(groupsOf(slots));
        expect(readSavedDock(writeSavedDock(layout, []))?.layout).toEqual(
          layout,
        );
      }),
    );
  });

  // Why: a layout missing a panel, or holding one twice, would load with
  // a panel lost or the docking library failing - it falls back instead.
  it("refuses the same with one panel dropped or doubled", () => {
    fc.assert(
      fc.property(
        arrangement,
        fc.integer({ min: 0, max: OTHERS.length - 1 }),
        fc.boolean(),
        (slots, which, doubled) => {
          const groups = groupsOf(slots);
          const id = OTHERS[which] ?? "list";
          const broken = doubled
            ? [...groups, [id]]
            : groups
                .map((g) => g.filter((v) => v !== id))
                .filter((g) => g.length > 0);
          expect(
            readSavedDock(writeSavedDock(layoutOf(broken), [])),
          ).toBeNull();
        },
      ),
    );
  });
});
