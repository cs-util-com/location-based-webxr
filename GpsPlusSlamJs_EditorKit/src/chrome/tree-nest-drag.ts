/**
 * The tree's drag of an item among nested lists: a row dragged by its
 * grip (the app's selector) lands before or after another row of a list
 * that takes it, or into a row that holds a list (a folder), as ONE move.
 * A drag stays inside its scope (the row's nearest ancestor of the app's
 * scope selector: a station's card), so it never crosses into another.
 * While it moves, the carried row is marked `dragging` and the row it
 * would land at `drop-before`, `drop-after` or `drop-into`. A drop where
 * the row already was writes nothing; Escape or a cancelled pointer end
 * the drag with nothing written; a redraw that no longer has the carried
 * row ends it unwritten. The rows' markup, their lists and which list
 * takes which item are the app's: the kit has none of its own. The slot
 * maths is `tree-reorder.ts`'s `movedAcross`.
 *
 * @see tree-nest-drag.ts.md
 */
import { movedAcross } from "./tree-reorder.js";

/** Where a row stands: its list and its id in it. */
export interface NestPlace {
  readonly list: string;
  readonly id: string;
}

/** Where a drop lands: at a slot of a list (counted before the move: 0
 *  first, the list's length last), or into a list, at its end. */
export type NestDrop =
  | { readonly list: string; readonly slot: number }
  | { readonly list: string; readonly into: true };

const MARKS = ["dragging", "drop-before", "drop-after", "drop-into"] as const;

/** The share of an into row's height, above and below its middle, that
 *  lands into it when its list also takes the item (0.25: its middle
 *  half). */
const INTO_BAND = 0.25;

interface Drag {
  readonly pointerId: number;
  readonly from: NestPlace;
  row: HTMLElement;
  /** The row marked as where it lands, and how. */
  target: { row: HTMLElement; drop: NestDrop; mark: string } | null;
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

  const rowsIn = (scope: Element): HTMLElement[] => [
    ...scope.querySelectorAll<HTMLElement>(deps.rows),
  ];

  const unmark = (): void => {
    for (const row of body.querySelectorAll<HTMLElement>(
      MARKS.map((m) => `.${m}`).join(","),
    )) {
      row.classList.remove(...MARKS);
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

  /** The row of `rows` nearest to `y` that takes the item at all. */
  const nearest = (
    now: Drag,
    rows: readonly HTMLElement[],
    y: number,
  ): HTMLElement | null => {
    let best: { row: HTMLElement; distance: number } | null = null;
    for (const candidate of rows) {
      const takes = takenBy(now, candidate);
      if (takes.into === null && takes.place === null) continue;
      const box = candidate.getBoundingClientRect();
      const distance = Math.max(box.top - y, y - box.bottom, 0);
      if (best === null || distance < best.distance) {
        best = { row: candidate, distance };
      }
    }
    return best?.row ?? null;
  };

  /** Where a drop at `y` lands: the row under it (else the nearest) of
   *  those whose list or folder takes the item. */
  const targetAt = (now: Drag, row: HTMLElement, y: number): Drag["target"] => {
    const scope = row.closest(deps.scope);
    if (scope === null) return null;
    const rows = rowsIn(scope);
    const at = nearest(now, rows, y);
    return at === null || at === row ? null : dropOn(now, rows, at, y);
  };

  /** The drop on `at` at `y`: into its folder near its middle (or
   *  anywhere on it when its own list does not take the item), else
   *  before or after it. */
  const dropOn = (
    now: Drag,
    rows: readonly HTMLElement[],
    at: HTMLElement,
    y: number,
  ): Drag["target"] => {
    const box = at.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const { into, place } = takenBy(now, at);
    const central = Math.abs(y - middle) <= box.height * INTO_BAND;
    if (into !== null && (place === null || central)) {
      return { row: at, drop: { list: into, into: true }, mark: "drop-into" };
    }
    if (place === null) return null;
    const index = (listsOf(rows)[place.list] ?? []).indexOf(place.id);
    const after = y >= middle;
    return {
      row: at,
      drop: { list: place.list, slot: index + (after ? 1 : 0) },
      mark: after ? "drop-after" : "drop-before",
    };
  };

  const end = (write: boolean): void => {
    const was = drag;
    if (was === null) return;
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    const row = write ? carried(was) : null;
    unmark();
    const target = was.target;
    if (row === null || target === null || !target.row.isConnected) return;
    if (changes(was.from, row, target.drop)) deps.move(was.from, target.drop);
  };

  /** Whether `drop` moves the item at all: a slot drop next to where it
   *  already stands writes nothing. */
  const changes = (from: NestPlace, row: HTMLElement, drop: NestDrop) => {
    if (!("slot" in drop)) return true;
    const scope = row.closest(deps.scope);
    const lists = scope === null ? {} : listsOf(rowsIn(scope));
    const index = (lists[from.list] ?? []).indexOf(from.id);
    if (index < 0) return false;
    const to = { list: drop.list, slot: drop.slot };
    return movedAcross(lists, { list: from.list, index }, to) !== null;
  };

  function onMove(event: PointerEvent): void {
    const now = drag;
    if (now === null || event.pointerId !== now.pointerId) return;
    const row = carried(now);
    if (row === null) {
      end(false);
      return;
    }
    for (const marked of body.querySelectorAll(
      ".drop-before,.drop-after,.drop-into",
    )) {
      marked.classList.remove("drop-before", "drop-after", "drop-into");
    }
    now.target = targetAt(now, row, event.clientY);
    now.target?.row.classList.add(now.target.mark);
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
    drag = { pointerId: event.pointerId, from, row, target: null };
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
