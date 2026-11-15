// @vitest-environment jsdom
/**
 * Why these tests matter: dragging a station's card by its grip is how a
 * creator reorders the tour in the tree. The drag must show where the card
 * will land while it moves, land it there in ONE reorder (one undo step),
 * leave the tour alone when it is dropped where it was, and let Escape or
 * a cancelled pointer (a second finger, the browser taking the gesture)
 * undo nothing because nothing was written.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTreeDrag } from "./tree-drag.js";

const IDS = ["a", "b", "c"];
/** The Tour Viewer's cards, as it passes them: the kit has none of its own. */
const TOUR_CARDS = { cards: ".card[data-station]", idAttribute: "station" };

/** The cards drawn again (a store change): new elements, same rects. */
function redraw(body: HTMLElement, ids: readonly string[]): void {
  const cards = body.querySelector(".cards") as HTMLElement;
  cards.innerHTML = ids
    .map(
      (id) =>
        `<div class="card" data-station="${id}"><span class="grip" data-drag="${id}"></span></div>`,
    )
    .join("");
  rectsScrolled(body, () => 0);
}

/** Cards 40 px high from y = 100, moved up by the dock's scroll. */
function rectsScrolled(body: HTMLElement, scroll: () => number): void {
  for (const [index, card] of [
    ...body.querySelectorAll<HTMLElement>(".card"),
  ].entries()) {
    vi.spyOn(card, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: 100 + index * 40 - scroll(),
          bottom: 140 + index * 40 - scroll(),
          height: 40,
          left: 0,
          right: 200,
          width: 200,
        }) as DOMRect,
    );
  }
}

function setUp(
  options: {
    readonly frame?: (run: FrameRequestCallback) => number;
    readonly arm?: { holdMs: number; tolerancePx: number; movePx: number };
  } = {},
) {
  document.body.innerHTML = `<div id="tree-body"><div class="cards">${IDS.map(
    (id) =>
      `<div class="card" data-station="${id}"><span class="grip" data-drag="${id}"></span></div>`,
  ).join("")}</div></div>`;
  const body = document.getElementById("tree-body") as HTMLElement;
  // Cards 40 px high from y = 100: middles 120, 160, 200.
  for (const [index, card] of [
    ...body.querySelectorAll<HTMLElement>(".card"),
  ].entries()) {
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      top: 100 + index * 40,
      bottom: 140 + index * 40,
      height: 40,
      left: 0,
      right: 200,
      width: 200,
    } as DOMRect);
  }
  const reorder = vi.fn();
  const drag = createTreeDrag({
    body,
    reorder,
    ...TOUR_CARDS,
    ...(options.arm === undefined ? {} : { arm: options.arm }),
    ...(options.frame === undefined
      ? {}
      : { frame: options.frame, cancelFrame: () => undefined }),
  });
  const grip = (id: string) =>
    body.querySelector(`[data-drag="${id}"]`) as HTMLElement;
  const card = (id: string) =>
    body.querySelector(`[data-station="${id}"]`) as HTMLElement;
  return { body, drag, reorder, grip, card };
}

