/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import { attachBuildChoiceSwitch } from "./build-choice-switch.js";

/**
 * WHY THESE TESTS MATTER. Every header checkbox that rebuilds the city (the
 * invented roofs, the zebras and pedestrian areas) shares one switch: its
 * in-progress state, its echo, its revert and the rebuild its choice starts
 * are the behaviour the async-UI rule asks for, so they must not drift apart
 * between two copies. The roofs' own suite covers the behaviour; these pin
 * what each switch names itself and the rebuild it owns.
 */
function setup(initial: unknown = true) {
  document.body.innerHTML =
    '<input type="checkbox" id="b"><span id="t" role="status"></span>';
  const box = document.getElementById("b") as HTMLInputElement;
  const status = document.getElementById("t") as HTMLElement;
  // A minimal store: the switch records into it, and listens to it.
  let value = initial;
  const listeners: Array<() => void> = [];
  const storeChanges = (on: boolean): void => {
    value = on;
    for (const listener of listeners) listener();
  };
  const choose = vi.fn(storeChanges);
  const rebuild = vi.fn();
  const control = attachBuildChoiceSwitch({
    name: "zebras",
    box,
    status,
    store: {
      selected: () => value as boolean,
      subscribe: (listener) => listeners.push(listener),
    },
    choose,
    rebuild,
    applying: (on) => (on ? "Painting zebras..." : "Removing zebras..."),
  });
  return { box, status, choose, rebuild, control, storeChanges };
}

describe("attachBuildChoiceSwitch", () => {
  it("says what it applies in its own words, until the echo", () => {
    const { box, status, choose, control } = setup(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(choose).toHaveBeenCalledWith(false);
    expect(status.textContent).toBe("Removing zebras...");
    expect(box.disabled).toBe(true);
    control.meshDrawn(false);
    expect(status.textContent).toBe("");
    expect(box.disabled).toBe(false);
  });

  it("reverts its own failed build and says nothing more", () => {
    const { box, status, choose, control } = setup(false);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(status.textContent).toBe("Painting zebras...");
    control.failed(true);
    expect(box.checked).toBe(false);
    expect(choose).toHaveBeenLastCalledWith(false);
    expect(status.textContent).toBe("");
  });

  it("names itself when refusing a boot choice that is not a boolean", () => {
    expect(() => setup("yes")).toThrow(
      new TypeError("zebras: the store's choice must be a boolean"),
    );
  });

  // The zebras switch once shipped without its rebuild: the box recorded the
  // choice, nothing rebuilt, and the status waited for an echo forever. The
  // rebuild is now the switch's own, so no switch can be wired without it.
  it("rebuilds once per change of the store's choice, and shows it", () => {
    const { box, rebuild, storeChanges } = setup(true);
    expect(rebuild).not.toHaveBeenCalled();
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(rebuild).toHaveBeenCalledTimes(1);
    storeChanges(false);
    expect(rebuild).toHaveBeenCalledTimes(1);
    storeChanges(true);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(box.checked).toBe(true);
  });

  it("rebuilds when its own failed build is reverted", () => {
    const { box, rebuild, control } = setup(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    control.failed(false);
    expect(box.checked).toBe(true);
    expect(rebuild).toHaveBeenCalledTimes(2);
  });
});
