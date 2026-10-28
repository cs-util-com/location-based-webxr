/**
 * The 3D view's ground menu: a right click (a long press on a touch
 * screen) on the scene opens it where the pointer was, with one command,
 * "New station here". It starts a station only at a spot whose ground has
 * loaded; elsewhere (the sky, ground still loading) the item stays,
 * disabled, and says why in a line of its own. A wheel over the view (a
 * zoom) closes it: the ground it offers is no longer under the spot.
 *
 * A menu by the WAI-ARIA pattern, as the bar's (`menu-button.ts`): the
 * focus goes to its item on opening; Escape closes it with the focus back
 * on the view (and goes no further), Tab closes it and lets the focus move
 * on, a press outside closes it. Its keys are its own: the page's key
 * rules leave a `[role="menu"]` alone (`key-target.ts`).
 *
 * @see scene-menu.ts.md
 */
import { setItemDisabled, isItemDisabled } from "../menu-button.js";

/** A spot on the ground (degrees; its ellipsoidal height). */
export interface GroundPlace {
  readonly lat: number;
  readonly lon: number;
  readonly alt: number;
}

export interface SceneMenu {
  /** Open at `point` (px from the view's top left), offering a station at
   *  `place`; null: no ground has loaded there. */
  openAt(point: { x: number; y: number }, place: GroundPlace | null): void;
  close(): void;
  isOpen(): boolean;
}

/** The menu's least distance from the view's edges (px). */
const EDGE_PX = 8;

/** Said by the item where no station can start. */
const NO_GROUND = "There is no ground loaded under that spot yet";

export function createSceneMenu(deps: {
  /** The view's box, the menu's positioned parent. */
  readonly box: HTMLElement;
  readonly menu: HTMLElement;
  readonly item: HTMLElement;
  /** Where the focus goes back when the menu closes by a key or a choice. */
  readonly returnFocus: HTMLElement;
  readonly newStation: (place: GroundPlace) => void;
}): SceneMenu {
  const { box, menu, item } = deps;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "The ground here");
  item.setAttribute("role", "menuitem");
  item.setAttribute("tabindex", "-1");
  menu.hidden = true;
  // The reason a disabled item gives, in its own line: part of its name,
  // and seen on a touch screen, where a title never shows.
  const why = document.createElement("span");
  why.className = "why";
  why.textContent = NO_GROUND;
  why.hidden = true;
  item.append(why);
  let place: GroundPlace | null = null;

  const isOpen = (): boolean => !menu.hidden;

  const onWheel = (): void => {
    close(false);
  };

  const onOutside = (event: Event): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    close(false);
  };

  function close(returnFocus: boolean): void {
    if (!isOpen()) return;
    menu.hidden = true;
    place = null;
    document.removeEventListener("pointerdown", onOutside, true);
    box.removeEventListener("wheel", onWheel, true);
    if (returnFocus) deps.returnFocus.focus();
  }

  item.addEventListener("click", () => {
    if (place === null || isItemDisabled(item)) return;
    const at = place;
    close(true);
    deps.newStation(at);
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  });

  return {
    openAt(point, at) {
      place = at;
      setItemDisabled(item, at === null);
      why.hidden = at !== null;
      menu.hidden = false;
      const view = box.getBoundingClientRect();
      const size = menu.getBoundingClientRect();
      const left = Math.max(
        EDGE_PX,
        Math.min(point.x, view.width - size.width - EDGE_PX),
      );
      const top = Math.max(
        EDGE_PX,
        Math.min(point.y, view.height - size.height - EDGE_PX),
      );
      menu.style.left = `${String(left)}px`;
      menu.style.top = `${String(top)}px`;
      document.addEventListener("pointerdown", onOutside, true);
      box.addEventListener("wheel", onWheel, { capture: true, passive: true });
      item.focus();
    },
    close() {
      close(false);
    },
    isOpen,
  };
}
