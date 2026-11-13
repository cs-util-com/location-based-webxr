/**
 * The editor's panels docked around the 3D view: the page's own elements
 * (the list, the details, the asset shelf, the bottom panel's four panes)
 * adopted as panels of a docking layout, the 3D view's canvas in its
 * centre. The layout's state is the docking library's alone; this module
 * is the one place that shows a panel, hides a group or folds one.
 *
 * Loaded by a dynamic `import()` with the 3D view (`editor-shell.ts`), so
 * the docking library and its stylesheet stay out of the page's first
 * load.
 *
 * @see dock-host.ts.md
 */
import "dockview/dist/styles/dockview.css";

import {
  createDockview,
  type DockviewApi,
  type DockviewGroupPanel,
  type IDockviewPanel,
  type ITabRenderer,
} from "dockview";
import { shellIcon } from "gps-plus-slam-editor-kit/chrome";

import {
  bottomStartPx,
  defaultDockLayout,
  DOCK_PANELS,
  dockPanel,
  dockWidths,
  isDockPanelId,
  keyboardMaximizes,
  stripHidden,
  type DockPanelId,
  type DockStep,
  writerWidthPx,
} from "./dock-layout.js";
import {
  canFold,
  foldAxis,
  foldedAt,
  prunedTo,
  railPx,
  railSide,
  unfoldedAt,
  type Folds,
} from "./dock-rail.js";

/** The parts of the view box that move with the 3D view into its panel:
 *  the canvas, the model's notes over it, the map controls. */
const VIEW_PARTS = [".view3d-canvas", ".model-notes", "#map-controls"];

/** What takes the focus in a moved element when the one that held it
 *  cannot any more. */
const FOCUSABLE =
  "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

/** A side group's and the bottom group's least size once released
 *  (px). */
const MIN_WIDTH_PX = 140;
const MIN_HEIGHT_PX = 90;

/** The two side panels whose groups take the window's widths. */
type SidePanel = "list" | "details";
const SIDES: readonly SidePanel[] = ["list", "details"];

/** A tab's count of what needs a look in its panel (the Files panel's
 *  files in the works or not optimized), and what it counts in words. */
export interface DockBadge {
  readonly count: number;
  /** Something failed: drawn as a warning. */
  readonly bad: boolean;
  readonly label: string;
}

/** The way a folded group's button points to unfold it. */
const AWAY = { left: "right", right: "left", up: "down", down: "up" } as const;

export interface DockHostDeps {
  /** The 3D view's box (`#view3d`): the layout fills it below the
   *  accent line. */
  readonly box: HTMLElement;
  /** A panel was shown, hidden or chosen by the docking's own controls
   *  (or by this host). */
  readonly onChange: () => void;
}

export interface DockHost {
  /** Shows `id`: its group made visible and unfolded, it the group's
   *  shown tab. The one way a folded group opens for the page. */
  reveal(id: DockPanelId): void;
  /** Takes the group that holds `id` out of sight: hidden when it holds
   *  only the bottom panel's panes (its toggles show it again), else
   *  folded to its rail. */
  hideGroupOf(id: DockPanelId): void;
  /** Takes `id` out of sight when it shows: `instead` made its group's
   *  shown tab when the group holds it, else the group's next panel; alone
   *  in its group, the group out of sight as by `hideGroupOf`. */
  conceal(id: DockPanelId, instead?: DockPanelId): void;
  /** Whether the group holding `id` shows, unfolded. */
  groupShown(id: DockPanelId): boolean;
  /** The shown tab of the group holding `id`. */
  activeIn(id: DockPanelId): DockPanelId | null;
  /** Folds the group holding `id` to a rail of its tabs' icons, or
   *  unfolds it at the size it had; the 3D view's group and a floating
   *  one never fold. */
  fold(id: DockPanelId, folded: boolean): void;
  /** Whether the group holding `id` is folded to its rail. */
  folded(id: DockPanelId): boolean;
  /** The count on `id`'s tab (and on its rail), or none. */
  badge(id: DockPanelId, badge: DockBadge | null): void;
  /** The element a panel's content sits in. */
  content(id: DockPanelId): HTMLElement;
  /** An on-screen keyboard of `px` (0: none) came, changed or went:
   *  the groups are laid out for the layout's box now, not on the next
   *  frame, and over a short window the group holding the field in use
   *  takes the whole layout until the keyboard goes. */
  keyboard(px: number): void;
  /** Puts every adopted element back where it was and removes the
   *  layout. */
  dispose(): void;
}

