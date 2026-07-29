/**
 * The details panel: why THIS cell scores what it scores.
 *
 * WHY A PANEL RATHER THAN A BIGGER POPUP. The popup is small, it sits on top of
 * the thing being inspected, and on a phone it covers most of the map. A tree
 * over "every contributing element and every one of its tags" is the wrong
 * shape for it. The panel is also where a 3D pick lands once that exists, so
 * one selection has one place to be explained regardless of which view produced
 * it.
 *
 * WHY IT IS AN OVERLAY ON DESKTOP TOO (DEC-17). The plan first put it in a thin
 * third column. On a laptop that leaves the 2D and 3D panes at ~450 px each —
 * the width that made the 3D pane useless on the phone. Floating it over the
 * split keeps both views full size, costs a dismiss button, and means one
 * layout to build and test instead of two.
 *
 * Every decision it renders lives in `explanation-tree.ts`; this file builds
 * nodes. Text goes in with `textContent`, never a template string: tag keys and
 * values come from OSM and the rule ids from a publicly editable sheet, and
 * avoiding the HTML sink is stronger than escaping into one.
 *
 * @see details-panel.ts.md
 */

import { explanationTree, type FeatureRow } from "./explanation-tree.js";
import type { CellExplanation } from "gps-plus-slam-osm";

export interface DetailsPanelOptions {
  readonly container: HTMLElement;
  /** Called when the user dismisses the panel, so the store can deselect. */
  readonly onClose: () => void;
}

export class DetailsPanel {
  private readonly container: HTMLElement;
  private readonly onClose: () => void;

  constructor(options: DetailsPanelOptions) {
    this.container = options.container;
    this.onClose = options.onClose;
  }

  /** Hides the panel. Nothing is selected, so there is nothing to explain. */
  clear(): void {
    this.container.replaceChildren();
    this.container.hidden = true;
  }

  render(explanation: CellExplanation): void {
    const tree = explanationTree(explanation);
    const nodes: HTMLElement[] = [];

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("strong");
    title.textContent = `${tree.category} = ${tree.scoreLabel}`;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "panel-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "close details");
    close.addEventListener("click", this.onClose);
    header.append(title, close);
    nodes.push(header);

    // The sentence a table of numbers cannot say: "nothing is mapped here",
    // "something vetoed it" and "it scored but under the bar" read almost
    // identically as rows, and telling them apart is why the panel exists.
    const summary = document.createElement("p");
    summary.className = "panel-summary";
    summary.textContent = tree.summary;
    nodes.push(summary);

    const bar = document.createElement("p");
    bar.className = "panel-threshold";
    bar.textContent = tree.aboveThreshold
      ? `above the ${tree.thresholdLabel} threshold`
      : `at or below the ${tree.thresholdLabel} threshold — not drawn as a region`;
    nodes.push(bar);

    for (const feature of tree.features) nodes.push(featureNode(feature));

    this.container.replaceChildren(...nodes);
    this.container.hidden = false;
  }
}

/** One collapsible feature: the element, its factor, and its tags. */
function featureNode(feature: FeatureRow): HTMLElement {
  const details = document.createElement("details");
  details.className = `panel-feature panel-feature-${feature.state}`;
  // The vetoing feature opens by default: it is the answer, and making the
  // reader find and click it is making them guess which row is the answer.
  details.open = feature.state === "veto";

  const summary = document.createElement("summary");
  const link = document.createElement("a");
  link.href = feature.osmUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = feature.key;
  const factor = document.createElement("span");
  factor.className = "panel-factor";
  factor.textContent = ` × ${feature.factorLabel}`;
  summary.append(link, factor);
  details.append(summary);

  const table = document.createElement("table");
  table.className = "panel-tags";
  for (const tag of feature.tags) {
    const row = document.createElement("tr");
    row.className = `panel-tag panel-tag-${tag.state}`;
    for (const text of [
      `${tag.key}=${tag.value}`,
      tag.factorLabel,
      tag.runningLabel,
      // Named in the row rather than only in a colour: a legend for five tag
      // states in a panel this size would cost more room than the words do,
      // and "skipped" is the one a reader must not have to infer.
      tag.state === "scored" ? "" : tag.state,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    table.append(row);
  }
  details.append(table);
  return details;
}
