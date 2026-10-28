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

import { editorViewActions, STATION_LOCKED } from "../editor/editor-view.js";
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
import { LONG_PRESS } from "./long-press.js";
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
    world?: GestureWorld;
  } = {},
) {
  const log: string[] = [];
  const dispatched: UnknownAction[] = [];
  const commits: GestureEdit[] = [];
  let selected = options.selected === undefined ? "pin" : options.selected;
  const scene: InputScene = {
    target: (id) => (id === "pin" ? PIN : null),
    handleAt: vi.fn(() => options.handle ?? null),
    pickAt: () => options.pick ?? null,
    world: options.world ?? WORLD,
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
    groundMenu: vi.fn(),
    keysFree: () => options.keysFree ?? true,
  };
  // The view's box holds the canvas and a dock over it, as on the page.
  const box = document.createElement("div");
  const element = document.createElement("canvas");
  const dock = document.createElement("aside");
  box.append(element, dock);
  document.body.append(box);
  const input = createSceneInput({
    element: box,
    surface: element,
    scene,
    page,
  });
  return {
    input,
    scene,
    page,
    element,
    dock,
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
    button?: number;
  } = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    button: over.button ?? 0,
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

describe("a gesture's other ends", () => {
  // Why: an undo or a redo pressed while a gesture runs acts on the tour
  // as it was; the gesture must end unwritten, or its edit would land on
  // top of the step just taken.
  it("ends a drag or a key hold unwritten when cancelled (an undo, a redo)", () => {
    const t = setup({ handle: "move" });
    t.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    window.dispatchEvent(
      pointer("pointermove", { x: 10, y: 0 }, { buttons: 1 }),
    );
    t.input.cancel();
    expect(t.dispatched.at(-1)).toEqual(editorViewActions.gestureEnded());
    expect(t.input.gesture()).toBeNull();
    window.dispatchEvent(pointer("pointerup", { x: 10, y: 0 }));
    key("keydown", "ArrowRight");
    t.input.cancel();
    expect(t.dispatched.at(-1)).toEqual(editorViewActions.gestureEnded());
    key("keyup", "ArrowRight");
    expect(t.commits).toHaveLength(0);
    t.input.dispose();
  });

  // Why: the browser cancels a pointer when it takes the gesture over (a
  // system swipe, a lost capture); what the drag showed was never a
  // decision, so nothing is written.
  it("cancels a drag on pointercancel, writing nothing", () => {
    const t = setup({ handle: "move" });
    t.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    window.dispatchEvent(
      pointer("pointermove", { x: 10, y: 0 }, { buttons: 1 }),
    );
    window.dispatchEvent(pointer("pointercancel", { x: 10, y: 0 }));
    expect(t.dispatched.at(-1)).toEqual(editorViewActions.gestureEnded());
    expect(t.commits).toHaveLength(0);
    t.input.dispose();
  });

  // Why: the right button is the camera's (OrbitControls pans or tilts
  // with it), and a press while keys are held would start a second
  // gesture over the first.
  it("starts no drag on the right button, or while a key is held", () => {
    const right = setup({ handle: "move" });
    right.element.dispatchEvent(
      pointer("pointerdown", { x: 0, y: 0 }, { button: 2 }),
    );
    expect(right.dispatched).toHaveLength(0);
    expect(right.log).not.toContain("lock:true");
    right.input.dispose();
    const keys = setup({ handle: "move" });
    key("keydown", "ArrowRight");
    keys.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    expect(keys.dispatched).toHaveLength(1);
    expect(keys.input.gesture()).toBe("key");
    key("keyup", "ArrowRight");
    keys.input.dispose();
  });

  // Why: the window losing focus never delivers the keyup, so a hold
  // would otherwise run for ever; what the creator saw move is kept.
  it("writes a key hold when the window loses focus", () => {
    const t = setup();
    key("keydown", "ArrowRight");
    window.dispatchEvent(new Event("blur"));
    expect(t.commits).toHaveLength(1);
    expect(t.dispatched.at(-1)).toEqual(editorViewActions.gestureEnded());
    t.input.dispose();
  });

  // Why: Esc or a click elsewhere while an arrow is held changes the
  // selection; the nudges already shown on the screen are the creator's
  // and must be kept, not silently thrown away.
  it("writes a key hold when the selection changes under it", () => {
    const t = setup();
    key("keydown", "ArrowRight");
    key("keydown", "ArrowRight");
    t.setSelected(null);
    t.input.frame();
    expect(t.commits).toEqual([
      {
        kind: "item-pose",
        id: "pin",
        geo: nudgedGeo(
          nudgedGeo(PIN.geo, 0.1, 0, WORLD.groundAt),
          0.1,
          0,
          WORLD.groundAt,
        ),
      },
    ]);
    key("keyup", "ArrowRight");
    expect(t.commits).toHaveLength(1);
    t.input.dispose();
  });

  // Why: a key pressed after the selection changed but before the next
  // frame noticed it must not fold into the old hold or drop it: the old
  // selection's nudges are written first.
  it("writes a key hold when a key arrives for another selection before the next frame", () => {
    const t = setup();
    key("keydown", "ArrowRight");
    t.setSelected("c1");
    key("keydown", "ArrowRight");
    expect(t.commits).toEqual([
      {
        kind: "item-pose",
        id: "pin",
        geo: nudgedGeo(PIN.geo, 0.1, 0, WORLD.groundAt),
      },
    ]);
    key("keyup", "ArrowRight");
    t.input.dispose();
  });

  // Why: the camera's coast or a flight still moving when the gizmo is
  // grabbed would move the object under a still pointer; the camera is
  // stopped before the gesture reads where the pointer is.
  it("locks the camera before the gesture reads the ground under the press", () => {
    const reads: string[] = [];
    const world: GestureWorld = {
      ...WORLD,
      groundUnder: (p) => {
        reads.push("ground");
        return WORLD.groundUnder(p);
      },
    };
    const t = setup({ handle: "move", world });
    t.scene.lockCamera = vi.fn((on: boolean) => {
      reads.push(`lock:${String(on)}`);
    });
    t.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    expect(reads[0]).toBe("lock:true");
    expect(reads).toContain("ground");
    t.input.dispose();
  });
});

describe("the pointer's feedback", () => {
  // Why: a hover test raycasts the scene; over a dock (the tree, the
  // inspector) the pointer is not over the scene, and the cursor there is
  // the dock's.
  it("asks for the handle under the mouse only over the scene", () => {
    const t = setup({ handle: "move" });
    t.dock.dispatchEvent(pointer("pointermove", { x: 5, y: 5 }));
    expect(t.scene.handleAt).not.toHaveBeenCalled();
    expect(t.scene.hover).not.toHaveBeenCalled();
    t.element.dispatchEvent(pointer("pointermove", { x: 5, y: 5 }));
    expect(t.scene.hover).toHaveBeenCalledWith("move");
    expect(t.element.style.cursor).toBe("grab");
    t.input.dispose();
  });

  // Why: a drag over ground that has not loaded yet waits, and the object
  // stands still; without a sign the creator would think the drag broke.
  it("shows a progress cursor while the drag waits for its ground", () => {
    let loaded = true;
    const world: GestureWorld = {
      ...WORLD,
      groundUnder: (p) =>
        loaded ? WORLD.groundUnder(p) : { miss: "not-loaded" },
    };
    const t = setup({ handle: "move", world });
    t.element.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    expect(t.element.style.cursor).toBe("grabbing");
    loaded = false;
    window.dispatchEvent(
      pointer("pointermove", { x: 10, y: 0 }, { buttons: 1 }),
    );
    t.input.frame();
    expect(t.element.style.cursor).toBe("progress");
    loaded = true;
    t.input.frame();
    expect(t.element.style.cursor).toBe("grabbing");
    window.dispatchEvent(pointer("pointerup", { x: 10, y: 0 }));
    expect(t.element.style.cursor).toBe("");
    expect(t.commits).toHaveLength(1);
    t.input.dispose();
  });
});

describe("the keys with nothing selected", () => {
  // Why: the design takes only the arrows from the page when nothing is
  // selected (they would scroll it); Q, E and the page keys keep their
  // ordinary meaning.
  it("take the arrows from the page, and leave Q, E, PageUp and PageDown", () => {
    const t = setup({ selected: null });
    expect(tap("ArrowRight").defaultPrevented).toBe(true);
    expect(tap("ArrowUp", { alt: true }).defaultPrevented).toBe(true);
    for (const code of ["KeyQ", "KeyE", "PageUp", "PageDown"]) {
      expect(tap(code).defaultPrevented, code).toBe(false);
    }
    expect(t.dispatched).toHaveLength(0);
    t.input.dispose();
  });
});

// Why: a locked station's pose keys must move nothing and say why, once
// per press - not once per repeat of a held key - while its delete and
// copy keys still work.
describe("the keys on a locked station", () => {
  const LOCKED: GestureTarget = {
    kind: "station",
    id: "st",
    geo: { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 0 },
    foundRadiusM: 12,
    centre: { x: 0, y: 0, z: 0 },
    locked: true,
  };

  it("nudge, turn and lift nothing, say why once a press, and leave delete and copy", () => {
    const t = setup({ selected: "station:st" });
    t.scene.target = (id) => (id === "station:st" ? LOCKED : null);
    tap("ArrowRight");
    tap("KeyE");
    tap("PageUp");
    const held = new KeyboardEvent("keydown", {
      code: "ArrowLeft",
      key: "ArrowLeft",
      repeat: true,
      cancelable: true,
    });
    window.dispatchEvent(held);
    expect(t.commits).toEqual([]);
    expect(t.dispatched).toEqual([]);
    expect(t.page.say).toHaveBeenCalledTimes(3);
    expect(t.page.say).toHaveBeenCalledWith(STATION_LOCKED);
    tap("Delete");
    expect(t.page.remove).toHaveBeenCalledWith("station:st");
    t.input.dispose();
  });
});

describe("the ground menu", () => {
  function context(target: EventTarget, at: ScreenPoint): MouseEvent {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      button: 2,
    });
    target.dispatchEvent(event);
    return event;
  }

  // Why: "New station here" puts a station exactly where the creator
  // points; the place must be the ground under the pointer, with the
  // ground's own height, so the station stands on it.
  it("a right click on the ground opens it at the pointer, with the ground's place", () => {
    const t = setup({ selected: null });
    t.element.dispatchEvent(
      pointer("pointerdown", { x: 30, y: 40 }, { button: 2, buttons: 2 }),
    );
    window.dispatchEvent(pointer("pointerup", { x: 30, y: 40 }, { button: 2 }));
    const event = context(t.element, { x: 30, y: 40 });
    // The browser's own menu does not open over the scene.
    expect(event.defaultPrevented).toBe(true);
    expect(t.page.groundMenu).toHaveBeenCalledTimes(1);
    expect(t.page.groundMenu).toHaveBeenCalledWith(
      { x: 30, y: 40 },
      {
        lat: PIN.geo.lat - 40 / 111_000,
        lon: PIN.geo.lon + 30 / 74_000,
        alt: 518.5,
      },
    );
    // A right click selects nothing.
    expect(t.page.select).not.toHaveBeenCalled();
    t.input.dispose();
  });

  it("opens it with no place where no ground has loaded under the pointer", () => {
    const t = setup({
      selected: null,
      world: { ...WORLD, groundUnder: () => ({ miss: "not-loaded" }) },
    });
    context(t.element, { x: 5, y: 5 });
    expect(t.page.groundMenu).toHaveBeenCalledWith({ x: 5, y: 5 }, null);
    t.input.dispose();
    const u = setup({
      selected: null,
      world: { ...WORLD, groundAt: () => null },
    });
    context(u.element, { x: 5, y: 5 });
    expect(u.page.groundMenu).toHaveBeenCalledWith({ x: 5, y: 5 }, null);
    u.input.dispose();
  });

  // Why: a right drag pans the camera; the browser sends its contextmenu
  // after the release, and a menu popping up at the end of every pan
  // would be in the way.
  it("a right drag (the camera's pan) opens nothing", () => {
    const t = setup({ selected: null });
    t.element.dispatchEvent(
      pointer("pointerdown", { x: 30, y: 40 }, { button: 2, buttons: 2 }),
    );
    window.dispatchEvent(
      pointer("pointermove", { x: 80, y: 40 }, { buttons: 2 }),
    );
    window.dispatchEvent(pointer("pointerup", { x: 80, y: 40 }, { button: 2 }));
    const event = context(t.element, { x: 80, y: 40 });
    expect(event.defaultPrevented).toBe(true);
    expect(t.page.groundMenu).not.toHaveBeenCalled();
    t.input.dispose();
  });

  it("a long press of a finger opens it, and its release selects nothing", () => {
    const t = setup({ selected: null, pick: "pin" });
    t.element.dispatchEvent(
      pointer("pointerdown", { x: 10, y: 10 }, { touch: true }),
    );
    // The browser sends the long press's contextmenu while the finger is down.
    context(t.element, { x: 10, y: 10 });
    expect(t.page.groundMenu).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      pointer("pointerup", { x: 10, y: 10 }, { touch: true }),
    );
    expect(t.page.select).not.toHaveBeenCalled();
    t.input.dispose();
  });

  // Why: iOS sends no contextmenu for a long press, so on an iPhone or
  // an iPad the ground menu had no way to open. The page times the press
  // itself; a browser that also sends its contextmenu must not open the
  // menu twice, and an orbit or a pinch must never open it.
  it("a finger held still opens it with no contextmenu from the browser, once, and its release selects nothing", () => {
    vi.useFakeTimers();
    try {
      const t = setup({ selected: null, pick: "pin" });
      t.element.dispatchEvent(
        pointer("pointerdown", { x: 10, y: 10 }, { touch: true }),
      );
      window.dispatchEvent(
        pointer("pointermove", { x: 13, y: 12 }, { touch: true }),
      );
      vi.advanceTimersByTime(LONG_PRESS.holdMs - 1);
      expect(t.page.groundMenu).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(t.page.groundMenu).toHaveBeenCalledTimes(1);
      expect(t.page.groundMenu).toHaveBeenCalledWith(
        { x: 10, y: 10 },
        expect.objectContaining({ alt: 518.5 }),
      );
      // A browser that sends its own contextmenu as well: still once.
      context(t.element, { x: 10, y: 10 });
      expect(t.page.groundMenu).toHaveBeenCalledTimes(1);
      window.dispatchEvent(
        pointer("pointerup", { x: 10, y: 10 }, { touch: true }),
      );
      expect(t.page.select).not.toHaveBeenCalled();
      t.input.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a finger that moves (the camera's orbit) or a second finger (a pinch) opens nothing", () => {
    vi.useFakeTimers();
    try {
      const t = setup({ selected: null });
      t.element.dispatchEvent(
        pointer("pointerdown", { x: 10, y: 10 }, { touch: true, id: 1 }),
      );
      window.dispatchEvent(
        pointer("pointermove", { x: 40, y: 10 }, { touch: true, id: 1 }),
      );
      vi.advanceTimersByTime(LONG_PRESS.holdMs * 2);
      window.dispatchEvent(
        pointer("pointerup", { x: 40, y: 10 }, { touch: true, id: 1 }),
      );
      t.element.dispatchEvent(
        pointer("pointerdown", { x: 10, y: 10 }, { touch: true, id: 2 }),
      );
      t.element.dispatchEvent(
        pointer("pointerdown", { x: 90, y: 10 }, { touch: true, id: 3 }),
      );
      vi.advanceTimersByTime(LONG_PRESS.holdMs * 2);
      expect(t.page.groundMenu).not.toHaveBeenCalled();
      t.input.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not the docks': a right click on a dock opens nothing", () => {
    const t = setup({ selected: null });
    context(t.dock, { x: 5, y: 5 });
    expect(t.page.groundMenu).not.toHaveBeenCalled();
    t.input.dispose();
  });
});
