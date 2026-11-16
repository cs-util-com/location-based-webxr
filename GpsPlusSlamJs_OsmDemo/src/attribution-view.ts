/**
 * The map's footer line: "© OpenStreetMap | Credits | Legal".
 *
 * WHY THE DEMO OWNS THIS INSTEAD OF USING LEAFLET'S.
 * `Control.Attribution._update` finishes by assigning `innerHTML` on its own
 * container, and it runs on every `addAttribution`/`removeAttribution` - which
 * `MapView.setTerrainAttribution` calls on every terrain apply, repeatedly
 * during normal use. A Credits view injected into that control, and its
 * listener, would be destroyed mid-session at random, closing an open view for
 * no reason the user could see. Leaflet exposes no hook that survives it, so
 * the choice is between owning the control and not having a Credits view.
 *
 * WHAT STAYS VISIBLE, AND WHY (see `attribution-view.ts.md`).
 * - The OSMF attribution guidelines ask for the credit to "OpenStreetMap" to
 *   be visible without interaction and to link to openstreetmap.org/copyright,
 *   which is how it also names the ODbL. That entry is `pinned`.
 * - The elevation sources' licences (CC BY and similar, via Mapterhorn and the
 *   AWS Terrain Tiles) ask for credit "in any reasonable manner", which CC BY
 *   4.0 says may be a link to a resource carrying the attribution. The Credits
 *   view one tap away beside the map is that resource, with every source
 *   linked where it has a page.
 * - The legal notice and privacy link sits in the same line, so the map has
 *   one footer instead of a corner each.
 *
 * Thin on purpose, like `legend-view.ts`: this file is DOM and nothing else.
 * The Leaflet wiring lives in `map-view.ts`, which is also the only place that
 * knows a map exists.
 *
 * @see attribution-view.ts.md
 */

export interface AttributionEntry {
  /** The short name the resting line shows when the entry is `pinned`. */
  readonly short: string;
  /** The full credit, listed in the Credits view. */
  readonly full: string;
  /** The source's canonical page; makes the credit a link wherever it shows. */
  readonly href?: string;
  /**
   * Shown in the resting line as well as in the Credits view, for a source
   * whose terms ask for a credit visible without interaction.
   */
  readonly pinned?: boolean;
}

/** What separates the items in the resting line. Hidden from screen readers. */
const SEPARATOR = " | ";

/** Makes each instance's panel id unique: a page may hold more than one map. */
let instances = 0;

/** A link to another site, which must not get `window.opener`. */
function externalLink(href: string, text: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

/** Equal by value, field by field and in order. */
function sameEntries(
  a: readonly AttributionEntry[],
  b: readonly AttributionEntry[],
): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        y !== undefined &&
        x.short === y.short &&
        x.full === y.full &&
        x.href === y.href &&
        (x.pinned === true) === (y.pinned === true)
      );
    })
  );
}

function separator(): HTMLElement {
  const sep = document.createElement("span");
  sep.className = "map-attribution-sep";
  sep.setAttribute("aria-hidden", "true");
  sep.textContent = SEPARATOR;
  return sep;
}

export class AttributionView {
  readonly element: HTMLElement;
  private readonly line: HTMLElement;
  /** The pinned credits, re-rendered by `setEntries`; may be empty. */
  private readonly pinned: HTMLElement;
  private readonly details: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private legal: HTMLAnchorElement | undefined;
  /** The pipe in front of the adopted legal link, removed with it. */
  private legalSeparator: HTMLElement | undefined;
  /** The last list rendered, compared by value to skip unchanged ones. */
  private entries: readonly AttributionEntry[] = [];
  /**
   * Held rather than read back off the DOM, so `setEntries` can restore it.
   * A re-render that silently closed the view would be the exact defect this
   * control was written to avoid (see the file header).
   */
  private expanded = false;

