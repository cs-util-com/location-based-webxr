/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPreviewControls } from "./preview-controls.js";

let keyTarget: HTMLElement;
let pointerTarget: HTMLElement;

function key(type: "keydown" | "keyup", code: string, shiftKey = false): void {
  keyTarget.dispatchEvent(
    new KeyboardEvent(type, { code, shiftKey, bubbles: true }),
  );
}

function pointer(type: string, clientX: number, clientY = 0): void {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true });
  pointerTarget.dispatchEvent(event);
}

beforeEach(() => {
  keyTarget = document.createElement("div");
  pointerTarget = document.createElement("div");
  document.body.append(keyTarget, pointerTarget);
});

afterEach(() => {
  keyTarget.remove();
  pointerTarget.remove();
});

describe("preview controls", () => {
  it("reports no movement until a key is pressed", () => {
    const controls = createPreviewControls({ keyTarget, pointerTarget });

    expect(controls.sample().input).toEqual({
      forward: 0,
      strafe: 0,
      turn: 0,
      run: false,
    });
    controls.dispose();
  });

  it("maps WASD and the arrow keys onto walk input", () => {
    const controls = createPreviewControls({ keyTarget, pointerTarget });

    key("keydown", "KeyW");
    key("keydown", "KeyD");
    expect(controls.sample().input).toMatchObject({ forward: 1, strafe: 1 });

    key("keyup", "KeyW");
    key("keydown", "ArrowDown");
    expect(controls.sample().input).toMatchObject({ forward: -1, strafe: 1 });

    key("keydown", "ArrowLeft");
    expect(controls.sample().input.turn).toBe(-1);
    controls.dispose();
  });

  it("reports the run modifier while shift is held", () => {
    const controls = createPreviewControls({ keyTarget, pointerTarget });

    key("keydown", "ShiftLeft", true);
    expect(controls.sample().input.run).toBe(true);

    key("keyup", "ShiftLeft");
    expect(controls.sample().input.run).toBe(false);
    controls.dispose();
  });

  it("turns the view by a mouse drag, and only while dragging", () => {
    const controls = createPreviewControls({
      keyTarget,
      pointerTarget,
      lookSensitivityRadPerPx: 0.01,
    });

    pointer("mousemove", 100);
    expect(controls.sample().yawDeltaRad).toBe(0);

    pointer("mousedown", 100);
    pointer("mousemove", 130);
    expect(controls.sample().yawDeltaRad).toBeCloseTo(0.3, 5);

    // Each sample drains the accumulated delta — it is applied exactly once.
    expect(controls.sample().yawDeltaRad).toBe(0);

    pointer("mouseup", 130);
    pointer("mousemove", 200);
    expect(controls.sample().yawDeltaRad).toBe(0);
    controls.dispose();
  });

  it("turns the view by a touch drag, and only while dragging", () => {
    const controls = createPreviewControls({
      keyTarget,
      pointerTarget,
      lookSensitivityRadPerPx: 0.01,
    });

    const touchStart = new TouchEvent("touchstart", {
      touches: [{ clientX: 100, clientY: 0 } as Touch],
      bubbles: true,
    });
    pointerTarget.dispatchEvent(touchStart);

    const touchMove = new TouchEvent("touchmove", {
      touches: [{ clientX: 130, clientY: 0 } as Touch],
      bubbles: true,
    });
    pointerTarget.dispatchEvent(touchMove);
    expect(controls.sample().yawDeltaRad).toBeCloseTo(0.3, 5);

    const touchEnd = new TouchEvent("touchend", {
      changedTouches: [{ clientX: 130, clientY: 0 } as Touch],
      bubbles: true,
    });
    pointerTarget.dispatchEvent(touchEnd);

    const touchMoveAfterEnd = new TouchEvent("touchmove", {
      touches: [{ clientX: 200, clientY: 0 } as Touch],
      bubbles: true,
    });
    pointerTarget.dispatchEvent(touchMoveAfterEnd);
    expect(controls.sample().yawDeltaRad).toBe(0);
    controls.dispose();
  });

  it("stops responding once disposed", () => {
    const controls = createPreviewControls({ keyTarget, pointerTarget });
    controls.dispose();

    key("keydown", "KeyW");

    expect(controls.sample().input.forward).toBe(0);
  });
});
