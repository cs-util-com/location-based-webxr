/**
 * The layer set — which geometries the scene is asked to build.
 *
 * WHY THIS IS THE ACTUAL DELIVERABLE (DEC-R2-12, and the feedback said so):
 * _"Hauptsache, dass es so ein bisschen modularisiert ist, dass man das auch dann
 * einzeln rendern kann"_. The builders can arrive one at a time; the seam that lets
 * a later AR mode ask for buildings + POI markers and skip ground plates is the part
 * that is expensive to retrofit, so it lands first and the existing two layers are
 * migrated through it before any new one is written.
 *
 * WHY IT IS A SET OF INDEPENDENT TOGGLES rather than a two-state mode (DEC-R2-10).
 * The decisive argument was that a mode makes it impossible to view a merged area
 * OVER the cells that produced it — the first check anyone makes when a region looks
 * wrong. It also means one mechanism serves both this and the cells/areas switch,
 * which are the same feature.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_LAYERS,
  DEFAULT_LAYERS,
  isLayerEnabled,
  needsRefetch,
  needsRefetchFor,
  parseLayers,
  serialiseLayers,
  toggleLayer,
  type LayerKind,
} from "./layers.js";

describe("the layer set", () => {
  it("names every layer the scene can build", () => {
    // A guard on the union: adding a builder without adding it here would leave a
    // layer nothing can switch off, which is the state this module exists to end.
    expect([...ALL_LAYERS]).toEqual([
      "cells",
      "areas",
      "buildings",
      "trees",
      "plates",
      "roads",
      "poi",
      // `terrainDebug` USED TO BE HERE and is now a ground mode (W6, DEC-R5-4).
      // Its removal is asserted rather than merely absent, because "the list no
      // longer contains X" is the kind of change that a re-added entry would
      // silently undo.
    ]);
  });

  it("contains only things that are IN the world", () => {
    // The point of removing the ramp (W6, DEC-R5-4): it re-coloured the ground
    // plane in place rather than adding a surface, which is why it alone needed a
    // "greyed out when there is no ground" rule. A registry whose entries are all
    // the same KIND of thing is what lets `layer-order.ts` and `layer-toggles.ts`
    // stay exhaustive without special cases.
    expect([...ALL_LAYERS]).not.toContain("terrainDebug");
  });

  it("starts with every layer on EXCEPT plates and cells", () => {
    // AN EXPLICIT EXPECTED SET, not a loosened rule. The obvious edit when this
    // changed was to assert "at least one layer is on", which catches nothing —
    // naming both halves means an accidental flip in either direction fails,
    // including a new layer silently defaulting to off.
    //
    // DEC-R7b-5 and DEC-R7b-6 reverse DEC-R4-4 for exactly two layers. Ground
    // PLATES go off because the terrain relief now carries the ground on its
    // own; cells go off because the 2D map draws one Leaflet polygon per cell
    // and the final ring is ~2 989 of them.
    //
    // (Named "landuse" here until 2026-08-05, after that layer had been renamed
    // `plates`. The assertion was right the whole time; the title and this
    // comment named a layer that no longer exists, which is the kind of stale
    // prose a reader trusts precisely because the test passes.) Roads and POI stay ON, so round 4's
    // "standardmäßig sollten alle an sein" is honoured where it still holds.
    const on = ALL_LAYERS.filter((layer) =>
      isLayerEnabled(DEFAULT_LAYERS, layer),
    );
    const off = ALL_LAYERS.filter(
      (layer) => !isLayerEnabled(DEFAULT_LAYERS, layer),
    );
    expect([...off].sort()).toEqual(["cells", "plates"]);
    expect([...on].sort()).toEqual(
      ["areas", "buildings", "poi", "roads", "trees"].sort(),
    );
  });

  it("keeps a key for every layer, including the ones that are off", () => {
    // The invariant `setOf` exists for, and it survives the default change: a
    // PARTIAL record would make `isLayerEnabled` return `undefined` for a layer
    // nobody remembered, which reads as "off" while being a different thing.
    // Now that two layers really are off, "off" and "absent" have to stay
    // distinguishable.
    expect(Object.keys(DEFAULT_LAYERS)).toHaveLength(ALL_LAYERS.length);
    for (const layer of ALL_LAYERS) {
      expect(typeof isLayerEnabled(DEFAULT_LAYERS, layer)).toBe("boolean");
    }
  });

  it("still shows something the moment it opens", () => {
    // The floor under the two exclusions. Turning layers off by default is a
    // taste decision; turning ENOUGH of them off that the first frame is empty
    // is a broken demo, and the two are one edit apart.
    expect(isLayerEnabled(DEFAULT_LAYERS, "buildings")).toBe(true);
    expect(isLayerEnabled(DEFAULT_LAYERS, "areas")).toBe(true);
  });

  it("toggles one layer without disturbing the others", () => {
    const next = toggleLayer(DEFAULT_LAYERS, "roads", true);
    expect(isLayerEnabled(next, "roads")).toBe(true);
    for (const layer of ALL_LAYERS) {
      if (layer === "roads") continue;
      expect(isLayerEnabled(next, layer)).toBe(
        isLayerEnabled(DEFAULT_LAYERS, layer),
      );
    }
  });

  it("is IMMUTABLE, so a toggle cannot mutate store state in place", () => {
    // The set lives in a Redux slice. Mutating it would update the state without a
    // dispatch, so subscribers would never fire and the views would silently keep
    // drawing the previous layers.
    const before = serialiseLayers(DEFAULT_LAYERS);
    toggleLayer(DEFAULT_LAYERS, "roads", true);
    expect(serialiseLayers(DEFAULT_LAYERS)).toBe(before);
  });

  it("round-trips through its serialised form", () => {
    // The set has to survive the store, which means it has to be plain data. A
    // `Set` would be dropped by RTK's serialisability scan and by structuredClone.
    const enabled = toggleLayer(
      toggleLayer(DEFAULT_LAYERS, "poi", true),
      "cells",
      false,
    );
    expect(parseLayers(serialiseLayers(enabled))).toEqual(enabled);
  });

  it("ignores unknown names when parsing, rather than trusting the input", () => {
    // The serialised form is a candidate for a URL parameter, so it is untrusted.
    // An unknown layer must not become a key nothing can ever switch off.
    const parsed = parseLayers("buildings,not-a-layer,poi");
    expect(isLayerEnabled(parsed, "buildings")).toBe(true);
    expect(isLayerEnabled(parsed, "poi")).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual([...ALL_LAYERS].sort());
  });

  it("treats an empty string as no layers, not as the default", () => {
    // "Show nothing" has to be expressible, or a user who switches everything off
    // gets the default back on reload and cannot tell why.
    const parsed = parseLayers("");
    for (const layer of ALL_LAYERS) {
      expect(isLayerEnabled(parsed, layer)).toBe(false);
    }
  });

  it("is exhaustive over the union, so a new layer cannot be forgotten", () => {
    // `Record<LayerKind, boolean>` makes this a compile error too; this asserts it
    // at runtime as well, because the parse path builds the record dynamically.
    const layers: LayerKind[] = [...ALL_LAYERS];
    for (const layer of layers) {
      expect(typeof isLayerEnabled(DEFAULT_LAYERS, layer)).toBe("boolean");
    }
  });
});

/**
 * WHY THESE TESTS MATTER (round 10, stage B).
 *
 * `needsRefetch` exists because of a regression that unit tests could not see.
 * Stage B stopped sending the cell array while its layer is off, and each half
 * of that was individually correct — but switching the layer on then had
 * nothing to draw, and the demo showed an empty grid until an unrelated refresh
 * happened to bring the data. Nine e2e tests caught it.
 */
