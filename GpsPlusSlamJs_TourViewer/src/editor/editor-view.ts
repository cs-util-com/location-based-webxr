/**
 * The desktop editor's page state that is not the tour (`editorView`):
 * which item is selected, whether an edit is in flight, the marker being
 * dragged, the walk's flags, the card's last outcome line, Done's and the
 * file picker's in-progress states, and whether a save waits to be
 * delivered again. The tour itself is `tourDocument`'s; this slice holds
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
