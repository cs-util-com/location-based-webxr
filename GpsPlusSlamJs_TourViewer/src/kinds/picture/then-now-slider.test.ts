// @vitest-environment jsdom
/**
 * Why these tests matter: the slider is how a lined-up visitor takes the
 * blend over. It must be found by role, start where the fade-in is, tell
 * the part every move, never move the thumb under the visitor's finger,
 * and leave nothing behind. Its swipe line must follow a dragging finger
 * past the knob (pointer capture), be the only part of the full-screen
 * layer that takes a touch, and show only while Swipe is chosen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildThenNowSlider,
  firstSentence,
  type ThenNowSliderStart,
} from "./then-now-slider.js";
import { SWIPE_SPLIT_MAX, SWIPE_SPLIT_START } from "./then-now-swipe.js";

const FADE: ThenNowSliderStart = {
  mode: "fade",
  fade: 0,
  split: SWIPE_SPLIT_START,
};

/** Spies for every move the panel reports. */
function listeners() {
  return {
    fade: vi.fn<(fade: number) => void>(),
    mode: vi.fn<(mode: string) => void>(),
    split: vi.fn<(split: number) => void>(),
  };
}

/** jsdom has no pointer capture: a stand-in that records it. */
function capturable(el: HTMLElement): Set<number> {
  const held = new Set<number>();
  el.setPointerCapture = (id: number) => {
    held.add(id);
  };
  el.releasePointerCapture = (id: number) => {
    held.delete(id);
  };
  el.hasPointerCapture = (id: number) => held.has(id);
  return held;
}

