/**
 * The tree's reorder by drag: a card dragged by its grip (`[data-drag]`,
 * drawn by the app) lands where it is dropped, as ONE reorder of the whole
 * list (one undo step). While it moves, the card
 * it carries is marked `dragging` and the card it would land before is
 * marked `drop-before` (past the last card: the last is `drop-after`). A
 * drop where the card already was writes nothing; Escape or a cancelled
 * pointer end the drag with nothing written. Held near the dock's top or
 * bottom edge, the drag scrolls the dock, and the slot follows the cards
 * as they move. A redraw of the tree mid-drag (any store change) carries
 * the drag over to the new cards when they are the same cards, and
 * ends it with nothing written when they are not, at a move or at the
 * release. The slot maths is
 * `tree-reorder.ts`'s. The cards' selector and id attribute are the
 * app's: the kit has none of its own. With an `arm` a press waits before
 * it drags (`tree-drag-arm.ts`): a finger rests first, a mouse moves a
 * little; a list that scrolls under a finger needs it.
 *
 * @see tree-drag.ts.md
 */
import {
  armIsValid,
  armState,
  type ArmState,
  type TreeDragArm,
} from "./tree-drag-arm.js";
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

/** A press on a grip that waits for its arm (`deps.arm`). */
interface Press {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** The press's event time (ms). */
  readonly at: number;
}

/** The move a drop made: the card's id, its index before, and the slot it
 *  went to (counted before the move, `movedTo`'s). */
interface TreeDragMove {
  readonly id: string;
  readonly from: number;
  readonly slot: number;
}

const MARKS = ["dragging", "drop-before", "drop-after"] as const;

/** How near the dock's edge the pointer scrolls it, in CSS px. */
const EDGE_PX = 32;
/** The scroll per frame at the very edge, in CSS px (less farther in). */
const SCROLL_PX = 12;

/** The cards' middles where they are now (the dock may have scrolled). */
function middlesOf(cards: readonly HTMLElement[]): number[] {
  return cards.map((card) => {
    const box = card.getBoundingClientRect();
    return box.top + box.height / 2;
  });
}

