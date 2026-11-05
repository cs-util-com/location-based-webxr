/**
 * The 3D view's credits: one button at the bottom bar's left (the page
 * places the box) that names the map's source ("Map data © OpenStreetMap
 * contributors", "© OSM" on a narrow window; "Credits" where the map has
 * none), a disclosure that shows a panel listing every source in full
 * with its link, and a note under the list (the globe view's: GIBS's
 * acknowledgement). Esc anywhere while it is open (heard on the document)
 * and a pointer down outside close it; Esc gives focus back to the button
 * when focus was in the box or on the page itself.
 * Texts are set as text, never as markup.
 *
 * @see editor3d-credits.ts.md
 */

import type { EditorCredit as Credit } from "./editor3d-terrain.js";

/** Whether the map's credit also shows beside the button as a link by
 *  default. Off: the button itself names it; the option is kept so
 *  turning it on is one word. */
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
  const osm = credits.find((c) => c.short === OSM_SHORT);
  if (osm === undefined) {
    button.textContent = "Credits";
  } else {
    // The map's own credit is the button's words; a click still opens
    // every source in full.
    const long = document.createElement("span");
    long.className = "long";
    long.textContent = `Map data ${osm.full}`;
    const short = document.createElement("span");
    short.className = "short";
    short.textContent = "© OSM";
    button.append(long, short);
    button.setAttribute("aria-label", `Credits: Map data ${osm.full}`);
    button.title = "All credits";
  }
  button.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "view3d-credits-panel";
  panel.id = `view3d-credits-panel-${++panels}`;
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
  if ((options.osmBeside ?? OSM_BESIDE_BUTTON) && osm !== undefined) {
    parts.push(link(osm, "view3d-credits-beside"));
  }
  parts.push(panel);
  box.replaceChildren(...parts);

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    // Focus goes back to the button only from the box or the page itself;
    // focus that has moved on elsewhere stays there.
    const at = document.activeElement;
    close(at === null || at === document.body || box.contains(at));
  };
  const onOutside = (event: Event) => {
    if (event.target instanceof Node && box.contains(event.target)) return;
    close(false);
  };
  const close = (refocus: boolean) => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    if (refocus) button.focus();
  };
  const open = () => {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    // Heard on the document (capture) while open, so Esc closes the panel
    // wherever focus is, and nothing else hears that Esc.
    document.addEventListener("keydown", onKey, true);
  };
  const onClick = () => {
    if (panel.hidden) open();
    else close(true);
  };
  button.addEventListener("click", onClick);

  return () => {
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    button.removeEventListener("click", onClick);
    box.replaceChildren();
  };
}
