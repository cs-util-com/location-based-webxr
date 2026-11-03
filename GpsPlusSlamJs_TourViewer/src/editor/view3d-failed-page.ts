/**
 * The page the editor shows where its 3D view cannot open: no WebGL, its
 * code not loaded, its graphics lost, or an error that stopped it. The 3D
 * view is the editor, and the 2D map no longer stands in for it, so this
 * says plainly what happened (`view3dFailureText`) and keeps the tour's
 * File actions within reach - try again, open another tour, save, save a
 * copy, the tour's details - so no work is stranded.
 *
 * It follows the store (`editorView`): shown while the 3D load has failed
 * with a reason, gone once it is tried again, shown, or left. An "empty"
 * tour is no failure (only the temporary older view refuses one, and the
 * map shows it), so it never brings the page up.
 *
 * @see view3d-failed-page.ts.md
 */

import type { EditorViewState, View3dFailure } from "./editor-view.js";
import { view3dFailureText } from "./view-switch.js";

/** The page's words that do not depend on the failure. */
export const VIEW3D_FAILED_PAGE = Object.freeze({
  title: "The 3D view cannot open",
  /** The first button: the view tried again in place, or - for code that
   *  did not load, which the browser keeps failing for the page's life -
   *  the page reloaded. */
  retry: "Try again",
  reload: "Reload the page",
});

type ViewState = Pick<
  EditorViewState,
  "viewMode" | "view3dLoad" | "view3dFailure"
>;

/** The failure the page shows, or `null` while it does not show. */
export function failedPageReason(view: ViewState): View3dFailure | null {
  if (view.view3dLoad !== "failed") return null;
  const reason = view.view3dFailure;
  return reason === null || reason === "empty" ? null : reason;
}

interface Clickable {
  addEventListener(type: "click", listener: () => void): void;
}

/** The page's elements (structural, so the unit tests run in node). */
export interface View3dFailedPageDom {
  // As the DOM types it (`HTMLElement.hidden`); this module writes booleans.
  root: {
    hidden: boolean | "until-found";
    style: { setProperty(name: string, value: string): void };
  };
  heading: { focus(): void };
  reason: { textContent: string | null };
  retry: Clickable & { textContent: string | null };
  open: Clickable;
  save: Clickable;
  saveCopy: Clickable;
  details: Clickable;
}

/** What each button does (the page's own File actions). */
export interface View3dFailedPageActions {
  retry(): void;
  /** Reload the page (after the page's unsaved-work guard). */
  reload(): void;
  open(): void;
  save(): void;
  saveCopy(): void;
  details(): void;
}

/** The toasts' stack, which sits above the page (structural, as the DOM). */
export interface ToastStack {
  /** Its height now (px; 0 while it is empty). */
  height(): number;
  /** Call `changed` whenever its size changes; returns a stop. */
  watch(changed: () => void): () => void;
}

export interface View3dFailedPage {
  /** Stop following the store and the toasts. */
  dispose(): void;
}

/**
 * Wire the page: it shows and hides with the store, its heading takes the
 * focus when it shows (so it is read out), and `covered` (the map, the
 * rail, the card and its "Show it" chip, the debug panel) leaves the tab
 * order only while it shows - touched on a change of showing alone, as the
 * 3D view keeps the map inert itself while it shows. The toasts' height is
 * kept on the page as `--toasts-h` (px), which its CSS keeps the card
 * clear of: a save's result must be seen, so the toasts stay above it.
 */
export function wireView3dFailedPage(deps: {
  readonly dom: View3dFailedPageDom;
  readonly covered: readonly { inert: boolean }[];
  readonly store: {
    getState(): { readonly editorView: EditorViewState };
    subscribe(listener: () => void): () => void;
  };
  readonly actions: View3dFailedPageActions;
  readonly toasts: ToastStack;
}): View3dFailedPage {
  const { dom, covered, store, actions, toasts } = deps;
  let shown = false;

  const render = (): void => {
    const reason = failedPageReason(store.getState().editorView);
    if (reason !== null) {
      dom.reason.textContent = view3dFailureText(reason);
      dom.retry.textContent =
        reason === "chunk"
          ? VIEW3D_FAILED_PAGE.reload
          : VIEW3D_FAILED_PAGE.retry;
    }
    const show = reason !== null;
    if (show === shown) return;
    shown = show;
    dom.root.hidden = !show;
    for (const element of covered) element.inert = show;
    if (show) dom.heading.focus();
  };

  dom.retry.addEventListener("click", () => {
    if (failedPageReason(store.getState().editorView) === "chunk") {
      actions.reload();
    } else actions.retry();
  });
  dom.open.addEventListener("click", () => {
    actions.open();
  });
  dom.save.addEventListener("click", () => {
    actions.save();
  });
  dom.saveCopy.addEventListener("click", () => {
    actions.saveCopy();
  });
  dom.details.addEventListener("click", () => {
    actions.details();
  });

  const keepClear = (): void => {
    const px = toasts.height();
    dom.root.style.setProperty(
      "--toasts-h",
      `${String(Number.isFinite(px) && px > 0 ? Math.ceil(px) : 0)}px`,
    );
  };

  dom.root.hidden = true;
  const unsubscribe = store.subscribe(render);
  const unwatch = toasts.watch(keepClear);
  keepClear();
  render();
  return {
    dispose: () => {
      unsubscribe();
      unwatch();
    },
  };
}
