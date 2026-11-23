/**
 * Why these tests matter: the desktop page's chrome state moved from
 * module variables into the store, so every view of the page reads one
 * copy. A setter that drops or mangles a field silently changes what the
 * page shows: each setter must change only what it names.
 */

import { createEmptyTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";
import {
  editorViewActions as act,
  editorViewReducer as reduce,
  initialEditorViewState,
  isEntryIdle,
  isStationLocked,
  pointerDragRuns,
  selectEditorView,
} from "./editor-view.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { tourDocumentActions, tourDocumentReducer } from "../tour-document.js";

/** The 3D view's shell at the start: every station folded, every section
 *  open, both docks unfolded, every layer shown, no rows picked, every
 *  plain folder open. */
const SHELL_START = {
  gesture: null,
  openStations: [],
  openSections: { stations: true, codes: true, layers: true },
  foldedDocks: { tree: false, inspector: false },
  hiddenLayers: [],
  unlockedStations: [],
  modelFocus: null,
  modelPick: null,
  pointPick: false,
  picked: [],
  selectMode: false,
  foldedFolders: [],
  clipboard: null,
};

// Why: the 3D inspector's note or section in focus, and the click on the
// model the 3D view waits for, belong to the selected model. Kept across
// another selection, a click on the next model would add a note to it, or
// a stale index would mark another model's note.
describe("editorView model focus and pick", () => {
  it("keeps a focus and a pick for the selection, and clears them with it", () => {
    let state = reduce(initialEditorViewState, act.selected({ id: "m" }));
    state = reduce(
      state,
      act.modelFocused({ focus: { part: "note", index: 2 } }),
    );
    state = reduce(state, act.modelPickAsked({ pick: { what: "note-add" } }));
    expect(state.modelFocus).toEqual({ part: "note", index: 2 });
    expect(state.modelPick).toEqual({ what: "note-add" });
    // The same selection again keeps them.
    state = reduce(state, act.selected({ id: "m" }));
    expect(state.modelPick).toEqual({ what: "note-add" });
    state = reduce(state, act.selected({ id: "other" }));
    expect(state.modelFocus).toBeNull();
    expect(state.modelPick).toBeNull();
  });

  it("refuses a focus or a pick that is none", () => {
    const bad = [
      { part: "pin", index: 0 },
      { part: "note", index: -1 },
      { part: "note", index: 0.5 },
    ];
    for (const focus of bad) {
      expect(
        reduce(initialEditorViewState, act.modelFocused({ focus } as never))
          .modelFocus,
      ).toBeNull();
    }
    for (const pick of [
      { what: "spin" },
      { what: "note-place" },
      { what: "section-place", index: -2 },
    ]) {
      expect(
        reduce(initialEditorViewState, act.modelPickAsked({ pick } as never))
          .modelPick,
      ).toBeNull();
    }
    expect(
      reduce(
        initialEditorViewState,
        act.modelPickAsked({ pick: { what: "section-place", index: 1 } }),
      ).modelPick,
    ).toEqual({ what: "section-place", index: 1 });
  });

  it("clears both when another tour opens", () => {
    let state = reduce(initialEditorViewState, act.selected({ id: "m" }));
    state = reduce(
      state,
      act.modelPickAsked({ pick: { what: "section-add" } }),
    );
    state = reduce(state, tourDocumentActions.closed());
    expect(state.modelPick).toBeNull();
  });
});

// Why: "Pick in 3D" arms the next click of the 3D view to set where the
// selected short text points. Kept across another selection, that click
// would move another sign's point; kept into another tour, a stray click
// there would write one.
describe("editorView point pick", () => {
  it("arms and disarms, and is dropped with the selection, a picking and another tour", () => {
    let state = reduce(initialEditorViewState, act.selected({ id: "t" }));
    expect(state.pointPick).toBe(false);
    state = reduce(state, act.pointPickAsked({ on: true }));
    expect(state.pointPick).toBe(true);
    state = reduce(state, act.selected({ id: "t" }));
    expect(state.pointPick).toBe(true);
    state = reduce(state, act.pointPickAsked({ on: "yes" } as never));
    expect(state.pointPick).toBe(true);
    state = reduce(state, act.pointPickAsked({ on: false }));
    expect(state.pointPick).toBe(false);
    state = reduce(state, act.pointPickAsked({ on: true }));
    state = reduce(state, act.selected({ id: "other" }));
    expect(state.pointPick).toBe(false);
    state = reduce(state, act.pointPickAsked({ on: true }));
    state = reduce(state, act.picked({ ids: ["a", "b"] }));
    expect(state.pointPick).toBe(false);
    state = reduce(state, act.selected({ id: "t" }));
    state = reduce(state, act.pointPickAsked({ on: true }));
    state = reduce(state, tourDocumentActions.closed());
    expect(state.pointPick).toBe(false);
  });
});

describe("editorView", () => {
  it("starts with nothing selected, nothing in flight and no walk", () => {
    expect(initialEditorViewState).toEqual({
      selected: null,
      openStories: [],
      busy: false,
      keepsWalk: false,
      openedWalk: false,
      doneBusy: false,
      undelivered: false,
      picking: false,
      entryStep: null,
      duplicating: false,
      view3dShown: false,
      view3dLoad: "idle",
      view3dFailure: null,
      ...SHELL_START,
    });
  });

  it("sets each flag on its own, leaving the others as they are", () => {
    let state = reduce(initialEditorViewState, act.selected({ id: "x" }));
    state = reduce(state, act.busyChanged({ busy: true }));
    state = reduce(state, act.walkChanged({ keepsWalk: true }));
    state = reduce(state, act.walkChanged({ openedWalk: true }));
    state = reduce(state, act.doneBusyChanged({ busy: true }));
    state = reduce(state, act.undeliveredChanged({ waits: true }));
    state = reduce(state, act.pickingChanged({ picking: true }));
    state = reduce(state, act.duplicatingChanged({ duplicating: true }));
    expect(state).toEqual({
      selected: "x",
      openStories: [],
      busy: true,
      keepsWalk: true,
      openedWalk: true,
      doneBusy: true,
      undelivered: true,
      picking: true,
      entryStep: null,
      duplicating: true,
      view3dShown: false,
      view3dLoad: "idle",
      view3dFailure: null,
      ...SHELL_START,
    });
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

describe("the 3D view's load state", () => {
  // Why: the 3D view loads in three async ways (its chunk, its ground,
  // WebGL), and the page must show each state the CLAUDE.md async-UI
  // rule asks for: loading while it loads, then the 3D view, or its
  // cannot-open page with why. A late answer of a load already left (the
  // tour closed, another opening) must not bring the view back.
  it("goes from loading to the 3D view and closes again", () => {
    let state = reduce(initialEditorViewState, act.view3dRequested());
    expect(state).toMatchObject({
      view3dShown: false,
      view3dLoad: "loading",
      view3dFailure: null,
    });
    state = reduce(state, act.view3dShown());
    expect(state).toMatchObject({ view3dShown: true, view3dLoad: "idle" });
    state = reduce(state, act.view3dClosed());
    expect(state).toMatchObject({
      view3dShown: false,
      view3dLoad: "idle",
      view3dFailure: null,
    });
  });

  it("ends with the reason when the load fails", () => {
    for (const reason of ["chunk", "webgl", "error"] as const) {
      const state = [
        act.view3dRequested(),
        act.view3dFailed({ reason }),
      ].reduce(reduce, initialEditorViewState);
      expect(state).toMatchObject({
        view3dShown: false,
        view3dLoad: "failed",
        view3dFailure: reason,
      });
    }
  });

  it("ends with the reason when the shown 3D view loses its context", () => {
    const state = [
      act.view3dRequested(),
      act.view3dShown(),
      act.view3dFailed({ reason: "context-lost" }),
    ].reduce(reduce, initialEditorViewState);
    expect(state).toMatchObject({
      view3dShown: false,
      view3dLoad: "failed",
      view3dFailure: "context-lost",
    });
  });

  it("ignores a load's late answer once it was left", () => {
    const left = [act.view3dRequested(), act.view3dClosed()].reduce(
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

  it("keeps the selection and every other field through opens and closes", () => {
    const before = reduce(initialEditorViewState, act.selected({ id: "s" }));
    const after = [
      act.view3dRequested(),
      act.view3dShown(),
      act.view3dFailed({ reason: "context-lost" }),
      act.view3dRequested(),
      act.view3dShown(),
      act.view3dClosed(),
    ].reduce(reduce, before);
    expect(after).toEqual(before);
  });
});

describe("the 3D view's shell state", () => {
  // Why: the tree's folds, the docks and the layers are the
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

  it("sets a section, a dock and a layer each on its own", () => {
    let state = reduce(
      initialEditorViewState,
      act.sectionFolded({ section: "codes", open: false }),
    );
    state = reduce(state, act.dockFolded({ dock: "tree", folded: true }));
    state = reduce(state, act.layerShown({ layer: "names", shown: false }));
    state = reduce(state, act.layerShown({ layer: "names", shown: false }));
    expect(state).toEqual({
      ...initialEditorViewState,
      openSections: { stations: true, codes: false, layers: true },
      foldedDocks: { tree: true, inspector: false },
      hiddenLayers: ["names"],
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
  it("ignores a fold, a dock or a layer that is not a boolean", () => {
    const unread = [
      act.stationFolded({ id: "a", open: "yes" as never }),
      act.sectionFolded({ section: "codes", open: undefined as never }),
      act.dockFolded({ dock: "tree", folded: 1 as never }),
      act.layerShown({ layer: "names", shown: null as never }),
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

  it("keeps the shell's state through an open, a close and a selection", () => {
    const before = [
      act.stationFolded({ id: "a", open: true }),
      act.dockFolded({ dock: "inspector", folded: true }),
      act.layerShown({ layer: "codes", shown: false }),
    ].reduce(reduce, initialEditorViewState);
    const after = [
      act.view3dRequested(),
      act.view3dShown(),
      act.selected({ id: "station:a" }),
      act.view3dClosed(),
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

// Why: during a drag of the gizmo the shell's camera keys (T, F, Home)
// would fly the camera under the pointer and move the object with it; a
// key hold is no drag, and those keys stay the shell's then.
describe("pointerDragRuns", () => {
  it("is true only while a handle of the gizmo is dragged", () => {
    expect(pointerDragRuns(initialEditorViewState)).toBe(false);
    for (const handle of ["move", "turn", "dot", "point"] as const) {
      expect(
        pointerDragRuns(
          reduce(
            initialEditorViewState,
            act.gestureStarted({ id: "a", handle }),
          ),
        ),
      ).toBe(true);
    }
    expect(
      pointerDragRuns(
        reduce(
          initialEditorViewState,
          act.gestureStarted({ id: "a", handle: "key" }),
        ),
      ),
    ).toBe(false);
  });
});

// Why: a station's pose places every item in it, so every station opens
// locked and only the creator's own unlock opens it to a move; the lock
// is view state of the open tour - another open must not inherit an
// unlock the creator gave a station of the tour before.
describe("the station lock", () => {
  it("locks every station until it is unlocked, and locks it again", () => {
    expect(isStationLocked(initialEditorViewState, "a")).toBe(true);
    const open = reduce(
      initialEditorViewState,
      act.stationLocked({ id: "a", locked: false }),
    );
    expect(isStationLocked(open, "a")).toBe(false);
    expect(isStationLocked(open, "b")).toBe(true);
    // Unlocked twice: listed once.
    const twice = reduce(open, act.stationLocked({ id: "a", locked: false }));
    expect(twice.unlockedStations).toEqual(["a"]);
    const again = reduce(twice, act.stationLocked({ id: "a", locked: true }));
    expect(isStationLocked(again, "a")).toBe(true);
    expect(again.unlockedStations).toEqual([]);
  });

  it("ignores an unlock without an id or a flag", () => {
    for (const payload of [
      { id: "", locked: false },
      { id: 3 as unknown as string, locked: false },
      { id: "a", locked: "no" as unknown as boolean },
    ]) {
      expect(
        reduce(initialEditorViewState, act.stationLocked(payload)),
      ).toEqual(initialEditorViewState);
    }
  });

  it("locks every station again when another tour opens, or the tour closes", () => {
    let state = reduce(
      initialEditorViewState,
      act.stationLocked({ id: "a", locked: false }),
    );
    state = reduce(
      state,
      tourDocumentActions.opened({ manifest: createEmptyTourManifest() }),
    );
    expect(isStationLocked(state, "a")).toBe(true);
    state = reduce(state, act.stationLocked({ id: "a", locked: false }));
    state = reduce(state, tourDocumentActions.closed());
    expect(isStationLocked(state, "a")).toBe(true);
  });
});

// Why: the tree's several-row selection lives beside the one selection the
// inspector and the 3D view follow. A plain selection (a 3D click, a plain
// row click) must end the picking, or Group would act on rows the creator
// no longer sees picked; and a new tour starts with none picked.
describe("editorView - the tree's picked rows", () => {
  it("picks rows, the last one selected, dropping repeats and blanks", () => {
    const state = reduce(
      initialEditorViewState,
      act.picked({ ids: ["a", "", "b", "a"] }),
    );
    expect(state.picked).toEqual(["a", "b"]);
    expect(state.selected).toBe("b");
  });

  it("ends the picking on a plain selection, and keeps the selection on none picked", () => {
    let state = reduce(initialEditorViewState, act.picked({ ids: ["a", "b"] }));
    state = reduce(state, act.selected({ id: "c" }));
    expect(state.picked).toEqual([]);
    state = reduce(state, act.picked({ ids: [] }));
    expect(state.selected).toBe("c");
  });

  it("turns the Select mode on and off, and folds plain folders", () => {
    let state = reduce(initialEditorViewState, act.selectModeSet({ on: true }));
    expect(state.selectMode).toBe(true);
    state = reduce(state, act.folderFolded({ id: "f", folded: true }));
    state = reduce(state, act.folderFolded({ id: "f", folded: true }));
    expect(state.foldedFolders).toEqual(["f"]);
    state = reduce(state, act.folderFolded({ id: "f", folded: false }));
    expect(state.foldedFolders).toEqual([]);
  });

  it("forgets the picking, the mode and the folds with another tour", () => {
    let state = reduce(initialEditorViewState, act.picked({ ids: ["a", "b"] }));
    state = reduce(state, act.selectModeSet({ on: true }));
    state = reduce(state, act.folderFolded({ id: "f", folded: true }));
    state = reduce(state, tourDocumentActions.closed());
    expect(state.picked).toEqual([]);
    expect(state.selectMode).toBe(false);
    expect(state.foldedFolders).toEqual([]);
  });
});

// Why: a tour given with a scan is one busy state to the person; the step
// the page shows is the store's, and a stray value must not clear it.
describe("the entry step", () => {
  it("goes opening, then adding the scan, then none, and ignores anything else", () => {
    let state = reduce(
      initialEditorViewState,
      act.entryStepChanged({ step: "opening" }),
    );
    expect(state.entryStep).toBe("opening");
    state = reduce(state, act.entryStepChanged({ step: "adding-scan" }));
    expect(state.entryStep).toBe("adding-scan");
    state = reduce(
      state,
      act.entryStepChanged({ step: "bogus" as unknown as "opening" }),
    );
    expect(state.entryStep).toBe("adding-scan");
    state = reduce(state, act.entryStepChanged({ step: null }));
    expect(state.entryStep).toBeNull();
  });

  // Why: between the open and the add, `busy` is false; a sample or a
  // link opened then would replace the tour the scan is being added to,
  // so every entry asks this, not `busy` alone.
  it("is idle only with nothing opening and no entry between its steps", () => {
    expect(isEntryIdle(initialEditorViewState)).toBe(true);
    const busy = reduce(
      initialEditorViewState,
      act.busyChanged({ busy: true }),
    );
    expect(isEntryIdle(busy)).toBe(false);
    for (const step of ["opening", "adding-scan"] as const) {
      expect(
        isEntryIdle(
          reduce(initialEditorViewState, act.entryStepChanged({ step })),
        ),
      ).toBe(false);
    }
  });
});

// Why: Copy fills the editor's own clipboard, which lives in the store so
// the Edit menu, the keys and every bar read one copy. It holds ids, not
// content (re-checked at the paste), never changes the tour, and belongs
// to the open tour: another tour, or none, starts with it empty.
describe("the editor's clipboard", () => {
  it("holds what Copy copied, in order, dropping repeats and blanks", () => {
    const state = reduce(
      initialEditorViewState,
      act.copied({ ids: ["a", "", "folder:f", "a"] }),
    );
    expect(state.clipboard).toEqual({ mode: "copy", ids: ["a", "folder:f"] });
  });

  it("is emptied by a Copy of nothing and by another tour", () => {
    const full = reduce(initialEditorViewState, act.copied({ ids: ["a"] }));
    expect(reduce(full, act.copied({ ids: [] })).clipboard).toBeNull();
    const manifest = createEmptyTourManifest();
    for (const action of [
      tourDocumentActions.opened({ manifest }),
      tourDocumentActions.closed(),
    ]) {
      expect(reduce(full, action).clipboard).toBeNull();
    }
  });

  // Why: Cut puts ids on the same clipboard, marked as a cut, so Paste
  // moves rather than copies; Escape and a finished move empty it.
  it("holds what Cut cut as a cut, emptied when cleared", () => {
    const cut = reduce(
      initialEditorViewState,
      act.copied({ ids: ["a", "a", "story:s"], mode: "cut" }),
    );
    expect(cut.clipboard).toEqual({ mode: "cut", ids: ["a", "story:s"] });
    expect(reduce(cut, act.clipboardCleared()).clipboard).toBeNull();
    const copy = reduce(cut, act.copied({ ids: ["a"] }));
    expect(copy.clipboard).toEqual({ mode: "copy", ids: ["a"] });
  });

  it("ignores a Copy that carries no list", () => {
    const full = reduce(initialEditorViewState, act.copied({ ids: ["a"] }));
    const bad = act.copied({ ids: "a" as unknown as string[] });
    expect(reduce(full, bad)).toBe(full);
  });

  it("is not the tour: a Copy changes nothing the document holds", () => {
    const store = createTourViewerStore(undefined, { editorView: reduce });
    const before = store.getState().tourDocument;
    store.dispatch(act.copied({ ids: ["a"] }));
    expect(store.getState().tourDocument).toBe(before);
    expect(tourDocumentReducer(before, act.copied({ ids: ["a"] }))).toBe(
      before,
    );
  });
});
