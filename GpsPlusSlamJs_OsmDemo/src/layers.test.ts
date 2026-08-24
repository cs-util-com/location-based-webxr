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
  layersNeedingData,
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
      // A DIAGNOSTIC, unlike everything above it: `underground` draws what the
      // scorer REFUSED to look at, so a reader can judge whether
      // `isBelowSurface` dropped the right 13 % of features. Everything else in
      // this list is a thing in the world.
      "underground",
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

  it("starts with every layer on EXCEPT plates, cells and underground", () => {
    // AN EXPLICIT EXPECTED SET, not a loosened rule. The obvious edit when this
    // changed was to assert "at least one layer is on", which catches nothing —
    // naming both halves means an accidental flip in either direction fails,
    // including a new layer silently defaulting to off.
    //
    // DEC-R7b-5 and DEC-R7b-6 reverse DEC-R4-4 for two layers, and the
    // underground diagnostic makes a third. Ground
    // PLATES go off because the terrain relief now carries the ground on its
    // own; cells go off because the 2D map draws one Leaflet polygon per cell
    // and the final ring is ~6 223 of them.
    //
    // (Named "landuse" here until 2026-08-05, after the LayerKind was renamed
    // `plates`. The assertion was right the whole time; the title named an id
    // that no longer exists.
    //
    // THE WORD IS NOT GONE, though, and the first correction over-claimed that
    // it was: `layer-toggles.ts:118` still LABELS this switch "landuse" in the
    // bar, deliberately -- "ground" collided with the ground-mode picker and
    // "OSM areas" with the `areas` layer, for readers and for e2e locators
    // addressing it by accessible name. So the next person sweeping stale
    // `landuse` prose should leave that string alone: it is a decision, and
    // changing it moves user-visible text.) Roads and POI stay ON, so round 4's
    // "standardmäßig sollten alle an sein" is honoured where it still holds.
    const on = ALL_LAYERS.filter((layer) =>
      isLayerEnabled(DEFAULT_LAYERS, layer),
    );
    const off = ALL_LAYERS.filter(
      (layer) => !isLayerEnabled(DEFAULT_LAYERS, layer),
    );
    expect([...off].sort()).toEqual(["cells", "plates", "underground"]);
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
 * WHY THESE TESTS MATTER (round 10 stage B, extended by the underground layer).
 *
 * Some layers have their DATA omitted from the snapshot while they are off, so
 * an array nobody draws is neither built nor copied across the worker boundary.
 * The cost of that saving is a seam: switching such a layer on has nothing to
 * draw until new data arrives, where every other layer needs only a redraw.
 *
 * That seam was a regression once already — the cells layer switched on and
 * showed an empty grid, and nine e2e tests caught what no unit test could,
 * because both halves were individually correct and nothing owned the
 * transition. The underground layer was then written on the assumption that the
 * seam did not apply to it, which was wrong the moment its outlines were gated
 * for the same payload reason. Hence a LIST rather than a special case.
 */
describe("layersNeedingData", () => {
  const off = { ...DEFAULT_LAYERS, cells: false, underground: false };
  const on = { ...DEFAULT_LAYERS, cells: true, underground: false };
  const undergroundOn = { ...DEFAULT_LAYERS, cells: false, underground: true };

  it("names a data-gated layer that just turned on with nothing held", () => {
    expect(layersNeedingData(off, on, {})).toEqual(["cells"]);
    expect(layersNeedingData(off, undergroundOn, {})).toEqual(["underground"]);
  });

  it("says nothing when the data is already held", () => {
    // The 18-second flick: switching off does not replace the snapshot, so an
    // off/on within one position is a redraw rather than a widening cycle.
    expect(layersNeedingData(off, on, { cells: 931 })).toEqual([]);
    expect(layersNeedingData(off, undergroundOn, { underground: 4 })).toEqual(
      [],
    );
  });

  it("treats a missing count as nothing held, which is the strongest case", () => {
    // No snapshot at all is the state where LEAST is in hand, and an earlier
    // version declined to refetch in exactly that state because
    // `snapshot?.cells.length === 0` is `undefined === 0`.
    expect(layersNeedingData(off, on, { underground: 9 })).toEqual(["cells"]);
  });

  it("is one-way: switching off never needs data", () => {
    expect(layersNeedingData(on, off, {})).toEqual([]);
    expect(layersNeedingData(undergroundOn, off, {})).toEqual([]);
  });

  it("ignores layers that are NOT data-gated", () => {
    // THE FIXTURE THAT MAKES THIS BITE: a data-gated layer is held constant
    // while another changes, so an implementation that returned every changed
    // layer fails here rather than passing by luck.
    expect(
      layersNeedingData(off, { ...off, buildings: !off.buildings }, {}),
    ).toEqual([]);
  });

  it("can name more than one at once", () => {
    // Both switched on together — a URL that restores a saved layer set does
    // exactly this, and refetching once for the pair is the whole reason the
    // caller gets a list rather than a boolean.
    expect(
      layersNeedingData(
        off,
        { ...DEFAULT_LAYERS, cells: true, underground: true },
        {},
      ).sort(),
    ).toEqual(["cells", "underground"]);
  });
});
