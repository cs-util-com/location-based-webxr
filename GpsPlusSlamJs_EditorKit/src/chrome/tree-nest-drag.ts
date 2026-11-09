/**
 * The tree's drag of an item among nested lists: a row dragged by its
 * grip (the app's selector) lands before or after another row of a list
 * that takes it, or into a row that holds a list (a folder), as ONE move.
 * A drag lands only where the pointer is: on the row under it (or one a
 * few pixels off, across the gap between two rows). Over a row whose list
 * or folder does not take the item, over the carried row itself, beside a
 * slot where it already stands or outside the rows, nothing is marked, the
 * drag says it cannot land there (`refused`: its ghost's badge and the
 * not-allowed cursor), and a release writes nothing - it never snaps to the
 * nearest place that would take it. A drag stays inside its scope (the
 * row's nearest ancestor of the app's scope selector: a station's card);
 * over another scope it lands on that scope as a whole only where the app
 * offers it (`across`), marked `drop-across`. While it moves, the carried
 * row is marked `dragging` and the row it would land at `drop-before`,
 * `drop-after` or `drop-into`. Escape or a cancelled pointer end the drag
 * with nothing written; a redraw that no longer has the carried row ends
 * it unwritten. The rows' markup, their lists and which list takes which
 * item are the app's: the kit has none of its own. The slot maths is
 * `tree-reorder.ts`'s `movedAcross`.
 *
 * @see tree-nest-drag.ts.md
 */
import { shellIcon } from "./shell-icons.js";
import { movedAcross } from "./tree-reorder.js";

/** Where a row stands: its list and its id in it. */
export interface NestPlace {
  readonly list: string;
  readonly id: string;
}

/** Where a drop lands: at a slot of a list (counted before the move: 0
 *  first, the list's length last), into a list, at its end, or onto
 *  another scope as a whole (its key, `across`). */
export type NestDrop =
  | { readonly list: string; readonly slot: number }
  | { readonly list: string; readonly into: true }
  | { readonly across: string };

const MARKS = [
  "dragging",
  "drop-before",
  "drop-after",
  "drop-into",
  "drop-across",
] as const;

const DROP_MARKS = ".drop-before,.drop-after,.drop-into,.drop-across";

/** The share of an into row's height, above and below its middle, that
 *  lands into it when its list also takes the item (0.25: its middle
 *  half). */
const INTO_BAND = 0.25;

/** How far above or below a row (px) the pointer still counts as on it:
 *  the gap between two rows, never a reach to a row further away. */
const ROW_GAP_PX = 8;

/** The ghost's offset from the pointer (px): beside a mouse pointer, and
 *  above a finger, which would hide it. */
const GHOST_MOUSE = { x: 14, y: 12 } as const;
const GHOST_FINGER = { x: -24, y: -64 } as const;

/** Said on the ghost where a drop cannot land. */
const REFUSED_WORDS = "Not possible here";

/** The root's attribute while a drag runs: `on`, or `refused` where it
 *  cannot land (the app's cursor rule). */
const ROOT_FLAG = "nestDrag";

interface Target {
  /** The element marked as where it lands: a row, or a scope. */
  readonly el: HTMLElement;
  readonly drop: NestDrop;
  readonly mark: string;
}

interface Drag {
  readonly pointerId: number;
  readonly from: NestPlace;
  row: HTMLElement;
  /** Where it lands now; null where it cannot. */
  target: Target | null;
  /** The pointer's picture of the item, made at the first move. */
  ghost: HTMLElement | null;
}

