/**
 * The editor's docked layout as data: which panels there are, which page
 * element each one adopts, where each starts and how wide. No DOM and no
 * docking library here: `dock-host.ts` applies it.
 *
 * @see dock-layout.ts.md
 */

/** From this window width up (CSS px) the editor's panels dock around the
 *  3D view, a phone held sideways (844 px) included; below it a phone's
 *  sheets show them (`phone-sheet.ts`, `PHONE_SHEET_PX` is one less). */
export const DOCK_MIN_PX = 701;

/** Whether the panels dock at this window width. */
export function docksAt(widthPx: number): boolean {
  return Number.isFinite(widthPx) && widthPx >= DOCK_MIN_PX;
}

/** The bottom panel's four tabs, one docked panel each. */
export const BOTTOM_PANEL_IDS = [
  "problems",
  "history",
  "tiles",
  "perf",
] as const;
export type BottomPanelId = (typeof BOTTOM_PANEL_IDS)[number];

/** Whether `id` is one of the bottom panel's tabs. */
export function isBottomPanelId(id: unknown): id is BottomPanelId {
  return (BOTTOM_PANEL_IDS as readonly unknown[]).includes(id);
}

export type DockPanelId = "view" | "list" | "details" | "files" | BottomPanelId;

/** The four places a panel starts in. */
type DockGroup = "centre" | "left" | "right" | "bottom";

export interface DockPanelSpec {
  readonly id: DockPanelId;
  /** Its tab's words. */
  readonly title: string;
  /** The page element it adopts, by id (`edit.html`, or the bottom
   *  panel's pane, `bottom-panel.ts`); none for the 3D view, whose
   *  canvas the host moves in. */
  readonly element: string | null;
  readonly group: DockGroup;
}

/** Every docked panel, the 3D view first. */
export const DOCK_PANELS: readonly DockPanelSpec[] = [
  { id: "view", title: "3D view", element: null, group: "centre" },
  { id: "list", title: "List", element: "shell-tree", group: "left" },
  {
    id: "details",
    title: "Details",
    element: "shell-inspector",
    group: "right",
  },
  { id: "files", title: "Files", element: "shell-shelf", group: "right" },
  {
    id: "problems",
    title: "Problems",
    element: "shell-pane-problems",
    group: "bottom",
  },
  {
    id: "history",
    title: "History",
    element: "shell-pane-history",
    group: "bottom",
  },
  {
    id: "tiles",
    title: "Map loading",
    element: "shell-pane-tiles",
    group: "bottom",
  },
  {
    id: "perf",
    title: "Performance",
    element: "shell-pane-perf",
    group: "bottom",
  },
];

/** A panel's spec by id. */
export function dockPanel(id: DockPanelId): DockPanelSpec {
  const found = DOCK_PANELS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`No docked panel "${id}"`);
  return found;
}

/** Whether `id` names a docked panel (for ids read from elsewhere). */
export function isDockPanelId(id: unknown): id is DockPanelId {
  return DOCK_PANELS.some((p) => p.id === id);
}

/** The panels that carry their own head: the 3D view (none needed) and
 *  the list (its title, search and fold). */
const OWN_HEAD: readonly string[] = ["view", "list"];

/** Whether a group holding `panelIds` hides its tab strip: only over one
 *  panel that carries its own head, so nothing is named twice; a group
 *  with a tab to choose, or with nothing known in it, keeps its strip. */
export function stripHidden(panelIds: readonly string[]): boolean {
  return panelIds.length === 1 && OWN_HEAD.includes(panelIds[0] ?? "");
}

/** One panel added to the layout: beside, below or inside a panel added
 *  before it, at a size along that direction's axis. */
export interface DockStep {
  readonly id: DockPanelId;
  /** The panel it is placed against, and how; none for the first. */
  readonly against?: {
    readonly id: DockPanelId;
    readonly direction: "left" | "right" | "below" | "within";
  };
  readonly widthPx?: number;
  readonly heightPx?: number;
  /** Added as a tab that is not the shown one. */
  readonly inactive?: boolean;
}

/** The list's and the right column's widths, by window width: narrower
 *  windows give the 3D view more (the chosen arrangement's 248 and 300,
 *  210 for the list from 1100 px down, 268 for the column from 900 px
 *  down, so a phone held sideways keeps a usable view). */
export function dockWidths(widthPx: number): {
  readonly list: number;
  readonly column: number;
} {
  return {
    list: widthPx <= 1100 ? 210 : 248,
    column: widthPx <= 900 ? 268 : 300,
  };
}

/** The details' width while they hold the long text's writer, as the
 *  writer's styles give it undocked (`long-text-editor.css`): 360 px,
 *  340 px from 1100 px down; "Wider", up to 540 px and at most 52 % of
 *  the window. */
export function writerWidthPx(widthPx: number, wide: boolean): number {
  if (wide) return Math.min(540, Math.floor(widthPx * 0.52));
  return widthPx <= 1100 ? 340 : 360;
}

/** The bottom group's height when first shown: 220 px, at most about a
 *  third of the space below the top bar so the 3D view keeps most of it
 *  (a phone held sideways, 326 px between the bars, gets 108). */
export function bottomStartPx(heightPx: number): number {
  const third = Math.floor(Math.max(0, heightPx) / 3);
  return Math.max(90, Math.min(220, third));
}

/**
 * The default layout for a window: the list at the left, the 3D view in
 * the middle, one right group with Details and Files as tabs (Details
 * shown), and the bottom panel's four tabs below the 3D view (Problems
 * shown; the host keeps that group hidden until it is asked for).
 */
export function defaultDockLayout(
  widthPx: number,
  heightPx: number,
): readonly DockStep[] {
  const w = dockWidths(widthPx);
  const bottom = bottomStartPx(heightPx);
  return [
    { id: "view" },
    { id: "list", against: { id: "view", direction: "left" }, widthPx: w.list },
    {
      id: "details",
      against: { id: "view", direction: "right" },
      widthPx: w.column,
    },
    {
      id: "files",
      against: { id: "details", direction: "within" },
      inactive: true,
    },
    {
      id: "problems",
      against: { id: "view", direction: "below" },
      heightPx: bottom,
    },
    ...BOTTOM_PANEL_IDS.slice(1).map((id): DockStep => ({
      id,
      against: { id: "problems", direction: "within" },
      inactive: true,
    })),
  ];
}
