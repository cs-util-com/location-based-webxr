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
    case "terrainDebug":
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
  /**
   * Greys out a switch that cannot currently do anything (DEC-R3-17).
   *
   * DISABLED, NEVER HIDDEN, and its stored value is untouched: a control that
   * disappears reads as a bug, and one whose value is silently reset loses the
   * user's choice on the way back. The live case is `terrainDebug` under the
   * `No ground` mode — the ramp re-colours the ground plane in place, so with the
   * plane hidden the switch would be a control that does nothing, which is the
   * shape of half of round 3's findings.
   */
  setAvailable(layer: LayerKind, available: boolean): void;
  dispose(): void;
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
      return "ground";
    case "roads":
      return "roads";
    case "poi":
      return "POI";
    case "terrainDebug":
      return "height ramp";
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
    setAvailable(layer, available) {
      const input = inputs.get(layer);
      if (input === undefined) return;
      input.disabled = !available;
      // The LABEL is dimmed with it, or the text stays at full contrast beside a
      // greyed box and the control reads as broken rather than as unavailable.
      input.parentElement?.classList.toggle("layer-toggle-off", !available);
    },
    dispose() {
      container.removeEventListener("change", onInput);
    },
  };
}
