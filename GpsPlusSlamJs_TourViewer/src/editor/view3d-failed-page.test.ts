/**
 * Why these tests matter: the 3D view is the editor; where it cannot open
 * (no WebGL, its code not loaded, its graphics lost, an error) the page
 * used to fall back to the 2D map, which is being removed. It now says
 * plainly what happened on a page of its own, and keeps the tour's File
 * actions within reach - open another, save, save a copy, the details -
 * plus a way to try again. These pin when the page shows (a failure, never
 * the temporary older view's "nothing positioned", which is no failure),
 * that it goes when the view shows or the load is left, what it says, that
 * each button runs its action, and that what it covers leaves the tab
 * order only while it shows.
 */
import { describe, expect, it, vi } from "vitest";

import type { EditorViewState, View3dFailure } from "./editor-view.js";
import { view3dFailureText } from "./view-switch.js";
import {
  VIEW3D_FAILED_PAGE,
  failedPageReason,
  wireView3dFailedPage,
} from "./view3d-failed-page.js";

type View = Pick<EditorViewState, "viewMode" | "view3dLoad" | "view3dFailure">;

const idle: View = { viewMode: "2d", view3dLoad: "idle", view3dFailure: null };
const failed = (reason: View3dFailure): View => ({
  viewMode: "2d",
  view3dLoad: "failed",
  view3dFailure: reason,
});

describe("failedPageReason", () => {
  it("names the failure while the load has failed", () => {
    for (const reason of ["webgl", "chunk", "context-lost", "error"] as const) {
      expect(failedPageReason(failed(reason))).toBe(reason);
    }
  });

  // Why: "nothing with a position" is the older view's (globe=0), and no
  // failure: the map shows such a tour, a passing line says why.
  it("is null for an empty tour, an idle, loading or shown view", () => {
    expect(failedPageReason(failed("empty"))).toBeNull();
    expect(failedPageReason(idle)).toBeNull();
    expect(failedPageReason({ ...idle, view3dLoad: "loading" })).toBeNull();
    expect(failedPageReason({ ...idle, viewMode: "3d" })).toBeNull();
  });
});

function button() {
  let click: (() => void) | null = null;
  return {
    addEventListener(_type: "click", listener: () => void) {
      click = listener;
    },
    click() {
      click?.();
    },
  };
}

