/**
 * The map's attribution line: a short name per source, full credits behind an
 * expander.
 *
 * WHY THE DEMO OWNS THIS INSTEAD OF USING LEAFLET'S (round three, G5/F5).
 * `Control.Attribution._update` finishes by assigning `innerHTML` on its own
 * container, and it runs on every `addAttribution`/`removeAttribution` — which
 * `MapView.setTerrainAttribution` calls on every terrain apply, repeatedly
 * during normal use. An expander injected into that control, and its listener,
 * would be destroyed mid-session at random, resetting an expanded state for no
 * reason the user could see. Leaflet exposes no hook that survives it, so the
 * choice is between owning the control and not having an expander.
 *
 * WHAT MAY AND MAY NOT COLLAPSE (DEC-W1). Every source keeps a VISIBLE short
 * name; only the long credit text moves behind the tap. ODbL requires the OSM
 * credit wherever the data is shown, and this repo records the two elevation
 * credits as required "the same as the OSM one" — so hiding any of them behind
 * a tap would answer a licence question in the opposite direction to the answer
 * already written into `map-view.ts` and `main.ts`. The owner asked for "one
 * word per attribution" in a thin line; one short name each IS that, which is
 * why the request and the obligation turned out to be the same design rather
 * than a compromise between two.
 *
 * Thin on purpose, like `legend-view.ts`: this file is DOM and nothing else.
 * The Leaflet wiring lives in `map-view.ts`, which is also the only place that
 * knows a map exists.
 *
 * @see attribution-view.ts.md
 */

export interface AttributionEntry {
  /** The always-visible short name. One or two words. */
  readonly short: string;
  /** The full credit, revealed by the expander. */
  readonly full: string;
  /** Where the short name links, for a source with a canonical page. */
  readonly href?: string;
}

/** What separates the short names in the resting line. */
const SEPARATOR = " · ";

export class AttributionView {
  readonly element: HTMLElement;
  private readonly line: HTMLElement;
  private readonly details: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  /**
   * Held rather than read back off the DOM, so `setEntries` can restore it.
   *
   * A re-render that silently collapsed the panel would be the exact defect
   * this control was written to avoid — see the file header.
   */
  private expanded = false;

  constructor() {
    // `leaflet-control-attribution` as well as our own class: the container IS
    // an attribution control in a Leaflet corner, so Leaflet's stylesheet gives
    // it the right look for free — and every existing e2e locator addresses it
    // by that class, so owning the rendering does not also mean rewriting the
    // suite's selectors.
    this.element = document.createElement("div");
    this.element.className = "leaflet-control-attribution map-attribution";

    this.line = document.createElement("span");
    this.line.className = "map-attribution-line";

    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "map-attribution-toggle";
    this.toggle.textContent = "Attributions";
    this.toggle.setAttribute("aria-expanded", "false");

    this.details = document.createElement("div");
    this.details.className = "map-attribution-full";
    this.details.hidden = true;

    this.toggle.addEventListener("click", () => {
      this.setExpanded(!this.expanded);
    });

    this.element.append(this.line, this.toggle, this.details);
    this.element.hidden = true;
  }

  /**
   * Replaces the credited sources.
   *
   * Idempotent and order-preserving. An empty list hides the control outright
   * rather than leaving a stray separator and an "Attributions" button in the
   * corner of the map.
   */
  setEntries(entries: readonly AttributionEntry[]): void {
    this.element.hidden = entries.length === 0;

    // `textContent`, never a template string — the same rule `legend-view.ts`
    // follows. These strings come from library constants today, and a credit is
    // exactly the kind of externally-authored text that acquires an ampersand
    // or an angle bracket the day nobody is looking.
    this.line.replaceChildren();
    entries.forEach((entry, index) => {
      if (index > 0) this.line.append(document.createTextNode(SEPARATOR));
      const name = document.createElement("span");
      name.className = "map-attribution-short";
      if (entry.href === undefined) {
        name.textContent = entry.short;
      } else {
        const link = document.createElement("a");
        link.href = entry.href;
        link.target = "_blank";
        // A cross-origin link opened from the map must not hand `window.opener`
        // to the destination.
        link.rel = "noopener noreferrer";
        link.textContent = entry.short;
        name.append(link);
      }
      this.line.append(name);
    });

    this.details.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "map-attribution-credit";
      row.textContent = entry.full;
      this.details.append(row);
    }

    // RESTORED, not reset. See `expanded`'s comment.
    this.setExpanded(this.expanded);
  }

  private setExpanded(next: boolean): void {
    this.expanded = next;
    this.details.hidden = !next;
    this.toggle.setAttribute("aria-expanded", String(next));
  }
}
