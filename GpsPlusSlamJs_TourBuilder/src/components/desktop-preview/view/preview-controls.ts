/**
 * Keyboard + mouse-look input for the desktop preview.
 *
 * Turns raw DOM events into the `WalkInput` the pure simulator consumes, so
 * the walking rules stay testable without a DOM and the DOM plumbing stays
 * testable without a renderer. Look deltas are *accumulated* between samples
 * and drained on read: a frame that renders late must still apply every pixel
 * the mouse moved, exactly once.
 *
 * Drag-to-look rather than Pointer Lock: the preview shares its container with
 * the HUD and the map, both of which need a normal cursor, and a locked
 * pointer would swallow their clicks.
 */

import type { WalkInput } from "../core/walk-simulator.js";

export interface PreviewControlsOptions {
  /** Where key events are listened for — usually `window`. */
  readonly keyTarget: EventTarget;
  /** The canvas: dragging inside it looks around. */
  readonly pointerTarget: HTMLElement;
  readonly lookSensitivityRadPerPx?: number;
}

interface ControlsSample {
  readonly input: WalkInput;
  /** Yaw accumulated since the last sample (right-positive), in radians. */
  readonly yawDeltaRad: number;
  /** Pitch accumulated since the last sample (up-positive), in radians. */
  readonly pitchDeltaRad: number;
}

export interface PreviewControls {
  /** Read and drain the input accumulated since the previous call. */
  sample(): ControlsSample;
  dispose(): void;
}

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACKWARD_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA"]);
const RIGHT_KEYS = new Set(["KeyD"]);
const TURN_LEFT_KEYS = new Set(["ArrowLeft", "KeyQ"]);
const TURN_RIGHT_KEYS = new Set(["ArrowRight", "KeyE"]);
const RUN_KEYS = new Set(["ShiftLeft", "ShiftRight"]);

/** All the keys this module claims; anything else is left to the page. */
const HANDLED = new Set([
  ...FORWARD_KEYS,
  ...BACKWARD_KEYS,
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
  ...TURN_LEFT_KEYS,
  ...TURN_RIGHT_KEYS,
  ...RUN_KEYS,
]);

const axis = (
  held: ReadonlySet<string>,
  positive: ReadonlySet<string>,
  negative: ReadonlySet<string>,
): number => {
  const forward = [...positive].some((code) => held.has(code)) ? 1 : 0;
  const backward = [...negative].some((code) => held.has(code)) ? 1 : 0;
  return forward - backward;
};

export function createPreviewControls(
  options: PreviewControlsOptions,
): PreviewControls {
  const sensitivity = options.lookSensitivityRadPerPx ?? 0.004;
  const held = new Set<string>();
  let yawDelta = 0;
  let pitchDelta = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onKeyDown = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    if (!HANDLED.has(code)) return;
    held.add(code);
  };
  const onKeyUp = (event: Event): void => {
    held.delete((event as KeyboardEvent).code);
  };
  // A tab switch mid-stride would otherwise leave the walker running forever.
  const onBlur = (): void => held.clear();

  // A touch never fires mouse events on its own, so drag-to-look needs its
  // own touch handlers — mirroring the mouse ones — to work on a phone.
  const touchPoint = (event: TouchEvent): { x: number; y: number } | null => {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onPointerDown = (event: Event): void => {
    dragging = true;
    lastX = (event as MouseEvent).clientX;
    lastY = (event as MouseEvent).clientY;
  };
  const onPointerMove = (event: Event): void => {
    if (!dragging) return;
    const mouse = event as MouseEvent;
    yawDelta += (mouse.clientX - lastX) * sensitivity;
    pitchDelta -= (mouse.clientY - lastY) * sensitivity;
    lastX = mouse.clientX;
    lastY = mouse.clientY;
  };
  const onPointerUp = (): void => {
    dragging = false;
  };

  const onTouchStart = (event: Event): void => {
    const point = touchPoint(event as TouchEvent);
    if (!point) return;
    dragging = true;
    lastX = point.x;
    lastY = point.y;
    event.preventDefault();
  };
  const onTouchMove = (event: Event): void => {
    if (!dragging) return;
    const point = touchPoint(event as TouchEvent);
    if (!point) return;
    yawDelta += (point.x - lastX) * sensitivity;
    pitchDelta -= (point.y - lastY) * sensitivity;
    lastX = point.x;
    lastY = point.y;
    event.preventDefault();
  };
  const onTouchEnd = (): void => {
    dragging = false;
  };

  options.keyTarget.addEventListener("keydown", onKeyDown);
  options.keyTarget.addEventListener("keyup", onKeyUp);
  options.keyTarget.addEventListener("blur", onBlur);
  options.pointerTarget.addEventListener("mousedown", onPointerDown);
  options.pointerTarget.addEventListener("mousemove", onPointerMove);
  options.pointerTarget.addEventListener("mouseup", onPointerUp);
  options.pointerTarget.addEventListener("mouseleave", onPointerUp);
  options.pointerTarget.addEventListener("touchstart", onTouchStart, {
    passive: false,
  });
  options.pointerTarget.addEventListener("touchmove", onTouchMove, {
    passive: false,
  });
  options.pointerTarget.addEventListener("touchend", onTouchEnd);
  options.pointerTarget.addEventListener("touchcancel", onTouchEnd);

  return {
    sample() {
      const sample: ControlsSample = {
        input: {
          forward: axis(held, FORWARD_KEYS, BACKWARD_KEYS),
          strafe: axis(held, RIGHT_KEYS, LEFT_KEYS),
          turn: axis(held, TURN_RIGHT_KEYS, TURN_LEFT_KEYS),
          run: [...RUN_KEYS].some((code) => held.has(code)),
        },
        yawDeltaRad: yawDelta,
        pitchDeltaRad: pitchDelta,
      };
      yawDelta = 0;
      pitchDelta = 0;
      return sample;
    },
    dispose() {
      held.clear();
      options.keyTarget.removeEventListener("keydown", onKeyDown);
      options.keyTarget.removeEventListener("keyup", onKeyUp);
      options.keyTarget.removeEventListener("blur", onBlur);
      options.pointerTarget.removeEventListener("mousedown", onPointerDown);
      options.pointerTarget.removeEventListener("mousemove", onPointerMove);
      options.pointerTarget.removeEventListener("mouseup", onPointerUp);
      options.pointerTarget.removeEventListener("mouseleave", onPointerUp);
      options.pointerTarget.removeEventListener("touchstart", onTouchStart);
      options.pointerTarget.removeEventListener("touchmove", onTouchMove);
      options.pointerTarget.removeEventListener("touchend", onTouchEnd);
      options.pointerTarget.removeEventListener("touchcancel", onTouchEnd);
    },
  };
}
