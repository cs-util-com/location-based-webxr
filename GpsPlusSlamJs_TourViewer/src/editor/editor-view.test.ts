/**
 * Why these tests matter: the desktop page's chrome state moved from
 * module variables into the store, so every view of the page reads one
 * copy. A setter that drops or mangles a field silently changes the 2D
 * page's subtle states - above all the drag guard: a drop recorded for a
 * marker no longer dragged (a stale map event) must not resurrect the
 * drag, and a spot nobody can draw must not become the drop a commit
 * moves the item to.
 */

import { createEmptyTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";
import {
  editorViewActions as act,
  editorViewReducer as reduce,
  initialEditorViewState,
  selectEditorView,
} from "./editor-view.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { tourDocumentActions, tourDocumentReducer } from "../tour-document.js";

/** The 3D view's shell at the start: every station folded, every section
 *  open, both docks unfolded, every layer shown, no debug readout. */
const SHELL_START = {
  gesture: null,
  openStations: [],
  openSections: { stations: true, codes: true, layers: true },
  foldedDocks: { tree: false, inspector: false },
  hiddenLayers: [],
  readout: false,
};

describe("editorView", () => {
  it("starts with nothing selected, nothing in flight and no walk", () => {
    expect(initialEditorViewState).toEqual({
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
      ...SHELL_START,
    });
  });

  it("keeps a drop only for the marker being dragged, and only a drawable spot", () => {
    let state = reduce(initialEditorViewState, act.moveStarted({ id: "a" }));
    expect(state.moving).toEqual({ id: "a", drop: null });
    state = reduce(
      state,
      act.moveDropped({ id: "a", drop: { lat: 1, lng: 2 } }),
    );
    expect(state.moving).toEqual({ id: "a", drop: { lat: 1, lng: 2 } });
    // Another marker's late event, and spots nobody can draw: ignored.
    const after = [
      act.moveDropped({ id: "b", drop: { lat: 3, lng: 4 } }),
      act.moveDropped({ id: "a", drop: { lat: Number.NaN, lng: 4 } }),
      act.moveDropped({ id: "a", drop: { lat: 3, lng: Infinity } }),
    ].reduce(reduce, state);
    expect(after.moving).toEqual({ id: "a", drop: { lat: 1, lng: 2 } });
    const ended = reduce(after, act.moveEnded());
    expect(ended.moving).toBeNull();
    // A drop after the drag ended starts nothing.
    expect(
      reduce(ended, act.moveDropped({ id: "a", drop: { lat: 1, lng: 2 } }))
        .moving,
    ).toBeNull();
  });

  it("sets each flag on its own, leaving the others as they are", () => {
    let state = reduce(initialEditorViewState, act.selected({ id: "x" }));
    state = reduce(
      state,
      act.said({ message: { id: "x", text: "No.", refused: true } }),
    );
    state = reduce(state, act.busyChanged({ busy: true }));
    state = reduce(state, act.walkChanged({ keepsWalk: true }));
    state = reduce(state, act.walkChanged({ openedWalk: true }));
    state = reduce(state, act.doneBusyChanged({ busy: true }));
    state = reduce(state, act.undeliveredChanged({ waits: true }));
    state = reduce(state, act.pickingChanged({ picking: true }));
    expect(state).toEqual({
      selected: "x",
      busy: true,
      moving: null,
      keepsWalk: true,
      openedWalk: true,
      doneBusy: true,
      undelivered: true,
      message: { id: "x", text: "No.", refused: true },
      picking: true,
      viewMode: "2d",
      view3dLoad: "idle",
      view3dFailure: null,
      ...SHELL_START,
    });
    // Selecting another item keeps the line: the page clears it itself.
    expect(reduce(state, act.selected({ id: null })).message).toEqual(
      state.message,
    );
  });
});

describe("createTourViewerStore with extra reducers", () => {
  // Why: the desktop page mounts its own slice beside the shared ones; the
  // phone's store never names it. A key that collides with one of the
  // store's own slices would silently replace the tour document.
  it("mounts the page's slice beside the shared ones", () => {
    const store = createTourViewerStore(undefined, { editorView: reduce });
    expect(selectEditorView(store.getState())).toEqual(initialEditorViewState);
    store.dispatch(act.selected({ id: "a" }));
    expect(store.getState().editorView.selected).toBe("a");
    expect(store.getState().tourDocument.written).toBeNull();
  });

  it("refuses a key one of its own slices has", () => {
    expect(() =>
      createTourViewerStore(undefined, { tourDocument: tourDocumentReducer }),
    ).toThrow(/tourDocument/);
  });

  it("the phone's store carries no editor slice", () => {
    expect("editorView" in createTourViewerStore().getState()).toBe(false);
  });
});

describe("the view switch's state", () => {
  // Why: the 3D view loads in three async ways (its chunk, its ground,
  // WebGL), and the switch must show each state the CLAUDE.md async-UI
  // rule asks for: loading while it loads, then the 3D view, or the map
  // again with why. A late answer of a load the creator already left (a
  // tour opened, the map asked for) must not throw the page into 3D.
  it("goes from the map to loading to the 3D view and back", () => {
    let state = reduce(initialEditorViewState, act.view3dRequested());
    expect(state).toMatchObject({
      viewMode: "2d",
      view3dLoad: "loading",
      view3dFailure: null,
    });
    state = reduce(state, act.view3dShown());
    expect(state).toMatchObject({ viewMode: "3d", view3dLoad: "idle" });
    state = reduce(state, act.view2dRequested());
    expect(state).toMatchObject({
      viewMode: "2d",
      view3dLoad: "idle",
      view3dFailure: null,
    });
  });

  it("lands on the map with the reason when the load fails", () => {
    for (const reason of ["chunk", "webgl", "empty"] as const) {
      const state = [
        act.view3dRequested(),
        act.view3dFailed({ reason }),
      ].reduce(reduce, initialEditorViewState);
      expect(state).toMatchObject({
        viewMode: "2d",
        view3dLoad: "failed",
        view3dFailure: reason,
      });
    }
  });

  it("falls back to the map when the 3D view loses its context", () => {
    const state = [
      act.view3dRequested(),
      act.view3dShown(),
      act.view3dFailed({ reason: "context-lost" }),
    ].reduce(reduce, initialEditorViewState);
    expect(state).toMatchObject({
      viewMode: "2d",
      view3dLoad: "failed",
      view3dFailure: "context-lost",
    });
  });

  it("ignores a load's late answer once the creator left it", () => {
    const left = [act.view3dRequested(), act.view2dRequested()].reduce(
      reduce,
      initialEditorViewState,
    );
    expect(reduce(left, act.view3dShown())).toEqual(left);
    expect(reduce(left, act.view3dFailed({ reason: "chunk" }))).toEqual(left);
    // Shown with no load running, or asked again while it loads: nothing.
    expect(reduce(initialEditorViewState, act.view3dShown())).toEqual(
      initialEditorViewState,
    );
    const loading = reduce(initialEditorViewState, act.view3dRequested());
    expect(reduce(loading, act.view3dRequested())).toEqual(loading);
  });

  it("keeps the selection and every other field through the switch", () => {
    const before = reduce(initialEditorViewState, act.selected({ id: "s" }));
    const after = [
      act.view3dRequested(),
      act.view3dShown(),
      act.view3dFailed({ reason: "context-lost" }),
      act.view3dRequested(),
      act.view3dShown(),
      act.view2dRequested(),
    ].reduce(reduce, before);
    expect(after).toEqual(before);
  });
});

describe("the 3D view's shell state", () => {
  // Why: the tree's folds, the docks, the layers and the readout are the
  // page's chrome, read by every view of the page from one copy. Each
  // setter must change only what it names, a second unfold must not list
  // a station twice, and an id or a name nobody has must change nothing,
  // so a stale click cannot leave the state in a shape the tree cannot
  // draw back.
  it("unfolds a station once and folds it again", () => {
    let state = reduce(
      initialEditorViewState,
      act.stationFolded({ id: "a", open: true }),
    );
    state = reduce(state, act.stationFolded({ id: "b", open: true }));
    state = reduce(state, act.stationFolded({ id: "a", open: true }));
    expect(state.openStations).toEqual(["a", "b"]);
    state = reduce(state, act.stationFolded({ id: "a", open: false }));
    expect(state.openStations).toEqual(["b"]);
    // Folding a station that is not open, or an empty id: nothing.
    expect(reduce(state, act.stationFolded({ id: "z", open: false }))).toBe(
      state,
    );
    expect(reduce(state, act.stationFolded({ id: "", open: true }))).toBe(
      state,
    );
  });

  it("sets a section, a dock, a layer and the readout each on its own", () => {
    let state = reduce(
      initialEditorViewState,
      act.sectionFolded({ section: "codes", open: false }),
    );
    state = reduce(state, act.dockFolded({ dock: "tree", folded: true }));
    state = reduce(state, act.layerShown({ layer: "names", shown: false }));
    state = reduce(state, act.layerShown({ layer: "names", shown: false }));
    state = reduce(state, act.readoutShown({ shown: true }));
    expect(state).toEqual({
      ...initialEditorViewState,
      openSections: { stations: true, codes: false, layers: true },
      foldedDocks: { tree: true, inspector: false },
      hiddenLayers: ["names"],
      readout: true,
    });
    state = reduce(state, act.layerShown({ layer: "names", shown: true }));
    expect(state.hiddenLayers).toEqual([]);
  });

  it("ignores a section, a dock or a layer it does not know", () => {
    const unknown = [
      act.sectionFolded({ section: "x" as never, open: false }),
      act.dockFolded({ dock: "x" as never, folded: true }),
      act.layerShown({ layer: "x" as never, shown: false }),
    ];
    expect(unknown.reduce(reduce, initialEditorViewState)).toEqual(
      initialEditorViewState,
    );
  });

  // Why: a payload from a stale or malformed dispatch must not
  // write a value the shell would read as a fold or a layer state.
  it("ignores a fold, a dock, a layer or a readout that is not a boolean", () => {
    const unread = [
      act.stationFolded({ id: "a", open: "yes" as never }),
      act.sectionFolded({ section: "codes", open: undefined as never }),
      act.dockFolded({ dock: "tree", folded: 1 as never }),
      act.layerShown({ layer: "names", shown: null as never }),
      act.readoutShown({ shown: "true" as never }),
    ];
    expect(unread.reduce(reduce, initialEditorViewState)).toEqual(
      initialEditorViewState,
    );
  });

  // Why: the unfolded stations are ids of the open tour; another
  // tour may reuse an id, and must open with every station folded.
  it("folds every station when another tour opens, or the tour closes", () => {
    const open = reduce(
      initialEditorViewState,
      act.stationFolded({ id: "a", open: true }),
    );
    const another = reduce(
      open,
      tourDocumentActions.opened({ manifest: createEmptyTourManifest() }),
    );
    expect(another.openStations).toEqual([]);
    expect(reduce(open, tourDocumentActions.closed()).openStations).toEqual([]);
  });

  it("keeps the shell's state through the view switch and a selection", () => {
    const before = [
      act.stationFolded({ id: "a", open: true }),
      act.dockFolded({ dock: "inspector", folded: true }),
      act.layerShown({ layer: "codes", shown: false }),
    ].reduce(reduce, initialEditorViewState);
    const after = [
      act.view3dRequested(),
      act.view3dShown(),
      act.selected({ id: "station:a" }),
      act.view2dRequested(),
      act.selected({ id: null }),
    ].reduce(reduce, before);
    expect(after).toEqual(before);
  });
});

describe("the 3D view's gesture", () => {
  // Why: the 3D view tells the store only that a drag (or a held key)
  // started and that it ended - committed or cancelled - never where the
  // object is mid-gesture. The page reads the flag to hold its autosave
  // and to end a gesture before an undo; a malformed start must not leave
  // the page believing an edit is in flight forever.
  it("starts for an id with its handle, and ends", () => {
    const started = reduce(
      initialEditorViewState,
      act.gestureStarted({ id: "pin-1", handle: "move" }),
    );
    expect(started.gesture).toEqual({ id: "pin-1", handle: "move" });
    expect(reduce(started, act.gestureEnded()).gesture).toBeNull();
  });

  it("ignores a start without an id or with a handle it does not know", () => {
    for (const bad of [
      { id: "", handle: "move" },
      { id: "a", handle: "fly" },
      { id: 3, handle: "turn" },
    ]) {
      expect(
        reduce(
          initialEditorViewState,
          act.gestureStarted(bad as { id: string; handle: "move" }),
        ).gesture,
      ).toBeNull();
    }
  });

  it("ends any gesture when another tour opens", () => {
    const started = reduce(
      initialEditorViewState,
      act.gestureStarted({ id: "a", handle: "key" }),
    );
    expect(
      reduce(
        started,
        tourDocumentActions.opened({ manifest: createEmptyTourManifest() }),
      ).gesture,
    ).toBeNull();
  });
});