function harness(start: View) {
  let view = start;
  const listeners = new Set<() => void>();
  const store = {
    getState: () => ({ editorView: view as EditorViewState }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (next: View) => {
    view = next;
    for (const l of [...listeners]) l();
  };
  const props = new Map<string, string>();
  const dom = {
    root: {
      hidden: true,
      style: {
        setProperty(name: string, value: string) {
          props.set(name, value);
        },
      },
    },
    heading: {
      focused: 0,
      focus() {
        this.focused += 1;
      },
    },
    reason: { textContent: "" as string | null },
    retry: { ...button(), textContent: "Try again" as string | null },
    open: button(),
    save: button(),
    saveCopy: button(),
    details: button(),
  };
  const covered = [{ inert: false }, { inert: false }];
  const actions = {
    retry: vi.fn(),
    reload: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
    saveCopy: vi.fn(),
    details: vi.fn(),
  };
  let stackPx = 0;
  let resized: (() => void) | null = null;
  const toasts = {
    height: () => stackPx,
    watch(changed: () => void) {
      resized = changed;
      return () => {
        resized = null;
      };
    },
  };
  const resize = (px: number) => {
    stackPx = px;
    resized?.();
  };
  const page = wireView3dFailedPage({ dom, covered, store, actions, toasts });
  return { dom, covered, actions, set, page, listeners, props, resize };
}

describe("wireView3dFailedPage", () => {
  it("shows for a failure, with its reason in plain words, and goes when the view shows", () => {
    const h = harness(idle);
    expect(h.dom.root.hidden).toBe(true);
    h.set(failed("webgl"));
    expect(h.dom.root.hidden).toBe(false);
    expect(h.dom.reason.textContent).toBe(view3dFailureText("webgl"));
    // The heading takes the focus once, so it is read out.
    expect(h.dom.heading.focused).toBe(1);
    h.set({ ...idle, view3dLoad: "loading" });
    expect(h.dom.root.hidden).toBe(true);
    h.set({ ...idle, viewMode: "3d" });
    expect(h.dom.root.hidden).toBe(true);
  });

  it("shows at once for a load that had already failed", () => {
    const h = harness(failed("chunk"));
    expect(h.dom.root.hidden).toBe(false);
    expect(h.dom.reason.textContent).toBe(view3dFailureText("chunk"));
  });

  it("never shows for an empty tour", () => {
    const h = harness(idle);
    h.set(failed("empty"));
    expect(h.dom.root.hidden).toBe(true);
  });

  // Why: the page covers the map and the rail; their controls must not be
  // reached by Tab behind it - and must be given back when it goes, but
  // never touched while it stays hidden (the 3D view keeps the map inert
  // itself while it shows, and the store changes on every edit).
  it("makes what it covers inert only while it shows", () => {
    const h = harness(idle);
    h.covered[0]!.inert = true;
    h.set({ ...idle, viewMode: "3d" });
    expect(h.covered.map((c) => c.inert)).toEqual([true, false]);
    h.set(failed("error"));
    expect(h.covered.map((c) => c.inert)).toEqual([true, true]);
    h.set(idle);
    expect(h.covered.map((c) => c.inert)).toEqual([false, false]);
  });

  it("runs each button's action", () => {
    const h = harness(failed("context-lost"));
    for (const name of [
      "retry",
      "open",
      "save",
      "saveCopy",
      "details",
    ] as const) {
      h.dom[name].click();
      expect(h.actions[name]).toHaveBeenCalledTimes(1);
    }
  });

  // Why: the browser keeps a failed import's answer for the page's life,
  // so trying the view again in place fails the same way for good; only a
  // reload fetches its code again (the unsaved-work guard and the draft
  // are the page's, behind `reload`).
  it("reloads the page for code that did not load, and tries again in place otherwise", () => {
    const h = harness(failed("chunk"));
    expect(h.dom.retry.textContent).toBe("Reload the page");
    h.dom.retry.click();
    expect(h.actions.reload).toHaveBeenCalledTimes(1);
    expect(h.actions.retry).not.toHaveBeenCalled();
    h.set(idle);
    h.set(failed("error"));
    expect(h.dom.retry.textContent).toBe("Try again");
    h.dom.retry.click();
    expect(h.actions.retry).toHaveBeenCalledTimes(1);
    expect(h.actions.reload).toHaveBeenCalledTimes(1);
  });

  // Why: the toasts sit above the page (a save's result must be seen), so
  // the page keeps its card clear of their stack, however tall it grows:
  // two of them covered its buttons on a phone held sideways.
  it("keeps the toasts' height on itself, following their stack", () => {
    const h = harness(failed("webgl"));
    expect(h.props.get("--toasts-h")).toBe("0px");
    h.resize(96);
    expect(h.props.get("--toasts-h")).toBe("96px");
    h.resize(0);
    expect(h.props.get("--toasts-h")).toBe("0px");
  });

  it("stops following the store and the toasts once disposed", () => {
    const h = harness(idle);
    h.page.dispose();
    expect(h.listeners.size).toBe(0);
    h.resize(50);
    expect(h.props.get("--toasts-h")).toBe("0px");
  });

  it("names itself plainly", () => {
    expect(VIEW3D_FAILED_PAGE.title).toBe("The 3D view cannot open");
  });
});

describe("view3dFailureText", () => {
  // Why: the map no longer stands in for the 3D view, so no failure's words
  // may promise it; each says what to do instead.
  it("no longer says the map shows the tour for a failure", () => {
    for (const reason of ["webgl", "chunk", "context-lost", "error"] as const) {
      expect(view3dFailureText(reason)).not.toMatch(/map/i);
    }
  });
});
