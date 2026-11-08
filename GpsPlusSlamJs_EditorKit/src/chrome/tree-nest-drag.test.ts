// @vitest-environment jsdom
/**
 * Why these tests matter: a creator drags an item of a station into one
 * of its stories, from one story to another, and back out among the free
 * items, and drags a story to another place among the stories. The drag
 * must show where the item will land (before, after or into a folder),
 * write ONE move there, offer only the lists the app says take the item,
 * never leave its station, and write nothing for a drop in place, Escape,
 * a cancelled pointer or a redraw that lost the item.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNestDrag, type NestPlace } from "./tree-nest-drag.js";

/** Two stations: "s" with story A (a1, a2), story B (empty) and a free
 *  pin p; "t" with a free pin q. Rows 20 px high from y = 0, in order. */
const MARKUP = `
<div class="card" data-station="s">
  <div class="head row" data-into="free"></div>
  <div class="folder row" data-list="stories" data-item="A" data-into="story:A"><span class="grip" data-move></span></div>
  <div class="kid row" data-list="story:A" data-item="a1"><span class="grip" data-move></span></div>
  <div class="kid row" data-list="story:A" data-item="a2"><span class="grip" data-move></span></div>
  <div class="folder row" data-list="stories" data-item="B" data-into="story:B"><span class="grip" data-move></span></div>
  <div class="emptyrow row" data-into="story:B"></div>
  <div class="kid row" data-list="free" data-item="p"><span class="grip" data-move></span></div>
</div>
<div class="card" data-station="t">
  <div class="head row" data-into="free"></div>
  <div class="kid row" data-list="free" data-item="q"><span class="grip" data-move></span></div>
</div>`;

function stubRows(body: HTMLElement): void {
  for (const [index, row] of [
    ...body.querySelectorAll<HTMLElement>(".row"),
  ].entries()) {
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top: index * 20,
      bottom: index * 20 + 20,
      height: 20,
      left: 0,
      right: 200,
      width: 200,
    } as DOMRect);
  }
}

/** Free items and story entries go to any story or among the free items;
 *  stories only among the stories. */
function accepts(from: NestPlace, to: string): boolean {
  if (from.list === "stories") return to === "stories";
  return to !== "stories";
}