export function createTreeDrag(deps: {
  /** The tree's body: its cards, in order. */
  readonly body: HTMLElement;
  /** The cards' selector inside `body`. */
  readonly cards: string;
  /** The `dataset` key of a card's id (`node` reads `data-node`); a
   *  grip's `data-drag` names the same id. */
  readonly idAttribute: string;
  /** Write the cards' new order (every id once); `move` is the one card
   *  moved, for a page that writes a move rather than an order. */
  readonly reorder: (order: readonly string[], move: TreeDragMove) => void;
  /** When a press becomes a drag (default: at once). */
  readonly arm?: TreeDragArm;
  /** The frame scheduler (default: the window's animation frames). */
  readonly frame?: (run: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
}): { dispose(): void } {
  const { body, arm } = deps;
  if (arm !== undefined && !armIsValid(arm)) {
    throw new RangeError("a tree drag's arm takes numbers of 0 or more");
  }
  const selector: unknown = deps.cards;
  const idAttribute: unknown = deps.idAttribute;
  if (
    typeof selector !== "string" ||
    typeof idAttribute !== "string" ||
    selector === "" ||
    idAttribute === ""
  ) {
    throw new RangeError(
      "a tree drag needs a card selector and an id attribute",
    );
  }
  const cardsNow = (): HTMLElement[] => [
    ...body.querySelectorAll<HTMLElement>(selector),
  ];
  const idOf = (card: HTMLElement): string => card.dataset[idAttribute] ?? "";
  const frame =
    deps.frame ?? ((run: FrameRequestCallback) => requestAnimationFrame(run));
  const cancelFrame =
    deps.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
  let drag: Drag | null = null;
  let press: Press | null = null;

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
   *  cards carry on (marked again), others end the drag unwritten. */
  const current = (now: Drag): boolean => {
    if (now.cards.every((card) => card.isConnected)) return true;
    const cards = cardsNow();
    const ids = cards.map(idOf);
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

  const unlisten = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    body.removeEventListener("scroll", onScroll);
  };

  const end = (write: boolean): void => {
    if (press !== null) {
      press = null;
      unlisten();
    }
    const was = drag;
    if (was === null) return;
    drag = null;
    if (was.frame !== null) cancelFrame(was.frame);
    unlisten();
    unmark(was.cards);
    if (!write) return;
    const order = movedTo(was.ids, was.from, was.slot);
    const id = was.ids[was.from];
    if (order !== null && id !== undefined) {
      deps.reorder(order, { id, from: was.from, slot: was.slot });
    }
  };

  /** The drag of the card `id` from the pointer at `y`, by the cards as
   *  they stand now; false when the card is gone. */
  const begin = (pointerId: number, id: string, y: number): boolean => {
    const cards = cardsNow();
    const ids = cards.map(idOf);
    const from = ids.indexOf(id);
    if (from < 0) return false;
    drag = { pointerId, cards, ids, from, slot: from, y, frame: null };
    cards[from]?.classList.add("dragging");
    return true;
  };

  /** The drag follows the pointer to `y`, and scrolls the dock while
   *  it is near an edge. */
  const track = (now: Drag, y: number): void => {
    now.y = y;
    follow(now);
    if (drag === now && now.frame === null && scrollStep(now.y) !== 0) {
      now.frame = frame(scrollFrame);
    }
  };

  /** A move of a press that waits: still waiting, its drag begun (this
   *  move tracked), or no drag at all. A lagging page gets several moves
   *  folded into one event: the first that decides counts. */
  const armed = (now: Press, event: PointerEvent): void => {
    if (arm === undefined) return;
    const folded =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [];
    let state: ArmState = "wait";
    for (const move of folded.length > 0 ? folded : [event]) {
      state = armState(arm, {
        pointer: now.pointerType,
        distancePx: Math.hypot(move.clientX - now.x, move.clientY - now.y),
        ms: move.timeStamp - now.at,
      });
      if (state !== "wait") break;
    }
    if (state === "wait") return;
    press = null;
    if (state === "none" || !begin(now.pointerId, now.id, event.clientY)) {
      unlisten();
      return;
    }
    if (drag !== null) track(drag, event.clientY);
  };

  function onMove(event: PointerEvent): void {
    if (press !== null && event.pointerId === press.pointerId) {
      armed(press, event);
      return;
    }
    const now = drag;
    if (now === null || event.pointerId !== now.pointerId) return;
    track(now, event.clientY);
  }

  /** A finger's moves while it drags: the cards stay still under it. A
   *  press that waits leaves them to the browser, which scrolls for a
   *  flick (the app's grip lets it pan) and then cancels the press. */
  function onTouchMove(event: TouchEvent): void {
    if (drag !== null && event.cancelable) event.preventDefault();
  }

  /** A scroll of the dock by any means (a wheel, the drag's own): the
   *  slot follows the cards under the pointer. */
  function onScroll(): void {
    if (drag !== null) follow(drag);
  }

  function onUp(event: PointerEvent): void {
    if (press !== null && event.pointerId === press.pointerId) {
      end(false);
      return;
    }
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // The cards changed since the last move: the drag ended unwritten.
    if (!current(drag)) return;
    end(true);
  }

  function onCancel(event: PointerEvent): void {
    if (press !== null && event.pointerId === press.pointerId) {
      end(false);
      return;
    }
    if (drag === null || event.pointerId !== drag.pointerId) return;
    end(false);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // A press still waiting is no drag yet: the page's Escape stands.
    if (drag === null) {
      end(false);
      return;
    }
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
    if (drag !== null || press !== null) return;
    const id = grip.dataset["drag"] ?? "";
    if (!cardsNow().map(idOf).includes(id)) return;
    // No text selection and no emulated mouse: a drag, or a press that
    // waits for its arm. (Whether a finger scrolls the dock is the grip's
    // touch-action, and with an arm, onTouchMove's.)
    event.preventDefault();
    if (arm === undefined) {
      begin(event.pointerId, id, event.clientY);
    } else {
      press = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        id,
        x: event.clientX,
        y: event.clientY,
        at: event.timeStamp,
      };
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    body.addEventListener("scroll", onScroll);
  };

  body.addEventListener("pointerdown", onDown);
  // Not passive, so a drag's touch moves can hold the cards still; only
  // with an arm, whose grips let a finger pan.
  if (arm !== undefined) {
    body.addEventListener("touchmove", onTouchMove, { passive: false });
  }
  return {
    dispose() {
      end(false);
      body.removeEventListener("pointerdown", onDown);
      body.removeEventListener("touchmove", onTouchMove);
    },
  };
}
