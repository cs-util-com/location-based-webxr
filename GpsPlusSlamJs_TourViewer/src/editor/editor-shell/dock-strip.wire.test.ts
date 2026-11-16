// @vitest-environment jsdom
/**
 * Why these tests matter: `wireStripScroll` is the wiring between a
 * finger and the docking library on a tab strip, and the pure rules it
 * reads (`stripGesture`, `restEndedAt`) are tested on their own. What
 * only this file holds is how a touch is followed ACROSS its moves: the
 * hold is the rest before the finger moved (kept from an earlier move),
 * not the time to the move that decides it, a decided swipe cancels the
 * library's pending drag once and the strip then follows later moves, and
 * the library never sees a withheld move. The browser test sends a
 * gesture's moves in one burst, so it no longer drives this.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STRIP_HOLD_MS, STRIP_REST_PX, wireStripScroll } from "./dock-strip.js";

/** A pointer event of a finger at `x` (px along the strip), stamped `at`
 *  (ms on the page's clock, as a busy phone delivers it: late, but with
 *  the time the finger was there). */
function touch(type: string, x: number, at: number): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: "touch",
    clientX: x,
    clientY: 20,
  });
  Object.defineProperty(event, "timeStamp", { value: at });
  return event;
}

let root: HTMLElement;
let strip: HTMLElement;
let tab: HTMLElement;
let scroll: number;
/** What reached the docking library's own listeners (the window's
 *  bubbling ones). */
let library: string[];
const activate = vi.fn<(tab: HTMLElement) => void>();
let unwire: () => void;

const seen = (event: Event) => {
  library.push(event.type);
};

beforeEach(() => {
  document.body.innerHTML = `<div class="root"><div class="dv-tabs-container"><div class="dv-tab"><span>Files</span></div></div></div>`;
  root = document.querySelector<HTMLElement>(".root") as HTMLElement;
  strip = document.querySelector<HTMLElement>(
    ".dv-tabs-container",
  ) as HTMLElement;
  tab = document.querySelector<HTMLElement>(".dv-tab") as HTMLElement;
  // jsdom lays nothing out: a strip with 200 px more than it shows.
  scroll = 100;
  Object.defineProperty(strip, "scrollWidth", { value: 600 });
  Object.defineProperty(strip, "clientWidth", { value: 400 });
  Object.defineProperty(strip, "scrollLeft", {
    get: () => scroll,
    set: (v: number) => {
      scroll = v;
    },
  });
  library = [];
  activate.mockClear();
  for (const type of ["pointermove", "pointerup", "pointercancel"]) {
    window.addEventListener(type, seen);
  }
  unwire = wireStripScroll(root, activate);
});

afterEach(() => {
  unwire();
  for (const type of ["pointermove", "pointerup", "pointercancel"]) {
    window.removeEventListener(type, seen);
  }
});

const press = (x: number, at: number) => {
  tab.querySelector("span")?.dispatchEvent(touch("pointerdown", x, at));
};
const move = (x: number, at: number) => {
  window.dispatchEvent(touch("pointermove", x, at));
};
const lift = (x: number, at: number) => {
  window.dispatchEvent(touch("pointerup", x, at));
};

describe("a finger on a strip's tab, followed across its moves", () => {
  it("scrolls for a quick swipe whose deciding move came late, and follows it", () => {
    press(200, 0);
    // Left its rest at 20 ms, still under the slop: undecided, withheld.
    move(200 - (STRIP_REST_PX + 1), 20);
    expect(scroll).toBe(100);
    // Delivered long after the hold, but the finger never rested that
    // long: a swipe, not a held drag.
    move(160, STRIP_HOLD_MS + 150);
    expect(scroll).toBe(140);
    move(140, STRIP_HOLD_MS + 170);
    expect(scroll).toBe(160);
    lift(140, STRIP_HOLD_MS + 190);
    // The library got one cancel and none of the moves; no tab shown.
    expect(library.filter((t) => t === "pointercancel")).toHaveLength(1);
    expect(library).not.toContain("pointermove");
    expect(activate).not.toHaveBeenCalled();
  });

  it("drags the tab for a finger that rested past the hold, then moved", () => {
    press(200, 0);
    move(160, STRIP_HOLD_MS + 50);
    // The deciding move reaches the library: its drag. No cancel.
    expect(library).toEqual(["pointermove"]);
    expect(scroll).toBe(100);
    move(150, STRIP_HOLD_MS + 70);
    expect(library).toEqual(["pointermove", "pointermove"]);
    lift(150, STRIP_HOLD_MS + 90);
    expect(library).not.toContain("pointercancel");
    expect(activate).not.toHaveBeenCalled();
  });

  it("shows the tab for a finger that lifts under the slop", () => {
    press(200, 0);
    move(197, 16);
    lift(197, 32);
    expect(activate).toHaveBeenCalledWith(tab);
    expect(scroll).toBe(100);
    expect(library).not.toContain("pointermove");
  });
});
