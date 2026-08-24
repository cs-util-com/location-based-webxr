/**
 * The collapsible header, and the one rule that keeps it honest.
 *
 * WHY IT IS WORTH COLLAPSING, AND WHY THE REPORT UNDERSTATED IT. The feedback
 * assumed the header already floats over the 3D view ("das ist glaube ich auch
 * gerade schon der Fall"). **It does not.** `body` is
 * `grid-template-rows: auto 1fr`, so the header is a grid ROW that takes real
 * layout height and `main` gets the remainder. On a phone in portrait it wraps to
 * several lines — the title, the category picker, the checkbox, a hint, an
 * eight-fact status string, the legend and the terrain credit — and every one of
 * those lines is taken out of the 3D view's height rather than covering it.
 *
 * So collapsing HANDS BACK viewport rather than merely uncovering pixels, which
 * makes it a better change than the one requested. (Making it an overlay as well
 * is a separate change with a separate effect, and was not taken.)
 *
 * WHAT STAYS VISIBLE WHEN COLLAPSED (DEC-R2-4, narrowed since). The category
 * picker — one of the demo's two primary inputs, which collapsing away would
 * put two taps from reach — and the caret itself. This paragraph used to list
 * the title and the legend too (PR #329 review): the title TEXT was removed by
 * F3b, so the `<h1>` holds only the caret, and DEC-W4 hides `#legend` when
 * collapsed — the argument was always about the collapsed bar, so the
 * expanded legend keeps its place.
 *
 * THE ERROR RULE IS RETIRED (DEC-R2-15 → DEC-U10). It said "any error expands
 * the header", because errors reported into the status line, which is hidden
 * when collapsed. Errors have a toast now — a channel visible while the
 * header is collapsed — so `revealForError` is gone
 * (`header-collapse.test.ts` pins its absence) and the collapse behaviour is
 * entirely user-driven.
 *
 * @see header-collapse.ts.md
 */

export interface HeaderCollapseOptions {
  /** The `<header>` itself; gains `data-collapsed`. */
  readonly header: HTMLElement;
  /** The clickable title. Becomes a real button for keyboard and AT reach. */
  readonly toggle: HTMLElement;
  /**
   * Called after every change, so the caller can resize its canvases.
   *
   * Collapsing changes `main`'s height and neither Leaflet nor the WebGL renderer
   * notices a container that resized without a window event. **The 3D view must
   * also repaint** — it renders on demand, so a resize without a scheduled frame
   * leaves the pane blank (finding R2-3). `BuildingView.resize()` handles that
   * itself now; this only has to call it.
   */
  readonly onToggle: () => void;
}

export interface HeaderCollapse {
  /** Collapses or expands, and reports through `onToggle`. */
  set(collapsed: boolean): void;
  readonly collapsed: boolean;
  dispose(): void;
}

/**
 * Wires the header's collapse behaviour.
 *
 * The state lives in a `data-collapsed` attribute rather than a class, so the CSS
 * and the tests read the same single source and `aria-expanded` can be derived
 * from it without a second place to forget.
 */
export function attachHeaderCollapse(
  options: HeaderCollapseOptions,
): HeaderCollapse {
  const { header, toggle, onToggle } = options;
  let collapsed = false;

  // Made a real button rather than a styled `<h1>` with a click handler: a
  // div-with-onclick is unreachable by keyboard and unannounced by a screen
  // reader, and this is the only control for a bar that hides two others.
  toggle.setAttribute("role", "button");
  toggle.setAttribute("tabindex", "0");

  function apply(): void {
    header.dataset["collapsed"] = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    // THE ACCESSIBLE NAME, SET HERE BECAUSE THE TITLE TEXT IS GONE (F3b).
    //
    // This element used to read "OSM affordance demo", and that text WAS the
    // control's name — a screen reader announced "OSM affordance demo, button,
    // expanded". Dropping the text for a tidier bar leaves a button that
    // announces as nothing at all, which is a regression nobody sees and no
    // visual test can catch.
    //
    // `aria-expanded` alone is not a substitute: it says what STATE the control
    // is in, never what it controls. Both are needed, and the label tracks the
    // state so the announcement stays a sentence rather than a contradiction.
    toggle.setAttribute(
      "aria-label",
      collapsed ? "Show details" : "Hide details",
    );
    onToggle();
  }

  function set(next: boolean): void {
    if (next === collapsed) return;
    collapsed = next;
    apply();
  }

  const onClick = (): void => {
    set(!collapsed);
  };
  // Space and Enter, because `role="button"` promises them and a bare element
  // does not deliver them the way a real `<button>` would.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Space would otherwise scroll the page out from under the tap target.
    event.preventDefault();
    set(!collapsed);
  };

  toggle.addEventListener("click", onClick);
  toggle.addEventListener("keydown", onKeyDown);
  apply();

  return {
    set,
    get collapsed() {
      return collapsed;
    },
    dispose: () => {
      toggle.removeEventListener("click", onClick);
      toggle.removeEventListener("keydown", onKeyDown);
    },
  };
}
