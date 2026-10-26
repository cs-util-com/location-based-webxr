/**
 * The 3D view's pointer, touch and keys for editing (the design's): select
 * first, then drag a handle of the gizmo; a click selects what is under
 * the pointer (nothing: none), a double click or a double tap frames it;
 * the keys nudge, turn, lift, delete and duplicate the selection; two
 * fingers move the camera only, and a second finger during a drag cancels
 * the drag. A right click that did not move (a right drag pans), or a
 * finger's long press, opens the page's ground menu with the ground's
 * place under it (`InputPage.groundMenu`).
 *
 * What it writes (the store's rule for the 3D view): a gesture's start
 * (`gestureStarted`) and end (`gestureEnded`) to `editorView`, and the
 * one edit of a finished gesture through the page (`commit`) - one undo
 * step. Nothing during a drag's frames: the preview is the scene's
 * (`InputScene.preview`). A held key is one gesture: its repeats move the
 * preview, and letting go of the keys writes one edit. A locked station
 * (`GestureTarget.locked`) takes no pose key and no drag of its middle or
 * knob: its radius dots stay.
 *
 * OrbitControls keeps the camera's own input; a gesture or two fingers
 * lock it (`InputScene.lockCamera`) rather than hide events from it, so
 * its bookkeeping of the pointers stays whole.
 *
 * @see editor3d-input.ts.md
 */
import type { UnknownAction } from "@reduxjs/toolkit";

import type { GroundPlace } from "../editor/editor-shell/scene-menu.js";
import { editorViewActions, STATION_LOCKED } from "../editor/editor-view.js";
import {
  poseLocked,
  startGesture,
  startKeyGesture,
  type Gesture,
  type GestureEdit,
  type GesturePreview,
  type GestureTarget,
  type GestureWorld,
  type KeyGesture,
} from "./gesture.js";
import { sceneKey, type GizmoHandle, type ScreenPoint } from "./gizmo-maths.js";
import { createLongPress, LONG_PRESS } from "./long-press.js";
import { twoFingerMode, type FingerPair } from "./two-finger.js";

/** What the input reads of the scene and asks of it. */
export interface InputScene {
  /** The selection as a gesture's target; null for none, or one without
   *  handles (a code). */
  target(selection: string): GestureTarget | null;
  /** The gizmo's handle under a pointer; null: the camera's. */
  handleAt(pointer: ScreenPoint): GizmoHandle | null;
  /** What a click at a pointer selects; null: nothing. */
  pickAt(pointer: ScreenPoint): string | null;
  readonly world: GestureWorld;
  /** Draw a gesture's preview of `target` (null: the tour as it is). */
  preview(target: GestureTarget, preview: GesturePreview | null): void;
  /** The handle drawn larger (under the pointer, or held). */
  hover(handle: GizmoHandle | null): void;
  /** OrbitControls takes no input while locked. */
  lockCamera(on: boolean): void;
  /** Two fingers began moving the camera (a flight ends). */
  twoFingerStart(): void;
  /** Two fingers moved from `last` to `now`, read as `mode`. */
  twoFinger(mode: "tilt" | "map", last: FingerPair, now: FingerPair): void;
  /** Fly to a selection (a double click or a double tap). */
  frame(selection: string): void;
}

/** What the input asks of the page. */
export interface InputPage {
  dispatch(action: UnknownAction): void;
  /** The page's selection. */
  selected(): string | null;
  select(id: string | null): void;
  /** Write a gesture's edit (one undo step). */
  commit(edit: GestureEdit): void;
  remove(selection: string): void;
  duplicate(selection: string): void;
  say(text: string): void;
  /** A right click (a long press of a finger) on the scene: the ground
   *  menu at `point`, for the ground's place there (its ellipsoidal
   *  height), or for none where no ground has loaded. */
  groundMenu(point: ScreenPoint, place: GroundPlace | null): void;
  /** The keys are the view's: no dialog shows, no field has the focus. */
  keysFree(event: KeyboardEvent): boolean;
}

/** The ground's place under `at`, or null where none has loaded. */
function groundPlace(world: GestureWorld, at: ScreenPoint): GroundPlace | null {
  const hit = world.groundUnder(at);
  if (!("at" in hit)) return null;
  const place = world.placeOf(hit.at);
  const alt = world.groundAt(place);
  return alt === null ? null : { ...place, alt };
}

