/**
 * The 3D view's docks on a narrow window, pure. The tree (left, 272 px)
 * and the inspector (right, 290 px) lie over the scene; from
 * `DOCKS_SIDE_BY_SIDE_PX` up they sit side by side. Below it - a tablet
 * in portrait, a 768 px window - two open docks would leave a strip of
 * about 200-260 px of scene, under `SCENE_FLOOR_PX`, so one is open at
 * a time: opening the inspector (a selection, or unfolding it) folds the
 * tree to its header, and unfolding the tree folds the inspector. Below
 * `TREE_STARTS_FOLDED_PX` (a phone) the tree also starts folded.
 *
 * @see dock-rule.ts.md
 */

/** The tree dock's width (px), as `editor-shell.css` draws it. */
export const TREE_DOCK_PX = 272;
/** The inspector dock's width (px), as `editor-shell.css` draws it. */
export const INSPECTOR_DOCK_PX = 290;
/**
 * The narrowest strip of scene (px) left between two open docks. Not a
 * measurement: a strip of about a third of a landscape phone, which still
 * shows a station and its surroundings. The strip is 206 px at 768, 258 at
 * 820, 338 at 900 and 462 at 1024; the floor keeps 900 px as the first
 * width with both docks open.
 */
export const SCENE_FLOOR_PX = 338;

/** From this window width (px) up, both docks may be open at once: the
 *  two docks and the scene's floor between them. */
export const DOCKS_SIDE_BY_SIDE_PX =
  TREE_DOCK_PX + INSPECTOR_DOCK_PX + SCENE_FLOOR_PX;

/** Below this window width (px) the tree starts folded. */
export const TREE_STARTS_FOLDED_PX = 700;

/** What just happened to the docks or the window. */
export type DockChange =
  "opened" | "selected" | "resized" | "tree-unfolded" | "inspector-unfolded";

export interface DockFolds {
  readonly tree: boolean;
  readonly inspector: boolean;
}

/**
 * The docks' folds after `change`, on a window `widthPx` wide, while the
 * docks are `folded` and the inspector shows (something is selected) or
 * not. Above the breakpoint nothing is folded by the rule.
 */
export function docksAfter(
  change: DockChange,
  state: {
    readonly widthPx: number;
    readonly folded: DockFolds;
    readonly inspectorShows: boolean;
  },
): DockFolds {
  const { widthPx, folded, inspectorShows } = state;
  let { tree, inspector } = folded;
  if (change === "opened" && widthPx < TREE_STARTS_FOLDED_PX) tree = true;
  if (!(widthPx < DOCKS_SIDE_BY_SIDE_PX) || !inspectorShows) {
    return { tree, inspector };
  }
  if (change === "tree-unfolded") {
    if (!tree) inspector = true;
  } else if (!inspector) {
    tree = true;
  }
  return { tree, inspector };
}
