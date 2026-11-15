/**
 * "Move to...": the keyboard's way to move a docked panel, where a mouse
 * drags its tab. `moveTargets` lists where a panel can go (into another
 * group as a tab, or into a group of its own beside or below the 3D
 * view); `showMoveMenu` offers them as a menu read and worked from the
 * keyboard. `dock-host.ts` opens it from a tab and carries out the move.
 *
 * @see dock-move.ts.md
 */
import type { DockPanelId } from "./dock-layout.js";

/** A group a panel can be moved into: its id and its panels' ids. */
export interface MoveGroup {
  readonly id: string;
  readonly panels: readonly DockPanelId[];
}

/** Where a move puts the panel: in `group` as a tab ("center"), or in a
 *  new group at that side of it. */
export interface MoveTarget {
  readonly label: string;
  readonly group: string;
  readonly position: "center" | "left" | "right" | "bottom";
}

/** The sides of the 3D view a panel can take a group of its own at. */
const SIDES = [
  ["left", "Left of the 3D view"],
  ["right", "Right of the 3D view"],
  ["bottom", "Below the 3D view"],
] as const;

/**
 * Where `panel` can move: into each other group shown (`groups`, in the
 * layout's order) as a tab, then beside or below the 3D view (its group
 * `viewGroup`, which takes no other tab). Nothing for the 3D view itself,
 * which never moves.
 */
export function moveTargets(
  panel: DockPanelId,
  groups: readonly MoveGroup[],
  viewGroup: string,
  titleOf: (id: DockPanelId) => string,
): readonly MoveTarget[] {
  if (panel === "view") return [];
  if (!groups.some((g) => g.id === viewGroup)) return [];
  const into = groups.flatMap((g): MoveTarget[] => {
    if (g.id === viewGroup || g.panels.includes(panel)) return [];
    if (g.panels.length === 0) return [];
    return [
      {
        label: `Into ${g.panels.map(titleOf).join(", ")}`,
        group: g.id,
        position: "center",
      },
    ];
  });
  const beside = SIDES.map(([position, label]): MoveTarget => ({
    label,
    group: viewGroup,
    position,
  }));
  return [...into, ...beside];
}

export interface MoveMenuOptions {
  /** The tab the menu belongs to: it stands below it, and the focus goes
   *  back to it when the menu closes without a move. */
  readonly anchor: HTMLElement;
  /** The moved panel's title, for the menu's name. */
  readonly title: string;
  readonly targets: readonly MoveTarget[];
  readonly onPick: (target: MoveTarget) => void;
}

/**
 * Shows the "Move to..." menu below `anchor`, its first entry focused:
 * Up and Down (and Home, End) walk it, Enter or Space picks, Escape or
 * Tab or a press elsewhere closes it. Returns its close; one menu at a
 * time, a second call closes the first.
 */
export function showMoveMenu(options: MoveMenuOptions): () => void {
  closeOpen?.();
  const { anchor, targets } = options;
  const menu = document.createElement("div");
  menu.className = "dock-move";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Move ${options.title} to`);
  const items = targets.map((target) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dock-move-item";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.textContent = target.label;
    item.addEventListener("click", () => {
      close(false);
      options.onPick(target);
    });
    return item;
  });
  menu.append(...items);

  let open = true;
  const close = (focusBack: boolean) => {
    if (!open) return;
    open = false;
    if (closeOpen === closer) closeOpen = null;
    document.removeEventListener("pointerdown", onOutside, true);
    menu.remove();
    if (focusBack && anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  const closer = () => {
    close(false);
  };
  const onOutside = (event: PointerEvent) => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    close(false);
  };
  menu.addEventListener("keydown", (event) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (index: number) => {
      const count = items.length;
      items[((index % count) + count) % count]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(items.length - 1);
        break;
      case "Escape":
        close(true);
        break;
      case "Tab":
        close(true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  document.body.append(menu);
  const at = anchor.getBoundingClientRect();
  const room = menu.getBoundingClientRect();
  const left = Math.max(0, Math.min(at.left, window.innerWidth - room.width));
  const below = at.bottom + room.height <= window.innerHeight;
  const top = below ? at.bottom : Math.max(0, at.top - room.height);
  menu.style.left = `${String(Math.round(left))}px`;
  menu.style.top = `${String(Math.round(top))}px`;
  document.addEventListener("pointerdown", onOutside, true);
  closeOpen = closer;
  items[0]?.focus({ preventScroll: true });
  return closer;
}

/** The menu shown now, closed by the next. */
let closeOpen: (() => void) | null = null;
