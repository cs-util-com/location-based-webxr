/**
 * Why these tests matter: the view switch is the page's one way into the
 * 3D view, and the 3D view is async three ways (its code, its ground,
 * WebGL). By the CLAUDE.md async-UI rule the button must show that it is
 * loading while it loads, and end either in the 3D view or back on the map
 * with the reason said; a context lost while the view shows must fall back
 * to the map the same way. These drive the controller with a plain button
 * object and a hand-made opener, and check the button's words, its
 * disabled state, the store's fields and what was said, on the success
 * path and on each failure. A late answer of a load the creator left must
 * neither show the view nor leak it.
 */
import { describe, expect, it } from "vitest";

import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  editorViewReducer,
  selectEditorView,
  type View3dFailure,
} from "./editor-view.js";
import {
  VIEW_SWITCH_LABELS,
  VIEW_SWITCH_SHORT_LABELS,
  createViewSwitch,
  view3dFailureText,
  type View3dHandle,
  type ViewSwitchButton,
} from "./view-switch.js";

function button(): ViewSwitchButton & { click(): void } {
  const listeners: (() => void)[] = [];
  return {
    textContent: "",
    disabled: false,
    dataset: {},
    addEventListener: (_type: "click", fn: () => void) => {
      listeners.push(fn);
    },
    click: () => {
      for (const fn of listeners) fn();
    },
  };
}

