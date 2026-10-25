/**
 * The tree's reorder by drag: a station's card dragged by its grip
 * (`[data-drag]`, drawn by `shell-tree.ts`) lands where it is dropped, as
 * ONE reorder of the whole tour (one undo step). While it moves, the card
 * it carries is marked `dragging` and the card it would land before is
 * marked `drop-before` (past the last card: the last is `drop-after`). A
 * drop where the card already was writes nothing; Escape or a cancelled
 * pointer end the drag with nothing written. Held near the dock's top or
 * bottom edge, the drag scrolls the dock, and the slot follows the cards
 * as they move. A redraw of the tree mid-drag (any store change) carries
 * the drag over to the new cards when they are the same stations, and
 * ends it with nothing written when they are not. The slot maths is
 * `tree-reorder.ts`'s. The keyboard's way to reorder is the inspector's
 * Earlier and Later.
 *
 * @see tree-drag.ts.md
 */
import { dropSlot, movedTo } from "./tree-reorder.js";

interface Drag {
  readonly pointerId: number;
  cards: readonly HTMLElement[];
  readonly ids: readonly string[];
  readonly from: number;
  slot: number;
  /** The pointer's last height on the page. */
  y: number;
  /** The scroll frame asked for, while the pointer is near an edge. */
  frame: number | null;
}

const MARKS = ["dragging", "drop-before", "drop-after"] as const;

/** How near the dock's edge the pointer scrolls it, in CSS px. */
const EDGE_PX = 32;
/** The scroll per frame at the very edge, in CSS px (less farther in). */
const SCROLL_PX = 12;

function stationCards(body: HTMLElement): HTMLElement[] {
  return [...body.querySelectorAll<HTMLElement>(".card[data-station]")];
}

/** The cards' middles where they are now (the dock may have scrolled). */
function middlesOf(cards: readonly HTMLElement[]): number[] {
  return cards.map((card) => {
    const box = card.getBoundingClientRect();
    return box.top + box.height / 2;
  });
}

export function createTreeDrag(deps: {
  /** The tree's body: its `.card[data-station]` elements, in order. */
  readonly body: HTMLElement;
  /** Write the stations' new order (every station once). */
  readonly reorder: (order: readonly string[]) => void;
  /** The frame scheduler (default: the window's animation frames). */
  readonly frame?: (run: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
}): { dispose(): void } {
  const { body } = deps;
  const frame =
    deps.frame ?? ((run: FrameRequestCallback) => requestAnimationFrame(run));
  const cancelFrame =
    deps.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
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

  /** The drag's cards, drawn again since by a store change: the same
   *  stations carry on (marked again), others end the drag unwritten. */
  const current = (now: Drag): boolean => {
    if (now.cards.every((card) => card.isConnected)) return true;
    const cards = stationCards(body);
    const ids = cards.map((card) => card.dataset["station"] ?? "");
    if (
      ids.length !== now.ids.length ||
      ids.some((id, i) => id !== now.ids[i])
    ) {
      end(false);
      return false;
    }
    now.cards = cards;
    cards[now.from]?.classList.add("dragging");
    return true;
  };

  /** The slot under the pointer, by where the cards are now. */
  const follow = (now: Drag): void => {
    if (!current(now)) return;
    now.slot = dropSlot(middlesOf(now.cards), now.y);
    mark(now);
  };

  /** How far to scroll this frame: toward the edge the pointer is near,
   *  faster the nearer; 0 away from both. */
  const scrollStep = (y: number): number => {
    const box = body.getBoundingClientRect();
    if (y < box.top + EDGE_PX) {
      return -Math.ceil(
        SCROLL_PX * Math.min(1, (box.top + EDGE_PX - y) / EDGE_PX),
      );
    }
    if (y > box.bottom - EDGE_PX) {
      return Math.ceil(
        SCROLL_PX * Math.min(1, (y - (box.bottom - EDGE_PX)) / EDGE_PX),
      );
    }
    return 0;
  };

  const scrollFrame = (): void => {
    const now = drag;
    if (now === null) return;
    now.frame = null;
    const step = scrollStep(now.y);
    if (step === 0) return;
    const was = body.scrollTop;
    body.scrollTop = was + step;
    follow(now);
    // At the end of the list the dock stops; so does the loop.
    if (drag === now && body.scrollTop !== was) now.frame = frame(scrollFrame);
  };

  const end = (write: boolean): void => {
    const was = drag;
    if (was === null) return;
    drag = null;
    if (was.frame !== null) cancelFrame(was.frame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    body.removeEventListener("scroll", onScroll);
    unmark(was.cards);
    if (!write) return;
    const order = movedTo(was.ids, was.from, was.slot);
    if (order !== null) deps.reorder(order);
  };

  function onMove(event: PointerEvent): void {
    const now = drag;
    if (now === null || event.pointerId !== now.pointerId) return;
    now.y = event.clientY;
    follow(now);
    if (drag === now && now.frame === null && scrollStep(now.y) !== 0) {
      now.frame = frame(scrollFrame);
    }
  }

  /** A scroll of the dock by any means (a wheel, the drag's own): the
   *  slot follows the cards under the pointer. */
  function onScroll(): void {
    if (drag !== null) follow(drag);
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
    const cards = stationCards(body);
    const ids = cards.map((card) => card.dataset["station"] ?? "");
    const from = ids.indexOf(grip.dataset["drag"] ?? "");
    if (from < 0) return;
    // Neither a scroll of the dock nor a text selection: a drag.
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      cards,
      ids,
      from,
      slot: from,
      y: event.clientY,
      frame: null,
    };
    cards[from]?.classList.add("dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    body.addEventListener("scroll", onScroll);
  };

  body.addEventListener("pointerdown", onDown);
  return {
    dispose() {
      end(false);
      body.removeEventListener("pointerdown", onDown);
    },
  };
}
