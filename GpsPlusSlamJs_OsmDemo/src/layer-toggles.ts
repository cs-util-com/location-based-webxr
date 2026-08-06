/**
 * The layer switches in the header, built from the registry rather than by hand.
 *
 * WHY IT IS GENERATED FROM `ALL_LAYERS`. A hand-written row of checkboxes is a
 * second list of layers, and the two drift the moment a builder is added — leaving a
 * layer that renders but cannot be switched off, which is exactly the state the
 * registry exists to prevent. Generating them means the compiler's exhaustiveness
 * over `LayerKind` reaches the UI too.
 *
 * WHY IT REPORTS A WHOLE SET rather than one changed layer. The store's action
 * replaces the set (see `osm-view-slice.ts` for the publish-boundary reason), and
 * `toggleLayer` is the one place that knows how to produce a valid next set. This
 * file does DOM, not state arithmetic.
 *
 * @see layer-toggles.ts.md
 */

import {
  ALL_LAYERS,
  isLayerEnabled,
  toggleLayer,
  type LayerKind,
  type LayerSet,
} from "./layers.js";

/**
 * The three kinds of switch, which is what the grouping is FOR (W15).
 *
 * Nine checkboxes in one wrapping row is a pile, and a pile is what the round-3
 * notes called prototypical. The grouping is not decoration: the three groups
 * answer three different questions — what is the affordance analysis claiming,
 * what is in the world, and what am I inspecting the renderer with — and a
 * reader who knows which group a switch is in already knows most of what it does.
 */
// Not exported: `extras` reaches it through `LayerTogglesOptions`, which is the
// only way a caller ever names a group, and knip is right that a second public
// name earns nothing.
type LayerGroup = "overlays" | "world" | "diagnostics";

/** Which group each layer belongs to. Exhaustive over the union by construction. */
function groupOf(layer: LayerKind): LayerGroup {
  switch (layer) {
    case "cells":
    case "areas":
      return "overlays";
    case "buildings":
    case "trees":
    case "plates":
    case "roads":
    case "poi":
      return "world";
    // A DIAGNOSTIC, not a thing in the world: it draws what the scorer REFUSED
    // to look at, so it belongs beside the other "why does it look like that"
    // switches rather than among the buildings and trees.
    case "underground":
      return "diagnostics";
  }
}

/** Group captions, in the order the groups appear. */
const GROUP_LABELS: readonly (readonly [LayerGroup, string])[] = [
  ["overlays", "affordance"],
  ["world", "world"],
  ["diagnostics", "debug"],
];

export interface LayerTogglesOptions {
  readonly container: HTMLElement;
  /** Called with the complete next set whenever a switch changes. */
  readonly onChange: (layers: LayerSet) => void;
  /**
   * Controls that belong in a group but are not layers.
   *
   * The perf panel is the live case: it is a diagnostic and belongs beside the
   * height ramp, but it draws nothing in the scene so it is deliberately not in
   * `ALL_LAYERS` (DEC-R3-18). Passing the element in is what puts it in the right
   * group without inventing a second registry or moving DOM around after the
   * fact.
   */
  readonly extras?: Partial<Record<LayerGroup, readonly HTMLElement[]>>;
}

export interface LayerToggles {
  /** Brings the switches in line with the store. Safe to call on every change. */
  render(layers: LayerSet): void;
  // `setAvailable` USED TO LIVE HERE and was removed with its only caller (W6,
  // DEC-R5-4). It greyed out a switch that could not currently do anything, and
  // `terrainDebug` under `No ground` was the only such case in the demo. Folding
  // the ramp into the ground mode makes DEC-R3-17 true by construction — there is
  // no `none-ramp` entry to offer — so the capability had nothing left to
  // describe. If a layer ever genuinely needs disabling again, the rule it
  // enforced is worth restoring verbatim: DISABLED, never hidden, with the stored
  // value untouched, because a control that disappears reads as a bug and one
  // whose value is silently reset loses the user's choice on the way back.
  /**
   * Marks one switch as WORKING, so an async toggle does not look inert.
   *
   * WHY IT EXISTS (F58). Since round 10 stage B, switching `cells` ON triggers a
   * refresh rather than a redraw -- the snapshot omits the array while the layer
   * is off. MEASURED at 1880 ms with the tiles already held, which is far over
   * the "few hundred milliseconds" at which the root `CLAUDE.md` requires a
   * control to show an in-progress state. The round-10 summary ESTIMATED this
   * was comfortably under; the estimate was wrong by about 5x.
   *
   * DISABLED, NEVER HIDDEN, AND THE STORED VALUE IS UNTOUCHED -- the rule the
   * removed `setAvailable` left behind, and it applies unchanged here: a control
   * that disappears reads as a bug, and one whose value is silently reset loses
   * the choice the user just made.
   */
  setBusy(layer: LayerKind, busy: boolean): void;
  dispose(): void;
}

/**
 * What a layer does BEYOND drawing itself, or `undefined` for the honest ones.
 *
 * Only one layer has an answer today, and it is the accepted cost DEC-S1 wrote
 * down rather than discovered: the marker set is not independent of the layer
 * set. A tooltip is the smallest thing that turns that from a mystery into a
 * rule — and per DEC-S1 the alternative was worse, since suppressing a pool
 * marker whether or not its pool is drawn makes the pool vanish entirely under
 * the shipped defaults.
 */
function sideEffectOf(layer: LayerKind): string | undefined {
  if (layer !== "plates") return undefined;
  return "Also hides the pool, pitch and parking markers whose area this draws — the area already says what they say.";
}

