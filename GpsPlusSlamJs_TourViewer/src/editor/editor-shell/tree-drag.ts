/**
 * The tree's reorder by drag: a station's card dragged by its grip
 * (`[data-drag]`, drawn by `shell-tree.ts`) lands where it is dropped, as
 * ONE reorder of the whole tour (one undo step). While it moves, the card
 * it carries is marked `dragging` and the card it would land before is
 * marked `drop-before` (past the last card: the last is `drop-after`). A
 * drop where the card already was writes nothing; Escape or a cancelled
 * pointer end the drag with nothing written. The slot maths is
 * `tree-reorder.ts`'s. The keyboard's way to reorder is the inspector's
 * Earlier and Later.
 *
 * @see tree-drag.ts.md
 */
import { dropSlot, movedTo } from "./tree-reorder.js";

interface Drag {
  readonly pointerId: number;
  readonly cards: readonly HTMLElement[];
  readonly ids: readonly string[];
  readonly middles: readonly number[];
  readonly from: number;
  slot: number;
}

const MARKS = ["dragging", "drop-before", "drop-after"] as const;

export function createTreeDrag(deps: {
  /** The tree's body: its `.card[data-station]` elements, in order. */
  readonly body: HTMLElement;
  /** Write the stations' new order (every station once). */
  readonly reorder: (order: readonly string[]) => void;
}): { dispose(): void } {
  const { body } = deps;
  let drag: Drag | null = null;

  const unmark = (cards: readonly HTMLElement[]): void => {
    for (const card of cards) card.classList.remove(...MARKS);
  };

  const mark = (now: Drag): void => {
    for (const card of now.cards)
      card.classList.remove("drop-before", "drop-after");
    const before = now.cards[now.slot];
    if (before !== undefined) before.classList.add("drop-before");
    else now.cards.at(-1)?.classList.add("drop-after");
  };

  const end = (write: boolean): void => {
    const was = drag;
    if (was === null) return;
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    unmark(was.cards);
    if (!write) return;
    const order = movedTo(was.ids, was.from, was.slot);
    if (order !== null) deps.reorder(order);
  };

  function onMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    drag.slot = dropSlot(drag.middles, event.clientY);
    mark(drag);
  }

  function onUp(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    end(true);
  }

  function onCancel(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    end(false);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // The drag's: the page's own Escape (deselect) does not run as well.
    event.preventDefault();
    event.stopPropagation();
    end(false);
  }

  const onDown = (event: PointerEvent): void => {
    const grip = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-drag]",
    );
    if (grip == null || !body.contains(grip) || event.button !== 0) return;
    if (drag !== null) return;
    const cards = [
      ...body.querySelectorAll<HTMLElement>(".card[data-station]"),
    ];
    const ids = cards.map((card) => card.dataset["station"] ?? "");
    const from = ids.indexOf(grip.dataset["drag"] ?? "");
    if (from < 0) return;
    // Neither a scroll of the dock nor a text selection: a drag.
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      cards,
      ids,
      middles: cards.map((card) => {
        const box = card.getBoundingClientRect();
        return box.top + box.height / 2;
      }),
      from,
      slot: from,
    };
    cards[from]?.classList.add("dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  body.addEventListener("pointerdown", onDown);
  return {
    dispose() {
      end(false);
      body.removeEventListener("pointerdown", onDown);
    },
  };
}
