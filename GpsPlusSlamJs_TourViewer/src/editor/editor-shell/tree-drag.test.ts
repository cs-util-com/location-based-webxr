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

function setUp() {
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
  const drag = createTreeDrag({ body, reorder });
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

describe("createTreeDrag", () => {
  it("moves a card to where it is dropped: one reorder of every station", () => {
    const { grip, reorder, body } = setUp();
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 175);
    pointer(window, "pointerup", 175);
    // Below b's middle (160), above c's (200): between b and c.
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith(["b", "a", "c"]);
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

  it("is gone after dispose", () => {
    const { grip, reorder, drag } = setUp();
    drag.dispose();
    pointer(grip("a"), "pointerdown", 120);
    pointer(window, "pointermove", 260);
    pointer(window, "pointerup", 260);
    expect(reorder).not.toHaveBeenCalled();
  });
});
