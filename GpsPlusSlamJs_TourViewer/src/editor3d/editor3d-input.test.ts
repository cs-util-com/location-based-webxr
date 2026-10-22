// @vitest-environment jsdom
/**
 * Why these tests matter: the 3D view's edits reach the tour only through
 * this input, and the store's rule for the view is strict - a gesture's
 * start, its end and its one edit, nothing in between (a dispatch per
 * frame would flood the history, the autosave and every subscriber). A
 * second finger during a drag must cancel it and leave the document as it
 * was; each key must do what the design says, and the keys the shell or
 * the page answer (T, F, Home, Esc, Ctrl+Z) must be left to them. A click
 * selects what is under the pointer, a press that moved is the camera's.
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { editorViewActions } from "../editor/editor-view.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  INPUT,
  TWO_FINGER_CANCEL,
  createSceneInput,
  type InputPage,
  type InputScene,
} from "./editor3d-input.js";
import type { GestureEdit, GestureTarget, GestureWorld } from "./gesture.js";
import type { GizmoHandle, ScreenPoint } from "./gizmo-maths.js";
import { liftedGeo, nudgedGeo, turnedGeo } from "./pose-edits.js";

// The geodesy is licence-gated; the store activates it (as the page does).
beforeAll(() => {
  createTourViewerStore();
});

const PIN: GestureTarget = {
  kind: "item",
  id: "pin",
  geo: { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 0 },
  sizeM: null,
  centre: { x: 0, y: 0, z: 0 },
};

/** A pixel is a metre (x east, the screen's y south); flat ground at
 *  518.5 m. */
const WORLD: GestureWorld = {
  groundUnder: (p) => ({ at: { x: p.x, y: 0, z: p.y } }),
  planeUnder: (p, y) => ({ x: p.x, y, z: p.y }),
  placeOf: (at) => ({
    lat: PIN.geo.lat - at.z / 111_000,
    lon: PIN.geo.lon + at.x / 74_000,
  }),
  groundAt: () => 518.5,
};

function setup(
  options: {
    selected?: string | null;
    handle?: GizmoHandle | null;
    pick?: string | null;
    keysFree?: boolean;
  } = {},
) {
  const log: string[] = [];
  const dispatched: UnknownAction[] = [];
  const commits: GestureEdit[] = [];
  let selected = options.selected === undefined ? "pin" : options.selected;
  const scene: InputScene = {
    target: (id) => (id === "pin" ? PIN : null),
    handleAt: () => options.handle ?? null,
    pickAt: () => options.pick ?? null,
    world: WORLD,
    preview: vi.fn((_t, p) => {
      log.push(p === null ? "preview:clear" : "preview");
    }),
    hover: vi.fn(),
    lockCamera: vi.fn((on: boolean) => {
      log.push(`lock:${String(on)}`);
    }),
    twoFingerStart: vi.fn(),
    twoFinger: vi.fn(),
    frame: vi.fn(),
  };
  const page: InputPage = {
    dispatch: (action) => {
      dispatched.push(action);
      log.push(`dispatch:${action.type.split("/")[1] ?? action.type}`);
    },
    selected: () => selected,
    select: vi.fn((id: string | null) => {
      selected = id;
    }),
    commit: (edit) => {
      commits.push(edit);
      log.push("commit");
    },
    remove: vi.fn(),
    duplicate: vi.fn(),
    say: vi.fn(),
    keysFree: () => options.keysFree ?? true,
  };
  const element = document.createElement("div");
  document.body.append(element);
  const input = createSceneInput({ element, surface: element, scene, page });
  return {
    input,
    scene,
    page,
    element,
    log,
    dispatched,
    commits,
    setSelected: (id: string | null) => {
      selected = id;
    },
  };
}

