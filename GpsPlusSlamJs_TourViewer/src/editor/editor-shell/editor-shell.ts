/**
 * The 3D view's shell: the top bar's studio controls (Details, Undo and
 * Redo, Help), the Edit menu's Undo and Redo (where they fold at a
 * phone's width) and the View menu's Top view and Frame, the tree dock at
 * the left, the inspector dock at the right, the compass and the zoom
 * buttons at the bottom right, and the bottom bar's view line, hint and
 * debug readout. The page's own controls (the File menu, the view switch,
 * the save status) stay the page's.
 *
 * Everything it shows is drawn from the store - the tour from
 * `tourDocument`, the selection and the docks' and tree's folds from
 * `editorView` - so the map and the 3D view read one copy. A click on a
 * card follows the tree click rule (`tree-click.ts`): selected, unfolded
 * and flown to; a second click deselects and folds; a double click does
 * not toggle. On a narrow window the docks follow the dock rule
 * (`dock-rule.ts`). The camera commands are the 3D view's
 * (`ShellView`); the shell never imports the 3D view's code.
 *
 * @see editor-shell.ts.md
 */
import type { UnknownAction } from "@reduxjs/toolkit";

import type { Editor3dView } from "../../editor3d/editor3d-scene.js";
import {
  manifestToWrite,
  nextStep,
  type TourDocumentState,
} from "../../tour-document.js";
import {
  editorViewActions,
  isStationLocked,
  pointerDragRuns,
  type EditorViewState,
  type ShellLayer,
  type TreeSection,
} from "../editor-view.js";
import { STATION_PREFIX } from "../editor-model.js";
import { docksAfter, type DockChange } from "./dock-rule.js";
import {
  buildInspector,
  inspectorHint,
  type InspectorCode,
} from "./inspector-model.js";
import { drawInspector } from "./shell-inspector.js";
import { placeShellIcons } from "./shell-icons.js";
import { createShellPictures } from "./shell-pictures.js";
import { drawTree } from "./shell-tree.js";
import {
  NO_TREE_CLICK,
  treeClick,
  treeClickPlan,
  type TreeClickMemory,
} from "./tree-click.js";
import { buildTree } from "./tree-model.js";

/** The 3D view's commands the shell drives. */
type ShellView = Pick<
  Editor3dView,
  "flyTo" | "frame" | "setTop" | "zoom" | "northUp" | "readout" | "setLayers"
>;

/** The page's store, as the shell reads it. */
interface ShellStore {
  getState(): {
    readonly tourDocument: TourDocumentState;
    readonly editorView: EditorViewState;
  };
  subscribe(listener: () => void): () => void;
  dispatch(action: UnknownAction): unknown;
}

export interface EditorShellDeps {
  readonly store: ShellStore;
  /** The page's selection (the map's markers and card follow it). */
  readonly select: (id: string | null) => void;
  /** One step of the edit history, as Ctrl+Z and Ctrl+Shift+Z. */
  readonly step: (which: "undo" | "redo") => void;
  /** The tour's details dialog. */
  readonly openDetails: () => void;
  /** The open tour's codes, in the phone's numbering. */
  readonly codes: () => readonly InspectorCode[];
  /** A picture's bytes from the open tour (its content path). */
  readonly loadPicture: (path: string) => Promise<Blob>;
  /** A dialog of the page shows: the shell's keys stay out of it. */
  readonly dialogOpen: () => boolean;
}

export interface EditorShell {
  /** The 3D view shows: the shell drives `view` until `hide`. */
  show(view: ShellView): void;
  hide(): void;
}

/** The layers this view draws, a chip each (the others come with what
 *  they show). */
const SHELL_LAYERS: readonly ShellLayer[] = ["codes", "names"];

/** How often the compass, the view line and the readout follow the
 *  camera (ms). */
const READOUT_MS = 200;

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`edit.html lacks #${id}`);
  return found as T;
}

function inField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