function pointer(
  target: EventTarget,
  type: string,
  y: number,
  init: Partial<PointerEventInit> = {},
): Event {
  // jsdom has no PointerEvent: a MouseEvent carries the same fields here.
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: y,
    button: 0,
    ...init,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("createTreeDrag with the app's own cards", () => {
  // Why: the cards are the app's markup (the Tour Viewer's
  // `.card[data-station]`); another editor's rows must drag the same way
  // when it names its own selector and id attribute.
  it("finds its cards by the given selector and reads their ids from the given attribute", () => {
    document.body.innerHTML = `<div id="rows">${IDS.map(
      (id) =>
        `<div class="row" data-node="${id}"><span data-drag="${id}"></span></div>`,
    ).join("")}<div class="card" data-station="x"></div></div>`;
    const body = document.getElementById("rows") as HTMLElement;
    for (const [index, row] of [
      ...body.querySelectorAll<HTMLElement>(".row"),
    ].entries()) {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top: 100 + index * 40,
        bottom: 140 + index * 40,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
      } as DOMRect);
    }
    const reorder = vi.fn();
    const drag = createTreeDrag({
      body,
      reorder,
      cards: ".row[data-node]",
      idAttribute: "node",
    });
    const grip = body.querySelector('[data-drag="c"]') as HTMLElement;
    pointer(grip, "pointerdown", 200);
    pointer(window, "pointermove", 110);
    pointer(window, "pointerup", 110);
    expect(reorder).toHaveBeenCalledWith(["c", "a", "b"], {
      id: "c",
      from: 2,
      slot: 0,
    });
    drag.dispose();
  });

  it("refuses an empty selector or attribute", () => {
    const body = document.createElement("div");
    expect(() =>
      createTreeDrag({
        body,
        reorder: () => undefined,
        ...TOUR_CARDS,
        cards: "",
      }),
    ).toThrow(RangeError);
    expect(() =>
      createTreeDrag({
        body,
        reorder: () => undefined,
        ...TOUR_CARDS,
        idAttribute: "",
      }),
    ).toThrow(RangeError);
  });

  // Why: the kit is generic, so it assumes no app's markup: a default
  // selector would silently find no cards in another editor. Both are
  // required (a type error to leave out) and refused when missing.
  it("has no cards of its own", () => {
    const body = document.createElement("div");
    expect(() =>
      // @ts-expect-error the cards' selector and id attribute are the app's
      createTreeDrag({ body, reorder: () => undefined }),
    ).toThrow(RangeError);
  });
});

