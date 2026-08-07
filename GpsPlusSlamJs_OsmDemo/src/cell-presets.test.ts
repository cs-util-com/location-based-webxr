/**
 * The affordance grid's look presets (§3, DEC-R6-9/10/22).
 *
 * WHY THESE TESTS MATTER. The presets are the whole of §3 — a structured
 * experiment rather than a feature — so the properties worth pinning are the
 * ones that keep the experiment honest rather than any particular look:
 *
 * - **Every preset states every axis.** A preset that omitted one would inherit
 *   whatever the previous look happened to leave behind, which makes two runs of
 *   the same named preset different and the comparison worthless. TypeScript
 *   enforces this for the fields; the test is for the case where an axis is
 *   ADDED later and every preset silently gains a default.
 * - **The default is one of them, and it is the one that ships.** The e2e suite
 *   can only assert one look; if the default were not in the list, cycling would
 *   never return to what was tested.
 * - **The cycle is a cycle.** A cycle that gets stuck or skips is discovered by
 *   pressing a key twenty times and wondering, which is exactly the kind of bug
 *   that survives a review.
 * - **The prism height respects the layer ladder.** `layer-order.ts` allows
 *   0.04 m per step, and a prism taller than that punches through the layer
 *   above it — a real defect that looks like a z-fighting artefact.
 */

import { describe, expect, it } from "vitest";

import {
  CELL_BAR_MAX_HEIGHT_M,
  CELL_PRESETS,
  CELL_PRISM_HEIGHT_M,
  DEFAULT_CELL_PRESET,
  cellPreset,
  needsMeshRebuild,
  nextCellPreset,
} from "./cell-presets.js";

describe("the preset table", () => {
  it("names every axis on every preset", () => {
    // Guards the case TypeScript cannot: a FIFTH axis added later, with the
    // existing presets silently inheriting a default. Then "preset A" means
    // something different before and after the change and no comparison holds.
    const axes = ["opacity", "extrude", "heightByScore", "fog", "liftM"];
    for (const preset of CELL_PRESETS) {
      for (const axis of axes) {
        expect(Object.hasOwn(preset, axis)).toBe(true);
      }
    }
  });

  it("has unique names", () => {
    const names = CELL_PRESETS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("describes each one, since the hotkey help renders the description", () => {
    for (const preset of CELL_PRESETS) {
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("keeps opacity in range", () => {
    for (const preset of CELL_PRESETS) {
      expect(preset.opacity).toBeGreaterThan(0);
      expect(preset.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("includes the DEFAULT, which is what the e2e suite pins", () => {
    // If the default were not in the list, cycling could never return to the
    // look the suite actually tested.
    expect(CELL_PRESETS.map((preset) => preset.name)).toContain(
      DEFAULT_CELL_PRESET,
    );
  });

  it("starts the cycle at the default", () => {
    // So the hotkey walks AWAY from what ships rather than towards it — the
    // first press should change something.
    expect(CELL_PRESETS[0]?.name).toBe(DEFAULT_CELL_PRESET);
  });

  it("keeps the default the shipped look, not an experiment", () => {
    // DEC-R6-22: the losing branches are not deleted until §6 has landed,
    // because two axes are premised on the wider heat radius. Until then the
    // default must stay the thing that was reviewed.
    const shipped = cellPreset(DEFAULT_CELL_PRESET);
    expect(shipped.opacity).toBe(0.8);
    expect(shipped.extrude).toBe(false);
    expect(shipped.heightByScore).toBe(false);
  });
});

describe("cellPreset", () => {
  it("finds each preset by name", () => {
    for (const preset of CELL_PRESETS) {
      expect(cellPreset(preset.name)).toBe(preset);
    }
  });

  it("falls back to the default for an unknown name", () => {
    // A candidate for a URL parameter, so the input is untrusted — and a typo
    // should leave the demo usable, exactly as `parseGroundMode` does.
    expect(cellPreset("chrome").name).toBe(DEFAULT_CELL_PRESET);
    expect(cellPreset("").name).toBe(DEFAULT_CELL_PRESET);
  });
});

describe("nextCellPreset", () => {
  it("visits every preset and returns to the start", () => {
    // A cycle that gets stuck or skips is found by pressing a key twenty times
    // and wondering. This finds it in CI instead.
    const seen = [DEFAULT_CELL_PRESET];
    let current = DEFAULT_CELL_PRESET;
    for (let i = 0; i < CELL_PRESETS.length - 1; i++) {
      current = nextCellPreset(current);
      seen.push(current);
    }
    expect(new Set(seen).size).toBe(CELL_PRESETS.length);
    expect(nextCellPreset(current)).toBe(DEFAULT_CELL_PRESET);
  });

  it("starts from the beginning for an unknown name rather than sticking", () => {
    expect(nextCellPreset("chrome")).toBe(CELL_PRESETS[0]?.name);
  });
});

describe("needsMeshRebuild", () => {
  it("is false for changes the view can make on its own", () => {
    // Opacity, fog and lift are material and transform changes. Rebuilding for
    // them would make the hotkey feel broken on a large working set, because
    // every press would wait on a worker republish.
    expect(needsMeshRebuild(cellPreset("current"), cellPreset("opaque"))).toBe(
      false,
    );
    expect(
      needsMeshRebuild(cellPreset("current"), cellPreset("translucent")),
    ).toBe(false);
  });

  it("is true when the vertex buffers have to change", () => {
    expect(
      needsMeshRebuild(cellPreset("current"), cellPreset("prototype")),
    ).toBe(true);
    expect(needsMeshRebuild(cellPreset("prototype"), cellPreset("bars"))).toBe(
      true,
    );
  });

  it("is false for a preset compared with itself", () => {
    for (const preset of CELL_PRESETS) {
      expect(needsMeshRebuild(preset, preset)).toBe(false);
    }
  });
});

describe("the heights", () => {
  it("keeps a plain prism inside the per-layer vertical budget", () => {
    // `layer-order.ts` allows 0.04 m per step. A prism taller than its step
    // punches through the layer above, which reads as z-fighting rather than as
    // a decision.
    expect(CELL_PRISM_HEIGHT_M).toBeLessThan(0.04);
  });

  it("lets a BAR leave that regime deliberately", () => {
    // Stated rather than assumed: a bar field is not a thin overlay, so it
    // breaks the ladder on purpose. If it wins, the ladder is what has to be
    // revisited — not the height.
    expect(CELL_BAR_MAX_HEIGHT_M).toBeGreaterThan(1);
  });
});
