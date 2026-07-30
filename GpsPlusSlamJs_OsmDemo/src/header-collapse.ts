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
 * WHAT STAYS VISIBLE WHEN COLLAPSED (DEC-R2-4). The title, the category picker and
 * the legend. The picker is one of the demo's two primary inputs and collapsing it
 * away would put it two taps from reach; the legend was added in round 1
 * specifically because nothing on screen named the current category (DEC-1), so a
 * collapsed bar without it re-creates the confusion it was built to fix.
 *
 * THE ERROR RULE (DEC-R2-15). The status line is hidden when collapsed, and the
 * locate button plus the fetch path both report failures **into** the status line.
 * That is a message written into something invisible — so any error expands the
 * header. It stays expanded until dismissed, because auto-collapsing again would
 * race the user reading it. This is the smallest rule that keeps ONE error channel
 * instead of growing a second one.
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
  /** Expands if collapsed. Called when an error needs to be readable. */
  revealForError(): void;
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
    revealForError: () => {
      set(false);
    },
    dispose: () => {
      toggle.removeEventListener("click", onClick);
      toggle.removeEventListener("keydown", onKeyDown);
    },
  };
}
