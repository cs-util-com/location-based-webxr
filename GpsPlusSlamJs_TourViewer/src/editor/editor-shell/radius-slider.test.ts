// @vitest-environment jsdom
/**
 * Why these tests matter: the radius slider is the one control of the
 * inspector that changes the 3D view on every step of a drag. A drag must
 * show its radius and write nothing until the release, or a drag across
 * the track would be dozens of undo steps; a press that ends where it
 * began must write nothing at all; and a drag cut off (the selection gone
 * under it) must leave the view as the tour has it, or the ring would keep
 * a size the tour never took.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RADIUS_SLIDER,
  radiusRange,
  wireRadiusSlider,
} from "./radius-slider.js";

let root: HTMLElement;
let number: HTMLInputElement;
let slider: HTMLInputElement;
let selected: { id: string; radiusM: number } | null;
const preview = vi.fn<(id: string, radiusM: number | null) => void>();
const write = vi.fn<(id: string, radiusM: number) => void>();

function drawn(radiusM: number): void {
  const box = document.createElement("div");
  box.className = "num";
  number = document.createElement("input");
  number.dataset["field"] = "radius";
  number.defaultValue = radiusM.toFixed(1);
  box.append(number);
  root.replaceChildren(radiusRange(box, radiusM));
  slider = root.querySelector("input[type=range]") as HTMLInputElement;
}

function drag(to: number): void {
  slider.value = String(to);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function release(): void {
  slider.dispatchEvent(new Event("change", { bubbles: true }));
}

function wired() {
  return wireRadiusSlider({
    root,
    station: () => selected,
    preview,
    write,
  });
}

beforeEach(() => {
  document.body.innerHTML = "<div id=r></div>";
  root = document.getElementById("r") as HTMLElement;
  selected = { id: "gate", radiusM: 25 };
  preview.mockClear();
  write.mockClear();
  drawn(25);
});

describe("radiusRange", () => {
  it("puts the slider before the number, over the prototype's range", () => {
    const box = root.querySelector(".range") as HTMLElement;
    expect(box.firstElementChild).toBe(slider);
    expect(box.lastElementChild?.classList.contains("num")).toBe(true);
    expect(slider.min).toBe(String(RADIUS_SLIDER.min));
    expect(slider.max).toBe(String(RADIUS_SLIDER.max));
    expect(slider.value).toBe("25");
    expect(slider.getAttribute("aria-label")).toBe("Radius");
  });

  // Why: the format takes radii the track does not reach. The thumb rests
  // at its end, and the number keeps saying what the tour holds.
  it("rests at the end for a radius past the track", () => {
    drawn(250);
    expect(slider.value).toBe("100");
    expect(number.value).toBe("250.0");
  });
});

describe("wireRadiusSlider", () => {
  it("shows the radius during a drag and writes one edit on release", () => {
    wired();
    drag(30);
    drag(42);
    expect(preview.mock.calls).toEqual([
      ["gate", 30],
      ["gate", 42],
    ]);
    expect(number.value).toBe("42.0");
    expect(write).not.toHaveBeenCalled();
    release();
    expect(write.mock.calls).toEqual([["gate", 42]]);
    expect(preview).toHaveBeenLastCalledWith("gate", null);
  });

  it("writes nothing for a drag that ends where it began", () => {
    wired();
    drag(30);
    drag(25);
    release();
    expect(write).not.toHaveBeenCalled();
    expect(preview).toHaveBeenLastCalledWith("gate", null);
  });

  // Why: the view drops the preview once the tour carries the edit: the
  // other order would show the old ring for a frame.
  it("drops the preview after the edit is written", () => {
    wired();
    const order: string[] = [];
    write.mockImplementationOnce(() => order.push("write"));
    preview.mockImplementation((_, r) => {
      if (r === null) order.push("preview off");
    });
    drag(30);
    release();
    preview.mockReset();
    expect(order).toEqual(["write", "preview off"]);
  });

  it("puts the number back for an edit that changed nothing", () => {
    wired();
    drag(30);
    release();
    // The page refused it: no draw replaced the field.
    expect(number.value).toBe(number.defaultValue);
  });

  it("gives the view back when the drag is cut off", () => {
    const radius = wired();
    drag(30);
    radius.cancel();
    expect(preview).toHaveBeenLastCalledWith("gate", null);
    expect(number.value).toBe("25.0");
    preview.mockClear();
    radius.cancel();
    expect(preview).not.toHaveBeenCalled();
    release();
    expect(write).not.toHaveBeenCalled();
  });

  it("ignores every other input of the dock, and a selection that is none", () => {
    wired();
    number.dispatchEvent(new Event("input", { bubbles: true }));
    number.dispatchEvent(new Event("change", { bubbles: true }));
    selected = null;
    drag(30);
    release();
    expect(preview).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
