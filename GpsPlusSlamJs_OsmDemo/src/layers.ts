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
 * Everything EXCEPT `plates` and `cells` (DEC-R7b-5, DEC-R7b-6).
 *
 * THIS REVERSES DEC-R4-4 FOR TWO LAYERS, and the reversal is deliberate rather
 * than drift. Round 4 set every layer on from this user's own words —
 * _"standardmäßig sollten alle an sein, also auch Landuse, Roads, POI"_ — and
 * round 8's session asked for two of them back off, having seen what the demo
 * looks like since. Roads and POI stay on, so the round-4 request is honoured
 * where it still holds.
 *
 * **`plates` (landuse) off**, because the terrain relief now carries the ground
 * on its own. That is the real change since round 4: landuse used to be the only
 * thing giving the ground any structure, and the session's verdict on seeing it
 * without was _"das wirkt deutlich sinnvoller"_. Note the cost — the plate
 * colour was round 7's highest-uncertainty change and nobody will look at it
 * again unless it is deliberately scheduled.
 *
 * **`cells` off**, because the 2D map draws one Leaflet polygon per cell and the
 * final scoring ring is ~2 989 of them. The 3D grid is a single merged draw call
 * and costs almost nothing, so this is a composition decision in 3D and a real
 * cost in 2D.
 *
 * **`cells` off DEPENDS on region selection existing** (DEC-R7b-3a, landed
 * first). The cell click used to be the only route to a score explanation, so
 * hiding cells by default without a clickable region would have shipped a first
 * frame with no way to ask "why does this score that" — a strictly worse demo,
 * as an improvement.
 *
 * COST, STATED RATHER THAN DISCOVERED (N7): every layer on multiplies the
 * per-publish rebuild, and the 30 FPS the notes accept was measured with three
 * layers on. Two fewer by default moves back toward that, which is a side
 * benefit rather than the reason.
 */
export const DEFAULT_LAYERS: LayerSet = setOf(
  ALL_LAYERS.filter((layer) => layer !== "plates" && layer !== "cells"),
);

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

/**
 * Whether a layer change needs a REFETCH rather than just a redraw.
 *
 * Almost every layer only decides what is drawn from data the snapshot already
 * carries, so switching one on is a render. `cells` is the exception since
 * round 10 stage B: the snapshot deliberately arrives WITHOUT the cell array
 * while that layer is off — ~24 000 cells that would structured-clone in a
 * measured 27–35 ms to be drawn by nobody — so switching it on has nothing to
 * draw and needs the data fetched.
 *
 * A FUNCTION RATHER THAN AN `if` AT THE CALL SITE, because the defect it fixes
 * was invisible to unit tests: the refresh cycle asked correctly and the
 * pipeline answered correctly, and nothing owned the transition between them.
 * Nine e2e tests failed and no unit test did. This is the seam that makes the
 * rule assertable.
 *
 * ONE-WAY ON PURPOSE. Switching `cells` OFF needs no refetch — the data is
 * already held and simply stops being drawn.
 */
export function needsRefetch(previous: LayerSet, next: LayerSet): boolean {
  return !isLayerEnabled(previous, "cells") && isLayerEnabled(next, "cells");
}

/**
 * `needsRefetch`, AND we do not already hold the cells.
 *
 * WHY BOTH HALVES ARE HERE. The layer rule alone says an off→on switch needs
 * data; it cannot know whether the data is already in hand. Switching `cells`
 * OFF does not refetch and dispatches nothing that replaces the snapshot, so the
 * held array survives — and an off/on flick within one position was paying a
 * whole progressive refresh (three rings, a worker mesh build, up to 18 s) to
 * arrive at cells that were already there.
 *
 * IT LIVED AS A CONJUNCTION AT THE CALL SITE FOR ONE COMMIT, and deleting the
 * second half passed every test: `layers.test.ts` sees the pure rule,
 * `refresh-cycle.test.ts` sees the per-ring read, and neither can see a
 * condition that exists only in `main.ts`. That is the same shape this round
 * keeps finding — a stated rule with nothing executable behind it — and it is
 * the worst kind to lose, because the symptom is an 18-second pause rather than
 * anything that looks broken.
 *
 * `heldCells` IS A COUNT RATHER THAN A SNAPSHOT so "there is no snapshot at all"
 * has to be answered explicitly by the caller instead of hiding in an optional
 * chain. It first shipped as `snapshot?.cells.length === 0`, which yields
 * `undefined === 0` — `false` — for a missing snapshot, i.e. it declined to
 * refetch in the one state where nothing whatsoever is held. Reachable after any
 * `fetchFailed` (a dead worker, an Overpass 429) and at boot.
 */
export function needsRefetchFor(
  previous: LayerSet,
  next: LayerSet,
  heldCells: number,
): boolean {
  return needsRefetch(previous, next) && heldCells === 0;
}