let nextTime = 1000;
function pointer(
  type: string,
  at: ScreenPoint,
  over: {
    id?: number;
    touch?: boolean;
    shift?: boolean;
    buttons?: number;
  } = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    button: 0,
    buttons: over.buttons ?? 0,
    shiftKey: over.shift ?? false,
  });
  Object.defineProperty(event, "pointerId", { value: over.id ?? 1 });
  Object.defineProperty(event, "pointerType", {
    value: over.touch === true ? "touch" : "mouse",
  });
  nextTime += 50;
  Object.defineProperty(event, "timeStamp", { value: nextTime });
  return event as PointerEvent;
}

function key(
  type: "keydown" | "keyup",
  code: string,
  mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {},
) {
  const event = new KeyboardEvent(type, {
    code,
    key: code.replace(/^Key/, "").toLowerCase(),
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    ctrlKey: mods.ctrl ?? false,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

/** One press and release of a key (a tap). */
function tap(code: string, mods: { shift?: boolean; alt?: boolean } = {}) {
  const down = key("keydown", code, mods);
  key("keyup", code, mods);
  return down;
}

describe("a drag of the gizmo", () => {
  it("dispatches its start and its end, and writes one edit - nothing during its frames", () => {
    const t = setup({ handle: "move" });
    t.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    expect(t.dispatched).toEqual([
      editorViewActions.gestureStarted({ id: "pin", handle: "move" }),
    ]);
    for (let i = 1; i <= 20; i++) {
      window.dispatchEvent(
        pointer("pointermove", { x: i, y: -i }, { buttons: 1 }),
      );
      t.input.frame();
    }
    expect(t.dispatched).toHaveLength(1);
    expect(t.commits).toHaveLength(0);
    window.dispatchEvent(pointer("pointerup", { x: 20, y: -20 }));
    expect(t.dispatched[1]).toEqual(editorViewActions.gestureEnded());
    expect(t.commits).toHaveLength(1);
    expect(t.commits[0]?.kind).toBe("item-pose");
    // The store first, then the edit, then the preview dropped (the tour
    // carries the edit by then: no frame shows the old pose).
    expect(t.log.slice(-4)).toEqual([
      "dispatch:gestureEnded",
      "commit",
      "preview:clear",
      "lock:false",
    ]);
    // The camera was locked from the press on.
    expect(t.log[0]).toBe("lock:true");
    t.input.dispose();
  });

  it("is cancelled by a second finger, writing nothing and saying so", () => {
    const t = setup({ handle: "move" });
    t.element.dispatchEvent(
      pointer("pointerdown", { x: 0, y: 0 }, { touch: true, id: 1 }),
    );
    window.dispatchEvent(
      pointer("pointermove", { x: 30, y: 0 }, { touch: true, id: 1 }),
    );
    t.element.dispatchEvent(
      pointer("pointerdown", { x: 100, y: 0 }, { touch: true, id: 2 }),
    );
    expect(t.dispatched.at(-1)).toEqual(editorViewActions.gestureEnded());
    expect(t.commits).toHaveLength(0);
    expect(t.page.say).toHaveBeenCalledWith(TWO_FINGER_CANCEL);
    expect(t.log).toContain("preview:clear");
    // The fingers move the camera now, and only the camera: both up
    // together, a few pixels per event, one finger at a time (as a
    // touch screen reports them).
    for (let y = -5; y >= -40; y -= 5) {
      window.dispatchEvent(
        pointer("pointermove", { x: 30, y }, { touch: true, id: 1 }),
      );
      window.dispatchEvent(
        pointer("pointermove", { x: 100, y }, { touch: true, id: 2 }),
      );
    }
    expect(t.scene.twoFinger).toHaveBeenCalledWith(
      "tilt",
      expect.anything(),
      expect.anything(),
    );
    // Lifting one finger is no click and starts nothing; the camera stays
    // locked until the last finger is up.
    window.dispatchEvent(
      pointer("pointerup", { x: 100, y: -40 }, { touch: true, id: 2 }),
    );
    window.dispatchEvent(
      pointer("pointermove", { x: 60, y: -40 }, { touch: true, id: 1 }),
    );
    expect(t.log.at(-1)).not.toBe("lock:false");
    window.dispatchEvent(
      pointer("pointerup", { x: 60, y: -40 }, { touch: true, id: 1 }),
    );
    expect(t.log.at(-1)).toBe("lock:false");
    expect(t.commits).toHaveLength(0);
    expect(t.page.select).not.toHaveBeenCalled();
    expect(t.dispatched).toHaveLength(2);
    t.input.dispose();
  });

  it("is cancelled when the selection changes under it (Esc, the tree)", () => {
    const t = setup({ handle: "turn" });
    t.element.dispatchEvent(pointer("pointerdown", { x: 0, y: -10 }));
    window.dispatchEvent(
      pointer("pointermove", { x: 10, y: 0 }, { buttons: 1 }),
    );
    t.setSelected(null);
    t.input.frame();
    expect(t.dispatched.at(-1)).toEqual(editorViewActions.gestureEnded());
    window.dispatchEvent(pointer("pointerup", { x: 10, y: 0 }));
    expect(t.commits).toHaveLength(0);
    t.input.dispose();
  });

  it("starts only on a handle of the selection; elsewhere the press is the camera's", () => {
    const none = setup({ handle: null });
    none.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    expect(none.dispatched).toHaveLength(0);
    expect(none.log).not.toContain("lock:true");
    none.input.dispose();
    // A code has no handles.
    const code = setup({ handle: "move", selected: "c1" });
    code.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    expect(code.dispatched).toHaveLength(0);
    code.input.dispose();
  });
});

describe("a click", () => {
  it("selects what is under the pointer, or nothing; a press that moved selects nothing", () => {
    const t = setup({ pick: "station:a" });
    t.element.dispatchEvent(pointer("pointerdown", { x: 5, y: 5 }));
    window.dispatchEvent(pointer("pointerup", { x: 6, y: 5 }));
    expect(t.page.select).toHaveBeenLastCalledWith("station:a");
    const empty = setup({ pick: null });
    empty.element.dispatchEvent(pointer("pointerdown", { x: 5, y: 5 }));
    window.dispatchEvent(pointer("pointerup", { x: 5, y: 5 }));
    expect(empty.page.select).toHaveBeenLastCalledWith(null);
    const orbit = setup({ pick: "station:a" });
    orbit.element.dispatchEvent(pointer("pointerdown", { x: 5, y: 5 }));
    window.dispatchEvent(
      pointer(
        "pointermove",
        { x: 5 + INPUT.clickPx + 1, y: 5 },
        { buttons: 1 },
      ),
    );
    window.dispatchEvent(pointer("pointerup", { x: 9, y: 5 }));
    expect(orbit.page.select).not.toHaveBeenCalled();
    for (const s of [t, empty, orbit]) s.input.dispose();
  });

  it("frames what a double tap or a double click is on", () => {
    const t = setup({ pick: "pin" });
    for (let i = 0; i < 2; i++) {
      t.element.dispatchEvent(
        pointer("pointerdown", { x: 5, y: 5 }, { touch: true }),
      );
      window.dispatchEvent(
        pointer("pointerup", { x: 5, y: 5 }, { touch: true }),
      );
    }
    expect(t.scene.frame).toHaveBeenCalledWith("pin");
    t.element.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: 5, clientY: 5 }),
    );
    expect(t.scene.frame).toHaveBeenCalledTimes(2);
    t.input.dispose();
  });
});

