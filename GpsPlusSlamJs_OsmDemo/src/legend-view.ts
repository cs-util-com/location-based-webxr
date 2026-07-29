/**
 * The legend, in the DOM.
 *
 * Thin on purpose: every decision — which bands exist, what they say, that no
 * two of them look alike — lives in `legend-model.ts` and is tested without a
 * browser. This file turns that model into elements and nothing else.
 *
 * WHY IT IS BUILT WITH `textContent` AND NOT A TEMPLATE STRING. The category
 * name is a column header from the publicly editable rule sheet, and so is
 * anything derived from it. `escape-html.ts` exists because this app already
 * renders sheet-derived text into HTML sinks; the legend avoids the sink
 * entirely rather than escaping its way through one.
 *
 * @see legend-view.ts.md
 */

import { legendModel, type LegendStop } from "./legend-model.js";
import type { HeatScale } from "./heat-colours.js";

export interface LegendViewOptions {
  readonly container: HTMLElement;
}

export class LegendView {
  private readonly container: HTMLElement;

  constructor(options: LegendViewOptions) {
    this.container = options.container;
  }

  /** Empties the legend — there is nothing to explain without a scale. */
  clear(): void {
    this.container.replaceChildren();
  }

  render(
    scale: HeatScale,
    category: string,
    showBelowThreshold: boolean,
  ): void {
    const model = legendModel(scale, category, showBelowThreshold);

    const name = document.createElement("span");
    name.className = "legend-category";
    name.textContent = model.category;

    const strip = document.createElement("span");
    strip.className = "legend-strip";
    // The sentence the strip replaces, kept where a screen reader and a hover
    // can still reach it (DEC-13: replaced pictorially, never deleted).
    strip.title = model.description;
    strip.setAttribute("aria-label", model.description);
    for (const stop of model.ramp) strip.append(swatch(stop));

    const min = document.createElement("span");
    min.className = "legend-min";
    min.textContent = model.minLabel;
    const max = document.createElement("span");
    max.className = "legend-max";
    max.textContent = model.maxLabel;

    const children: HTMLElement[] = [name, min, strip, max];
    for (const band of model.bands) {
      const item = document.createElement("span");
      item.className = "legend-band";
      item.append(swatch(band));
      const label = document.createElement("span");
      label.textContent = band.label;
      item.append(label);
      children.push(item);
    }

    this.container.replaceChildren(...children);
  }
}

/** One coloured square. `fill: false` renders as an outline, asserting nothing. */
function swatch(stop: LegendStop): HTMLElement {
  const box = document.createElement("span");
  box.className = `legend-swatch legend-swatch-${stop.kind}`;
  if (stop.fill) {
    box.style.background = stop.colour;
    box.style.borderColor = stop.colour;
  } else {
    box.style.background = "transparent";
    box.style.borderColor = stop.colour;
  }
  return box;
}
