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
 * The tree's editing (M3b): "+" adds a station at the centre of the view,
 * the scene's ground menu one where it was pressed (`scene-menu.ts`); a
 * card's grip reorders by drag (`tree-drag.ts`), the inspector's Earlier
 * and Later by the keyboard; the inspector's Delete and "Move to a new
 * station"; the bottom bar's power actions (`bar-actions.ts`). Each is the
 * page's command (`EditorShellDeps.stations`), one undo step.
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
import { inField, inMenu } from "../key-target.js";
import { closeOpenMenu, setItemDisabled } from "../menu-button.js";
import {
  ALIGNED_DEG,
  barActions,
  positionText,
  type BarAction,
} from "./bar-actions.js";
import { docksAfter, type DockChange } from "./dock-rule.js";
import {
  buildInspector,
  inspectorHint,
  type InspectorCode,
  type InspectorModel,
} from "./inspector-model.js";
import { createSceneMenu, type GroundPlace } from "./scene-menu.js";
import { drawInspector } from "./shell-inspector.js";
import { placeShellIcons, shellIcon, type ShellIcon } from "./shell-icons.js";
import { createShellPictures } from "./shell-pictures.js";
import { drawTree } from "./shell-tree.js";
import { createTreeDrag } from "./tree-drag.js";
import { movedTo } from "./tree-reorder.js";
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
  | "flyTo"
  | "frame"
  | "setTop"
  | "zoom"
  | "northUp"
  | "readout"
  | "setLayers"
  | "centre"
  | "turn"
>;

/** The page's station commands the tree and the bars give: each one undo
 *  step, its outcome said by the page. */
interface ShellStationCommands {
  /** A new station at `at`: the view's centre ("+") or where the ground
   *  menu was opened ("here"). */
  add(at: GroundPlace, where: "centre" | "here"): void;
  /** The stations in `order` (every station once). */
  reorder(order: readonly string[]): void;
  /** An item into a station of its own, where it stands. */
  split(itemId: string): void;
  /** The selection (`station:<id>` or an item's id) copied beside itself. */
  duplicate(selection: string): void;
  /** The selection deleted (its Undo in the page's toast). */
  remove(selection: string): void;
}

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
  readonly stations: ShellStationCommands;
  /** A passing line (the page's toast). */
  readonly say: (text: string) => void;
}

export interface EditorShell {
  /** The 3D view shows: the shell drives `view` until `hide`. */
  show(view: ShellView): void;
  hide(): void;
  /** The scene's ground menu at `point` (px in the view), for the
   *  ground's `place` there (null: none has loaded). */
  groundMenu(point: { x: number; y: number }, place: GroundPlace | null): void;
}

const BAR_ICON: Readonly<Record<BarAction, ShellIcon>> = {
  duplicate: "dup",
  align: "align",
  copy: "copy",
};

/** `deg` as a turn of -180 to 180 degrees. */
function signedDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** The layers this view draws, a chip each (the others come with what
 *  they show). */
const SHELL_LAYERS: readonly ShellLayer[] = ["codes", "names"];

/** How often the compass, the view line and the readout follow the
 *  camera (ms). */
const READOUT_MS = 200;

/** Inside an open menu (not on a menu's button): its own Escape closes
 *  it. */
function insideMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"]') !== null;
}

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`edit.html lacks #${id}`);
  return found as T;
}