/** The input's numbers (the design's). */
export const INPUT = Object.freeze({
  /** A press that moved less than this is a click (px; a finger more). */
  clickPx: 4,
  tapPx: 8,
  /** Two taps within this, this close, are a double tap. */
  doubleTapMs: 400,
  doubleTapPx: 30,
});

/** Said when a second finger cancels a drag (the design's words). */
export const TWO_FINGER_CANCEL =
  "Two fingers move the camera - the edit was undone";

interface Press {
  readonly id: number;
  readonly at: ScreenPoint;
  readonly touch: boolean;
  readonly button: number;
  moved: boolean;
  /** Part of a two-finger touch: never a click. */
  multi: boolean;
  /** The browser asked for the context menu while the button was down
   *  (as it does on some systems): the ground menu opens on the release,
   *  if the press did not move (a right drag pans). */
  menuOnRelease?: boolean;
}

/**
 * The input on `element` (the 3D view's box: its presses are read before
 * OrbitControls sees them) and the window's keys, until `dispose`. Only a
 * press on `surface` (the canvas) is the scene's: the docks over the view
 * keep theirs; a pointer's position is read against it. `frame` is called
 * each frame (a drag waiting for its ground tries again; a gesture whose
 * selection went is cancelled).
 */
export function createSceneInput(input: {
  readonly element: HTMLElement;
  readonly surface: HTMLElement;
  readonly scene: InputScene;
  readonly page: InputPage;
}) {
  const { element, surface, scene, page } = input;
  let drag: {
    readonly gesture: Gesture;
    readonly selection: string;
    readonly pointerId: number;
  } | null = null;
  let held: {
    readonly gesture: KeyGesture;
    readonly selection: string;
    readonly codes: Set<string>;
  } | null = null;
  let press: Press | null = null;
  /** The press that ended last, until the next: the context menu a
   *  browser sends after a right button's release reads it. */
  let lastPress: Press | null = null;
  const fingers = new Map<number, ScreenPoint>();
  let touchBlocked = false;
  let two: {
    start: FingerPair;
    last: FingerPair;
    mode: "tilt" | "map" | null;
  } | null = null;
  let lastTap: { t: number; at: ScreenPoint } | null = null;
  let hovered: GizmoHandle | null = null;
  /** A finger held still opens the ground menu: iOS sends no context
   *  menu for a long press. Where the browser does send one too, the
   *  first of the two opens it and marks the press moved, so the other
   *  does nothing and the release selects nothing. */
  const longPress = createLongPress({
    ...LONG_PRESS,
    schedule: (run, ms) => window.setTimeout(run, ms),
    cancel: (id) => {
      window.clearTimeout(id);
    },
    fire: (at) => {
      const p = press;
      if (p === null || !p.touch || p.moved || p.multi || drag !== null) {
        return;
      }
      p.moved = true;
      page.groundMenu(at, groundPlace(scene.world, at));
    },
  });

  const pointOf = (event: {
    clientX: number;
    clientY: number;
  }): ScreenPoint => {
    const r = surface.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  const setHover = (handle: GizmoHandle | null) => {
    if (handle === hovered) return;
    hovered = handle;
    scene.hover(handle);
  };

  /** The drag's end: the store told first, then the edit written, then
   *  the preview dropped (the tour already carries the edit by then). */
  const endDrag = (commit: boolean) => {
    const was = drag;
    if (was === null) return;
    drag = null;
    page.dispatch(editorViewActions.gestureEnded());
    const edit = commit ? was.gesture.edit() : null;
    if (edit !== null) page.commit(edit);
    scene.preview(was.gesture.target, null);
    scene.lockCamera(touchBlocked);
    setHover(null);
    surface.style.cursor = "";
  };

  const endHold = (commit: boolean) => {
    const was = held;
    if (was === null) return;
    held = null;
    page.dispatch(editorViewActions.gestureEnded());
    const edit = commit ? was.gesture.edit() : null;
    if (edit !== null) page.commit(edit);
    scene.preview(was.gesture.target, null);
  };

  const fingerPair = (): FingerPair | null => {
    const [a, b] = [...fingers.values()];
    return a === undefined || b === undefined ? null : [a, b];
  };

  const onDown = (event: PointerEvent) => {
    lastPress = null;
    const at = pointOf(event);
    const touch = event.pointerType === "touch";
    // A finger on a dock is not the scene's, unless one already is.
    if (touch && (event.target === surface || fingers.size > 0)) {
      fingers.set(event.pointerId, at);
      longPress.down(event.pointerId, at);
      if (fingers.size > 1) {
        // Two fingers are the camera's: a drag under way is cancelled,
        // the document left as it was, and the camera stays locked until
        // every finger is up.
        touchBlocked = true;
        if (press !== null) press.multi = true;
        if (drag !== null) {
          endDrag(false);
          page.say(TWO_FINGER_CANCEL);
        }
        scene.lockCamera(true);
        const pair = fingerPair();
        if (fingers.size === 2 && pair !== null) {
          two = { start: pair, last: pair, mode: null };
          scene.twoFingerStart();
        }
        return;
      }
    }
    if (event.target !== surface) return;
    press = {
      id: event.pointerId,
      at,
      touch,
      button: event.button,
      moved: false,
      multi: touchBlocked,
    };
    if (touchBlocked || event.button !== 0 || drag !== null || held !== null) {
      return;
    }
    const selection = page.selected();
    if (selection === null) return;
    const target = scene.target(selection);
    if (target === null) return;
    const handle = scene.handleAt(at);
    if (handle === null) return;
    // Before OrbitControls reads this press (the listener captures), and
    // before the gesture reads the pointer: the lock stops a flight or a
    // coast, so the camera stands still from here.
    scene.lockCamera(true);
    const gesture = startGesture(handle, target, at, scene.world);
    if (gesture === null) {
      scene.lockCamera(touchBlocked);
      return;
    }
    event.preventDefault();
    longPress.cancel();
    drag = { gesture, selection, pointerId: event.pointerId };
    page.dispatch(editorViewActions.gestureStarted({ id: selection, handle }));
    setHover(handle);
    surface.style.cursor = "grabbing";
  };

  const onMove = (event: PointerEvent) => {
    const at = pointOf(event);
    if (event.pointerType === "touch" && fingers.has(event.pointerId)) {
      fingers.set(event.pointerId, at);
      longPress.move(event.pointerId, at);
      const now = fingerPair();
      if (two !== null && now !== null) {
        two.mode ??= twoFingerMode(two.start, now);
        if (two.mode !== null) {
          scene.twoFinger(two.mode, two.last, now);
          two.last = now;
        }
        return;
      }
    }
    if (drag !== null && event.pointerId === drag.pointerId) {
      drag.gesture.move(at, event.shiftKey);
      scene.preview(drag.gesture.target, drag.gesture.preview());
      if (press !== null) press.moved = true;
      return;
    }
    if (press !== null && event.pointerId === press.id) {
      const d = Math.hypot(at.x - press.at.x, at.y - press.at.y);
      if (d > (press.touch ? INPUT.tapPx : INPUT.clickPx)) press.moved = true;
      return;
    }
    // A mouse over the scene (not a dock): the handle under it drawn
    // larger.
    if (
      event.pointerType === "mouse" &&
      event.buttons === 0 &&
      event.target === surface
    ) {
      const selection = page.selected();
      const handle =
        selection !== null && scene.target(selection) !== null
          ? scene.handleAt(at)
          : null;
      setHover(handle);
      surface.style.cursor = handle === null ? "" : "grab";
    }
  };

  const onEnd = (event: PointerEvent) => {
    const at = pointOf(event);
    if (event.pointerType === "touch") {
      fingers.delete(event.pointerId);
      longPress.end(event.pointerId);
      if (fingers.size < 2) two = null;
      if (fingers.size === 0 && touchBlocked) {
        touchBlocked = false;
        if (drag === null) scene.lockCamera(false);
      }
    }
    const wasDrag = drag !== null && event.pointerId === drag.pointerId;
    if (wasDrag) endDrag(event.type === "pointerup");
    const p = press;
    if (p === null || event.pointerId !== p.id) return;
    press = null;
    lastPress = p;
    if (p.menuOnRelease === true) {
      if (event.type === "pointerup" && !p.moved && !p.multi) {
        page.groundMenu(p.at, groundPlace(scene.world, p.at));
      }
      return;
    }
    if (
      event.type !== "pointerup" ||
      wasDrag ||
      p.moved ||
      p.multi ||
      p.button !== 0
    ) {
      return;
    }
    const hit = scene.pickAt(at);
    page.select(hit);
    if (!p.touch) return;
    const t = event.timeStamp;
    if (
      lastTap !== null &&
      t - lastTap.t < INPUT.doubleTapMs &&
      Math.hypot(at.x - lastTap.at.x, at.y - lastTap.at.y) < INPUT.doubleTapPx
    ) {
      lastTap = null;
      if (hit !== null) scene.frame(hit);
    } else {
      lastTap = { t, at };
    }
  };

  /** The ground menu: a right click that did not move (a right drag is
   *  the camera's pan), or a finger's long press. */
  const onContextMenu = (event: MouseEvent) => {
    // The browser's own menu never opens over the scene.
    event.preventDefault();
    if (drag !== null) return;
    const p = press ?? lastPress;
    lastPress = null;
    if (p !== null && (p.moved || p.multi)) return;
    if (p !== null && p === press) {
      // Sent while the button is down: wait for the release, which tells
      // a click from a pan. A finger's long press opens it now, and its
      // release selects nothing.
      if (!p.touch) {
        p.menuOnRelease = true;
        return;
      }
      p.moved = true;
    }
    const at = pointOf(event);
    page.groundMenu(at, groundPlace(scene.world, at));
  };

  const onDoubleClick = (event: MouseEvent) => {
    const hit = scene.pickAt(pointOf(event));
    if (hit === null) return;
    page.select(hit);
    scene.frame(hit);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (drag !== null || !page.keysFree(event)) return;
    const key = sceneKey(event);
    if (key === null) return;
    const selection = page.selected();
    if (key.kind === "delete" || key.kind === "duplicate") {
      // A code (no target) is read-only here, as on the map.
      if (selection === null || scene.target(selection) === null) return;
      event.preventDefault();
      endHold(true);
      if (key.kind === "delete") page.remove(selection);
      else page.duplicate(selection);
      return;
    }
    // The design's: the arrows are the view's even with nothing selected
    // (they would scroll the page); the other keys only with a selection.
    if (selection === null) {
      if (event.code.startsWith("Arrow")) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (held !== null && held.selection !== selection) endHold(true);
    if (held === null) {
      const target = scene.target(selection);
      if (target === null) return;
      // A locked station's pose keys are refused, said once per press (a
      // held key's repeats say nothing more).
      if (poseLocked(target)) {
        if (!event.repeat) page.say(STATION_LOCKED);
        return;
      }
      held = {
        gesture: startKeyGesture(target, scene.world),
        selection,
        codes: new Set(),
      };
      page.dispatch(
        editorViewActions.gestureStarted({ id: selection, handle: "key" }),
      );
    }
    held.codes.add(event.code);
    held.gesture.press(key);
    scene.preview(held.gesture.target, held.gesture.preview());
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (held === null) return;
    held.codes.delete(event.code);
    if (held.codes.size === 0) endHold(true);
  };

  const onBlur = () => {
    endHold(true);
  };

  element.addEventListener("pointerdown", onDown, true);
  surface.addEventListener("dblclick", onDoubleClick);
  surface.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    /** Each frame: a drag waiting for its ground tries again (a progress
     *  cursor while it waits); when the selection changed meanwhile (Esc,
     *  a click in the tree) a drag is cancelled and a key hold written -
     *  its nudges were already shown. */
    frame() {
      const selection = page.selected();
      if (drag !== null && drag.selection !== selection) endDrag(false);
      if (held !== null && held.selection !== selection) endHold(true);
      if (drag?.gesture.waiting() === true) {
        drag.gesture.retry();
        scene.preview(drag.gesture.target, drag.gesture.preview());
      }
      if (drag !== null) {
        surface.style.cursor = drag.gesture.waiting() ? "progress" : "grabbing";
      }
    },
    /** Cancel a gesture under way, writing nothing (an undo, a redo). */
    cancel() {
      endDrag(false);
      endHold(false);
    },
    /** The handle of the gesture under way, or null. */
    gesture(): GizmoHandle | "key" | null {
      return drag?.gesture.handle ?? (held === null ? null : "key");
    },
    dispose() {
      endDrag(false);
      endHold(false);
      longPress.cancel();
      element.removeEventListener("pointerdown", onDown, true);
      surface.removeEventListener("dblclick", onDoubleClick);
      surface.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      scene.lockCamera(false);
    },
  };
}
