/**
 * The desktop editor's 3D view opener: the page opens the 3D view, the
 * editor itself, when a tour opens (and again from its cannot-open page's
 * Try again), and closes it when the tour goes or another opens.
 *
 * The 3D view is async three ways - its code is a lazy chunk, its ground
 * starts up, WebGL may be missing or lost - so the load is said in a
 * status line (`status`, "Loading 3D view…") until it ends (the CLAUDE.md
 * async-UI rule), and a failure ends on a page of its own
 * (`view3d-failed-page.ts`; the words are `view3dFailureText`'s). The
 * state lives in `editorView` (`view3dShown`, `view3dLoad`,
 * `view3dFailure`); this module runs the opener and keeps the one view
 * handle.
 *
 * It never imports the 3D view: the page hands an `open` that does the
 * dynamic import, so the page's own code holds no 3D module. A failed
 * open says why by an error's `reason` (`webgl`, `chunk`); any other
 * failure is `error`.
 *
 * @see view3d-opener.ts.md
 */

import {
  editorViewActions,
  selectEditorView,
  type EditorViewState,
  type View3dFailure,
} from "./editor-view.js";

/** The status line's words while the 3D view loads. */
export const VIEW3D_LOADING = "Loading 3D view…";

const FAILURE_TEXT: Readonly<Record<View3dFailure, string>> = {
  chunk: "The 3D view could not be loaded. Reload the page to load it again.",
  webgl:
    "This browser cannot draw the 3D view: it has no WebGL. Open the editor in a browser with WebGL turned on.",
  "context-lost":
    "The 3D view stopped: the browser reset its graphics. Try again.",
  error: "The 3D view stopped on an error. Try again.",
};

/** What the page says when the 3D view fails for `reason`. */
export function view3dFailureText(reason: View3dFailure): string {
  return FAILURE_TEXT[reason];
}

const REASONS = new Set<string>(Object.keys(FAILURE_TEXT));

/** The failure an open's error names (its `reason`), or `error`. */
function reasonOf(error: unknown): View3dFailure {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" && REASONS.has(reason)
    ? (reason as View3dFailure)
    : "error";
}

/** The status line that says a load while it runs (structural). */
export interface View3dStatus {
  textContent: string | null;
  // As the DOM types it (`HTMLElement.hidden`); this module writes booleans.
  hidden: boolean | "until-found";
}

/** What the 3D view reports once it is asked for: its WebGL context lost,
 *  or an error that stopped its drawing (while it loads or once shown). */
export interface View3dEvents {
  contextLost(): void;
  failed(): void;
}

/** A shown 3D view, as the opener holds it. */
export interface View3dHandle {
  dispose(): void;
}

/** The store, as the opener reads and writes it. */
interface View3dStore {
  getState(): { readonly editorView: EditorViewState };
  dispatch(
    action: ReturnType<
      | typeof editorViewActions.view3dRequested
      | typeof editorViewActions.view3dShown
      | typeof editorViewActions.view3dFailed
      | typeof editorViewActions.view3dClosed
    >,
  ): unknown;
}

export interface View3dOpener {
  /** Open the 3D view; nothing while it loads or shows. */
  open(): void;
  /** Leave the 3D view or its load (a tour closed or another opening). */
  close(): void;
}

/**
 * The opener (its load said in `status`). `open` starts the 3D view
 * (resolves once it drew its first frame) and reports a lost context or
 * an error through its events; `onShown` follows the view shown or left,
 * called last, with the store already in the state it announces.
 */
export function createView3dOpener(deps: {
  readonly status: View3dStatus;
  readonly store: View3dStore;
  readonly open: (events: View3dEvents) => Promise<View3dHandle>;
  readonly onShown?: (on: boolean) => void;
}): View3dOpener {
  const { status, store } = deps;
  const ui = () => selectEditorView(store.getState());
  let view: View3dHandle | null = null;
  /** Which open is current: a late answer of an older one is dropped. */
  let attempt = 0;

  const render = (): void => {
    const loading = ui().view3dLoad === "loading";
    status.hidden = !loading;
    status.textContent = loading ? VIEW3D_LOADING : "";
  };

  /** Leave the 3D view (or its load) with `action`. */
  const leave = (
    action: ReturnType<
      | typeof editorViewActions.view3dFailed
      | typeof editorViewActions.view3dClosed
    >,
  ): void => {
    const was = view;
    view = null;
    was?.dispose();
    store.dispatch(action);
    render();
    if (was !== null) deps.onShown?.(false);
  };

  const start = async (): Promise<void> => {
    store.dispatch(editorViewActions.view3dRequested());
    render();
    const mine = ++attempt;
    let opened: View3dHandle;
    try {
      // A view that stops, while it loads or once shown, ends on the
      // failure's page; one already left says nothing.
      const stopped = (reason: "context-lost" | "error") => {
        if (mine !== attempt) return;
        const loading = view === null && ui().view3dLoad === "loading";
        if (!loading && view !== opened) return;
        // A view that still arrives for this open is dropped.
        if (loading) attempt++;
        leave(editorViewActions.view3dFailed({ reason }));
      };
      opened = await deps.open({
        contextLost: () => stopped("context-lost"),
        failed: () => stopped("error"),
      });
    } catch (error) {
      if (mine !== attempt || ui().view3dLoad !== "loading") return;
      store.dispatch(
        editorViewActions.view3dFailed({ reason: reasonOf(error) }),
      );
      render();
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

  render();

  return {
    open() {
      const { view3dShown, view3dLoad } = ui();
      if (view3dLoad === "loading" || view3dShown) return;
      void start();
    },
    close() {
      attempt++;
      leave(editorViewActions.view3dClosed());
    },
  };
}