describe("needsRefetch", () => {
  const off = { ...DEFAULT_LAYERS, cells: false };
  const on = { ...DEFAULT_LAYERS, cells: true };

  it("refetches when the cell layer is switched ON", () => {
    // The regression. Without this the grid stays empty until something else
    // triggers a refresh.
    expect(needsRefetch(off, on)).toBe(true);
  });

  it("does NOT refetch when it is switched off", () => {
    // One-way: the data is already held and simply stops being drawn. A
    // symmetric implementation would refetch for nothing on every hide.
    expect(needsRefetch(on, off)).toBe(false);
  });

  it("does not refetch while it stays on or stays off", () => {
    expect(needsRefetch(on, on)).toBe(false);
    expect(needsRefetch(off, off)).toBe(false);
  });

  it("ignores every OTHER layer, which only ever needs a redraw", () => {
    // THE FIXTURE THAT MAKES THIS BITE: `cells` is held constant while another
    // layer changes, so an implementation that refetched on any change would
    // fail here rather than passing by luck.
    expect(needsRefetch(off, { ...off, buildings: !off.buildings })).toBe(
      false,
    );
    expect(needsRefetch(on, { ...on, buildings: !on.buildings })).toBe(false);
  });
});

describe("needsRefetchFor", () => {
  const off = { ...DEFAULT_LAYERS, cells: false };
  const on = { ...DEFAULT_LAYERS, cells: true };

  it("refetches when the layer goes on and nothing is held", () => {
    expect(needsRefetchFor(off, on, 0)).toBe(true);
  });

  it("does NOT refetch when the array is still held from before", () => {
    // The 18-second flick. Switching off does not replace the snapshot, so an
    // off/on within one position is a redraw, not a widening cycle.
    expect(needsRefetchFor(off, on, 931)).toBe(false);
  });

  it("treats NO SNAPSHOT as nothing held, which is the strongest case", () => {
    // The bug the first version shipped: `snapshot?.cells.length === 0` is
    // `undefined === 0`, so a missing snapshot declined to refetch — in the one
    // state where nothing at all is in hand. Reachable after `fetchFailed` and
    // at boot, so the caller passes `?? 0` and this pins what that must mean.
    expect(needsRefetchFor(off, on, 0)).toBe(true);
  });

  it("stays one-way regardless of what is held", () => {
    expect(needsRefetchFor(on, off, 0)).toBe(false);
    expect(needsRefetchFor(on, off, 931)).toBe(false);
  });
});