describe("the keys", () => {
  const ground = WORLD.groundAt;

  it("nudge 0.1 m by the arrows and 1 m with Shift, one edit per press", () => {
    const t = setup();
    tap("ArrowRight");
    tap("ArrowUp", { shift: true });
    expect(t.commits).toEqual([
      { kind: "item-pose", id: "pin", geo: nudgedGeo(PIN.geo, 0.1, 0, ground) },
      { kind: "item-pose", id: "pin", geo: nudgedGeo(PIN.geo, 0, 1, ground) },
    ]);
    t.input.dispose();
  });

  it("turn 5 degrees by Q, E and Alt+arrows, 15 with Shift", () => {
    const t = setup();
    tap("KeyE");
    tap("KeyQ", { shift: true });
    tap("ArrowLeft", { alt: true });
    expect(
      t.commits.map((c) => (c.kind === "item-pose" ? c.geo : null)),
    ).toEqual([
      turnedGeo(PIN.geo, 5),
      turnedGeo(PIN.geo, -15),
      turnedGeo(PIN.geo, -5),
    ]);
    t.input.dispose();
  });

  it("lift an item by PageUp and PageDown (1 m with Shift)", () => {
    const t = setup();
    tap("PageUp");
    tap("PageDown", { shift: true });
    expect(
      t.commits.map((c) => (c.kind === "item-pose" ? c.geo : null)),
    ).toEqual([liftedGeo(PIN.geo, 0.1), liftedGeo(PIN.geo, -1)]);
    t.input.dispose();
  });

  it("make a held key one gesture: its repeats move the preview, letting go writes once", () => {
    const t = setup();
    for (let i = 0; i < 5; i++) key("keydown", "ArrowRight");
    expect(t.dispatched).toEqual([
      editorViewActions.gestureStarted({ id: "pin", handle: "key" }),
    ]);
    expect(t.commits).toHaveLength(0);
    key("keyup", "ArrowRight");
    expect(t.dispatched.at(-1)).toEqual(editorViewActions.gestureEnded());
    let want = PIN.geo;
    for (let i = 0; i < 5; i++) want = nudgedGeo(want, 0.1, 0, ground);
    expect(t.commits).toEqual([{ kind: "item-pose", id: "pin", geo: want }]);
    t.input.dispose();
  });

  it("delete and duplicate the selection by Del, Backspace and Ctrl+D", () => {
    const t = setup();
    tap("Delete");
    tap("Backspace");
    const ctrlD = key("keydown", "KeyD", { ctrl: true });
    expect(t.page.remove).toHaveBeenCalledTimes(2);
    expect(t.page.duplicate).toHaveBeenCalledWith("pin");
    expect(ctrlD.defaultPrevented).toBe(true);
    t.input.dispose();
    // A code is read-only in the 3D view, as on the map: no delete, no copy.
    const code = setup({ selected: "c1" });
    tap("Delete");
    key("keydown", "KeyD", { ctrl: true });
    expect(code.page.remove).not.toHaveBeenCalled();
    expect(code.page.duplicate).not.toHaveBeenCalled();
    code.input.dispose();
  });

  it("leave T, F, Home, Esc and Ctrl+Z to the shell and the page, and stay out of fields and dialogs", () => {
    const t = setup();
    for (const code of ["KeyT", "KeyF", "Home", "Escape"]) {
      expect(tap(code).defaultPrevented).toBe(false);
    }
    expect(key("keydown", "KeyZ", { ctrl: true }).defaultPrevented).toBe(false);
    expect(t.dispatched).toHaveLength(0);
    t.input.dispose();
    const busy = setup({ keysFree: false });
    expect(tap("ArrowRight").defaultPrevented).toBe(false);
    tap("Delete");
    expect(busy.commits).toHaveLength(0);
    expect(busy.page.remove).not.toHaveBeenCalled();
    busy.input.dispose();
  });

  it("do nothing during a drag (the design's)", () => {
    const t = setup({ handle: "move" });
    t.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    tap("ArrowRight");
    tap("Delete");
    expect(t.page.remove).not.toHaveBeenCalled();
    expect(t.dispatched).toHaveLength(1);
    t.input.dispose();
  });
});
