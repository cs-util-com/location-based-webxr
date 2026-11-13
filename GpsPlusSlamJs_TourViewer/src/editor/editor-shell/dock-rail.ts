/**
 * A docked group folded to a rail, as data: which groups fold, which way,
 * how wide the rail is for the input in use, and the size each folded
 * group gets back when it unfolds. No DOM and no docking library here:
 * `dock-host.ts` applies it.
 *
 * @see dock-rail.ts.md
 */

/** Along which size a group folds: a side column its width, a group
 *  above or below the 3D view its height. */
export type RailAxis = "width" | "height";

/** The rail's thickness (px): its buttons' size for a mouse and for a
 *  finger. */
export const RAIL_PX = { mouse: 34, touch: 44 } as const;

/** The least size a group unfolds to (px), so one folded while small
 *  comes back usable. */
export const UNFOLD_MIN_PX = { width: 200, height: 120 } as const;

/** From this share of the layout's height up a group is a column and
 *  folds its width. */
const TALL_SHARE = 0.55;

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Box extends Size {
  readonly x: number;
  readonly y: number;
}

/** A folded group: the axis it folded along, its size there before. */
interface Fold {
  readonly axis: RailAxis;
  readonly prevPx: number;
}

/** Every folded group, by the docking's group id. */
export type Folds = ReadonlyMap<string, Fold>;

/** The rail's thickness for a coarse pointer (touch) or a fine one. */
export function railPx(coarse: boolean): number {
  return coarse ? RAIL_PX.touch : RAIL_PX.mouse;
}

/** The axis `group` folds along inside a layout of `layout`: its height
 *  when it is as wide as the layout (no side to fold to: a phone's group
 *  held upright), else its width when it is at least 55 % of the layout's
 *  height, else its height. A height that is not a positive number folds
 *  the width. */
export function foldAxis(group: Size, layout: Size): RailAxis {
  if (
    !(group.height > 0) ||
    !(layout.height > 0) ||
    !Number.isFinite(group.height) ||
    !Number.isFinite(layout.height)
  ) {
    return "width";
  }
  if (layout.width > 0 && group.width >= layout.width) return "height";
  return group.height >= layout.height * TALL_SHARE ? "width" : "height";
}

/** Whether a group holding `panelIds`, at a docking `location` ("grid",
 *  "floating", "edge"), folds: only a docked one, never the 3D view's. */
export function canFold(
  panelIds: readonly string[],
  location: string,
): boolean {
  return (
    location === "grid" && panelIds.length > 0 && !panelIds.includes("view")
  );
}

/** `folds` with group `id` folded at its size now: unchanged when it is
 *  folded already (its rail is not a size to give back) or its size is
 *  not known. */
export function foldedAt(
  folds: Folds,
  id: string,
  group: Size,
  layout: Size,
): Folds {
  if (folds.has(id)) return folds;
  const axis = foldAxis(group, layout);
  const prevPx = axis === "width" ? group.width : group.height;
  if (!Number.isFinite(prevPx) || prevPx < 0) return folds;
  return new Map(folds).set(id, { axis, prevPx });
}

/** `folds` with group `id` unfolded, and the size it comes back at (at
 *  least `UNFOLD_MIN_PX`); null for a group that was not folded. */
export function unfoldedAt(
  folds: Folds,
  id: string,
): {
  readonly folds: Folds;
  readonly restore: { readonly axis: RailAxis; readonly px: number } | null;
} {
  const fold = folds.get(id);
  if (fold === undefined) return { folds, restore: null };
  const next = new Map(folds);
  next.delete(id);
  return {
    folds: next,
    restore: {
      axis: fold.axis,
      px: Math.max(UNFOLD_MIN_PX[fold.axis], fold.prevPx),
    },
  };
}

/** `folds` kept to the groups in `live` (a group dragged empty is gone). */
export function prunedTo(folds: Folds, live: Iterable<string>): Folds {
  const keep = new Set(live);
  if ([...folds.keys()].every((id) => keep.has(id))) return folds;
  return new Map([...folds].filter(([id]) => keep.has(id)));
}

/** Where `group` lies against the 3D view's `view`: the way it folds (its
 *  fold button points there). */
export function railSide(
  group: Box,
  view: Box,
): "left" | "right" | "up" | "down" {
  if (group.x + group.width <= view.x + 1) return "left";
  if (group.x >= view.x + view.width - 1) return "right";
  if (group.y + group.height <= view.y + 1) return "up";
  return "down";
}

/** The button that moves a group whose `location` is the docking's
 *  ("grid", "floating", ...): on a phone (`shape`, null at a desk) a
 *  docked group floats and a floating one docks; none at a desk, nor on
 *  a group that is `fixed` (the 3D view's, or one folded to its rail). */
export function moveOf(
  shape: "upright" | "sideways" | null,
  location: string,
  fixed: boolean,
): "float" | "dock" | null {
  if (shape === null || fixed) return null;
  if (location === "grid") return "float";
  if (location === "floating") return "dock";
  return null;
}
