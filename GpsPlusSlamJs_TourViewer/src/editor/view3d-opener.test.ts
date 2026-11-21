/**
 * Why these tests matter: the opener is the page's one way into the 3D
 * view, the editor itself, and the 3D view is async three ways (its code,
 * its ground, WebGL). By the CLAUDE.md async-UI rule the page must say
 * that it is loading while it loads, and end either in the 3D view or on
 * the failure's page with its reason; a context lost or an error while the
 * view shows must end it the same way. These drive the opener with a
 * hand-made `open`, and check the status line, the store's fields and
 * `onShown`, on the success path and on each failure. A late answer of a
 * load the creator left must neither show the view nor leak it.
 */
import { describe, expect, it } from "vitest";

import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  editorViewReducer,
  selectEditorView,
  type View3dFailure,
} from "./editor-view.js";
import {
  VIEW3D_LOADING,
  createView3dOpener,
  view3dFailureText,
  type View3dHandle,
} from "./view3d-opener.js";

/** An `open` the test settles by hand. */
function opener() {
  const calls: {
    resolve: (view: View3dHandle) => void;
    reject: (err: unknown) => void;
    contextLost: () => void;
    failed: () => void;
  }[] = [];
  return {
    calls,
    open: (events: { contextLost(): void; failed(): void }) =>
      new Promise<View3dHandle>((resolve, reject) => {
        calls.push({
          resolve,
          reject,
          contextLost: () => events.contextLost(),
          failed: () => events.failed(),
        });
      }),
  };
}

function view(): View3dHandle & { disposed: number } {
  const v = {
    disposed: 0,
    dispose: () => {
      v.disposed++;
    },
  };
  return v;
}

