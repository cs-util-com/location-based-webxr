/**
 * The docked layout a creator arranged, kept in the browser per form
 * factor (a desk, a phone held sideways, one upright) and read back with
 * a check: a kept layout that is not readable, comes from another
 * version, or names a panel set other than today's is refused, so the
 * default layout loads in its place and never an empty one. Pure: no DOM
 * and no docking library here; `dock-host.ts` stores and applies it.
 *
 * @see dock-save.ts.md
 */
import type { SerializedDockview } from "dockview";

import { DOCK_PANELS, isDockPanelId, type DockPanelId } from "./dock-layout.js";

/** The storage key's stem; one key per form factor follows it. */
export const DOCK_SAVE_KEY = "editor-dock-layout";

/** The kept layout's format; another one is refused. */
const VERSION = 1;

/** The three shapes of window a layout is kept for. */
export type DockFormFactor = "desk" | "sideways" | "upright";

/** A window's form factor: a phone's at most 700 px wide or 500 px tall
 *  (sideways when wider than tall), a desk otherwise. */
export function dockFormFactor(
  widthPx: number,
  heightPx: number,
): DockFormFactor {
  if (!(widthPx <= 700 || heightPx <= 500)) return "desk";
  return widthPx > heightPx ? "sideways" : "upright";
}

/** The storage key of a form factor's kept layout. */
export function dockSaveKey(formFactor: DockFormFactor): string {
  return `${DOCK_SAVE_KEY}:${formFactor}`;
}

/** A group folded to its rail, by a panel it holds, and the size along
 *  its fold axis it unfolds to. */
export interface SavedFold {
  readonly panel: DockPanelId;
  readonly prevPx: number;
}

/** A kept layout: the docking library's own description and the folds. */
export interface SavedDock {
  readonly layout: SerializedDockview;
  readonly folds: readonly SavedFold[];
}

/** The text a layout is kept as. */
export function writeSavedDock(
  layout: SerializedDockview,
  folds: readonly SavedFold[],
): string {
  return JSON.stringify({ v: VERSION, layout, folds });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Each group's panel ids under a grid node, or null for a node of
 *  another shape. */
function groupsUnder(node: unknown): string[][] | null {
  if (!isRecord(node)) return null;
  if (node["type"] === "leaf") {
    const views = viewsOf(node["data"]);
    return views === null ? null : [views];
  }
  if (node["type"] !== "branch" || !Array.isArray(node["data"])) return null;
  const out: string[][] = [];
  for (const child of node["data"] as unknown[]) {
    const under = groupsUnder(child);
    if (under === null) return null;
    out.push(...under);
  }
  return out;
}

/** A group's panel ids; null when it holds none or names them oddly. */
function viewsOf(data: unknown): string[] | null {
  if (!isRecord(data) || !Array.isArray(data["views"])) return null;
  const views = data["views"] as unknown[];
  if (views.length === 0) return null;
  return views.every((v) => typeof v === "string") ? views : null;
}

/** The layout's groups when it holds today's panels, each in one group,
 *  the 3D view alone in a docked one; null otherwise. */
function checkedLayout(layout: unknown): SerializedDockview | null {
  if (!isRecord(layout) || !isRecord(layout["grid"])) return null;
  if (!isRecord(layout["panels"])) return null;
  const docked = groupsUnder(layout["grid"]["root"]);
  if (docked === null) return null;
  const floating = layout["floatingGroups"] ?? [];
  if (!Array.isArray(floating)) return null;
  const floated: string[][] = [];
  for (const group of floating as unknown[]) {
    const views = isRecord(group) ? viewsOf(group["data"]) : null;
    if (views === null) return null;
    floated.push(views);
  }
  // Popout windows are never made here.
  const popouts = layout["popoutGroups"];
  if (Array.isArray(popouts) && popouts.length > 0) return null;
  const ids = DOCK_PANELS.map((p) => p.id);
  const named = Object.keys(layout["panels"]);
  const placed = [...docked, ...floated].flat();
  const sameSet = (list: readonly string[]) =>
    list.length === ids.length &&
    ids.every((id) => list.filter((at) => at === id).length === 1);
  if (!sameSet(named) || !sameSet(placed)) return null;
  if (!docked.some((g) => g.length === 1 && g[0] === "view")) return null;
  return layout as unknown as SerializedDockview;
}

/** A kept fold when it names a foldable panel and a usable size. */
function checkedFold(fold: unknown): SavedFold | null {
  if (!isRecord(fold)) return null;
  const { panel, prevPx } = fold;
  if (!isDockPanelId(panel) || panel === "view") return null;
  if (typeof prevPx !== "number" || !Number.isFinite(prevPx) || prevPx <= 0) {
    return null;
  }
  return { panel, prevPx };
}

/** A kept layout read back, or null when there is none or it is refused:
 *  not JSON, another version, or not today's panel set (a panel missing,
 *  unknown, twice, in an empty group, beside the 3D view or in a popout).
 *  A fold that names no foldable panel is left out. */
export function readSavedDock(raw: string | null): SavedDock | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["v"] !== VERSION) return null;
  const layout = checkedLayout(parsed["layout"]);
  if (layout === null) return null;
  const folds = Array.isArray(parsed["folds"])
    ? (parsed["folds"] as unknown[]).flatMap((f) => {
        const fold = checkedFold(f);
        return fold === null ? [] : [fold];
      })
    : [];
  return { layout, folds };
}
