/**
 * The 3D view's credits: one "Credits" button at the bottom left of the
 * view, which opens an overlay listing every source in full with its link,
 * and a note under the list (the globe view's: GIBS's acknowledgement).
 * Esc and a pointer down outside close it; Esc gives focus back to the
 * button. Texts are set as text, never as markup.
 *
 * @see editor3d-credits.ts.md
 */

/** One credit: its short name, its full text and its link (the globe's
 *  credit shape). */
interface Credit {
  readonly short: string;
  readonly full: string;
  readonly href: string;
}

/** Whether the map's short credit ("© OpenStreetMap contributors") shows
 *  beside the button by default. Off: the owner chose the button alone;
 *  the option is kept so turning it on is one word. */
const OSM_BESIDE_BUTTON = false;

/** The short name of the map's credit (`globe-osm-overlay.ts`). */
const OSM_SHORT = "OpenStreetMap";

let panels = 0;

function link(credit: Credit, className?: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = credit.href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = credit.full;
  if (className !== undefined) a.className = className;
  return a;
}

/**
 * Mount the button and its overlay in `box` (emptied first). `note` is a
 * paragraph under the list; `osmBeside` shows the map's credit beside the
 * button (default `OSM_BESIDE_BUTTON`). Returns the unmount: the box
 * emptied and the document's listener removed.
 */
export function mountCredits(
  box: HTMLElement,
  credits: readonly Credit[],
  options: { readonly note?: string; readonly osmBeside?: boolean } = {},
): () => void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "view3d-credits-button";
  button.textContent = "Credits";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-haspopup", "dialog");

  const panel = document.createElement("div");
  panel.className = "view3d-credits-panel";
  panel.id = `view3d-credits-panel-${++panels}`;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Credits");
  panel.hidden = true;
  button.setAttribute("aria-controls", panel.id);

  const list = document.createElement("ul");
  for (const credit of credits) {
    const item = document.createElement("li");
    item.append(link(credit));
    list.append(item);
  }
  panel.append(list);
  if (options.note !== undefined && options.note !== "") {
    const note = document.createElement("p");
    note.className = "view3d-credits-note";
    note.textContent = options.note;
    panel.append(note);
  }

  const parts: HTMLElement[] = [button];
  const osm = credits.find((c) => c.short === OSM_SHORT);
  if ((options.osmBeside ?? OSM_BESIDE_BUTTON) && osm !== undefined) {
    parts.push(link(osm, "view3d-credits-beside"));
  }
  parts.push(panel);
  box.replaceChildren(...parts);

  const onOutside = (event: Event) => {
    if (event.target instanceof Node && box.contains(event.target)) return;
    close(false);
  };
  const close = (refocus: boolean) => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (refocus) button.focus();
  };
  const open = () => {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
  };
  const onClick = () => {
    if (panel.hidden) open();
    else close(true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  button.addEventListener("click", onClick);
  box.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("pointerdown", onOutside, true);
    box.removeEventListener("keydown", onKey);
    button.removeEventListener("click", onClick);
    box.replaceChildren();
  };
}
