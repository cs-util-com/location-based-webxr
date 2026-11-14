/**
 * The command bar's panels: the settings drawer, the status info and the sun
 * popover share one place on screen, so at most one of them is open.
 *
 * Open/closed is view state only: nothing here is stored, every page load
 * starts with all panels closed, and no control's VALUE passes through here
 * (the drawer moves controls, the store keeps their values).
 *
 * Opening moves focus to the panel itself (it is made focusable for that):
 * the panels sit after the map and the scene in the page, so Tab from the
 * opener would otherwise walk every map control before reaching them.
 *
 * Escape closes the open panel and hands focus back to its opener. A panel
 * that something else already answered (a dialog stacked over it calls
 * `preventDefault` on its own Escape) is left open, so one Escape closes one
 * layer. The listener sits on `window`, which sees a key after every
 * `document` listener, so a stacked layer always answers first.
 */

interface HudPanelSpec {
  /** The panel element; its `hidden` attribute is the open state. */
  readonly element: HTMLElement;
  /** The bar button that toggles it, told `aria-expanded`. */
  readonly opener: HTMLElement;
}

export interface HudPanelsOptions {
  readonly panels: Readonly<Record<string, HudPanelSpec>>;
  /** Called after every change with the open panel's name, or undefined. */
  readonly onChange?: (open: string | undefined) => void;
}

export interface HudPanels {
  /** Closes the named panel if it is the open one (the drawer's own close button). */
  hide(name: string): void;
  dispose(): void;
}

export function attachHudPanels(options: HudPanelsOptions): HudPanels {
  const entries = Object.entries(options.panels);
  if (entries.length === 0) throw new Error("attachHudPanels: no panels");
  const byName = new Map(entries);
  let current: string | undefined;

  const spec = (name: string): HudPanelSpec => {
    const found = byName.get(name);
    if (!found) throw new Error(`attachHudPanels: unknown panel "${name}"`);
    return found;
  };

  const paint = (name: string, open: boolean) => {
    const { element, opener } = spec(name);
    element.hidden = !open;
    opener.setAttribute("aria-expanded", String(open));
  };

  const hide = (name: string) => {
    spec(name);
    if (current !== name) return;
    const { element, opener } = spec(name);
    const active = document.activeElement;
    const hadFocus =
      active === null || active === document.body || element.contains(active);
    paint(name, false);
    current = undefined;
    if (hadFocus) opener.focus();
    options.onChange?.(undefined);
  };

  const show = (name: string) => {
    spec(name);
    if (current === name) return;
    if (current !== undefined) paint(current, false);
    paint(name, true);
    current = name;
    spec(name).element.focus({ preventScroll: true });
    options.onChange?.(name);
  };

  const toggle = (name: string) => (current === name ? hide(name) : show(name));

  const clicks = entries.map(([name, { opener }]) => {
    const onClick = () => toggle(name);
    opener.setAttribute("aria-controls", spec(name).element.id);
    opener.addEventListener("click", onClick);
    return () => opener.removeEventListener("click", onClick);
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (current === undefined) return;
    event.preventDefault();
    hide(current);
  };
  window.addEventListener("keydown", onKey);

  for (const [name, { element }] of entries) {
    paint(name, false);
    element.tabIndex = -1;
  }

  return {
    hide,
    dispose() {
      window.removeEventListener("keydown", onKey);
      for (const off of clicks) off();
    },
  };
}

export interface BusyMarkOptions {
  /** The closed panel whose controls may be applying (the drawer). */
  readonly root: HTMLElement;
  /** The bar button that carries `data-busy` while any of them is. */
  readonly mark: HTMLElement;
}

/**
 * Keeps a bar button's `data-busy` in step with the drawer's own busy cues,
 * so an async state stays visible while the drawer is closed.
 *
 * It reads the cues the controls already show rather than a second busy
 * channel: a switch label marked `.layer-busy` (`layer-toggles.ts`), or a
 * `role="status"` line with text in it (the build-choice switches write
 * "Applying..." there and clear it when the rebuild lands).
 */
export function attachBusyMark(options: BusyMarkOptions): () => void {
  const { root, mark } = options;
  const paint = () => {
    const busy =
      root.querySelector(".layer-busy") !== null ||
      [...root.querySelectorAll('[role="status"]')].some(
        (line) => (line.textContent ?? "").trim() !== "",
      );
    mark.dataset["busy"] = String(busy);
  };
  const observer = new MutationObserver(paint);
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  paint();
  return () => observer.disconnect();
}
