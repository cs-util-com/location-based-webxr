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

  it("starts with EVERY layer on (W9, W6)", () => {
    // REPLACES "the layers the demo shipped with". That default existed so the
    // W10 registry migration had a known-good before to compare against; the
    // migration is complete, and what survived it was the historical order in
    // which builders happened to be written — not a fact about what a user
    // should see. The feedback: "standardmäßig sollten alle an sein".
    //
    // Derived from ALL_LAYERS rather than listed, so a new layer is on by
    // default and this test cannot go stale by omission. There is no longer an
    // exception to skip: W6 removed the only one by taking the diagnostic out of
    // the registry entirely.
    for (const layer of ALL_LAYERS) {
      expect(isLayerEnabled(DEFAULT_LAYERS, layer)).toBe(true);
    }
  });

  it("has no exclusions left to keep track of", () => {
    // This used to assert that `terrainDebug` stayed OFF while everything else
    // was on. DEC-R5-4 answered that question by moving the ramp out of the
    // registry and turning it on by default as a ground appearance, so the claim
    // worth pinning now is that DEFAULT_LAYERS is not quietly filtering anything
    // — the filter was the whole reason this constant needed watching.
    expect(Object.values(DEFAULT_LAYERS).every(Boolean)).toBe(true);
    expect(Object.keys(DEFAULT_LAYERS)).toHaveLength(ALL_LAYERS.length);
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