/** An opener the test settles by hand. */
function opener() {
  const calls: {
    resolve: (view: View3dHandle) => void;
    reject: (err: unknown) => void;
    contextLost: () => void;
  }[] = [];
  return {
    calls,
    open: (events: { contextLost(): void }) =>
      new Promise<View3dHandle>((resolve, reject) => {
        calls.push({ resolve, reject, contextLost: events.contextLost });
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
  const b = button();
  const o = opener();
  const said: string[] = [];
  const shown: boolean[] = [];
  /** The store's view mode as each `onShown` call found it. */
  const modes: string[] = [];
  const ui = () => selectEditorView(store.getState());
  const sw = createViewSwitch({
    button: b,
    store,
    open: o.open,
    say: (text) => said.push(text),
    onShown: (on) => {
      shown.push(on);
      modes.push(ui().viewMode);
    },
  });
  return { store, b, o, said, shown, modes, sw, ui };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createViewSwitch", () => {
  it("shows the loading state, then the 3D view, then the map again", async () => {
    const { b, o, said, shown, ui } = setup();
    expect(b.textContent).toBe(VIEW_SWITCH_LABELS.idle);
    expect(b.disabled).toBe(false);
    b.click();
    expect(b.textContent).toBe(VIEW_SWITCH_LABELS.loading);
    expect(b.disabled).toBe(true);
    expect(b.dataset["state"]).toBe("loading");
    expect(ui().view3dLoad).toBe("loading");
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    expect(ui().viewMode).toBe("3d");
    expect(b.textContent).toBe(VIEW_SWITCH_LABELS.shown);
    expect(b.disabled).toBe(false);
    expect(b.dataset["state"]).toBe("3d");
    expect(shown).toEqual([true]);
    b.click();
    expect(ui().viewMode).toBe("2d");
    expect(v.disposed).toBe(1);
    expect(b.textContent).toBe(VIEW_SWITCH_LABELS.idle);
    expect(shown).toEqual([true, false]);
    expect(said).toEqual([]);
  });

  it.each<[string, unknown, View3dFailure]>([
    [
      "chunk",
      new TypeError("Failed to fetch dynamically imported module"),
      "chunk",
    ],
    [
      "webgl",
      Object.assign(new Error("no WebGL"), { reason: "webgl" }),
      "webgl",
    ],
    ["empty", Object.assign(new Error("empty"), { reason: "empty" }), "empty"],
    [
      "a reason it does not know",
      Object.assign(new Error("x"), { reason: "odd" }),
      "chunk",
    ],
  ])(
    "lands on the map with the reason said when the load fails (%s)",
    async (_name, error, reason) => {
      const { b, o, said, shown, ui } = setup();
      b.click();
      o.calls[0]!.reject(error);
      await settle();
      expect(ui()).toMatchObject({
        viewMode: "2d",
        view3dLoad: "failed",
        view3dFailure: reason,
      });
      expect(b.textContent).toBe(VIEW_SWITCH_LABELS.idle);
      expect(b.disabled).toBe(false);
      expect(said).toEqual([view3dFailureText(reason)]);
      expect(shown).toEqual([]);
    },
  );

  it("falls back to the map, said, when the shown view loses its context", async () => {
    const { b, o, said, shown, ui } = setup();
    b.click();
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    o.calls[0]!.contextLost();
    expect(ui()).toMatchObject({
      viewMode: "2d",
      view3dFailure: "context-lost",
    });
    expect(v.disposed).toBe(1);
    expect(said).toEqual([view3dFailureText("context-lost")]);
    expect(shown).toEqual([true, false]);
    // Lost twice (the event can fire again): said once.
    o.calls[0]!.contextLost();
    expect(said).toHaveLength(1);
    // And the switch opens it again.
    b.click();
    expect(o.calls).toHaveLength(2);
  });

  it("drops a view that arrives after the creator left the load", async () => {
    const { b, o, sw, shown, ui } = setup();
    b.click();
    sw.close();
    expect(ui().view3dLoad).toBe("idle");
    expect(b.textContent).toBe(VIEW_SWITCH_LABELS.idle);
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    expect(ui().viewMode).toBe("2d");
    expect(v.disposed).toBe(1);
    expect(shown).toEqual([]);
  });

  it("closes a shown view when the tour goes", async () => {
    const { b, o, sw, shown, ui } = setup();
    b.click();
    const v = view();
    o.calls[0]!.resolve(v);
    await settle();
    sw.close();
    expect(ui().viewMode).toBe("2d");
    expect(v.disposed).toBe(1);
    expect(shown).toEqual([true, false]);
    sw.close();
    expect(v.disposed).toBe(1);
  });

  // Why: the page hides the map's card while the 3D view shows and puts
  // it back from `onShown`, reading the store. Called before the store
  // had left the 3D mode, the card stayed hidden on the map. Every path
  // back (the button, a lost context, a closed tour) must call it with the
  // store already in the mode it announces.
  it("calls onShown with the store already in the mode it announces", async () => {
    const paths: [string, (s: ReturnType<typeof setup>) => void][] = [
      ["the button", (s) => s.b.click()],
      ["a lost context", (s) => s.o.calls[0]!.contextLost()],
      ["a closed tour", (s) => s.sw.close()],
    ];
    for (const [, back] of paths) {
      const s = setup();
      s.b.click();
      s.o.calls[0]!.resolve(view());
      await settle();
      back(s);
      expect(s.shown).toEqual([true, false]);
      expect(s.modes).toEqual(["3d", "2d"]);
    }
  });

  // Why: on a phone-wide window the top bar must keep every control inside
  // it, so the button carries a short word for each state (the stylesheet
  // shows it below 720 px) next to its full label, which stays its text.
  it("carries a short word for each state next to its label", async () => {
    const { b, o } = setup();
    expect(b.dataset["short"]).toBe(VIEW_SWITCH_SHORT_LABELS.idle);
    b.click();
    expect(b.dataset["short"]).toBe(VIEW_SWITCH_SHORT_LABELS.loading);
    o.calls[0]!.resolve(view());
    await settle();
    expect(b.dataset["short"]).toBe(VIEW_SWITCH_SHORT_LABELS.shown);
    expect(b.textContent).toBe(VIEW_SWITCH_LABELS.shown);
    for (const word of Object.values(VIEW_SWITCH_SHORT_LABELS)) {
      expect(word.length).toBeLessThanOrEqual(3);
    }
  });

  it("opens nothing more while a load runs", () => {
    const { b, o } = setup();
    b.click();
    b.click();
    expect(o.calls).toHaveLength(1);
  });

  it("can be switched off while no tour is open", () => {
    const { b, o, sw } = setup();
    sw.setEnabled(false);
    expect(b.disabled).toBe(true);
    b.click();
    expect(o.calls).toHaveLength(0);
    sw.setEnabled(true);
    expect(b.disabled).toBe(false);
  });
});

describe("view3dFailureText", () => {
  it("names each failure in plain words, and says the map shows the tour", () => {
    for (const reason of ["chunk", "webgl", "context-lost", "empty"] as const) {
      const text = view3dFailureText(reason);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/undefined|null/);
    }
    expect(view3dFailureText("webgl")).toMatch(/WebGL/);
    expect(view3dFailureText("context-lost")).toMatch(/map/);
  });
});
