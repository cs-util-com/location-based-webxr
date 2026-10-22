/**
 * Why these tests matter: the view switch's three fields can only be in a
 * few combinations - the 3D view shown means no load and no failure, and a
 * failure is named exactly when the last load failed. A reducer that lets
 * them drift shows "Loading 3D view…" over the 3D view, or an error with no
 * reason. Any run of the switch's actions, in any order, must keep them.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  editorViewActions as act,
  editorViewReducer as reduce,
  initialEditorViewState,
  type EditorViewState,
} from "./editor-view.js";

const actions = fc.constantFrom(
  act.view3dRequested(),
  act.view3dShown(),
  act.view2dRequested(),
  act.view3dFailed({ reason: "chunk" }),
  act.view3dFailed({ reason: "webgl" }),
  act.view3dFailed({ reason: "context-lost" }),
  act.view3dFailed({ reason: "empty" }),
  act.selected({ id: "a" }),
);

function consistent(state: EditorViewState): boolean {
  const shown = state.viewMode === "3d";
  const failed = state.view3dLoad === "failed";
  return (
    (!shown || (state.view3dLoad === "idle" && state.view3dFailure === null)) &&
    failed === (state.view3dFailure !== null)
  );
}

describe("the view switch's state, for any run of its actions", () => {
  it("keeps the shown view, the load and the failure consistent", () => {
    fc.assert(
      fc.property(fc.array(actions, { maxLength: 40 }), (run) => {
        let state = initialEditorViewState;
        for (const action of run) {
          state = reduce(state, action);
          expect(consistent(state)).toBe(true);
        }
      }),
    );
  });

  it("never changes the selection", () => {
    fc.assert(
      fc.property(
        fc.array(actions.filter((a) => a.type !== act.selected.type)),
        (run) => {
          const start = reduce(
            initialEditorViewState,
            act.selected({ id: "s" }),
          );
          expect(run.reduce(reduce, start).selected).toBe("s");
        },
      ),
    );
  });
});