export function createEditorShell(deps: EditorShellDeps): EditorShell {
  const { store } = deps;
  const tree = {
    root: byId("shell-tree"),
    stationsHead: byId<HTMLButtonElement>("tree-stations"),
    fold: byId<HTMLButtonElement>("tree-fold"),
    add: byId<HTMLButtonElement>("tree-add"),
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
    acts: byId("shell-acts"),
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
  const viewBox = byId("view3d");
  const said = byId("shell-said");
  const ground = createSceneMenu({
    box: viewBox,
    menu: byId("scene-menu"),
    item: byId("scene-new-station"),
    // The view's box takes the focus back (`tabindex="-1"`): the view's
    // keys are the window's, and work from there.
    returnFocus: viewBox,
    newStation: (place) => {
      deps.stations.add(place, "here");
    },
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
      // The bar's button and the Edit menu's item say the same; the
      // item is disabled the menu pattern's way, its focus kept.
      const [barButton, item] =
        which === "undo" ? [top.undo, top.editUndo] : [top.redo, top.editRedo];
      barButton.disabled = next === undefined;
      setItemDisabled(item, next === undefined);
      for (const button of [barButton, item]) {
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

  /** The bottom bar's power actions for the selection; a draw keeps the
   *  focus on the action that had it. */
  const drawActs = (model: InspectorModel | null) => {
    const active = document.activeElement;
    const had =
      active instanceof HTMLElement && bar.acts.contains(active)
        ? active.dataset["bar"]
        : undefined;
    bar.acts.replaceChildren(
      ...barActions(model).map((act) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sact";
        button.dataset["bar"] = act.action;
        button.title = act.title;
        button.setAttribute("aria-label", act.label);
        const words = document.createElement("span");
        words.className = "lbl";
        words.textContent = act.label;
        button.append(shellIcon(BAR_ICON[act.action]), words);
        return button;
      }),
    );
    if (had !== undefined) {
      bar.acts.querySelector<HTMLElement>(`[data-bar="${had}"]`)?.focus();
    }
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
    drawActs(model);
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

  /** The selected station one place earlier or later in the tour (the
   *  inspector's buttons), the focus kept on the buttons and the new
   *  place said (the inspector's line, "Station n of N"). */
  const moveSelected = (selected: string, way: "earlier" | "later") => {
    if (!selected.startsWith(STATION_PREFIX)) return;
    const ids = (manifest()?.stations ?? []).map((s) => s.id);
    const from = ids.indexOf(selected.slice(STATION_PREFIX.length));
    if (from < 0) return;
    const slot = way === "earlier" ? from - 1 : from + 2;
    if (slot < 0 || slot > ids.length) return;
    const order = movedTo(ids, from, slot);
    if (order === null) return;
    deps.stations.reorder(order);
    // The inspector was drawn again: the same button, or at an end the
    // other one.
    const again = (name: string) =>
      inspector.body.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);
    const same = again(way);
    (same !== null && !same.disabled
      ? same
      : again(way === "earlier" ? "later" : "earlier")
    )?.focus();
    const place = inspector.body.querySelector(".sub")?.textContent ?? "";
    said.textContent = place === "" ? "" : `Now ${place.trim()}`;
  };

  /** After the inspector's Delete the focus would fall to the page: it
   *  goes to the tree card that took the deleted station's place (the one
   *  before it at the end), for an item to its station's card, and to the
   *  view when the tree is folded or empty. */
  const deleteSelected = (selected: string) => {
    const stations = manifest()?.stations ?? [];
    const stationId = selected.startsWith(STATION_PREFIX)
      ? selected.slice(STATION_PREFIX.length)
      : (stations.find((s) => s.items.some((i) => i.id === selected))?.id ??
        null);
    const index = stations.findIndex((s) => s.id === stationId);
    deps.stations.remove(selected);
    const picks = [
      ...tree.body.querySelectorAll<HTMLElement>(
        ".card[data-station] > .hero > .pick",
      ),
    ];
    const own = selected.startsWith(STATION_PREFIX)
      ? undefined
      : picks.find(
          (pick) =>
            pick.closest<HTMLElement>(".card")?.dataset["station"] ===
            stationId,
        );
    const target = own ?? picks[Math.min(Math.max(index, 0), picks.length - 1)];
    if (target !== undefined && target.getClientRects().length > 0) {
      target.focus();
    } else {
      viewBox.focus();
    }
  };

  /** The bar's action on the selection. */
  const runBarAction = (action: BarAction) => {
    const ui = state().editorView;
    const selected = ui.selected;
    if (selected === null) return;
    const model = inspectorModel(ui);
    if (action === "duplicate") {
      deps.stations.duplicate(selected);
      return;
    }
    if (action === "copy") {
      const text = positionText(model);
      if (text === null) return;
      // A browser without the clipboard, or one that refuses it, still
      // shows the text to copy by hand.
      const copied =
        typeof navigator.clipboard?.writeText === "function"
          ? navigator.clipboard.writeText(text)
          : Promise.reject(new Error("no clipboard"));
      copied.then(
        () => {
          deps.say(`Position copied: ${text}`);
        },
        () => {
          deps.say(`Copying was blocked - the position: ${text}`);
        },
      );
      return;
    }
    if (model?.kind !== "item") return;
    if (model.headingDeg === null) {
      deps.say(`${model.title} has no heading to turn`);
      return;
    }
    const off = signedDeg(model.headingDeg);
    if (Math.abs(off) < ALIGNED_DEG) {
      deps.say(`${model.title} already faces the way its station faces`);
      return;
    }
    view?.turn(selected, -off);
    // Said only once the tour carries it (a refusal is the page's to say).
    const after = inspectorModel(state().editorView);
    if (
      after?.kind === "item" &&
      after.headingDeg !== null &&
      Math.abs(signedDeg(after.headingDeg)) < ALIGNED_DEG
    ) {
      deps.say(`Turned ${model.title} to face the way its station faces`);
    }
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
  tree.add.addEventListener("click", () => {
    if (view !== null) deps.stations.add(view.centre(), "centre");
  });
  createTreeDrag({
    body: tree.body,
    reorder: (order) => {
      deps.stations.reorder(order);
    },
  });
  bar.acts.addEventListener("click", (event) => {
    const action = (event.target as Element).closest<HTMLElement>("[data-bar]")
      ?.dataset["bar"];
    if (action === "duplicate" || action === "align" || action === "copy") {
      runBarAction(action);
    }
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
    const { selected } = state().editorView;
    if (selected === null) return;
    if (act === "earlier" || act === "later") moveSelected(selected, act);
    if (act === "delete") deleteSelected(selected);
    if (act === "split") deps.stations.split(selected);
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
    // An open menu is the newest popover: Escape closes it first (the
    // focus back on its button), whether the focus is in it or has left
    // it, even with the help open; the help goes on the next Escape.
    if (event.key === "Escape" && closeOpenMenu()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (
      event.key === "Escape" &&
      helpBox.classList.contains("show") &&
      !insideMenu(event.target)
    ) {
      // Esc closes the help first, as a popover; the next deselects. On a
      // closed menu's button too (where an Escape just closed its menu).
      event.stopImmediatePropagation();
      showHelp(false);
      return;
    }
    // Every other key in a menu is the menu's, and on a menu's button the
    // keys that open or move in it (`key-target.ts`).
    if (inMenu(event.target, event.key)) return;
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
      ground.close();
      // Emptied before the pictures go: a later draw of the same selection
      // would otherwise be skipped and keep a card picture let go here.
      drawInspector(
        inspector,
        null,
        { folded: false, positionOpen: false },
        pictures,
      );
      pictures.clear();
      drawn = null;
    },
    groundMenu(point, place) {
      if (view === null) return;
      ground.openAt(point, place);
    },
  };
}
