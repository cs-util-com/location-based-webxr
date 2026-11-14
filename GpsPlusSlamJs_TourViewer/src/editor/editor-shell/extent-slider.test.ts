// @vitest-environment jsdom
/**
 * Why these tests matter: a video's width is set by feel, so it has a
 * slider beside its typed number. A drag must show the width in the number
 * and write nothing until the release (one undo step, not dozens), a
 * release where the drag began writes nothing, a drag cut off writes
 * nothing, and the slider only covers what is set by feel: a width outside
 * the track still shows in the number, its thumb resting at the nearer end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extentRange, wireExtentSlider } from "./extent-slider.js";

const TRACK = { min: 0.3, max: 6, step: 0.05 };
let root: HTMLElement;
let number: HTMLInputElement;
let slider: HTMLInputElement;
let selected: { id: string; value: number } | null;
const write = vi.fn<(id: string, value: number) => void>();

function drawn(value: number): void {
  const box = document.createElement("div");
  number = document.createElement("input");
  number.dataset["field"] = "size";
  number.defaultValue = value.toFixed(2);
  box.append(number);
  root.replaceChildren(extentRange(box, "Width", TRACK, value));
  slider = root.querySelector("input[type=range]") as HTMLInputElement;
}

function drag(to: number): void {
  slider.value = String(to);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function release(): void {
  slider.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "<div id=r></div>";
  root = document.getElementById("r") as HTMLElement;
  selected = { id: "clip", value: 2 };
  write.mockClear();
  drawn(2);
});

afterEach(() => {
  document.dispatchEvent(new Event("pointercancel"));
});

describe("the width slider", () => {
  it("sits beside the number on its track, labelled", () => {
    expect(slider.min).toBe("0.3");
    expect(slider.max).toBe("6");
    expect(slider.step).toBe("0.05");
    expect(slider.value).toBe("2");
    expect(slider.getAttribute("aria-label")).toBe("Width");
    expect(slider.nextElementSibling?.contains(number)).toBe(true);
  });

  it("rests at the track's nearer end for a width the number alone takes", () => {
    drawn(20);
    expect(slider.value).toBe("6");
    drawn(0.1);
    expect(slider.value).toBe("0.3");
  });

  it("shows a drag in the number and writes once, at the release", () => {
    wireExtentSlider({ root, item: () => selected, write });
    drag(3);
    drag(3.5);
    expect(number.value).toBe("3.50");
    expect(write).not.toHaveBeenCalled();
    release();
    expect(write.mock.calls).toEqual([["clip", 3.5]]);
    // The number shows the tour's value again; the draw the write causes
    // brings the new one.
    expect(number.value).toBe(number.defaultValue);
  });

  it("writes nothing for a drag back to where it began", () => {
    wireExtentSlider({ root, item: () => selected, write });
    drag(3);
    drag(2);
    release();
    expect(write).not.toHaveBeenCalled();
  });

  it("writes nothing for a drag cut off, and puts the thumb back", () => {
    const wired = wireExtentSlider({ root, item: () => selected, write });
    drag(4);
    wired.cancel();
    expect(write).not.toHaveBeenCalled();
    expect(slider.value).toBe("2");
    expect(number.value).toBe(number.defaultValue);
  });

  it("starts no drag while nothing with a width is selected", () => {
    selected = null;
    wireExtentSlider({ root, item: () => selected, write });
    drag(4);
    release();
    expect(write).not.toHaveBeenCalled();
  });
});
