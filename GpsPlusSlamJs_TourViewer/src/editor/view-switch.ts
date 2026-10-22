/**
 * The desktop editor's view switch: one button that opens the 3D view over
 * the map and closes it again (one page, two views; the tour, its edits
 * and the selection are the store's, so neither view owns them).
 *
 * The 3D view is async three ways - its code is a lazy chunk, its ground
 * starts up, WebGL may be missing or lost - so the button shows each
 * state (the CLAUDE.md async-UI rule): "Loading 3D view…" and disabled
 * while it loads, "Map view" while it shows, and back to "3D view" with
 * the reason said when it fails or its context is lost. The state lives in
 * `editorView` (`viewMode`, `view3dLoad`, `view3dFailure`); this module
 * runs the opener, keeps the one view handle and draws the button.
 *
 * It never imports the 3D view: the page hands an `open` that does the
 * dynamic import, so the map page's own code holds no 3D module. A failed
 * open says why by an error's `reason` (`webgl`, `empty`); any other
 * failure is the chunk's.
 *
 * @see view-switch.ts.md
 */

import {
  editorViewActions,
  selectEditorView,
  type EditorViewState,
  type View3dFailure,
} from "./editor-view.js";

/** The button's words in each state. */
export const VIEW_SWITCH_LABELS = Object.freeze({
  idle: "3D view",
  loading: "Loading 3D view…",
  shown: "Map view",
});

const FAILURE_TEXT: Readonly<Record<View3dFailure, string>> = {
  chunk:
    "The 3D view could not be loaded. Check the connection, then try the 3D view again. The map shows the tour.",
  webgl:
    "This browser cannot draw the 3D view: it has no WebGL. The map shows the tour.",
  "context-lost":
    "The 3D view stopped: the browser reset its graphics. The map shows the tour; try the 3D view again.",
  empty:
    "This tour has nothing with a position to show in 3D yet. The map shows the tour.",
};

/** What the page says when the 3D view fails for `reason`. */
export function view3dFailureText(reason: View3dFailure): string {
  return FAILURE_TEXT[reason];
}

const REASONS = new Set<string>(Object.keys(FAILURE_TEXT));

/** The failure an open's error names, or the chunk's. */
function reasonOf(error: unknown): View3dFailure {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" &&
    REASONS.has(reason) &&
    reason !== "context-lost"
    ? (reason as View3dFailure)
    : "chunk";
}

/** The part of a button this module uses (structural, for tests). */
export interface ViewSwitchButton {
  textContent: string | null;
  disabled: boolean;
  readonly dataset: Record<string, string | undefined>;
  addEventListener(type: "click", listener: () => void): void;
}

/** A shown 3D view, as the switch holds it. */
export interface View3dHandle {
  dispose(): void;
}

/** The store, as the switch reads and writes it. */
interface ViewSwitchStore {
  getState(): { readonly editorView: EditorViewState };
  dispatch(
    action: ReturnType<
      | typeof editorViewActions.view3dRequested
      | typeof editorViewActions.view3dShown
      | typeof editorViewActions.view3dFailed
      | typeof editorViewActions.view2dRequested
    >,
  ): unknown;
}

export interface ViewSwitch {
  /** Leave the 3D view or its load (a tour closed or another opening). */
  close(): void;
  /** Off while no tour is open. */
  setEnabled(on: boolean): void;
}

/**
 * The switch on `button`. `open` starts the 3D view (resolves once it drew
 * its first frame) and reports a lost context through `contextLost`; `say`
 * is the page's toast; `onShown` follows the view shown or hidden (the
 * page hides what belongs to the map).
 */
export function createViewSwitch(deps: {
  readonly button: ViewSwitchButton;
  readonly store: ViewSwitchStore;
  readonly open: (events: { contextLost(): void }) => Promise<View3dHandle>;
  readonly say: (text: string) => void;
  readonly onShown?: (on: boolean) => void;
}): ViewSwitch {
  const { button, store } = deps;
  const ui = () => selectEditorView(store.getState());
  let enabled = true;
  let view: View3dHandle | null = null;
  /** Which open is current: a late answer of an older one is dropped. */
  let attempt = 0;

  const render = (): void => {
    const { viewMode, view3dLoad } = ui();
    const state =
      viewMode === "3d" ? "3d" : view3dLoad === "loading" ? "loading" : "2d";
    button.dataset["state"] = state;
    button.textContent =
      state === "3d"
        ? VIEW_SWITCH_LABELS.shown
        : state === "loading"
          ? VIEW_SWITCH_LABELS.loading
          : VIEW_SWITCH_LABELS.idle;
    button.disabled = !enabled || state === "loading";
  };

  /** Leave the 3D view (or its load) with `action`. `onShown` comes
   *  last: the page reads the store there, which must already be on the
   *  map. */
  const leave = (
    action: ReturnType<
      | typeof editorViewActions.view3dFailed
      | typeof editorViewActions.view2dRequested
    >,
  ): void => {
    const was = view;
    view = null;
    was?.dispose();
    store.dispatch(action);
    render();
    if (was !== null) deps.onShown?.(false);
  };

  const open = async (): Promise<void> => {
    store.dispatch(editorViewActions.view3dRequested());
    render();
    const mine = ++attempt;
    let opened: View3dHandle;
    try {
      opened = await deps.open({
        contextLost: () => {
          if (mine !== attempt || view !== opened) return;
          leave(editorViewActions.view3dFailed({ reason: "context-lost" }));
          deps.say(view3dFailureText("context-lost"));
        },
      });
    } catch (error) {
      if (mine !== attempt || ui().view3dLoad !== "loading") return;
      const reason = reasonOf(error);
      store.dispatch(editorViewActions.view3dFailed({ reason }));
      render();
      deps.say(view3dFailureText(reason));
      return;
    }
    if (mine !== attempt || ui().view3dLoad !== "loading") {
      opened.dispose();
      return;
    }
    view = opened;
    store.dispatch(editorViewActions.view3dShown());
    render();
    deps.onShown?.(true);
  };

  button.addEventListener("click", () => {
    if (!enabled) return;
    const { viewMode, view3dLoad } = ui();
    if (view3dLoad === "loading") return;
    if (viewMode === "3d") {
      attempt++;
      leave(editorViewActions.view2dRequested());
      return;
    }
    void open();
  });
  render();

  return {
    close() {
      attempt++;
      leave(editorViewActions.view2dRequested());
    },
    setEnabled(on) {
      enabled = on;
      render();
    },
  };
}
