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

export interface LayerTogglesOptions {
  readonly container: HTMLElement;
  /** Called with the complete next set whenever a switch changes. */
  readonly onChange: (layers: LayerSet) => void;
}

export interface LayerToggles {
  /** Brings the switches in line with the store. Safe to call on every change. */
  render(layers: LayerSet): void;
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

  for (const layer of ALL_LAYERS) {
    const label = document.createElement("label");
    label.className = "layer-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset["layer"] = layer;
    // Named so the e2e can address one switch without depending on DOM order.
    input.id = `layer-${layer}`;
    label.append(input, document.createTextNode(` ${labelFor(layer)}`));
    container.append(label);
    inputs.set(layer, input);
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
    dispose() {
      container.removeEventListener("change", onInput);
    },
  };
}
