/**
 * The desktop editor's page state that is not the tour (`editorView`):
 * which item is selected, whether an edit is in flight, the marker being
 * dragged, the walk's flags, the card's last outcome line, Done's and the
 * file picker's in-progress states, whether a save waits to be
 * delivered again, and the view switch: the map or the 3D view, and the
 * 3D view's load and why it last failed, and the 3D view's shell: the
 * tree's folds, the docks' folds, the layers turned off and the debug
 * readout. The tour itself is `tourDocument`'s; this slice holds
 * what the page's chrome reads, so any view of the page (the map page,
 * a 3D view) reads one copy.
 *
 * Mounted only by the desktop page (`edit-main.ts` passes it to
 * `createTourViewerStore`): the phone's store never names it. Not an edit:
 * no history, no draft write. Blobs are never state - a save waiting to be
 * delivered again stays the page's, and this slice holds only that one
 * waits.
 *
 * @see editor-view.ts.md
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** A spot on the map, as a drag drops a marker. */
interface MapSpot {
  readonly lat: number;
  readonly lng: number;
}

/** The marker being dragged, and where it was dropped so far. */
interface EditorMoving {
  readonly id: string;
  readonly drop: MapSpot | null;
}

/** The card's last outcome line, for the item it was said about. */
export interface EditorMessage {
  readonly id: string;
  readonly text: string;
  readonly refused?: true;
}

/** Why the 3D view is not shown: its code did not load (`chunk`), the
 *  browser has no WebGL (`webgl`), the view lost its WebGL context
 *  (`context-lost`), the tour has nothing to place (`empty`), or anything
 *  else went wrong in it (`error`). */
export type View3dFailure =
  "chunk" | "webgl" | "context-lost" | "empty" | "error";

/** The 3D view's tree's sections, each open or folded to its header. */
export type TreeSection = "stations" | "codes" | "layers";
/** The 3D view's two docks: the tree (left) and the inspector (right). */
type ShellDock = "tree" | "inspector";
/** What the 3D view can show or hide. */
export type ShellLayer = "codes" | "names" | "walk" | "depth" | "buildings";

const TREE_SECTIONS: readonly string[] = ["stations", "codes", "layers"];
const SHELL_DOCKS: readonly string[] = ["tree", "inspector"];
const SHELL_LAYERS: readonly string[] = [
  "codes",
  "names",
  "walk",
  "depth",
  "buildings",
];

export interface EditorViewState {
  /** The selected item's id (the model's: `station:<id>` for a station). */
  readonly selected: string | null;
  /** An edit, an open or a save holds the page: the controls wait. */
  readonly busy: boolean;
  readonly moving: EditorMoving | null;
  /** The tour was opened to be saved in place: its saves keep the walk,
   *  even after a refusal turned them into downloads. */
  readonly keepsWalk: boolean;
  /** The opened file carries a walk, and none of it was moved out since. */
  readonly openedWalk: boolean;
  /** Done is saving before it opens its dialog. */
  readonly doneBusy: boolean;
  /** A save the browser did not deliver waits: Save offers it again. */
  readonly undelivered: boolean;
  readonly message: EditorMessage | null;
  /** The browser's file picker is open: a second click opens nothing. */
  readonly picking: boolean;
  /** The view the page shows: the map, or the 3D view. */
  readonly viewMode: "2d" | "3d";
  /** The 3D view's load: none running, loading, or the last one failed.
   *  Never `loading` or `failed` while the 3D view shows. */
  readonly view3dLoad: "idle" | "loading" | "failed";
  /** Why the last load failed, exactly while `view3dLoad` is `failed`. */
  readonly view3dFailure: View3dFailure | null;
  /** The 3D view's tree: the stations it lists the items of (unfolded),
   *  by id, in the order they were unfolded; an id the tour no longer
   *  has is ignored by the tree. */
  readonly openStations: readonly string[];
  /** The tree's sections: open, or folded to their header. */
  readonly openSections: Readonly<Record<TreeSection, boolean>>;
  /** A dock folded to its header. */
  readonly foldedDocks: Readonly<Record<ShellDock, boolean>>;
  /** The layers the creator turned off. */
  readonly hiddenLayers: readonly ShellLayer[];
  /** The bottom bar's debug readout shows. */
  readonly readout: boolean;
}

export const initialEditorViewState: EditorViewState = {
  selected: null,
  busy: false,
  moving: null,
  keepsWalk: false,
  openedWalk: false,
  doneBusy: false,
  undelivered: false,
  message: null,
  picking: false,
  viewMode: "2d",
  view3dLoad: "idle",
  view3dFailure: null,
  openStations: [],
  openSections: { stations: true, codes: true, layers: true },
  foldedDocks: { tree: false, inspector: false },
  hiddenLayers: [],
  readout: false,
};

/** Whether `spot` is a spot a map can draw: finite numbers. */
function isSpot(spot: MapSpot): boolean {
  return Number.isFinite(spot.lat) && Number.isFinite(spot.lng);
}