function pointer(type: string, pointerId: number, clientX = 0): PointerEvent {
  return new PointerEvent(type, {
    pointerId,
    clientX,
    bubbles: true,
    cancelable: true,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildThenNowSlider", () => {
  it("shows the year, the first sentence and the share, and hears moves", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const heard = listeners();
    const slider = buildThenNowSlider(
      host,
      { year: "1902", caption: "Market day. The stalls are gone." },
      { ...FADE, fade: 0.55 },
      heard,
    );
    const group = host.querySelector("[role=group]");
    expect(group?.getAttribute("aria-label")).toBe("Then and now");
    expect(group?.textContent).toContain("1902");
    expect(group?.textContent).toContain("Market day.");
    expect(group?.textContent).not.toContain("stalls");
    const input = host.querySelector<HTMLInputElement>("input[type=range]");
    expect(input?.value).toBe("55");
    if (input === null) throw new Error("no slider");
    input.value = "80";
    input.dispatchEvent(new Event("input"));
    expect(heard.fade).toHaveBeenCalledWith(0.8);
    slider.set(0.2);
    expect(input.value).toBe("20");
    slider.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("does not move the thumb under the visitor's finger", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const slider = buildThenNowSlider(
      host,
      {},
      { ...FADE, fade: 0.3 },
      listeners(),
    );
    const input = host.querySelector<HTMLInputElement>("input[type=range]");
    input?.focus();
    slider.set(0.9);
    expect(input?.value).toBe("30");
  });

  it("clamps a share outside 0 to 1 and reads a broken one as today", () => {
    const host = document.createElement("div");
    const slider = buildThenNowSlider(
      host,
      {},
      { ...FADE, fade: 4 },
      listeners(),
    );
    const input = host.querySelector<HTMLInputElement>("input[type=range]");
    expect(input?.value).toBe("100");
    slider.set(Number.NaN);
    expect(input?.value).toBe("0");
  });
});

describe("the swipe", () => {
  it("switches between Fade and Swipe, showing only the chosen control", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const heard = listeners();
    buildThenNowSlider(host, { year: "1902" }, FADE, heard);
    const modes = host.querySelector("[aria-label='Compare by']");
    const buttons = [...(modes?.querySelectorAll("button") ?? [])];
    // The chosen page's order and words.
    expect(buttons.map((b) => b.textContent)).toEqual(["Swipe", "Fade"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
    const layer = host.querySelector<HTMLElement>(".then-now-swipe");
    const row = host.querySelector<HTMLElement>(".then-now-row");
    const hint = host.querySelector<HTMLElement>(".then-now-hint");
    expect(layer?.hidden).toBe(true);
    expect(row?.hidden).toBe(false);
    expect(hint?.hidden).toBe(true);
    buttons[0]?.click();
    expect(heard.mode).toHaveBeenLastCalledWith("swipe");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);
    expect(layer?.hidden).toBe(false);
    expect(row?.hidden).toBe(true);
    expect(hint?.textContent).toBe("Drag the line to compare");
    expect(hint?.hidden).toBe(false);
    // The year names the old side, today the other.
    expect(layer?.textContent).toContain("1902");
    expect(layer?.textContent).toContain("Today");
    buttons[1]?.click();
    expect(heard.mode).toHaveBeenLastCalledWith("fade");
    expect(layer?.hidden).toBe(true);
    // A click on the group's padding chooses nothing.
    modes?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(heard.mode).toHaveBeenCalledTimes(2);
  });

  it("starts Swipe where the part left the line, naming the old side Then without a year", () => {
    const host = document.createElement("div");
    buildThenNowSlider(
      host,
      {},
      { mode: "swipe", fade: 0, split: 0.3 },
      listeners(),
    );
    const knob = host.querySelector<HTMLElement>("[role=slider]");
    expect(knob?.getAttribute("aria-valuenow")).toBe("30");
    expect(knob?.style.left).toBe("30%");
    expect(host.querySelector(".then-now-swipe-line")?.textContent).toBe(
      "ThenToday",
    );
  });

  it("follows a finger that holds the knob, past it, until it lets go", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const heard = listeners();
    buildThenNowSlider(host, {}, { ...FADE, mode: "swipe" }, heard);
    const layer = host.querySelector<HTMLElement>(".then-now-swipe");
    const knob = host.querySelector<HTMLElement>("[role=slider]");
    if (layer === null || knob === null) throw new Error("no swipe");
    layer.getBoundingClientRect = () =>
      ({ left: 0, width: 400, top: 0, height: 800 }) as DOMRect;
    const held = capturable(knob);
    // A move before any press moves nothing.
    knob.dispatchEvent(pointer("pointermove", 1, 100));
    expect(heard.split).not.toHaveBeenCalled();
    const below = vi.fn();
    host.addEventListener("pointerdown", below);
    const down = pointer("pointerdown", 1, 200);
    knob.dispatchEvent(down);
    // Held by the knob, and no press reaches the world below.
    expect(held.has(1)).toBe(true);
    expect(below).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(true);
    knob.dispatchEvent(pointer("pointermove", 1, 100));
    expect(heard.split).toHaveBeenLastCalledWith(0.25);
    expect(knob.getAttribute("aria-valuenow")).toBe("25");
    expect(knob.style.left).toBe("25%");
    // A second finger is not the one holding it.
    knob.dispatchEvent(pointer("pointermove", 2, 300));
    expect(heard.split).toHaveBeenCalledTimes(1);
    // Past the screen's edge the line stops in reach.
    knob.dispatchEvent(pointer("pointermove", 1, 9000));
    expect(heard.split).toHaveBeenLastCalledWith(SWIPE_SPLIT_MAX);
    knob.dispatchEvent(pointer("pointerup", 1, 9000));
    expect(held.has(1)).toBe(false);
    knob.dispatchEvent(pointer("pointermove", 1, 100));
    expect(heard.split).toHaveBeenCalledTimes(2);
  });

  it("moves the line by the arrow keys", () => {
    const host = document.createElement("div");
    const heard = listeners();
    buildThenNowSlider(host, {}, { ...FADE, mode: "swipe" }, heard);
    const knob = host.querySelector<HTMLElement>("[role=slider]");
    const key = (k: string): KeyboardEvent => {
      const e = new KeyboardEvent("keydown", { key: k, cancelable: true });
      knob?.dispatchEvent(e);
      return e;
    };
    expect(key("ArrowLeft").defaultPrevented).toBe(true);
    expect(heard.split).toHaveBeenLastCalledWith(0.45);
    key("End");
    expect(heard.split).toHaveBeenLastCalledWith(SWIPE_SPLIT_MAX);
    expect(key("a").defaultPrevented).toBe(false);
    expect(heard.split).toHaveBeenCalledTimes(2);
  });

  it("leaves no line behind and hears nothing after its clean-up", () => {
    const host = document.createElement("div");
    const heard = listeners();
    const slider = buildThenNowSlider(
      host,
      {},
      { ...FADE, mode: "swipe" },
      heard,
    );
    const knob = host.querySelector<HTMLElement>("[role=slider]");
    slider.dispose();
    expect(host.children).toHaveLength(0);
    knob?.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    expect(heard.split).not.toHaveBeenCalled();
  });
});

describe("firstSentence", () => {
  it("keeps the first sentence and cuts a long one at a word", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence(undefined)).toBe("");
    const long = firstSentence("word ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(110);
    expect(long.endsWith("…")).toBe(true);
  });
});
