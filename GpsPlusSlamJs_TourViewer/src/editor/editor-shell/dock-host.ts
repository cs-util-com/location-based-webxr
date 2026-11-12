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
} from "dockview";

import {
  defaultDockLayout,
  DOCK_PANELS,
  dockPanel,
  isDockPanelId,
  type DockPanelId,
  type DockStep,
} from "./dock-layout.js";

/** The parts of the view box that move with the 3D view into its panel:
 *  the canvas, the model's notes over it, the map controls. */
const VIEW_PARTS = [".view3d-canvas", ".model-notes", "#map-controls"];

/** A side group's and the bottom group's least size once released
 *  (px). */
const MIN_WIDTH_PX = 140;
const MIN_HEIGHT_PX = 90;

/** The two side panels that fold. */
export type FoldingPanel = "list" | "details";

export interface DockHostDeps {
  /** The 3D view's box (`#view3d`): the layout fills it below the
   *  accent line. */
  readonly box: HTMLElement;
  /** A panel was shown, hidden or chosen by the docking's own controls
   *  (or by this host). */
  readonly onChange: () => void;
}

export interface DockHost {
  /** Shows `id`: its group made visible (and unfolded), it the group's
   *  shown tab. */
  reveal(id: DockPanelId): void;
  /** Hides the group that holds `id`. */
  hideGroupOf(id: DockPanelId): void;
  /** Whether the group holding `id` shows. */
  groupShown(id: DockPanelId): boolean;
  /** The shown tab of the group holding `id`. */
  activeIn(id: DockPanelId): DockPanelId | null;
  /** Folds or unfolds a side panel: folded, its group hides and its
   *  element goes back to the view box, where it shows as its folded
   *  head. */
  fold(id: FoldingPanel, folded: boolean): void;
  /** The element a panel's content sits in. */
  content(id: DockPanelId): HTMLElement;
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
  const folded = new Set<FoldingPanel>();
  /** Groups whose first size is still to be given when they first show
   *  (the bottom group starts hidden). */
  const unsized = new Map<DockPanelId, DockStep>();
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

  const dock: DockviewApi = createDockview(root, {
    theme: THEME,
    createComponent: ({ name }) => ({
      element: isDockPanelId(name)
        ? contentOf(name)
        : document.createElement("div"),
      init: () => undefined,
    }),
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
      if (disposed) return;
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
      // Every panel keeps its element in the page while another tab shows:
      // the 3D view keeps its canvas, the others their scroll and focus.
      renderer: "always",
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
  for (const spec of DOCK_PANELS) {
    if (spec.element === null) continue;
    const node = document.getElementById(spec.element);
    if (node !== null) adopt(node, contentOf(spec.id));
  }
  adoptViewParts();
  watcher.observe(box, { childList: true });

  const centre = groupOf("view");
  // Nothing is dropped onto the 3D view as a tab, and its one tab needs
  // no strip.
  centre.api.locked = true;
  centre.header.hidden = true;
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

  const changed = dock.onDidActivePanelChange(() => {
    deps.onChange();
  });
  const laidOut = dock.onDidLayoutChange(() => {
    deps.onChange();
  });

  const showGroup = (id: DockPanelId) => {
    const group = groupOf(id);
    if (group.api.isVisible) return;
    group.api.setVisible(true);
    const first = [...unsized.entries()].find(
      ([panel]) => groupOf(panel) === group,
    );
    if (first !== undefined) {
      unsized.delete(first[0]);
      sizeFirst(first[1]);
    }
  };

  const fold = (id: FoldingPanel, shut: boolean) => {
    const spec = dockPanel(id);
    const node =
      spec.element === null ? null : document.getElementById(spec.element);
    if (shut === folded.has(id) || node === null) return;
    if (shut) {
      folded.add(id);
      groupOf(id).api.setVisible(false);
      sendHome(node);
    } else {
      folded.delete(id);
      adopt(node, contentOf(id), true);
      showGroup(id);
    }
    deps.onChange();
  };

  return {
    reveal(id) {
      if (id === "list" || id === "details") fold(id, false);
      showGroup(id);
      const panel = panelOf(id);
      if (panel.group.activePanel !== panel) panel.api.setActive();
      deps.onChange();
    },
    hideGroupOf(id) {
      const group = groupOf(id);
      if (!group.api.isVisible) return;
      group.api.setVisible(false);
      deps.onChange();
    },
    groupShown(id) {
      return groupOf(id).api.isVisible;
    },
    activeIn(id) {
      const active = groupOf(id).activePanel?.id;
      return isDockPanelId(active) ? active : null;
    },
    fold,
    content: contentOf,
    dispose() {
      if (disposed) return;
      disposed = true;
      watcher.disconnect();
      changed.dispose();
      laidOut.dispose();
      document.removeEventListener("pointerdown", onSashDown, true);
      window.removeEventListener("pointerup", onSashUp);
      window.removeEventListener("pointercancel", onSashUp);
      onSashUp();
      // The canvas first, back under the docks.
      for (const home of [...homes].reverse()) sendHome(home.node);
      dock.dispose();
      root.remove();
      box.classList.remove("docked");
    },
  };
}
