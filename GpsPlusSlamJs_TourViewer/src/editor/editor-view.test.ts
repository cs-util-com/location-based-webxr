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
      viewMode: "2d",
      view3dLoad: "idle",
      view3dFailure: null,
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