  constructor() {
    // `leaflet-control-attribution` as well as our own class: the container IS
    // an attribution control in a Leaflet corner, so Leaflet's stylesheet gives
    // it the right look, and the e2e locators address it by that class.
    this.element = document.createElement("div");
    this.element.className = "leaflet-control-attribution map-attribution";

    this.line = document.createElement("span");
    this.line.className = "map-attribution-line";

    this.pinned = document.createElement("span");
    this.pinned.className = "map-attribution-pinned";

    // A plain word, so the visible text IS the accessible name; the open state
    // is `aria-expanded`'s to announce, so the name never changes with it.
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "map-attribution-toggle";
    this.toggle.textContent = "Credits";
    this.toggle.setAttribute("aria-expanded", "false");

    // A disclosure, not a dialog: the map stays usable while it is open, so
    // focus is not trapped. `aria-controls` is the programmatic route from the
    // button to what it reveals.
    this.details = document.createElement("div");
    this.details.className = "map-attribution-full";
    this.details.hidden = true;
    this.details.id = `map-attribution-full-${String(++instances)}`;
    this.toggle.setAttribute("aria-controls", this.details.id);

    this.toggle.addEventListener("click", () => {
      this.setExpanded(!this.expanded);
    });
    // Escape anywhere inside the control closes an open view and puts focus
    // back on "Credits", so a keyboard user is never left on a link that just
    // disappeared. Only when open: a closed view has nothing to close, and
    // swallowing the key would break other Escape handlers on the page.
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.expanded) return;
      event.preventDefault();
      event.stopPropagation();
      this.setExpanded(false);
      this.toggle.focus();
    });

    this.line.append(this.pinned, this.toggle);
    this.element.append(this.line, this.details);
    this.updateVisibility();
  }

  /**
   * Moves the page's own legal notice link to the end of the line.
   *
   * Adopted rather than created: the link stays in `index.html`, so the page
   * offers it even if this script never runs, and there is one link, not two.
   * Idempotent: adopting the same link again changes nothing, and another
   * link replaces the first with its separator.
   */
  adoptLegalLink(link: HTMLAnchorElement): void {
    if (link === this.legal) return;
    if (this.legal?.parentElement === this.line) this.legal.remove();
    this.legalSeparator?.remove();
    this.legal = link;
    this.legalSeparator = separator();
    this.line.append(this.legalSeparator, link);
    this.updateVisibility();
  }

  /**
   * Replaces the credited sources.
   *
   * Idempotent and order-preserving, and it RESTORES the open state rather
   * than resetting it.
   *
   * An unchanged list (equal by value) touches nothing: `MapView` passes the
   * same list on every terrain apply, and re-rendering would detach a focused
   * link and drop focus to `<body>`, out of reach of the Escape handler. A
   * changed list that re-renders under focus moves it to the same credit's new
   * link, or to "Credits" when that credit is gone.
   */
  setEntries(entries: readonly AttributionEntry[]): void {
    if (sameEntries(this.entries, entries)) return;
    this.entries = [...entries];

    const focused = document.activeElement;
    const container = [this.pinned, this.details].find(
      (el) => focused !== null && el.contains(focused),
    );
    const focusedHref = focused?.getAttribute("href") ?? null;

    // `textContent`, never a template string: a credit is exactly the kind of
    // externally-authored text that acquires an ampersand or an angle bracket
    // the day nobody is looking.
    this.pinned.replaceChildren();
    for (const entry of entries.filter((e) => e.pinned === true)) {
      if (this.pinned.childElementCount > 0) this.pinned.append(separator());
      const name =
        entry.href === undefined
          ? document.createElement("span")
          : externalLink(entry.href, entry.short);
      name.textContent = entry.short;
      // The e2e suites address the pinned credits by this class.
      name.classList.add("map-attribution-short");
      this.pinned.append(name);
    }
    if (this.pinned.childElementCount > 0) this.pinned.append(separator());

    this.details.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "map-attribution-credit";
      if (entry.href === undefined) row.textContent = entry.full;
      else row.append(externalLink(entry.href, entry.full));
      this.details.append(row);
    }

    this.updateVisibility();
    this.setExpanded(this.expanded);

    if (container !== undefined) {
      const same = [...container.querySelectorAll("a")].find(
        (a) => focusedHref !== null && a.getAttribute("href") === focusedHref,
      );
      (same ?? this.toggle).focus();
    }
  }

  /** Hidden only when there is neither a credit nor a legal link to show. */
  private updateVisibility(): void {
    this.element.hidden = this.entries.length === 0 && this.legal === undefined;
  }

  private setExpanded(next: boolean): void {
    this.expanded = next;
    this.details.hidden = !next;
    this.toggle.setAttribute("aria-expanded", String(next));
  }
}