export function createEditorShell(deps: EditorShellDeps): EditorShell {
  const { store } = deps;
  const tree = {
    root: byId("shell-tree"),
    stationsHead: byId<HTMLButtonElement>("tree-stations"),
    fold: byId<HTMLButtonElement>("tree-fold"),
    body: byId("tree-body"),
  };
  const inspector = {
    root: byId("shell-inspector"),
    head: byId("inspector-head"),
    body: byId("inspector-body"),
  };
  const bar = {
    root: byId("shell-bar"),
    view: byId("shell-view"),
    hint: byId("shell-hint"),
    history: byId("shell-history"),
    calls: byId("shell-calls"),
    frame: byId("shell-frame"),
    debug: byId<HTMLButtonElement>("shell-debug"),
  };
  const top = {
    details: byId<HTMLButtonElement>("studio-details"),
    undo: byId<HTMLButtonElement>("studio-undo"),
    redo: byId<HTMLButtonElement>("studio-redo"),
    editUndo: byId<HTMLButtonElement>("edit-undo"),
    editRedo: byId<HTMLButtonElement>("edit-redo"),
    frame: byId<HTMLButtonElement>("studio-frame"),
    topView: byId<HTMLButtonElement>("studio-top"),
    help: byId<HTMLButtonElement>("studio-help"),
  };
  const helpBox = byId("shell-help");
  const needle = byId<HTMLElement>("compass-needle");
  for (const root of [byId("topbar"), byId("view3d")]) placeShellIcons(root);

  const pictures = createShellPictures({
    load: (path) => deps.loadPicture(path),
  });

  let view: ShellView | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: number | null = null;
  let memory: TreeClickMemory = NO_TREE_CLICK;
  let positionOpen = false;
  /** What was drawn from: the shell draws again only when it changed. */
  let drawn: {
    doc: TourDocumentState;
    ui: EditorViewState;
    positionOpen: boolean;
  } | null = null;

  const state = () => store.getState();
  const manifest = () => manifestToWrite(state().tourDocument);

  const inspectorModel = (ui: EditorViewState) => {
    const tour = manifest();
    return buildInspector({
      selected: ui.selected,
      stations: tour?.stations ?? [],
      assets: tour?.assets ?? [],
      codes: deps.codes(),
      unlockedStations: ui.unlockedStations,
    });
  };

  /** The docks after `change` by the dock rule, stored. */
  const applyDocks = (change: DockChange) => {
    const ui = state().editorView;
    const after = docksAfter(change, {
      widthPx: window.innerWidth,
      folded: ui.foldedDocks,
      inspectorShows: inspectorModel(ui) !== null,
    });
    for (const dock of ["tree", "inspector"] as const) {
      if (after[dock] !== ui.foldedDocks[dock]) {
        store.dispatch(
          editorViewActions.dockFolded({ dock, folded: after[dock] }),
        );
      }
    }
  };

  const drawHistory = (doc: TourDocumentState) => {
    for (const which of ["undo", "redo"] as const) {
      const next = nextStep(doc, which);
      const key = which === "undo" ? "Ctrl+Z" : "Ctrl+Shift+Z";
      const verb = which === "undo" ? "Undo" : "Redo";
      // The bar's button and the Edit menu's item say the same.
      const buttons =
        which === "undo" ? [top.undo, top.editUndo] : [top.redo, top.editRedo];
      for (const button of buttons) {
        button.disabled = next === undefined;
        button.title =
          next === undefined
            ? `Nothing to ${which}`
            : `${verb} ${next.what} (${key})`;
      }
    }
    bar.history.textContent = `History ${String(doc.past.length)} / ${String(
      doc.past.length + doc.future.length,
    )}`;
  };

  const draw = () => {
    const { tourDocument: doc, editorView: ui } = state();
    if (
      drawn !== null &&
      drawn.doc === doc &&
      drawn.ui === ui &&
      drawn.positionOpen === positionOpen
    ) {
      return;
    }
    const docChanged = drawn?.doc !== doc;
    const uiChanged = drawn?.ui !== ui;
    const before = drawn?.ui ?? null;
    drawn = { doc, ui, positionOpen };
    const tour = manifest();
    const codes = deps.codes();
    if (docChanged || uiChanged) {
      drawTree(
        tree,
        buildTree({
          stations: tour?.stations ?? [],
          assets: tour?.assets ?? [],
          codes,
          view: ui,
          layers: SHELL_LAYERS,
        }),
        ui.foldedDocks.tree,
        pictures,
      );
    }
    const model = buildInspector({
      selected: ui.selected,
      stations: tour?.stations ?? [],
      assets: tour?.assets ?? [],
      codes,
      unlockedStations: ui.unlockedStations,
    });
    drawInspector(
      inspector,
      model,
      { folded: ui.foldedDocks.inspector, positionOpen },
      pictures,
    );
    bar.hint.textContent = inspectorHint(model);
    bar.root.classList.toggle("debug", ui.readout);
    bar.debug.setAttribute("aria-pressed", String(ui.readout));
    // The cards and the thumbnail a draw replaced are no longer watched.
    pictures.sweep();
    drawHistory(doc);
    if (before === null || before.hiddenLayers !== ui.hiddenLayers) {
      view?.setLayers(ui.hiddenLayers);
    }
  };

  /** The selection changed: the inspector may open, and on a narrow
   *  window it folds the tree. */
  let lastSelected: string | null = null;
  const onStore = () => {
    const { selected } = state().editorView;
    if (selected !== lastSelected) {
      lastSelected = selected;
      positionOpen = false;
      if (selected !== null) applyDocks("selected");
    }
    draw();
  };

  const readout = () => {
    if (view === null) return;
    const r = view.readout();
    needle.setAttribute("transform", `rotate(${String(-r.headingDeg)} 12 12)`);
    bar.view.textContent =
      r.top || r.tiltDeg < 1
        ? "Top view"
        : `3D view, tilt ${String(Math.round(r.tiltDeg))} deg`;
    // A checkbox item of the View menu.
    top.topView.setAttribute("aria-checked", String(r.top));
    bar.calls.textContent = `${String(r.drawCalls)} draw calls`;
    bar.frame.textContent = `${r.frameMs.toFixed(1)} ms / frame`;
  };

  const showHelp = (on: boolean) => {
    helpBox.classList.toggle("show", on);
    top.help.classList.toggle("on", on);
    top.help.setAttribute("aria-expanded", String(on));
  };

  // --- the tree's and the inspector's clicks ------------------------------
  tree.body.addEventListener("click", (event) => {
    const target = event.target as Element;
    const section = target.closest<HTMLElement>("[data-section]");
    if (section !== null) {
      const key = section.dataset["section"] as TreeSection;
      const open = state().editorView.openSections[key];
      store.dispatch(
        editorViewActions.sectionFolded({ section: key, open: !open }),
      );
      return;
    }
    const chip = target.closest<HTMLElement>("[data-layer]");
    if (chip !== null) {
      const layer = chip.dataset["layer"] as ShellLayer;
      const shown = state().editorView.hiddenLayers.includes(layer);
      store.dispatch(editorViewActions.layerShown({ layer, shown }));
      // A hidden code cannot stay selected.
      const { selected } = state().editorView;
      if (
        layer === "codes" &&
        !shown &&
        deps.codes().some((c) => c.id === selected)
      ) {
        deps.select(null);
      }
      return;
    }
    const unfold = target.closest<HTMLElement>("[data-unfold]");
    if (unfold !== null) {
      const id = unfold.dataset["unfold"] ?? "";
      const open = state().editorView.openStations.includes(id);
      store.dispatch(editorViewActions.stationFolded({ id, open: !open }));
      return;
    }
    const row = target.closest<HTMLElement>("[data-select]");
    const id = row?.dataset["select"];
    if (id === undefined) return;
    const click = treeClick({
      id,
      at: event.timeStamp,
      detail: event.detail,
      selected: state().editorView.selected,
      last: memory,
    });
    memory = click.memory;
    const plan = treeClickPlan(click.outcome, id, manifest()?.stations ?? []);
    if (plan === null) return;
    deps.select(plan.select);
    if (plan.unfold !== null) {
      store.dispatch(
        editorViewActions.stationFolded({ id: plan.unfold, open: true }),
      );
    }
    if (plan.fold !== null) {
      store.dispatch(
        editorViewActions.stationFolded({ id: plan.fold, open: false }),
      );
    }
    if (plan.openCodes) {
      store.dispatch(
        editorViewActions.sectionFolded({ section: "codes", open: true }),
      );
    }
    if (plan.fly && plan.select !== null) view?.flyTo(plan.select);
  });
  tree.stationsHead.addEventListener("click", () => {
    const { openSections, foldedDocks } = state().editorView;
    // On a folded dock the header is the larger target of its head: a tap
    // there only unfolds the dock, its sections as they were.
    if (foldedDocks.tree) {
      store.dispatch(
        editorViewActions.dockFolded({ dock: "tree", folded: false }),
      );
      applyDocks("tree-unfolded");
      return;
    }
    store.dispatch(
      editorViewActions.sectionFolded({
        section: "stations",
        open: !openSections.stations,
      }),
    );
  });
  tree.fold.addEventListener("click", () => {
    const folded = !state().editorView.foldedDocks.tree;
    store.dispatch(editorViewActions.dockFolded({ dock: "tree", folded }));
    if (!folded) applyDocks("tree-unfolded");
  });
  inspector.root.addEventListener("click", (event) => {
    const act = (event.target as Element).closest<HTMLElement>("[data-act]")
      ?.dataset["act"];
    if (act === "close") deps.select(null);
    if (act === "lock") {
      // The selected station's position locked or unlocked: view state,
      // never an edit; the session refuses its moves while locked.
      const ui = state().editorView;
      if (ui.selected?.startsWith(STATION_PREFIX) === true) {
        const id = ui.selected.slice(STATION_PREFIX.length);
        store.dispatch(
          editorViewActions.stationLocked({
            id,
            locked: !isStationLocked(ui, id),
          }),
        );
      }
    }
    if (act === "position") {
      positionOpen = !positionOpen;
      draw();
    }
    if (act === "fold") {
      const folded = !state().editorView.foldedDocks.inspector;
      store.dispatch(
        editorViewActions.dockFolded({ dock: "inspector", folded }),
      );
      if (!folded) applyDocks("inspector-unfolded");
    }
  });

  // --- the top bar, the map controls and the bottom bar --------------------
  top.details.addEventListener("click", () => {
    deps.openDetails();
  });
  for (const button of [top.undo, top.editUndo]) {
    button.addEventListener("click", () => {
      deps.step("undo");
    });
  }
  for (const button of [top.redo, top.editRedo]) {
    button.addEventListener("click", () => {
      deps.step("redo");
    });
  }
  const frame = (whole: boolean) => {
    view?.frame(whole ? null : state().editorView.selected);
  };
  const toggleTop = () => {
    if (view === null) return;
    view.setTop(!view.readout().top);
    readout();
  };
  top.frame.addEventListener("click", () => {
    frame(false);
  });
  top.topView.addEventListener("click", toggleTop);
  top.help.addEventListener("click", (event) => {
    event.stopPropagation();
    showHelp(!helpBox.classList.contains("show"));
  });
  byId("compass").addEventListener("click", () => view?.northUp());
  byId("zoom-in").addEventListener("click", () => view?.zoom(1));
  byId("zoom-out").addEventListener("click", () => view?.zoom(-1));
  bar.debug.addEventListener("click", () => {
    store.dispatch(
      editorViewActions.readoutShown({ shown: !state().editorView.readout }),
    );
  });

  // --- while the view shows ------------------------------------------------
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && helpBox.classList.contains("show")) {
      // Esc closes the help first, as a popover; the next deselects.
      event.stopImmediatePropagation();
      showHelp(false);
      return;
    }
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      inField(event.target) ||
      deps.dialogOpen() ||
      // The camera stands still during a drag of the gizmo.
      pointerDragRuns(state().editorView)
    ) {
      return;
    }
    if (event.code === "KeyT") toggleTop();
    else if (event.code === "KeyF") frame(false);
    else if (event.code === "Home") frame(true);
  };
  const onOutside = (event: PointerEvent) => {
    const at = event.target as Element | null;
    if (at?.closest("#shell-help, #studio-help") == null) showHelp(false);
  };
  const onResize = () => {
    applyDocks("resized");
  };

  return {
    show(next) {
      view = next;
      drawn = null;
      lastSelected = state().editorView.selected;
      applyDocks("opened");
      unsubscribe?.();
      unsubscribe = store.subscribe(onStore);
      draw();
      readout();
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(readout, READOUT_MS);
      // Capture: Esc reaches the help before the page's own handler.
      window.addEventListener("keydown", onKey, true);
      document.addEventListener("pointerdown", onOutside);
      window.addEventListener("resize", onResize);
    },
    hide() {
      view = null;
      unsubscribe?.();
      unsubscribe = null;
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onOutside);
      window.removeEventListener("resize", onResize);
      showHelp(false);
      pictures.clear();
      drawn = null;
    },
  };
}
