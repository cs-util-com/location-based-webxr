/**
 * Why these tests matter: the desktop page's chrome state moved from
 * module variables into the store, so every view of the page reads one
 * copy. A setter that drops or mangles a field silently changes the 2D
 * page's subtle states - above all the drag guard: a drop recorded for a
 * marker no longer dragged (a stale map event) must not resurrect the
 * drag, and a spot nobody can draw must not become the drop a commit
 * moves the item to.
 */

import { describe, expect, it } from "vitest";
import {
  editorViewActions as act,
  editorViewReducer as reduce,
  initialEditorViewState,
  selectEditorView,
} from "./editor-view.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { tourDocumentReducer } from "../tour-document.js";

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
