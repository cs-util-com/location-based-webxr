// @vitest-environment jsdom
/**
 * Why these tests matter: a phone's keyboard lies over the page without
 * changing its size, so a field at a sheet's foot would be typed in blind.
 * Only the visual viewport tells, and a pinch zoom shrinks it the same way,
 * which must not be read as a keyboard. A real keyboard cannot be run
 * here: the stub stands for the browser's numbers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keyboardPx, watchKeyboard } from "./phone-keyboard.js";

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
}

let viewport: FakeViewport;
const host = () => document.getElementById("host") as HTMLElement;
const onPage = () => document.body.style.getPropertyValue("--s-keyboard-h");
const opened = (height: number) => {
  viewport.height = height;
  viewport.dispatchEvent(new Event("resize"));
};
const win = () =>
  ({ innerHeight: 800, visualViewport: viewport }) as unknown as Window;

beforeEach(() => {
  viewport = new FakeViewport();
  document.body.removeAttribute("style");
  document.body.innerHTML = "<div id=host><input id=f></div>";
});

describe("keyboardPx", () => {
  it("is what the visual viewport lost at its foot", () => {
    expect(keyboardPx(800, { height: 500, offsetTop: 0, scale: 1 })).toBe(300);
    expect(keyboardPx(800, { height: 500, offsetTop: 50, scale: 1 })).toBe(250);
  });

  it("is nothing for a zoom, a browser bar, or nonsense", () => {
    expect(keyboardPx(800, { height: 400, offsetTop: 0, scale: 2 })).toBe(0);
    expect(keyboardPx(800, { height: 744, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardPx(800, { height: 900, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardPx(800, { height: NaN, offsetTop: 0, scale: 1 })).toBe(0);
  });
});

describe("watchKeyboard", () => {
  it("writes the height while it is up and takes it away", () => {
    const stop = watchKeyboard(win(), host());
    opened(500);
    expect(onPage()).toBe("300px");
    opened(800);
    expect(onPage()).toBe("");
    opened(500);
    stop();
    expect(onPage()).toBe("");
    opened(400);
    expect(onPage()).toBe("");
  });

  // Why: the styles give a sheet all the room over a keyboard and drop its
  // grip only while one is up, and a selector cannot read a length.
  it("marks the page while it is up", () => {
    const stop = watchKeyboard(win(), host());
    opened(500);
    expect(document.body.dataset["keyboard"]).toBe("up");
    opened(800);
    expect(document.body.dataset["keyboard"]).toBeUndefined();
    opened(500);
    stop();
    expect(document.body.dataset["keyboard"]).toBeUndefined();
  });

  it("brings the field in use into sight when the keyboard comes", () => {
    const field = document.getElementById("f") as HTMLInputElement;
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    watchKeyboard(win(), host());
    field.focus();
    opened(500);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  // Why: a keyboard grows while it is up (its suggestions bar, another
  // layout, a phone turned), and the field it now covers was left there.
  it("brings the field in use into sight again when the keyboard grows", () => {
    const field = document.getElementById("f") as HTMLInputElement;
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    watchKeyboard(win(), host());
    field.focus();
    opened(500);
    opened(500);
    expect(scroll).toHaveBeenCalledTimes(1);
    opened(300);
    expect(scroll).toHaveBeenCalledTimes(2);
    // Smaller, the field is still where it was in sight.
    opened(450);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("brings a field in sight when the focus moves under the keyboard", () => {
    const field = document.getElementById("f") as HTMLInputElement;
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    watchKeyboard(win(), host());
    opened(500);
    field.focus();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("leaves a field alone without a keyboard, and one outside", () => {
    const field = document.getElementById("f") as HTMLInputElement;
    const outside = document.createElement("input");
    document.body.append(outside);
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    outside.scrollIntoView = scroll;
    watchKeyboard(win(), host());
    field.focus();
    outside.focus();
    opened(500);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without a visual viewport", () => {
    const stop = watchKeyboard(
      { innerHeight: 800, visualViewport: null } as unknown as Window,
      host(),
    );
    expect(onPage()).toBe("");
    stop();
  });
});