/** Human-readable name for a layer. Short, because they sit in a crowded bar. */
function labelFor(layer: LayerKind): string {
  switch (layer) {
    case "cells":
      return "cells";
    case "areas":
      return "areas";
    case "buildings":
      return "buildings";
    case "trees":
      return "trees";
    case "plates":
      // "landuse", NOT "ground" and NOT "OSM areas", and both rejections are the
      // point. It said "ground" until the ground-mode picker landed beside it
      // (W11), and two controls labelled "ground" meaning different things — one
      // a layer of OSM landuse/amenity/leisure/natural polygons, the other which
      // SURFACE is drawn — is unreadable: picking "No ground" while something
      // labelled "ground" is still on screen looks like the picker failed. The
      // picker owns the word, because it is the one with a "none".
      //
      // "OSM areas" was the first replacement and it collided with the
      // `areas` layer — the merged affordance regions — for a human reading the
      // bar and for two e2e locators addressing "areas" by accessible name. What
      // the builder actually selects is `PLATE_KEYS`: amenity, landuse, leisure,
      // natural. "landuse" is the honest short name for that set.
      return "landuse";
    case "roads":
      return "roads";
    case "poi":
      return "POI";
    case "underground":
      return "underground";
  }
}

export function attachLayerToggles(options: LayerTogglesOptions): LayerToggles {
  const { container, onChange } = options;
  /** Current set, so a change can be applied to it rather than reconstructed. */
  let current: LayerSet | undefined;
  const inputs = new Map<LayerKind, HTMLInputElement>();

  const onInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const layer = input.dataset["layer"] as LayerKind | undefined;
    if (layer === undefined || current === undefined) return;
    onChange(toggleLayer(current, layer, input.checked));
  };

  for (const [group, caption] of GROUP_LABELS) {
    const box = document.createElement("div");
    box.className = "layer-group";
    box.id = `layer-group-${group}`;
    const title = document.createElement("span");
    title.className = "layer-group-label";
    title.textContent = caption;
    box.append(title);

    for (const layer of ALL_LAYERS) {
      if (groupOf(layer) !== group) continue;
      const label = document.createElement("label");
      label.className = "layer-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset["layer"] = layer;
      // Named so the e2e can address one switch without depending on DOM order.
      // THE IDS ARE THE CONTRACT: the suite locates every switch by `#layer-<id>`,
      // so the grouping had to move the elements without renaming any of them.
      input.id = `layer-${layer}`;
      label.append(input, document.createTextNode(` ${labelFor(layer)}`));
      // WHY A LAYER MIGHT DO MORE THAN ITS NAME SAYS (stage 4, DEC-S1's cost).
      // Switching `landuse` on makes pool, pitch and parking MARKERS disappear,
      // because the area it draws already says what they say. That is legible
      // once you know the rule and a mystery until you do — and the toggle is
      // the only place a user meets it.
      const note = sideEffectOf(layer);
      if (note !== undefined) label.title = note;
      box.append(label);
      inputs.set(layer, input);
    }

    for (const extra of options.extras?.[group] ?? []) box.append(extra);
    container.append(box);
  }

  // ONE delegated listener rather than seven, and held so `dispose` can remove it.
  container.addEventListener("change", onInput);

  return {
    render(layers) {
      current = layers;
      for (const layer of ALL_LAYERS) {
        const input = inputs.get(layer);
        if (input === undefined) continue;
        const enabled = isLayerEnabled(layers, layer);
        // Guarded: assigning `checked` unconditionally is harmless for a checkbox,
        // but re-rendering from the store must never be able to fire `change` and
        // dispatch again — that is a loop, and a subtle one.
        if (input.checked !== enabled) input.checked = enabled;
      }
    },
    setBusy(layer, busy) {
      const input = inputs.get(layer);
      if (input === undefined) return;
      input.disabled = busy;
      // On the LABEL, so the cue is the whole row rather than a checkbox a
      // finger is covering.
      input.closest("label")?.classList.toggle("layer-busy", busy);
    },
    dispose() {
      container.removeEventListener("change", onInput);
    },
  };
}

/**
 * Runs an async action with one switch marked busy, and ALWAYS clears it.
 *
 * EXTRACTED SO THE `finally` CAN BE TESTED. Inline in `main.ts` the distinction
 * between `.then` and `.finally` is unreachable: the e2e cannot produce a
 * rejecting refresh, because `DemoPipeline.update` collects refused tiles into
 * `missingTiles` rather than throwing — an HTTP 400 is a SUCCESSFUL, empty
 * refresh, which `refresh-cycle.ts.md` states outright. So a `then` would leave
 * the control stranded on exactly the path nothing could exercise, which is the
 * worst place for an untested branch.
 *
 * Takes only the capability it needs (`Pick<…, "setBusy">`) so a test can pass a
 * two-line stub rather than a DOM.
 */
export async function withLayerBusy(
  toggles: Pick<LayerToggles, "setBusy">,
  layers: LayerKind | readonly LayerKind[],
  run: () => Promise<unknown>,
): Promise<void> {
  // TAKES A LIST, because more than one layer can need the same fetch. While
  // `cells` was the only data-gated layer the caller could name it literally;
  // adding `underground` made that spin the WRONG checkbox — the cells switch
  // went disabled for ~1.9 s while the switch the user actually clicked showed
  // nothing at all. Raised in review on #256.
  const busy = Array.isArray(layers)
    ? (layers as readonly LayerKind[])
    : [layers as LayerKind];
  for (const layer of busy) toggles.setBusy(layer, true);
  try {
    await run();
  } finally {
    for (const layer of busy) toggles.setBusy(layer, false);
  }
}
