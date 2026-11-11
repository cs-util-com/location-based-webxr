/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import {
  attachInventedRoofsSwitch,
  type InventedRoofsSwitch,
} from "./invented-roofs-switch.js";

function setup(initial = true): {
  box: HTMLInputElement;
  status: HTMLElement;
  choose: ReturnType<typeof vi.fn>;
  control: InventedRoofsSwitch;
  storeChanges: (on: boolean) => void;
} {
  document.body.innerHTML =
    '<input type="checkbox" id="b"><span id="t" role="status"></span>';
  const box = document.getElementById("b") as HTMLInputElement;
  const status = document.getElementById("t") as HTMLElement;
  let value = initial;
  const listeners: Array<() => void> = [];
  const choose = vi.fn((on: boolean) => {
    value = on;
    for (const listener of listeners) listener();
  });
  const control = attachInventedRoofsSwitch({
    box,
    status,
    store: {
      selected: () => value,
      subscribe: (listener) => listeners.push(listener),
    },
    choose,
    rebuild: () => undefined,
  });
  const storeChanges = (on: boolean): void => {
    value = on;
    for (const listener of listeners) listener();
  };
  return { box, status, choose, control, storeChanges };
}

function toggle(box: HTMLInputElement): void {
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change"));
}

describe("attachInventedRoofsSwitch", () => {
  it("shows the boot choice", () => {
    // Why this test matters: a link with the roofs switched off must open
    // with the box unticked, or the box lies about what is drawn.
    expect(setup(true).box.checked).toBe(true);
    expect(setup(false).box.checked).toBe(false);
  });

  it("shows the switch in progress until a mesh built with the choice is drawn", () => {
    // Why this test matters: the switch is a full rebuild; the in-progress
    // state must last until the durable end state, not the dispatch, and a
    // mesh from a pass in flight with the old choice must not end it.
    const { box, status, choose, control } = setup(true);
    toggle(box);
    expect(choose).toHaveBeenCalledWith(false);
    expect(box.disabled).toBe(true);
    expect(status.textContent).toBe("Applying flat roofs...");
    expect(control.pending()).toBe(false);
    control.meshDrawn(true);
    expect(box.disabled).toBe(true);
    control.meshDrawn(false);
    expect(box.disabled).toBe(false);
    expect(status.textContent).toBe("");
    expect(control.pending()).toBeUndefined();
  });

  it("treats a mesh without the field as built with invented roofs", () => {
    // Why this test matters: the worker omits nothing today, but the field is
    // optional in the protocol and absent means the default (on).
    const { box, control } = setup(false);
    toggle(box);
    expect(box.disabled).toBe(true);
    control.meshDrawn(undefined);
    expect(box.disabled).toBe(false);
  });

  it("reverts to what is drawn when its own build failed", () => {
    // Why this test matters: a failed rebuild leaves the old city on screen;
    // the box must go back to it and the store must follow, or the next pass
    // retries the failing build forever.
    const { box, status, choose, control } = setup(true);
    toggle(box);
    choose.mockClear();
    control.failed(false);
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    expect(status.textContent).toBe("");
    expect(choose).toHaveBeenCalledWith(true);
  });

  it("keeps the choice when an unrelated failure ends the switch", () => {
    // Why this test matters: an Overpass or terrain error says nothing about
    // roofs; the next pass builds the choice, so it must not be undone.
    const { box, choose, control } = setup(true);
    toggle(box);
    choose.mockClear();
    control.failed(undefined);
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });

  it("follows the store when it changes elsewhere", () => {
    // Why this test matters: a revert or another control changes the store;
    // the box must show the store's value.
    const { box, storeChanges } = setup(true);
    storeChanges(false);
    expect(box.checked).toBe(false);
  });

  it("ignores a failure or mesh when no switch is pending", () => {
    // Why this test matters: ordinary passes report meshes and failures all
    // the time; they must not touch an idle box.
    const { box, choose, control } = setup(true);
    control.failed(true);
    control.meshDrawn(false);
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
});
