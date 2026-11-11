/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import { attachBuildChoiceSwitch } from "./build-choice-switch.js";

/**
 * WHY THESE TESTS MATTER. Every header checkbox that rebuilds the city (the
 * invented roofs, the zebras and pedestrian areas) shares one switch: its
 * in-progress state, its echo and its revert are the behaviour the async-UI
 * rule asks for, so they must not drift apart between two copies. The roofs'
 * own suite covers the behaviour; these pin what each switch names itself.
 */
function setup(initial: unknown = true) {
  document.body.innerHTML =
    '<input type="checkbox" id="b"><span id="t" role="status"></span>';
  const box = document.getElementById("b") as HTMLInputElement;
  const status = document.getElementById("t") as HTMLElement;
  const choose = vi.fn();
  const control = attachBuildChoiceSwitch({
    name: "zebras",
    box,
    status,
    initial: initial as boolean,
    choose,
    applying: (on) => (on ? "Painting zebras..." : "Removing zebras..."),
  });
  return { box, status, choose, control };
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
      new TypeError("zebras: initial must be a boolean"),
    );
  });
});