describe("createTreeDrag", () => {
  it("moves a card to where it is dropped: one reorder of every station", () => {
    const { grip, reorder, body } = setUp();
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 175);
    pointer(window, "pointerup", 175);
    // Below b's middle (160), above c's (200): between b and c.
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith(["b", "a", "c"], {
      id: "a",
      from: 0,
      slot: 2,
    });
    expect(body.querySelector(".dragging, .drop-before, .drop-after")).toBe(
      null,
    );
  });

  it("shows where the card will land while it moves, and the card it carries", () => {
    const { grip, card } = setUp();
    pointer(grip("c"), "pointerdown", 200);
    expect(card("c").classList.contains("dragging")).toBe(true);
    pointer(window, "pointermove", 110);
    expect(card("a").classList.contains("drop-before")).toBe(true);
    pointer(window, "pointermove", 150);
    expect(card("a").classList.contains("drop-before")).toBe(false);
    expect(card("b").classList.contains("drop-before")).toBe(true);
    pointer(window, "pointermove", 400);
    // Past the last middle: after the last card.
    expect(card("c").classList.contains("drop-after")).toBe(true);
    pointer(window, "pointerup", 400);
  });

  it("writes nothing for a drop where the card already was", () => {
    const { grip, reorder } = setUp();
    pointer(grip("b"), "pointerdown", 160);
    pointer(window, "pointermove", 150);
    pointer(window, "pointerup", 150);
    expect(reorder).not.toHaveBeenCalled();
  });

  it("Escape or a cancelled pointer ends the drag with nothing written", () => {
    const { grip, reorder, body } = setUp();
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 260);
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    pointer(window, "pointerup", 260);
    expect(reorder).not.toHaveBeenCalled();
    expect(body.querySelector(".dragging")).toBe(null);
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 260);
    pointer(window, "pointercancel", 260);
    pointer(window, "pointerup", 260);
    expect(reorder).not.toHaveBeenCalled();
  });

  it("starts only from a grip, with the main button", () => {
    const { reorder, card, grip } = setUp();
    pointer(card("a"), "pointerdown", 120);
    pointer(window, "pointermove", 260);
    pointer(window, "pointerup", 260);
    pointer(grip("a"), "pointerdown", 120, { button: 2 });
    pointer(window, "pointermove", 260);
    pointer(window, "pointerup", 260);
    expect(reorder).not.toHaveBeenCalled();
  });

  it("the press on a grip is the drag's: the browser does not take it for a scroll or a selection", () => {
    const { grip } = setUp();
    const down = pointer(grip("a"), "pointerdown", 120);
    expect(down.defaultPrevented).toBe(true);
    pointer(window, "pointerup", 120);
  });

  // Why: the tree is drawn again on any store change - an autosave's
  // status lands mid-drag - and the cards the drag held were then
  // detached: the marks vanished and the drop read stale places. The same
  // stations drawn again carry on; changed stations end it, writing
  // nothing.
  it("carries on across a redraw of the same stations, and ends with nothing written when they changed", () => {
    const { grip, reorder, body, card } = setUp();
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 175);
    redraw(body, IDS);
    pointer(window, "pointermove", 176);
    expect(card("a").classList.contains("dragging")).toBe(true);
    expect(card("c").classList.contains("drop-before")).toBe(true);
    pointer(window, "pointerup", 176);
    expect(reorder).toHaveBeenCalledWith(["b", "a", "c"], {
      id: "a",
      from: 0,
      slot: 2,
    });

    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 175);
    redraw(body, ["a", "c"]);
    pointer(window, "pointermove", 176);
    pointer(window, "pointerup", 176);
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(body.querySelector(".dragging, .drop-before, .drop-after")).toBe(
      null,
    );
  });

  // Why: the release checks the tree too. Stations changed between the
  // last move and the release (an undo, a draft restored mid-drag) left
  // the drop to write an order from the ids the drag started with: a
  // different set was refused with a toast, the same set in another
  // order quietly put the old order back.
  it("writes nothing on a release after a redraw that changed the stations", () => {
    for (const after of [
      ["a", "c"],
      ["c", "b", "a"],
    ]) {
      const { grip, reorder, body } = setUp();
      pointer(grip("a"), "pointerdown", 120);
      pointer(window, "pointermove", 175);
      redraw(body, after);
      pointer(window, "pointerup", 175);
      expect(reorder, after.join()).not.toHaveBeenCalled();
      expect(body.querySelector(".dragging, .drop-before, .drop-after")).toBe(
        null,
      );
    }
  });

  // Why: a tour longer than the dock could only be reordered within what
  // the dock showed. Held near the dock's edge, the drag scrolls it, and
  // the slot follows the cards as they move under the still pointer.
  it("scrolls the dock while the pointer is held near its edge, and lands by where the cards are now", () => {
    const frames: FrameRequestCallback[] = [];
    const { grip, reorder, body } = setUp({
      frame: (run) => {
        frames.push(run);
        return frames.length;
      },
    });
    // The dock shows y 100 to 180: a and b; c (middle 200) is below.
    let scroll = 0;
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      get: () => scroll,
      set: (v: number) => {
        scroll = Math.max(0, Math.min(40, v));
      },
    });
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 180,
      height: 80,
    } as DOMRect);
    rectsScrolled(body, () => scroll);
    pointer(grip("a"), "pointerdown", 120);
    // Held 4 px above the dock's bottom edge: below b's middle only.
    pointer(window, "pointermove", 176);
    for (let i = 0; i < 60 && frames.length > 0; i++) frames.shift()?.(i * 16);
    expect(scroll).toBe(40);
    pointer(window, "pointerup", 176);
    // Scrolled by 40: c's middle is at 160, so the pointer is past it.
    expect(reorder).toHaveBeenCalledWith(["b", "c", "a"], {
      id: "a",
      from: 0,
      slot: 3,
    });
  });

  it("does not scroll the dock away from its edges", () => {
    const frames: FrameRequestCallback[] = [];
    const { grip, body } = setUp({
      frame: (run) => {
        frames.push(run);
        return frames.length;
      },
    });
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 300,
      height: 200,
    } as DOMRect);
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 200);
    expect(frames).toHaveLength(0);
    pointer(window, "pointerup", 200);
  });

  it("is gone after dispose", () => {
    const { grip, reorder, drag } = setUp();
    drag.dispose();
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 260);
    pointer(window, "pointerup", 260);
    expect(reorder).not.toHaveBeenCalled();
  });
});

