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
// `terrainDebug` USED TO BE HERE and is now a ground MODE (W6, DEC-R5-4). It was
// always the odd entry — it re-coloured the ground plane in place rather than
// adding a thing to the scene, which is why it alone needed a "greyed out when
// there is no ground" rule. Every layer here is now a thing in the world, which
// is what this list is supposed to mean. See `ground-mode.ts`.

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
 * EVERYTHING — and since W6 that is literally every layer (R4-2, DEC-R4-4).
 *
 * It used to be `cells`, `buildings`, `trees` — the three the demo shipped with —
 * and the reason was a migration reason: _"a default that switched new layers on
 * as they were written would leave no before to compare the after against"_. The
 * W10 registry migration is complete, so that baseline has served its purpose,
 * and what remained was the historical order in which builders were written,
 * which is not a fact about what a user should see. The feedback put it plainly:
 * _"standardmäßig sollten alle an sein, also auch Landuse, Roads, POI"_.
 *
 * **The one exclusion has been REMOVED, not switched on** (W6, DEC-R5-4). This
 * used to filter out `terrainDebug`, and that filter was the only thing making
 * this constant interesting. The height ramp is now an appearance of the ground
 * mode rather than a layer, so there is nothing left to exclude and this is
 * simply "all of them" — which is what the round-4 feedback asked for and what
 * the list now honestly means.
 *
 * COST, STATED RATHER THAN DISCOVERED (N7): every layer on multiplies the
 * per-publish rebuild, and the 30 FPS the notes accept was measured with three
 * layers on, not seven. That is why round 4's W6 and W7 (instancing the trees
 * and the POI markers) landed BEFORE this, and why the draw-call readout did too
 * — so the change can be measured rather than felt.
 */
export const DEFAULT_LAYERS: LayerSet = setOf(ALL_LAYERS);

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