function setUp() {
  document.body.innerHTML = `<div id="tree-body">${MARKUP}</div>`;
  const body = document.getElementById("tree-body") as HTMLElement;
  stubRows(body);
  const move = vi.fn();
  const drag = createNestDrag({
    body,
    grip: "[data-move]",
    rows: ".row",
    scope: ".card[data-station]",
    placeOf: (row) => {
      const list = row.dataset["list"];
      const id = row.dataset["item"];
      return list === undefined || id === undefined ? null : { list, id };
    },
    intoOf: (row) => row.dataset["into"] ?? null,
    accepts,
    move,
  });
  const row = (id: string) =>
    body.querySelector(`[data-item="${id}"]`) as HTMLElement;
  const grip = (id: string) => row(id).querySelector(".grip") as HTMLElement;
  return { body, drag, move, row, grip };
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

function dragTo(grip: HTMLElement, fromY: number, toY: number): void {
  pointer(grip, "pointerdown", fromY);
  pointer(window, "pointermove", toY);
  pointer(window, "pointerup", toY);
}

const MARKED = ".dragging, .drop-before, .drop-after, .drop-into";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// Rows: head 0-20, A 20-40, a1 40-60, a2 60-80, B 80-100, empty 100-120,
// p 120-140; station t: head 140-160, q 160-180.
describe("createNestDrag", () => {
  it("moves a free item into a folder: one move into its list", () => {
    const { grip, move, body } = setUp();
    dragTo(grip("p"), 130, 90);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(
      { list: "free", id: "p" },
      { list: "story:B", into: true },
    );
    expect(body.querySelector(MARKED)).toBe(null);
  });

  it("moves a free item before or after a story's entry", () => {
    const { grip, move } = setUp();
    dragTo(grip("p"), 130, 64);
    expect(move).toHaveBeenLastCalledWith(
      { list: "free", id: "p" },
      { list: "story:A", slot: 1 },
    );
    dragTo(grip("p"), 130, 75);
    expect(move).toHaveBeenLastCalledWith(
      { list: "free", id: "p" },
      { list: "story:A", slot: 2 },
    );
  });

  it("moves an entry out onto its station's row, among the free items", () => {
    const { grip, move } = setUp();
    dragTo(grip("a1"), 50, 10);
    expect(move).toHaveBeenCalledWith(
      { list: "story:A", id: "a1" },
      { list: "free", into: true },
    );
  });

  it("shows where it lands while it moves, and the row it carries", () => {
    const { grip, row, body } = setUp();
    pointer(grip("a2"), "pointerdown", 70);
    expect(row("a2").classList.contains("dragging")).toBe(true);
    pointer(window, "pointermove", 42);
    expect(row("a1").classList.contains("drop-before")).toBe(true);
    pointer(window, "pointermove", 90);
    expect(row("a1").classList.contains("drop-before")).toBe(false);
    expect(row("B").classList.contains("drop-into")).toBe(true);
    pointer(window, "pointermove", 110);
    const empty = body.querySelector(".emptyrow") as HTMLElement;
    expect(empty.classList.contains("drop-into")).toBe(true);
    expect(
      body.querySelectorAll(".drop-into, .drop-before, .drop-after").length,
    ).toBe(1);
    pointer(window, "pointerup", 110);
  });

  it("drags a story only among the stories, never into one", () => {
    const { grip, move, row } = setUp();
    pointer(grip("B"), "pointerdown", 90);
    pointer(window, "pointermove", 25);
    expect(row("A").classList.contains("drop-before")).toBe(true);
    expect(row("A").classList.contains("drop-into")).toBe(false);
    pointer(window, "pointerup", 25);
    expect(move).toHaveBeenCalledWith(
      { list: "stories", id: "B" },
      { list: "stories", slot: 0 },
    );
  });

  it("never leaves its station", () => {
    const { grip, move } = setUp();
    // Past its station's last row: still its own free list, where it was.
    dragTo(grip("p"), 130, 170);
    expect(move).not.toHaveBeenCalled();
    // Above its station: onto its own station row, never into story A.
    dragTo(grip("q"), 170, 50);
    expect(move).toHaveBeenCalledWith(
      { list: "free", id: "q" },
      { list: "free", into: true },
    );
  });

  it("writes nothing for a drop where the item already was", () => {
    const { grip, move } = setUp();
    dragTo(grip("a1"), 50, 52);
    dragTo(grip("a1"), 50, 62);
    expect(move).not.toHaveBeenCalled();
  });

  it("Escape or a cancelled pointer ends the drag with nothing written", () => {
    const { grip, move, body } = setUp();
    pointer(grip("p"), "pointerdown", 130);
    pointer(window, "pointermove", 90);
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    pointer(window, "pointerup", 90);
    expect(body.querySelector(MARKED)).toBe(null);
    pointer(grip("p"), "pointerdown", 130);
    pointer(window, "pointermove", 90);
    pointer(window, "pointercancel", 90);
    pointer(window, "pointerup", 90);
    expect(move).not.toHaveBeenCalled();
  });

  it("starts only from a grip, with the main button, and takes the press", () => {
    const { grip, row, move } = setUp();
    dragTo(row("p"), 130, 90);
    pointer(grip("p"), "pointerdown", 130, { button: 2 });
    pointer(window, "pointermove", 90);
    pointer(window, "pointerup", 90);
    expect(move).not.toHaveBeenCalled();
    const down = pointer(grip("p"), "pointerdown", 130);
    expect(down.defaultPrevented).toBe(true);
    pointer(window, "pointerup", 130);
  });

  // Why: the tree is drawn again on any store change; the drag must carry
  // on with the same item drawn again, and write nothing once it is gone.
  it("carries on across a redraw that keeps the item, and ends when it is gone", () => {
    const { body, grip, move } = setUp();
    pointer(grip("p"), "pointerdown", 130);
    body.innerHTML = MARKUP;
    stubRows(body);
    pointer(window, "pointermove", 90);
    const again = body.querySelector('[data-item="p"]') as HTMLElement;
    expect(again.classList.contains("dragging")).toBe(true);
    pointer(window, "pointerup", 90);
    expect(move).toHaveBeenCalledTimes(1);
    pointer(again.querySelector(".grip") as HTMLElement, "pointerdown", 130);
    pointer(window, "pointermove", 90);
    body.innerHTML = MARKUP.replace('data-item="p"', 'data-item="gone"');
    stubRows(body);
    pointer(window, "pointermove", 90);
    pointer(window, "pointerup", 90);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty selector, and is gone after dispose", () => {
    expect(() =>
      createNestDrag({
        body: document.body,
        grip: "",
        rows: ".row",
        scope: ".card",
        placeOf: () => null,
        intoOf: () => null,
        accepts: () => true,
        move: () => undefined,
      }),
    ).toThrow(RangeError);
    const { drag, grip, move } = setUp();
    drag.dispose();
    dragTo(grip("p"), 130, 90);
    expect(move).not.toHaveBeenCalled();
  });
});