function setup() {
  const store = createTourViewerStore(undefined, {
    editorView: editorViewReducer,
  });
  const o = opener();
  const shown: boolean[] = [];
  /** Whether the store had the view shown as each `onShown` call found it. */
  const states: boolean[] = [];
  const ui = () => selectEditorView(store.getState());
  const status = { textContent: "" as string | null, hidden: true };
  const sw = createView3dOpener({
    status,
    store,
    open: o.open,
    onShown: (on) => {
      shown.push(on);
      states.push(ui().view3dShown);
    },
  });
  return { store, o, shown, states, sw, ui, status };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createView3dOpener", () => {
  it("says the load, then shows the 3D view, then closes it", async () => {
    const { o, sw, shown, ui, status } = setup();
    expect(status.hidden).toBe(true);
    sw.open();
    expect(ui().view3dLoad).toBe("loading");
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(VIEW3D_LOADING);
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    expect(ui().view3dShown).toBe(true);
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(shown).toEqual([true]);
    sw.close();
    expect(ui().view3dShown).toBe(false);
    expect(v.disposed).toBe(1);
    expect(shown).toEqual([true, false]);
  });

  it.each<[string, unknown, View3dFailure]>([
    [
      "chunk",
      Object.assign(
        new TypeError("Failed to fetch dynamically imported module"),
        { reason: "chunk" },
      ),
      "chunk",
    ],
    [
      "context-lost",
      Object.assign(new Error("lost"), { reason: "context-lost" }),
      "context-lost",
    ],
    ["an error without a reason", new TypeError("x is undefined"), "error"],
    [
      "webgl",
      Object.assign(new Error("no WebGL"), { reason: "webgl" }),
      "webgl",
    ],
    [
      "a reason it does not know",
      Object.assign(new Error("x"), { reason: "odd" }),
      "error",
    ],
  ])(
    "ends the load as failed with its reason when it fails (%s)",
    async (_name, error, reason) => {
      const { o, sw, shown, ui, status } = setup();
      sw.open();
      o.calls[0]!.reject(error);
      await settle();
      expect(ui()).toMatchObject({
        view3dShown: false,
        view3dLoad: "failed",
        view3dFailure: reason,
      });
      expect(status.hidden).toBe(true);
      expect(shown).toEqual([]);
    },
  );

  it("ends a shown view that loses its context, once, and opens again", async () => {
    const { o, sw, shown, ui } = setup();
    sw.open();
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    o.calls[0]!.contextLost();
    expect(ui()).toMatchObject({
      view3dShown: false,
      view3dFailure: "context-lost",
    });
    expect(v.disposed).toBe(1);
    expect(shown).toEqual([true, false]);
    // Lost twice (the event can fire again): ended once.
    o.calls[0]!.contextLost();
    expect(shown).toEqual([true, false]);
    expect(v.disposed).toBe(1);
    // And it opens again (the failed page's Try again).
    sw.open();
    expect(o.calls).toHaveLength(2);
  });

  // Why: a context lost while the view loads (the browser resets the
  // graphics before the first frame) reached an opener with no view yet
  // and was dropped: the open then resolved on a black canvas. The load
  // must end as failed, and the late view be disposed.
  it("ends the load as failed when the context is lost while it loads", async () => {
    const { o, sw, shown, ui, status } = setup();
    sw.open();
    o.calls[0]!.contextLost();
    expect(ui()).toMatchObject({
      view3dShown: false,
      view3dLoad: "failed",
      view3dFailure: "context-lost",
    });
    expect(status.hidden).toBe(true);
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    expect(v.disposed).toBe(1);
    expect(ui().view3dShown).toBe(false);
    expect(shown).toEqual([]);
  });

  // Why: an error in the shown view's frame loop stops its drawing; the
  // page must end on the failure's page with a reason, as for a lost
  // context.
  it("ends a shown view that fails", async () => {
    const { o, sw, shown, ui } = setup();
    sw.open();
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    o.calls[0]!.failed();
    expect(ui()).toMatchObject({ view3dShown: false, view3dFailure: "error" });
    expect(v.disposed).toBe(1);
    expect(shown).toEqual([true, false]);
  });

  it("drops a view that arrives after the creator left the load", async () => {
    const { o, sw, shown, ui, status } = setup();
    sw.open();
    sw.close();
    expect(ui().view3dLoad).toBe("idle");
    expect(status.hidden).toBe(true);
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    expect(ui().view3dShown).toBe(false);
    expect(v.disposed).toBe(1);
    expect(shown).toEqual([]);
  });

  it("closes a shown view once", async () => {
    const { o, sw, shown } = setup();
    sw.open();
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    sw.close();
    sw.close();
    expect(v.disposed).toBe(1);
    expect(shown).toEqual([true, false]);
  });

  // Why: the page hides the view box and its shell from `onShown`, and
  // reads the store there. Every way out (a lost context, an error, a
  // closed tour) must call it with the store already in the state it
  // announces.
  it("calls onShown with the store already in the state it announces", async () => {
    const paths: [string, (s: ReturnType<typeof setup>) => void][] = [
      ["a lost context", (s) => s.o.calls[0]!.contextLost()],
      ["an error", (s) => s.o.calls[0]!.failed()],
      ["a closed tour", (s) => s.sw.close()],
    ];
    for (const [, out] of paths) {
      const s = setup();
      s.sw.open();
      s.o.calls[0]!.resolve(view());
      await settle();
      out(s);
      expect(s.shown).toEqual([true, false]);
      expect(s.states).toEqual([true, false]);
    }
  });

  it("opens nothing more while a load runs or the view shows", async () => {
    const { o, sw } = setup();
    sw.open();
    sw.open();
    expect(o.calls).toHaveLength(1);
    o.calls[0]!.resolve(view());
    await settle();
    sw.open();
    expect(o.calls).toHaveLength(1);
  });
});

describe("view3dFailureText", () => {
  it("names each failure in plain words and what to do: try again, or reload for code that did not load", () => {
    for (const reason of ["chunk", "webgl", "context-lost", "error"] as const) {
      const text = view3dFailureText(reason);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/undefined|null|map/);
    }
    expect(view3dFailureText("webgl")).toMatch(/WebGL/);
    expect(view3dFailureText("context-lost")).toMatch(/try again/i);
    // Only a chunk that did not load needs the page reloaded: trying
    // again in place gets the browser's kept failure back.
    expect(view3dFailureText("chunk")).toMatch(/reload the page/i);
    expect(view3dFailureText("chunk")).not.toMatch(/try again/i);
    expect(view3dFailureText("error")).not.toMatch(/reload/i);
  });
});
