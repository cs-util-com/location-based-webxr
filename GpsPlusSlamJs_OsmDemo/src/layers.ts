/**
 * Which geometries the views are asked to build — the layer registry.
 *
 * WHY THIS IS THE ACTUAL DELIVERABLE of the 3D layer work (DEC-R2-12). The feedback
 * put it plainly: _"Hauptsache, dass es so ein bisschen modularisiert ist, dass man
 * das auch dann einzeln rendern kann"_. Individual builders can arrive one at a time
 * and each is straightforward; the seam that lets a later AR mode ask for buildings
 * plus POI markers and skip ground plates is the part that is expensive to retrofit.
 * So it lands first, and the two layers that already existed are migrated through it
 * **before** any new one is written — which is the only way the migration is
 * verifiable, because there is a known-good picture to compare against.
 *
 * WHY INDEPENDENT TOGGLES RATHER THAN A MODE (DEC-R2-10). A two-state
 * `cells ↔ areas` switch was offered and rejected for a specific reason: it makes it
 * impossible to view a merged area **over** the cells that produced it, which is the
 * first check anyone performs when a region looks wrong. One mechanism therefore
 * serves both the layer question and the cells/areas question, because they are the
 * same feature.
 *
 * WHY A PLAIN RECORD RATHER THAN A `Set`. This lives in a Redux slice. A `Set` is
 * rejected by RTK's serialisability scan and dropped by `structuredClone`, so it
 * would break both the store and the worker boundary — silently, in the clone's
 * case.
 *
 * @see layers.ts.md
 */

/**
 * Every layer the scene can build.
 *
 * ORDERED, and the order is the paint order for anything drawn at ground level:
 * `cells` and `areas` are the affordance overlays, then the ground-level geometry,
 * then things that stand up from it. `layer-order.ts` owns the vertical offsets;
 * this is the enumeration.
 */
export const ALL_LAYERS = [
  "cells",
  "areas",
  "buildings",
  "trees",
  "plates",
  "roads",
  "poi",
] as const;

export type LayerKind = (typeof ALL_LAYERS)[number];

/** Which layers are on. Exhaustive over the union, by construction. */
export type LayerSet = Readonly<Record<LayerKind, boolean>>;

/** Builds a set from the layers that should be on; everything else is off. */
function setOf(enabled: Iterable<LayerKind>): LayerSet {
  const on = new Set(enabled);
  // Built from ALL_LAYERS rather than from the input, so every key always exists.
  // A partial record would make `isLayerEnabled` return `undefined` for a layer
  // nobody remembered, which reads as "off" while being a different thing.
  return Object.fromEntries(
    ALL_LAYERS.map((layer) => [layer, on.has(layer)]),
  ) as LayerSet;
}

/**
 * The layers the demo shipped with, and only those.
 *
 * DELIBERATELY NOT "everything available". The registry's own migration has to be
 * verifiable, and that requires the default to reproduce the previous picture
 * exactly — a default that switched new layers on as they were written would leave
 * no before to compare the after against.
 *
 * `areas` is off because regions had no fillable representation until W14/W15;
 * `plates`, `roads` and `poi` are off because they have no builder yet.
 */
export const DEFAULT_LAYERS: LayerSet = setOf(["cells", "buildings", "trees"]);

export function isLayerEnabled(layers: LayerSet, layer: LayerKind): boolean {
  return layers[layer];
}

/** Returns a NEW set with one layer changed. Never mutates its input. */
export function toggleLayer(
  layers: LayerSet,
  layer: LayerKind,
  enabled: boolean,
): LayerSet {
  return { ...layers, [layer]: enabled };
}

/** A comma-separated list of the enabled layers. Stable order, so it diffs. */
export function serialiseLayers(layers: LayerSet): string {
  return ALL_LAYERS.filter((layer) => layers[layer]).join(",");
}

/**
 * Parses a serialised set, ignoring anything it does not recognise.
 *
 * UNTRUSTED INPUT: this form is a candidate for a URL parameter, so an unknown name
 * must not become a key. It would be a layer nothing could ever switch off, and the
 * exhaustiveness `LayerSet` promises would be a lie.
 *
 * An empty string means NO layers, not the default — "show nothing" has to be
 * expressible, or a user who switches everything off gets the default back and
 * cannot tell why.
 */
export function parseLayers(serialised: string): LayerSet {
  const known = new Set<string>(ALL_LAYERS);
  return setOf(
    serialised
      .split(",")
      .map((part) => part.trim())
      .filter((part): part is LayerKind => known.has(part)),
  );
}