export function createNestDrag(deps: {
  /** The tree's body. */
  readonly body: HTMLElement;
  /** A grip's selector; a grip's row is its nearest `rows` ancestor. */
  readonly grip: string;
  /** Every row a drag may land at, in the order drawn. */
  readonly rows: string;
  /** The scope a drag stays in: its row's nearest ancestor of this. */
  readonly scope: string;
  /** A row's place, or null for a row that is only a folder to drop into. */
  readonly placeOf: (row: HTMLElement) => NestPlace | null;
  /** The list a drop onto `row` goes into, or null. */
  readonly intoOf: (row: HTMLElement) => string | null;
  /** Whether the item `from` may go into the list `to`. */
  readonly accepts: (from: NestPlace, to: string) => boolean;
  /** Write the move (one step). */
  readonly move: (from: NestPlace, to: NestDrop) => void;
  /** A drop onto another scope as a whole: its key (null: none), and
   *  whether the item may go there. None given: a drag never leaves its
   *  scope. */
  readonly across?: {
    readonly keyOf: (scope: HTMLElement) => string | null;
    readonly accepts: (from: NestPlace, key: string) => boolean;
  };
  /** The ghost's words for the carried row (default: its text). */
  readonly label?: (row: HTMLElement) => string;
}): { dispose(): void } {
  const { body } = deps;
  for (const selector of [deps.grip, deps.rows, deps.scope] as unknown[]) {
    if (typeof selector !== "string" || selector === "") {
      throw new RangeError(
        "a nested drag needs a grip, row and scope selector",
      );
    }
  }
  let drag: Drag | null = null;
  const root = (): HTMLElement => body.ownerDocument.documentElement;

  const rowsIn = (scope: Element): HTMLElement[] => [
    ...scope.querySelectorAll<HTMLElement>(deps.rows),
  ];

  const unmark = (selector: string): void => {
    for (const marked of body.querySelectorAll<HTMLElement>(selector)) {
      marked.classList.remove(...MARKS);
    }
  };

  /** The carried row in the page now: a redraw drew it again, or it is
   *  gone (null). */
  const carried = (now: Drag): HTMLElement | null => {
    if (now.row.isConnected) return now.row;
    const again = [...body.querySelectorAll<HTMLElement>(deps.rows)].find(
      (row) => {
        const place = deps.placeOf(row);
        return place?.id === now.from.id && place.list === now.from.list;
      },
    );
    if (again === undefined) return null;
    now.row = again;
    again.classList.add("dragging");
    return again;
  };

  /** The ids of each list of `rows`, in their order. */
  const listsOf = (rows: readonly HTMLElement[]): Record<string, string[]> => {
    const lists: Record<string, string[]> = {};
    for (const row of rows) {
      const place = deps.placeOf(row);
      if (place === null) continue;
      (lists[place.list] ??= []).push(place.id);
    }
    return lists;
  };

  /** What `row` takes of the dragged item: a drop into it (its folder's
   *  list), a drop beside it (its own list), both or neither. */
  const takenBy = (now: Drag, row: HTMLElement) => {
    const into = deps.intoOf(row);
    const place = deps.placeOf(row);
    return {
      into: into !== null && deps.accepts(now.from, into) ? into : null,
      place:
        place !== null && deps.accepts(now.from, place.list) ? place : null,
    };
  };

  /** The row the pointer at (`x`, `y`) is on: the drawn row under it, else
   *  the nearest within `ROW_GAP_PX` above or below; within the row's
   *  width. Null outside the rows. Whether it takes the item is not asked:
   *  the drop never goes to another row because this one refuses it. */
  const rowAt = (x: number, y: number): HTMLElement | null => {
    let best: { row: HTMLElement; distance: number } | null = null;
    for (const candidate of body.querySelectorAll<HTMLElement>(deps.rows)) {
      const box = candidate.getBoundingClientRect();
      if (box.height <= 0 || x < box.left || x > box.right) continue;
      const distance = Math.max(box.top - y, y - box.bottom, 0);
      if (distance > ROW_GAP_PX) continue;
      if (best === null || distance < best.distance) {
        best = { row: candidate, distance };
      }
    }
    return best?.row ?? null;
  };

  /** Where a drop at (`x`, `y`) lands, or null where it cannot. */
  const targetAt = (
    now: Drag,
    row: HTMLElement,
    x: number,
    y: number,
  ): Target | null => {
    const own = row.closest<HTMLElement>(deps.scope);
    const at = rowAt(x, y);
    if (own === null || at === null || at === row) return null;
    const scope = at.closest<HTMLElement>(deps.scope);
    if (scope === null) return null;
    if (scope !== own) return acrossTo(now, scope);
    const target = dropOn(now, rowsIn(own), at, y);
    return target !== null && changes(now.from, row, target.drop)
      ? target
      : null;
  };

  /** A drop onto the other scope `scope`, where the app takes it. */
  const acrossTo = (now: Drag, scope: HTMLElement): Target | null => {
    const key = deps.across?.keyOf(scope) ?? null;
    if (key === null || deps.across?.accepts(now.from, key) !== true) {
      return null;
    }
    return { el: scope, drop: { across: key }, mark: "drop-across" };
  };

  /** The drop on `at` at `y`: into its folder near its middle (or
   *  anywhere on it when its own list does not take the item), else
   *  before or after it; null when neither takes it. */
  const dropOn = (
    now: Drag,
    rows: readonly HTMLElement[],
    at: HTMLElement,
    y: number,
  ): Target | null => {
    const box = at.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const { into, place } = takenBy(now, at);
    const central = Math.abs(y - middle) <= box.height * INTO_BAND;
    if (into !== null && (place === null || central)) {
      return { el: at, drop: { list: into, into: true }, mark: "drop-into" };
    }
    if (place === null) return null;
    const index = (listsOf(rows)[place.list] ?? []).indexOf(place.id);
    const after = y >= middle;
    return {
      el: at,
      drop: { list: place.list, slot: index + (after ? 1 : 0) },
      mark: after ? "drop-after" : "drop-before",
    };
  };

  /** Whether `drop` moves the item at all: a slot drop next to where it
   *  already stands writes nothing, and nor does a drop into the list it
   *  already ends (an into drop lands at the list's end). */
  const changes = (from: NestPlace, row: HTMLElement, drop: NestDrop) => {
    if ("across" in drop) return true;
    const scope = row.closest(deps.scope);
    const lists = scope === null ? {} : listsOf(rowsIn(scope));
    const index = (lists[from.list] ?? []).indexOf(from.id);
    if (index < 0) return false;
    const slot = "slot" in drop ? drop.slot : (lists[drop.list] ?? []).length;
    const to = { list: drop.list, slot };
    return movedAcross(lists, { list: from.list, index }, to) !== null;
  };

  /** The pointer's picture of the item: its words, and the badge shown
   *  where it cannot land (an icon and words, read without a cursor). */
  const ghostOf = (row: HTMLElement): HTMLElement => {
    const doc = body.ownerDocument;
    const ghost = doc.createElement("div");
    ghost.className = "nest-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.position = "fixed";
    ghost.style.pointerEvents = "none";
    const name = doc.createElement("span");
    name.className = "nest-ghost-name";
    name.textContent = (deps.label?.(row) ?? row.textContent).trim();
    const badge = doc.createElement("span");
    badge.className = "nest-ghost-no";
    badge.append(shellIcon("ban"), REFUSED_WORDS);
    ghost.append(name, badge);
    doc.body.append(ghost);
    return ghost;
  };

  /** The ghost at the pointer, saying whether the drop lands. */
  const show = (now: Drag, event: PointerEvent, lands: boolean): void => {
    now.ghost ??= ghostOf(now.row);
    const off = event.pointerType === "touch" ? GHOST_FINGER : GHOST_MOUSE;
    now.ghost.style.left = `${String(event.clientX + off.x)}px`;
    now.ghost.style.top = `${String(event.clientY + off.y)}px`;
    now.ghost.toggleAttribute("data-refused", !lands);
    root().dataset[ROOT_FLAG] = lands ? "on" : "refused";
  };

  const end = (write: boolean): void => {
    const was = drag;
    if (was === null) return;
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    was.ghost?.remove();
    delete root().dataset[ROOT_FLAG];
    const row = write ? carried(was) : null;
    unmark(MARKS.map((m) => `.${m}`).join(","));
    const target = was.target;
    if (row === null || target === null || !target.el.isConnected) return;
    deps.move(was.from, target.drop);
  };

  function onMove(event: PointerEvent): void {
    const now = drag;
    if (now === null || event.pointerId !== now.pointerId) return;
    const row = carried(now);
    if (row === null) {
      end(false);
      return;
    }
    unmark(DROP_MARKS);
    now.target = targetAt(now, row, event.clientX, event.clientY);
    now.target?.el.classList.add(now.target.mark);
    show(now, event, now.target !== null);
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
      deps.grip,
    );
    if (grip == null || !body.contains(grip) || event.button !== 0) return;
    if (drag !== null) return;
    const row = grip.closest<HTMLElement>(deps.rows);
    const from = row === null ? null : deps.placeOf(row);
    if (row === null || from === null || row.closest(deps.scope) === null) {
      return;
    }
    // Neither a scroll of the dock nor a text selection, nor the row's
    // own press: a drag.
    event.preventDefault();
    event.stopPropagation();
    drag = { pointerId: event.pointerId, from, row, target: null, ghost: null };
    row.classList.add("dragging");
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