/** A press by `pointerType` at `y`, its event time `at` (ms). */
function timed(
  target: EventTarget,
  type: string,
  y: number,
  pointerType: string,
  at: number,
  coalesced?: readonly { readonly y: number; readonly at: number }[],
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "timeStamp", { value: at });
  if (coalesced !== undefined) {
    // The moves Chrome folded into this one while the page lagged.
    const moves = coalesced.map((m) => ({
      clientX: 0,
      clientY: m.y,
      timeStamp: m.at,
    }));
    Object.defineProperty(event, "getCoalescedEvents", {
      value: () => moves,
    });
  }
  target.dispatchEvent(event);
}

const ARM = { holdMs: 150, tolerancePx: 6, movePx: 4 };

// Why: a list that scrolls under a finger (the inspector's story cards)
// must not reorder for a flick that starts on a grip, and a click on a
// grip with a mouse must not mark a drag. With an `arm`, the press waits:
// a finger drags after resting `holdMs` (by the events' own times), a
// mouse after moving `movePx`; nothing is marked or written before.
describe("createTreeDrag with an arm", () => {
  it("a finger that rested drags, and lands where it is dropped", () => {
    const { grip, card, reorder } = setUp({ arm: ARM });
    timed(grip("a"), "pointerdown", 120, "touch", 1000);
    expect(card("a").classList.contains("dragging")).toBe(false);
    timed(window, "pointermove", 122, "touch", 1100);
    expect(card("a").classList.contains("dragging")).toBe(false);
    timed(window, "pointermove", 175, "touch", 1160);
    expect(card("a").classList.contains("dragging")).toBe(true);
    expect(card("c").classList.contains("drop-before")).toBe(true);
    timed(window, "pointerup", 175, "touch", 1200);
    expect(reorder).toHaveBeenCalledWith(["b", "a", "c"], {
      id: "a",
      from: 0,
      slot: 2,
    });
  });

  it("a flick that starts on a grip drags nothing, even when it rests later", () => {
    const { grip, body, reorder } = setUp({ arm: ARM });
    timed(grip("a"), "pointerdown", 120, "touch", 1000);
    timed(window, "pointermove", 140, "touch", 1016);
    timed(window, "pointermove", 175, "touch", 1400);
    timed(window, "pointerup", 175, "touch", 1420);
    expect(reorder).not.toHaveBeenCalled();
    expect(body.querySelector(".dragging, .drop-before, .drop-after")).toBe(
      null,
    );
  });

  it("a mouse drags from its threshold on; a click marks nothing", () => {
    const { grip, card, reorder } = setUp({ arm: ARM });
    timed(grip("a"), "pointerdown", 120, "mouse", 1000);
    timed(window, "pointermove", 123, "mouse", 1010);
    expect(card("a").classList.contains("dragging")).toBe(false);
    timed(window, "pointerup", 123, "mouse", 1020);
    expect(reorder).not.toHaveBeenCalled();
    timed(grip("c"), "pointerdown", 200, "mouse", 2000);
    timed(window, "pointermove", 110, "mouse", 2010);
    expect(card("c").classList.contains("dragging")).toBe(true);
    timed(window, "pointerup", 110, "mouse", 2020);
    expect(reorder).toHaveBeenCalledWith(["c", "a", "b"], {
      id: "c",
      from: 2,
      slot: 0,
    });
  });

  // Why: under lag Chrome folds a finger's moves into one pointermove;
  // read alone, its last move can look like a rested finger although the
  // first moves were a flick, or start the drag late.
  it("decides by the first decided move a lagging pointermove folded in", () => {
    const { grip, card, reorder } = setUp({ arm: ARM });
    timed(grip("a"), "pointerdown", 120, "touch", 1000);
    // A flick (20 px at 16 ms), folded with a move after the hold.
    timed(window, "pointermove", 122, "touch", 1400, [
      { y: 140, at: 1016 },
      { y: 122, at: 1400 },
    ]);
    expect(card("a").classList.contains("dragging")).toBe(false);
    timed(window, "pointermove", 175, "touch", 1500);
    timed(window, "pointerup", 175, "touch", 1520);
    expect(reorder).not.toHaveBeenCalled();
    // A rest, then the drag, folded into one: the drag lands where the
    // last folded move is.
    timed(grip("a"), "pointerdown", 120, "touch", 2000);
    timed(window, "pointermove", 175, "touch", 2200, [
      { y: 121, at: 2160 },
      { y: 175, at: 2200 },
    ]);
    expect(card("a").classList.contains("dragging")).toBe(true);
    expect(card("c").classList.contains("drop-before")).toBe(true);
    timed(window, "pointerup", 175, "touch", 2220);
    expect(reorder).toHaveBeenCalledWith(["b", "a", "c"], {
      id: "a",
      from: 0,
      slot: 2,
    });
  });

  // Why: a finger that rests on a grip and pulls straight to the panel's
  // edge must scroll the cards from that first move, as a drag that was
  // already running does.
  it("scrolls from the move that begins the drag when it is near the edge", () => {
    const frames: FrameRequestCallback[] = [];
    const { grip, body } = setUp({
      arm: ARM,
      frame: (run) => {
        frames.push(run);
        return frames.length;
      },
    });
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 180,
      height: 80,
    } as DOMRect);
    timed(grip("a"), "pointerdown", 120, "touch", 1000);
    timed(window, "pointermove", 176, "touch", 1200);
    expect(frames).toHaveLength(1);
    timed(window, "pointerup", 176, "touch", 1220);
  });

  // Why: a story's cards scroll under a finger. Once a rested finger
  // drags, its moves must not scroll the cards as well; before, the
  // browser keeps the flick (the grip lets it pan).
  it("holds the cards still under a drag's touch moves, and leaves a waiting press's to the browser", () => {
    const { grip, body } = setUp({ arm: ARM });
    const touchmove = () => {
      const event = new Event("touchmove", { bubbles: true, cancelable: true });
      grip("a").dispatchEvent(event);
      return event.defaultPrevented;
    };
    timed(grip("a"), "pointerdown", 120, "touch", 1000);
    timed(window, "pointermove", 122, "touch", 1050);
    expect(touchmove()).toBe(false);
    timed(window, "pointermove", 175, "touch", 1200);
    expect(body.querySelector(".dragging")).not.toBe(null);
    expect(touchmove()).toBe(true);
    timed(window, "pointerup", 175, "touch", 1220);
    expect(touchmove()).toBe(false);
  });

  it("a press still waiting takes no text selection or mouse emulation, and a lift ends it", () => {
    const { grip, reorder } = setUp({ arm: ARM });
    const down = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientY: 120,
      button: 0,
    });
    Object.defineProperty(down, "pointerId", { value: 1 });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    grip("a").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    timed(window, "pointerup", 120, "touch", down.timeStamp + 400);
    // A move after the lift is no drag.
    timed(window, "pointermove", 175, "touch", down.timeStamp + 500);
    timed(window, "pointerup", 175, "touch", down.timeStamp + 600);
    expect(reorder).not.toHaveBeenCalled();
  });

  it("refuses an arm that is not numbers of 0 or more", () => {
    document.body.innerHTML = `<div id="b"></div>`;
    const body = document.getElementById("b") as HTMLElement;
    expect(() =>
      createTreeDrag({
        body,
        ...TOUR_CARDS,
        arm: { holdMs: -1, tolerancePx: 6, movePx: 4 },
        reorder: () => undefined,
      }),
    ).toThrow(RangeError);
  });
});