const editorViewSlice = createSlice({
  name: "editorView",
  initialState: initialEditorViewState,
  reducers: {
    /** An item selected, or none. */
    selected(state, action: PayloadAction<{ id: string | null }>) {
      state.selected = action.payload.id;
    },
    busyChanged(state, action: PayloadAction<{ busy: boolean }>) {
      state.busy = action.payload.busy;
    },
    /** A marker's drag started (`drop` null until it moved). */
    moveStarted(state, action: PayloadAction<{ id: string }>) {
      state.moving = { id: action.payload.id, drop: null };
    },
    /** The dragged marker is over `drop`: kept only for the marker being
     *  dragged, and only for a spot a map can draw. */
    moveDropped(state, action: PayloadAction<{ id: string; drop: MapSpot }>) {
      const { id, drop } = action.payload;
      if (state.moving?.id !== id || !isSpot(drop)) return;
      state.moving = { id, drop: { lat: drop.lat, lng: drop.lng } };
    },
    /** The drag ended: committed or cancelled. */
    moveEnded(state) {
      state.moving = null;
    },
    walkChanged(
      state,
      action: PayloadAction<{ keepsWalk?: boolean; openedWalk?: boolean }>,
    ) {
      const { keepsWalk, openedWalk } = action.payload;
      if (keepsWalk !== undefined) state.keepsWalk = keepsWalk;
      if (openedWalk !== undefined) state.openedWalk = openedWalk;
    },
    doneBusyChanged(state, action: PayloadAction<{ busy: boolean }>) {
      state.doneBusy = action.payload.busy;
    },
    undeliveredChanged(state, action: PayloadAction<{ waits: boolean }>) {
      state.undelivered = action.payload.waits;
    },
    /** The card's outcome line for an item, or none. */
    said(state, action: PayloadAction<{ message: EditorMessage | null }>) {
      state.message = action.payload.message;
    },
    pickingChanged(state, action: PayloadAction<{ picking: boolean }>) {
      state.picking = action.payload.picking;
    },
    /** The 3D view asked for, from the map: its load starts. Asked again
     *  while it loads, or while it shows, nothing changes. */
    view3dRequested(state) {
      if (state.viewMode === "3d" || state.view3dLoad === "loading") return;
      state.view3dLoad = "loading";
      state.view3dFailure = null;
    },
    /** The load ended with the 3D view drawn. Only for a load that runs: a
     *  late answer after the creator went back to the map changes nothing. */
    view3dShown(state) {
      if (state.view3dLoad !== "loading") return;
      state.viewMode = "3d";
      state.view3dLoad = "idle";
    },
    /** The load failed, or the shown view lost its context: the map again,
     *  with why. A late failure of a load already left changes nothing. */
    view3dFailed(state, action: PayloadAction<{ reason: View3dFailure }>) {
      if (state.view3dLoad !== "loading" && state.viewMode !== "3d") return;
      state.viewMode = "2d";
      state.view3dLoad = "failed";
      state.view3dFailure = action.payload.reason;
    },
    /** A station of the tree unfolded (its items listed) or folded. */
    stationFolded(state, action: PayloadAction<{ id: string; open: boolean }>) {
      const { id, open } = action.payload;
      if (typeof id !== "string" || id === "") return;
      const at = state.openStations.indexOf(id);
      if (open && at < 0) state.openStations.push(id);
      if (!open && at >= 0) state.openStations.splice(at, 1);
    },
    sectionFolded(
      state,
      action: PayloadAction<{ section: TreeSection; open: boolean }>,
    ) {
      const { section, open } = action.payload;
      if (TREE_SECTIONS.includes(section)) state.openSections[section] = open;
    },
    dockFolded(
      state,
      action: PayloadAction<{ dock: ShellDock; folded: boolean }>,
    ) {
      const { dock, folded } = action.payload;
      if (SHELL_DOCKS.includes(dock)) state.foldedDocks[dock] = folded;
    },
    layerShown(
      state,
      action: PayloadAction<{ layer: ShellLayer; shown: boolean }>,
    ) {
      const { layer, shown } = action.payload;
      if (!SHELL_LAYERS.includes(layer)) return;
      const hidden = state.hiddenLayers.filter((l) => l !== layer);
      if (!shown) hidden.push(layer);
      state.hiddenLayers = hidden;
    },
    readoutShown(state, action: PayloadAction<{ shown: boolean }>) {
      state.readout = action.payload.shown;
    },
    /** The map asked for (or the tour closed): any load is left, and the
     *  last failure is forgotten. */
    view2dRequested(state) {
      state.viewMode = "2d";
      state.view3dLoad = "idle";
      state.view3dFailure = null;
    },
  },
});

export const editorViewActions = editorViewSlice.actions;
export const editorViewReducer = editorViewSlice.reducer;

/** The slice in a store's state. */
export function selectEditorView(root: {
  readonly editorView: EditorViewState;
}): EditorViewState {
  return root.editorView;
}
