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
      // W24's diagnostic. Last because it is the only entry that answers a
      // question about the DATA rather than showing a thing that is in the world.
      "terrainDebug",
    ]);
  });

  it("starts with EVERY layer on except the diagnostic (W9)", () => {
    // REPLACES "the layers the demo shipped with". That default existed so the
    // W10 registry migration had a known-good before to compare against; the
    // migration is complete, and what survived it was the historical order in
    // which builders happened to be written — not a fact about what a user
    // should see. The feedback: "standardmäßig sollten alle an sein".
    //
    // Derived from ALL_LAYERS rather than listed, so a new layer is on by
    // default and this test cannot go stale by omission.
    for (const layer of ALL_LAYERS) {
      if (layer === "terrainDebug") continue;
      expect(isLayerEnabled(DEFAULT_LAYERS, layer)).toBe(true);
    }
  });

  it("keeps the height ramp OFF, which is the one exclusion", () => {
    // It re-colours the ground rather than adding a thing to the world, the
    // notes ask for it to stay off, and DEC-R3-17 already disables it outright
    // when there is no ground to colour. Asserted separately so a bulk flip of
    // the defaults cannot quietly take it with them.
    expect(isLayerEnabled(DEFAULT_LAYERS, "terrainDebug")).toBe(false);
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