/** Where an adopted element came from, to put it back. */
interface Home {
  readonly node: Element;
  readonly parent: Node;
  readonly next: Node | null;
}

const THEME = {
  name: "tour",
  className: "dockview-theme-tour",
  colorScheme: "dark" as const,
};

/** Runs `then` after the layout of the next frame. */
function afterLayout(then: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(then);
  });
}

export function mountDockHost(deps: DockHostDeps): DockHost {
  const { box } = deps;
  const root = document.createElement("div");
  root.className = "dock-host";
  box.append(root);
  box.classList.add("docked");

  const homes: Home[] = [];
  const contents = new Map<DockPanelId, HTMLElement>();
  /** Every group folded to its rail, by the docking's group id. */
  let folds: Folds = new Map();
  /** Each tab's count, drawn on every tab of its panel. */
  const badges = new Map<DockPanelId, DockBadge>();
  /** Each group's fold button, kept for the group's life: the docking
   *  builds a group's header actions again when its tabs turn on their
   *  side, and the same element given back keeps the focus. */
  const folders = new Map<
    DockviewGroupPanel,
    { readonly element: HTMLElement; readonly update: () => void }
  >();
  /** Groups whose first size is still to be given when they first show
   *  (the bottom group starts hidden). */
  const unsized = new Map<DockPanelId, DockStep>();
  /** The group a keyboard maximized, and the layout to give back: each
   *  shown group's size and shown tab. */
  let maxed: {
    readonly group: DockviewGroupPanel;
    /** Each group's least height before: maximized, none has any, so the
     *  group fits the little room a keyboard leaves (the hidden groups'
     *  least heights still bound the layout's). */
    readonly minimumHeights: ReadonlyMap<DockviewGroupPanel, number>;
    readonly before: readonly {
      readonly group: DockviewGroupPanel;
      readonly width: number;
      readonly height: number;
      readonly active: IDockviewPanel | undefined;
    }[];
  } | null = null;
  let keyboardPx = 0;
  /** Side panels whose group was hidden while its width was to change
   *  (before its first layout, or over a window resize): it takes its
   *  width when it next shows. */
  const stale = new Set<SidePanel>();
  let disposed = false;

  const adopt = (node: Element, into: HTMLElement, first = false) => {
    if (node.parentElement === into) return;
    if (!homes.some((h) => h.node === node) && node.parentNode !== null) {
      homes.push({ node, parent: node.parentNode, next: node.nextSibling });
    }
    if (first) into.prepend(node);
    else into.append(node);
  };
  const sendHome = (node: Element) => {
    const home = homes.find((h) => h.node === node);
    if (home === undefined) return;
    const next =
      home.next !== null && home.next.parentNode === home.parent
        ? home.next
        : null;
    home.parent.insertBefore(node, next);
  };

  /** The focus inside `nodes`, to give back once they stand where they
   *  go: a moved element loses the focus to the page (and a phone its
   *  keyboard). Given back to the element that held it, or, when that one
   *  is out of sight now, to the first control in sight in its node. */
  const holdFocus = (nodes: readonly Element[]): (() => void) => {
    const at = document.activeElement;
    const node = nodes.find((n) => at !== null && n.contains(at));
    if (!(at instanceof HTMLElement) || node === undefined) {
      return () => undefined;
    }
    const give = () => {
      if (document.activeElement === at) return;
      if (at.isConnected) at.focus({ preventScroll: true });
      if (document.activeElement === at) return;
      const next = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
        (e) => e.checkVisibility({ visibilityProperty: true }),
      );
      next?.focus({ preventScroll: true });
    };
    const lost = () =>
      document.activeElement === null ||
      document.activeElement === document.body;
    // A group just shown stays hidden until the docking places it a frame
    // or two later, and takes no focus till then: tried again on the next
    // two frames, while the focus is still on the page.
    const later = (frames: number) => {
      requestAnimationFrame(() => {
        if (disposed || !lost()) return;
        give();
        if (lost() && frames > 1) later(frames - 1);
      });
    };
    return () => {
      give();
      if (lost()) later(2);
    };
  };

  for (const spec of DOCK_PANELS) {
    const content = document.createElement("div");
    content.className = `dock-pane dock-pane-${spec.id} dock-group-${spec.group}`;
    contents.set(spec.id, content);
  }
  const contentOf = (id: DockPanelId): HTMLElement => {
    const found = contents.get(id);
    if (found === undefined) throw new Error(`No docked panel "${id}"`);
    return found;
  };
  const view = contentOf("view");

  /** Where each scrolled element in a panel stood: a panel leaves the
   *  page while another tab of its group shows, which loses its scroll,
   *  given back when it shows again. */
  const offsets = new Map<Element, { top: number; left: number }>();
  const onScroll = (event: Event) => {
    const at = event.target;
    if (!(at instanceof Element) || !at.isConnected) return;
    offsets.set(at, { top: at.scrollTop, left: at.scrollLeft });
  };
  for (const content of contents.values()) {
    content.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
  }
  const scrollBack = (pane: HTMLElement) => {
    // An element no panel holds any more (a redraw replaced it) is let go.
    for (const at of [...offsets.keys()]) {
      if (![...contents.values()].some((c) => c.contains(at))) {
        offsets.delete(at);
      }
    }
    const put = () => {
      for (const [at, was] of offsets) {
        if (!pane.contains(at)) continue;
        at.scrollTop = was.top;
        at.scrollLeft = was.left;
      }
    };
    put();
    // Shown in a group the docking has yet to lay out: again a frame on.
    requestAnimationFrame(() => {
      if (!disposed) put();
    });
  };
  /** The 3D view's parts into its panel (the canvas first, under the
   *  rest); also those the view adds later (a new canvas). */
  const adoptViewParts = () => {
    for (const selector of VIEW_PARTS) {
      for (const node of box.querySelectorAll(`:scope > ${selector}`)) {
        adopt(node, view, selector === ".view3d-canvas");
      }
    }
  };
  const watcher = new MutationObserver(adoptViewParts);

  /** A tab: its panel's icon, its title (only its accessible name on a
   *  rail of upright tabs) and its count. A tap on a tab of a folded group
   *  unfolds it. */
  const makeTab = (): ITabRenderer => {
    const element = document.createElement("div");
    element.className = "dock-tab";
    return {
      element,
      init: (params) => {
        const id = params.api.id;
        const title = document.createElement("span");
        title.className = "dock-tab-title";
        title.textContent = params.title ?? id;
        if (!isDockPanelId(id)) {
          element.append(title);
          return;
        }
        element.dataset["panel"] = id;
        element.append(shellIcon(dockPanel(id).icon), title);
        drawBadge(element, badges.get(id) ?? null);
        element.addEventListener("click", () => {
          const group = params.api.group;
          if (folds.has(group.id)) foldGroup(group, false);
        });
      },
    };
  };
  const drawBadge = (tab: HTMLElement, badge: DockBadge | null) => {
    tab.querySelector(".dock-badge")?.remove();
    if (badge === null) return;
    const mark = document.createElement("span");
    mark.className = `dock-badge${badge.bad ? " bad" : ""}`;
    // Its words are the tab's name's: the number alone says nothing.
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", badge.label);
    mark.textContent = String(badge.count);
    tab.append(mark);
  };

  /** A group's fold button, in its tab strip: it points to the side the
   *  group folds to, and back once folded. Drawn again only when its
   *  look changes, so a press keeps the focus on it. */
  const makeFolder = (group: DockviewGroupPanel) => {
    const element = document.createElement("div");
    element.className = "dock-acts";
    element.hidden = true; // until first drawn
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dock-fold";
    element.append(button);
    // Not a press on the strip: no drag, no group made the active one.
    element.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", () => {
      foldGroup(group, !folds.has(group.id));
    });
    let drawn = "";
    const update = () => {
      if (disposed || !dock.groups.includes(group)) return;
      // The first groups are made before the 3D view is added: drawn once
      // it is there (the next layout change).
      const viewPanel = dock.getPanel("view");
      if (viewPanel === undefined) return;
      const ids = group.panels.map((p) => p.id);
      const can = canFold(ids, group.api.location.type);
      const shut = folds.has(group.id);
      const side = railSide(
        group.element.getBoundingClientRect(),
        viewPanel.group.element.getBoundingClientRect(),
      );
      const title = group.activePanel?.title ?? "";
      const key = `${String(can)}|${String(shut)}|${side}|${title}`;
      if (key === drawn) return;
      drawn = key;
      element.hidden = !can;
      const name = `${shut ? "Unfold" : "Fold"} ${title}`.trim();
      button.title = name;
      button.setAttribute("aria-label", name);
      button.setAttribute("aria-expanded", String(!shut));
      button.replaceChildren(shellIcon(shut ? AWAY[side] : side));
    };
    return { element, update };
  };
  const updateFolders = () => {
    for (const [group, folder] of folders) {
      if (dock.groups.includes(group)) folder.update();
      else folders.delete(group);
    }
  };

  const dock: DockviewApi = createDockview(root, {
    theme: THEME,
    createComponent: ({ name }) => {
      const element = isDockPanelId(name)
        ? contentOf(name)
        : document.createElement("div");
      return {
        element,
        init: () => undefined,
        onShow: () => {
          scrollBack(element);
        },
      };
    },
    // The library asks for a tab of its own only under a name.
    defaultTabComponent: "dock-tab",
    createTabComponent: () => makeTab(),
    createRightHeaderActionComponent: (group) => {
      let made = folders.get(group);
      if (made === undefined) {
        made = makeFolder(group);
        folders.set(group, made);
      }
      const { element, update } = made;
      return { element, init: update, dispose: () => undefined };
    },
    // Popouts never; the 3D view is not floated.
    getTabContextMenuItems: ({ panel }) =>
      panel.id === "view" ? ["maximize"] : ["float", "maximize"],
    floatingGroupBounds: "boundedWithinViewport",
    noPanelsOverlay: "emptyGroup",
  });

  const panelOf = (id: DockPanelId): IDockviewPanel => {
    const found = dock.getPanel(id);
    if (found === undefined) throw new Error(`No docked panel "${id}"`);
    return found;
  };
  const groupOf = (id: DockPanelId): DockviewGroupPanel => panelOf(id).group;

  /** Holds a group at `px` along an axis until laid out, then lets the
   *  creator's splitter move it again (a plain size is overruled by the
   *  relayout a constraint change starts). */
  const pin = (
    group: DockviewGroupPanel,
    axis: "width" | "height",
    px: number,
  ) => {
    if (axis === "width") {
      group.api.setConstraints({ minimumWidth: px, maximumWidth: px });
      group.api.setSize({ width: px });
    } else {
      group.api.setConstraints({ minimumHeight: px, maximumHeight: px });
      group.api.setSize({ height: px });
    }
    afterLayout(() => {
      // Folded meanwhile: the rail keeps its size.
      if (disposed || folds.has(group.id)) return;
      if (axis === "width" && !group.api.isVisible) {
        for (const side of SIDES) if (groupOf(side) === group) stale.add(side);
      }
      group.api.setConstraints(
        axis === "width"
          ? {
              minimumWidth: MIN_WIDTH_PX,
              maximumWidth: Number.MAX_SAFE_INTEGER,
            }
          : {
              minimumHeight: MIN_HEIGHT_PX,
              maximumHeight: Number.MAX_SAFE_INTEGER,
            },
      );
    });
  };
  const sizeFirst = (step: DockStep) => {
    const group = groupOf(step.id);
    if (step.widthPx !== undefined) pin(group, "width", step.widthPx);
    if (step.heightPx !== undefined) pin(group, "height", step.heightPx);
  };

  // --- the default layout ------------------------------------------------
  const steps = defaultDockLayout(window.innerWidth, root.clientHeight);
  for (const step of steps) {
    const spec = dockPanel(step.id);
    dock.addPanel({
      id: spec.id,
      component: spec.id,
      title: spec.title,
      // The 3D view keeps its canvas in the page whatever shows. The other
      // panels stand inside their group, after its tabs, and leave the
      // page while another tab of their group shows: the docking library
      // puts the content of an always-rendered panel after every group,
      // so Tab would walk every tab strip before any panel.
      renderer: spec.id === "view" ? "always" : "onlyWhenVisible",
      ...(step.against === undefined
        ? {}
        : {
            position: {
              referencePanel: step.against.id,
              direction: step.against.direction,
            },
          }),
      ...(step.widthPx === undefined ? {} : { initialWidth: step.widthPx }),
      ...(step.heightPx === undefined ? {} : { initialHeight: step.heightPx }),
      ...(step.inactive === true ? { inactive: true } : {}),
    });
  }
  const adopted = DOCK_PANELS.flatMap((spec) => {
    const node =
      spec.element === null ? null : document.getElementById(spec.element);
    return node === null ? [] : [{ id: spec.id, node }];
  });
  const focusBack = holdFocus(adopted.map((a) => a.node));
  for (const { id, node } of adopted) adopt(node, contentOf(id));
  adoptViewParts();
  watcher.observe(box, { childList: true });

  // Nothing is dropped onto the 3D view as a tab.
  groupOf("view").api.locked = true;
  /** A group over one panel with its own head shows no tab strip; one a
   *  tab joins gets its strip back, and a folded one is its strip. */
  const fitStrips = () => {
    for (const group of dock.groups) {
      group.header.hidden =
        group === maxed?.group ||
        (stripHidden(group.panels.map((p) => p.id)) && !folds.has(group.id));
    }
    // Maximized over a keyboard, the layout may run on under it
    // (`editor-shell.css`): the docking library never lays it out under
    // 100 px tall, more than the least a keyboard leaves.
    root.classList.toggle("keyboard-max", maxed !== null);
  };
  /** How far the maximized layout runs under the keyboard, for its
   *  panels' scrollers to stop above it. */
  const fitUnder = () => {
    const under =
      maxed === null
        ? 0
        : Math.max(
            0,
            Math.round(
              root.getBoundingClientRect().bottom -
                (window.innerHeight - keyboardPx),
            ),
          );
    root.style.setProperty("--dock-under", `${String(under)}px`);
  };
  fitStrips();
  dock.layout(root.clientWidth, root.clientHeight);
  for (const step of steps) {
    if (step.against === undefined) continue;
    if (dockPanel(step.id).group === "bottom") {
      if (step.heightPx !== undefined) unsized.set(step.id, step);
      continue;
    }
    sizeFirst(step);
  }
  // The bottom group shows when asked for (the bar's toggles, its keys).
  groupOf("problems").api.setVisible(false);

  // --- a splitter drag ---------------------------------------------------
  // The 3D view keeps its size while a splitter moves (each resize of its
  // canvas reallocates the drawing buffers) and fits once on release.
  let held: HTMLElement | null = null;
  const onSashDown = (event: PointerEvent) => {
    const at = event.target;
    if (!(at instanceof Element) || at.closest(".dv-sash") === null) return;
    if (!root.contains(at)) return;
    const canvas = view.querySelector<HTMLElement>(".view3d-canvas");
    if (canvas === null) return;
    canvas.style.width = `${String(canvas.clientWidth)}px`;
    canvas.style.height = `${String(canvas.clientHeight)}px`;
    held = canvas;
  };
  const onSashUp = () => {
    if (held === null) return;
    held.style.width = "";
    held.style.height = "";
    held = null;
  };
  document.addEventListener("pointerdown", onSashDown, true);
  window.addEventListener("pointerup", onSashUp);
  window.addEventListener("pointercancel", onSashUp);

  // The long text's writer widens the details while they hold it (the
  // classes `long-text-dock.ts` sets on them); docked, their group takes
  // that width and gets back the one it had once the writer goes.
  const detailsNode = document.getElementById(
    dockPanel("details").element ?? "",
  );
  let beforeWriter: number | null = null;
  let writerPx: number | null = null;
  const fitWriter = () => {
    if (detailsNode === null || disposed) return;
    const group = groupOf("details");
    const holds = detailsNode.classList.contains("lw");
    const want = holds
      ? writerWidthPx(
          window.innerWidth,
          detailsNode.classList.contains("lw-wide"),
        )
      : null;
    if (want === writerPx) return;
    if (writerPx === null) beforeWriter = group.api.width;
    writerPx = want;
    const px = want ?? beforeWriter;
    if (want === null) beforeWriter = null;
    if (px === null) return;
    // Folded, the rail keeps its width and the group unfolds at this one.
    const fold = folds.get(group.id);
    if (fold?.axis === "width") {
      folds = new Map(folds).set(group.id, { ...fold, prevPx: px });
      return;
    }
    group.api.setSize({ width: px });
  };
  const writerWatch = new MutationObserver(fitWriter);

  /** A side group's width for the window: the list's or the column's,
   *  the writer's while the details hold it. */
  const sideWidth = (side: SidePanel): number => {
    const widths = dockWidths(window.innerWidth);
    if (side === "list") return widths.list;
    return writerPx ?? widths.column;
  };
  // A window resize scales every group with it (the docking's own
  // proportional layout); the side groups then take the widths of the new
  // window, the 3D view the rest. A hidden one takes it when it shows.
  let windowPx = root.clientWidth;
  const onResize = () => {
    if (disposed || root.clientWidth === windowPx) return;
    windowPx = root.clientWidth;
    if (writerPx !== null && detailsNode !== null) {
      writerPx = writerWidthPx(
        window.innerWidth,
        detailsNode.classList.contains("lw-wide"),
      );
      // Once the writer goes, the details take the new window's width.
      beforeWriter = dockWidths(window.innerWidth).column;
    }
    afterLayout(() => {
      if (disposed) return;
      if (maxed !== null) {
        // Given back with the layout, at the new window's widths.
        for (const side of SIDES) stale.add(side);
        return;
      }
      for (const side of SIDES) {
        const group = groupOf(side);
        if (folds.has(group.id)) continue;
        if (group.api.isVisible) group.api.setSize({ width: sideWidth(side) });
        else stale.add(side);
      }
      // The bottom group its first height for the new window, now or when
      // it next shows.
      const heightPx = bottomStartPx(root.clientHeight);
      const bottom = groupOf("problems");
      if (bottom.api.isVisible) {
        bottom.api.setSize({ height: heightPx });
        return;
      }
      for (const id of [...unsized.keys()]) {
        if (dockPanel(id).group === "bottom") unsized.delete(id);
      }
      unsized.set("problems", { id: "problems", heightPx });
    });
  };
  const resizeWatch = new ResizeObserver(onResize);
  resizeWatch.observe(root);
  if (detailsNode !== null) {
    writerWatch.observe(detailsNode, {
      attributes: true,
      attributeFilter: ["class"],
    });
    fitWriter();
  }

  // --- a keyboard over a short window ------------------------------------
  /** The shown group whose panel holds the focus, if any. */
  const focusedGroup = (): DockviewGroupPanel | null => {
    const at = document.activeElement;
    if (at === null) return null;
    for (const spec of DOCK_PANELS) {
      if (!contentOf(spec.id).contains(at)) continue;
      const group = groupOf(spec.id);
      return group.api.isVisible ? group : null;
    }
    return null;
  };
  const restoreHeights = (heights: ReadonlyMap<DockviewGroupPanel, number>) => {
    for (const [g, minimumHeight] of heights) {
      g.api.setConstraints({ minimumHeight });
    }
  };
  const giveBack = () => {
    if (maxed === null) return;
    const { before, minimumHeights } = maxed;
    maxed = null;
    if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup();
    restoreHeights(minimumHeights);
    // The layout's own box again first (maximized it ran on under the
    // keyboard): sizes set in the old box were scaled when it changed.
    fitStrips();
    dock.layout(root.clientWidth, root.clientHeight, true);
    for (const was of before) {
      if (!was.group.api.isVisible) continue;
      const side = SIDES.find((id) => groupOf(id) === was.group);
      const width =
        side !== undefined && stale.delete(side) ? sideWidth(side) : was.width;
      was.group.api.setSize({ width, height: was.height });
      if (was.active !== undefined && was.group.activePanel !== was.active) {
        was.active.api.setActive();
      }
    }
    fitStrips();
    fitUnder();
  };
  const maximize = (group: DockviewGroupPanel) => {
    giveBack();
    maxed = {
      group,
      minimumHeights: new Map(dock.groups.map((g) => [g, g.minimumHeight])),
      before: dock.groups
        .filter((g) => g.api.isVisible)
        .map((g) => ({
          group: g,
          width: g.api.width,
          height: g.api.height,
          active: g.activePanel,
        })),
    };
    for (const g of dock.groups) g.api.setConstraints({ minimumHeight: 0 });
    group.api.maximize();
    fitStrips();
    // Laid out again at the layout's box: one smaller than the least
    // heights before was held at them.
    dock.layout(root.clientWidth, root.clientHeight, true);
    fitUnder();
  };
  /** Over a window the keyboard leaves too short, the group holding the
   *  field in use takes the whole layout; otherwise the layout is given
   *  back as it was. */
  const fitKeyboard = () => {
    if (disposed) return;
    const want = keyboardMaximizes(window.innerHeight, keyboardPx)
      ? focusedGroup()
      : null;
    if (want === (maxed?.group ?? null)) return;
    if (want === null) giveBack();
    else maximize(want);
    deps.onChange();
  };
  const onFocusIn = () => {
    if (keyboardPx > 0) fitKeyboard();
  };
  root.addEventListener("focusin", onFocusIn);
  // The field in use brought into sight again once its panel has its new
  // size: the docking places a panel's content a frame or two after it
  // lays out the group, so the keyboard's own scroll can come too early.
  const paneWatch = new ResizeObserver((entries) => {
    if (keyboardPx <= 0) return;
    const at = document.activeElement;
    if (!(at instanceof HTMLElement)) return;
    if (entries.some((entry) => entry.target.contains(at))) {
      at.scrollIntoView({ block: "nearest" });
    }
  });
  for (const content of contents.values()) paneWatch.observe(content);
  // Something else gave the layout back (a group shown or hidden ends the
  // maximized state): nothing is held any more.
  const unmaxed = dock.onDidMaximizedGroupChange(({ isMaximized }) => {
    if (isMaximized || maxed === null) return;
    restoreHeights(maxed.minimumHeights);
    maxed = null;
    fitStrips();
    fitUnder();
  });

  // A tab's Delete or Backspace closes its panel in the docking library;
  // here a panel is never closed, and the key must not reach the page
  // either, where it deletes the selection. On the root, in the capture
  // phase: before the tab strip's own handler.
  const onTabKey = (event: KeyboardEvent) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const at = event.target;
    if (!(at instanceof Element) || at.closest(".dv-tab") === null) return;
    event.preventDefault();
    event.stopPropagation();
  };
  root.addEventListener("keydown", onTabKey, true);

  const changed = dock.onDidActivePanelChange(() => {
    updateFolders();
    deps.onChange();
  });
  const laidOut = dock.onDidLayoutChange(() => {
    // A group dragged empty is gone, its fold with it.
    folds = prunedTo(
      folds,
      dock.groups.map((g) => g.id),
    );
    fitStrips();
    updateFolders();
    deps.onChange();
  });

  const showGroup = (id: DockPanelId) => {
    const group = groupOf(id);
    if (group.api.isVisible) return;
    // A group coming back takes its room from its neighbours, the other
    // side group too (down to its least width); that one keeps its width.
    const others = SIDES.flatMap((side) => {
      const other = groupOf(side);
      return other !== group && other.api.isVisible
        ? [{ other, width: other.api.width }]
        : [];
    });
    group.api.setVisible(true);
    for (const side of SIDES) {
      if (groupOf(side) !== group || !stale.delete(side)) continue;
      group.api.setSize({ width: sideWidth(side) });
    }
    for (const { other, width } of others) other.api.setSize({ width });
    const first = [...unsized.entries()].find(
      ([panel]) => groupOf(panel) === group,
    );
    if (first !== undefined) {
      unsized.delete(first[0]);
      sizeFirst(first[1]);
    }
  };

  /** Folds `group` to its rail or unfolds it, the other docked groups
   *  keeping their sizes along their own axes (the 3D view takes or gives
   *  the room). A focus inside the group that the rail hides goes to its
   *  fold button. */
  const foldGroup = (group: DockviewGroupPanel, shut: boolean) => {
    if (disposed || shut === folds.has(group.id)) return;
    const ids = group.panels.map((p) => p.id);
    if (shut && !canFold(ids, group.api.location.type)) return;
    const layout = { width: root.clientWidth, height: root.clientHeight };
    const centre = groupOf("view");
    const kept = dock.groups.flatMap((g) => {
      if (g === group || g === centre || g.api.location.type !== "grid") {
        return [];
      }
      if (!g.api.isVisible) return [];
      const size = { width: g.api.width, height: g.api.height };
      return [
        foldAxis(size, layout) === "width"
          ? { g, size: { width: size.width } }
          : { g, size: { height: size.height } },
      ];
    });
    const at = document.activeElement;
    const focusIn = at instanceof HTMLElement && group.element.contains(at);
    if (shut) {
      const next = foldedAt(
        folds,
        group.id,
        { width: group.api.width, height: group.api.height },
        layout,
      );
      const fold = next.get(group.id);
      if (fold === undefined) return;
      folds = next;
      group.element.classList.add("dock-folded");
      if (fold.axis === "width") group.api.setHeaderPosition("left");
      fitStrips();
      const px = railPx(
        window.matchMedia?.("(pointer: coarse)").matches === true,
      );
      if (fold.axis === "width") {
        group.api.setConstraints({ minimumWidth: px, maximumWidth: px });
        group.api.setSize({ width: px });
      } else {
        group.api.setConstraints({ minimumHeight: px, maximumHeight: px });
        group.api.setSize({ height: px });
      }
    } else {
      const { folds: next, restore } = unfoldedAt(folds, group.id);
      folds = next;
      group.element.classList.remove("dock-folded");
      group.api.setHeaderPosition("top");
      fitStrips();
      if (restore !== null) pin(group, restore.axis, restore.px);
    }
    afterLayout(() => {
      if (disposed) return;
      for (const { g, size } of kept) {
        if (dock.groups.includes(g) && !folds.has(g.id)) g.api.setSize(size);
      }
    });
    updateFolders();
    deps.onChange();
    if (focusIn && !(at.isConnected && at.checkVisibility())) {
      const to = shut
        ? folders.get(group)?.element.querySelector("button")
        : ownFold(group);
      to?.focus({ preventScroll: true });
    }
  };
  /** The shown fold button of a panel's own head in `group`, if any. */
  const ownFold = (group: DockviewGroupPanel): HTMLElement | null => {
    for (const panel of group.panels) {
      if (!isDockPanelId(panel.id)) continue;
      const selector = dockPanel(panel.id).fold;
      if (selector === undefined) continue;
      const button = document.querySelector<HTMLElement>(selector);
      if (button?.checkVisibility() === true) return button;
    }
    return null;
  };
  /** Out of sight: a group of the bottom panel's panes hidden (its
   *  toggles bring it back), any other folded to its rail. */
  const hideGroup = (group: DockviewGroupPanel) => {
    if (!group.api.isVisible) return;
    const bottom = group.panels.every(
      (p) => isDockPanelId(p.id) && dockPanel(p.id).group === "bottom",
    );
    if (!bottom) {
      foldGroup(group, true);
      return;
    }
    group.api.setVisible(false);
    deps.onChange();
  };
  focusBack();

  return {
    reveal(id) {
      // The focus stays where it was (a row picked from the keyboard shows
      // its details): a tab made active takes it otherwise.
      const back = holdFocus([...contents.values()]);
      showGroup(id);
      foldGroup(groupOf(id), false);
      const panel = panelOf(id);
      if (panel.group.activePanel !== panel) panel.api.setActive();
      back();
      deps.onChange();
    },
    hideGroupOf(id) {
      hideGroup(groupOf(id));
    },
    conceal(id, instead) {
      const group = groupOf(id);
      if (!group.api.isVisible || group.activePanel?.id !== id) return;
      const other =
        group.panels.find((p) => p.id === instead) ??
        group.panels.find((p) => p.id !== id);
      if (other === undefined) {
        hideGroup(group);
        return;
      }
      const back = holdFocus([...contents.values()]);
      other.api.setActive();
      back();
      deps.onChange();
    },
    groupShown(id) {
      const group = groupOf(id);
      return group.api.isVisible && !folds.has(group.id);
    },
    activeIn(id) {
      const active = groupOf(id).activePanel?.id;
      return isDockPanelId(active) ? active : null;
    },
    fold(id, shut) {
      foldGroup(groupOf(id), shut);
    },
    folded(id) {
      return folds.has(groupOf(id).id);
    },
    badge(id, badge) {
      if (badge === null) badges.delete(id);
      else badges.set(id, badge);
      for (const tab of root.querySelectorAll<HTMLElement>(
        `.dock-tab[data-panel="${id}"]`,
      )) {
        drawBadge(tab, badge);
      }
    },
    content: contentOf,
    keyboard(px) {
      if (disposed) return;
      keyboardPx = px;
      fitKeyboard();
      dock.layout(root.clientWidth, root.clientHeight);
      fitUnder();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      watcher.disconnect();
      writerWatch.disconnect();
      resizeWatch.disconnect();
      root.removeEventListener("focusin", onFocusIn);
      paneWatch.disconnect();
      root.removeEventListener("keydown", onTabKey, true);
      unmaxed.dispose();
      changed.dispose();
      laidOut.dispose();
      document.removeEventListener("pointerdown", onSashDown, true);
      window.removeEventListener("pointerup", onSashUp);
      window.removeEventListener("pointercancel", onSashUp);
      onSashUp();
      // The canvas first, back under the docks. Only what is still in the
      // layout goes back: a part removed meanwhile by the code that made
      // it (the 3D view's canvas when the view closed) stays removed. A
      // panel behind another tab is out of the page, and goes back too.
      const going = homes.filter((home) =>
        [root, ...contents.values()].some((at) => at.contains(home.node)),
      );
      const back = holdFocus(going.map((home) => home.node));
      for (const home of [...going].reverse()) sendHome(home.node);
      dock.dispose();
      root.remove();
      box.classList.remove("docked");
      back();
    },
  };
}
