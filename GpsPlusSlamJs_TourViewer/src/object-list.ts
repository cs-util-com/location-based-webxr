/**
 * The creator's list of placed objects (authoring plan 2026-09-28-0953
 * §3.4, M4): every object the tour will carry - the hosted zip's and this
 * device's - with Edit text, Move to the reticle (pins in AR) and Delete.
 *
 * Two halves:
 * - {@link objectListModel} - PURE: what the list shows for a given state
 *   (which rows, their words, which actions). Unit-tested.
 * - {@link createObjectListView} - the DOM: builds rows from a model and
 *   reports taps to the handlers the creator setup binds. Covered by the
 *   Playwright suite (this package's unit tests run without a DOM).
 *
 * The list lives in the setup panel, so it is on the page (desktop: list,
 * edit, delete need no AR) and inside the AR overlay. In AR it shows ONLY
 * the object selected by a tap (`object-pick.ts`): the overlay is the
 * screen and cannot be scrolled, so every further row would push the
 * panel's controls off it (a collapsed disclosure of all rows did exactly
 * that on a 360x640 phone - its buttons still took layout).
 *
 * @see object-list.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";

/** One object as the list sees it. */
export interface ObjectListEntry {
  readonly object: TourObject;
  /** The zip the tour was opened from (or the last Finish) carries its id. */
  readonly hosted: boolean;
  /** Placed, edited or moved on this device and not yet in that zip. */
  readonly changed: boolean;
}

/** What the list is drawn from. Everything here changes on an explicit
 *  event (a tap, a session start or end, a Finish), never per store
 *  dispatch: a redraw while the creator types would close the keyboard. */
export interface ObjectListState {
  readonly entries: readonly ObjectListEntry[];
  /** The stored codes' geo, for each object's distance to the nearest. */
  readonly codes: readonly QrGeoPose[];
  /** An AR session is live (the overlay shows the selection first). */
  readonly inAr: boolean;
  /** The object a tap in AR selected; null for none. */
  readonly selectedId: string | null;
  /** An action in flight per object id, as its button's busy label. */
  readonly busy: ReadonlyMap<string, string>;
  /** Actions are locked (a Finish is rebuilding the zip). */
  readonly locked: boolean;
  /** The last action's outcome, or a failure. */
  readonly note: string;
  /** The last delete can still be undone (M4 review #5). */
  readonly undo: boolean;
}

interface ObjectRowModel {
  readonly id: string;
  readonly kind: TourObject["kind"];
  /** A pin's text; a photo's caption or "Photo". */
  readonly title: string;
  /** On the page: kind, where it stands (in the zip, changed, new) and the
   *  distance to the code. In AR only the distance. */
  readonly detail: string;
  /**
   * In AR: drawn compact - the title, the chooser's position and the
   * detail on one line of text, and ONE line of buttons with short labels
   * (the chooser's Previous / Next at its ends). The full row put Edit,
   * Move, Delete and Done below the first screen of a 360x640 phone with
   * the code's re-measure offered (ar-layout.spec.js, 2026-10-01).
   */
  readonly compact: boolean;
  readonly selected: boolean;
  /** The busy label of an action in flight on this row, or null. */
  readonly busy: string | null;
  /** Edit text: pins only (a photo's caption is shown nowhere). */
  readonly canEditText: boolean;
  /** Move to the reticle: pins only, and only in AR (a photo's pose is
   *  where it was taken). */
  readonly canMove: boolean;
  /** Every action is off while the row is busy or the list is locked. */
  readonly enabled: boolean;
}

export interface ObjectListModel {
  readonly hidden: boolean;
  /** "Objects in this tour (3)" on the page; "" in AR, where every line
   *  over the camera costs the creator part of the view. */
  readonly heading: string;
  /** In AR: how to select; on the page: where moving happens. */
  readonly hint: string;
  /** Every row on the page; in AR only the selected one (or none). */
  readonly rows: readonly ObjectRowModel[];
  readonly note: string;
  /** Offer Undo beside the note: the delete it reports can be undone. */
  readonly undo: boolean;
  /**
   * In AR, Previous / Next through every object with the selection's place
   * ("2 of 5") or, before one, the count ("5 objects"): how an object too
   * far, too small or hidden behind another to tap is still selected - and
   * moved, which needs the selection (M4 review #4). Null on the page,
   * which lists everything, and with no objects. `inRow`: an object is
   * selected, and the chooser is drawn INTO its row (no line of its own).
   */
  readonly chooser: {
    readonly position: string;
    readonly inRow: boolean;
  } | null;
}

/** Said in AR while nothing is selected. */
export const SELECT_HINT =
  "Aim the ring at a pin or photo and tap the screen to select it.";
/** Said on the page when there are pins. */
const MOVE_HINT =
  "To move a pin, start the AR setup, select the pin and tap Move to the reticle.";

/** Horizontal metres between two geo points. */
function horizontalM(a: QrGeoPose, b: QrGeoPose): number {
  const nue = calcRelativeCoordsInMeters(
    { lat: a.lat, lon: a.lon },
    { lat: b.lat, lon: b.lon },
    b.alt,
    a.alt,
  );
  return Math.hypot(nue[0], nue[2]);
}

/** "4 m from the code", or "" without a code. Rounded to whole metres:
 *  the objects' own GPS error is metres, so decimals would be noise. */
function codeDistance(object: TourObject, codes: readonly QrGeoPose[]): string {
  const distances = codes
    .map((code) => horizontalM(code, object.geo))
    .filter(Number.isFinite);
  if (distances.length === 0) return "";
  const nearest = Math.round(Math.min(...distances));
  return codes.length === 1
    ? `${String(nearest)} m from the code`
    : `${String(nearest)} m from the nearest code`;
}

function standing(entry: ObjectListEntry): string {
  if (!entry.changed) return "in the zip";
  return entry.hosted
    ? "changed, not yet in the zip"
    : "new, not yet in the zip";
}

function rowOf(entry: ObjectListEntry, state: ObjectListState): ObjectRowModel {
  const { object } = entry;
  const busy = state.busy.get(object.id) ?? null;
  const title =
    object.kind === "pin" ? object.label : (object.label ?? "Photo");
  const distance = codeDistance(object, state.codes);
  return {
    id: object.id,
    kind: object.kind,
    title,
    detail: state.inAr
      ? distance
      : [
          object.kind === "pin" ? "Pin" : "Photo",
          standing(entry),
          ...(distance === "" ? [] : [distance]),
        ].join(" · "),
    compact: state.inAr,
    selected: object.id === state.selectedId,
    busy,
    canEditText: object.kind === "pin",
    canMove: object.kind === "pin" && state.inAr,
    enabled: busy === null && !state.locked,
  };
}

/** What the list shows for `state` (pure). */
export function objectListModel(state: ObjectListState): ObjectListModel {
  const rows = state.entries.map((entry) => rowOf(entry, state));
  const count = rows.length;
  const heading = `Objects in this tour (${String(count)})`;
  const hasPins = rows.some((row) => row.kind === "pin");
  if (!state.inAr) {
    return {
      hidden: count === 0 && state.note === "",
      heading,
      hint: hasPins ? MOVE_HINT : "",
      rows,
      note: state.note,
      undo: state.undo,
      chooser: null,
    };
  }
  const selected = rows.filter((row) => row.selected);
  const index = rows.findIndex((row) => row.selected);
  const chooser =
    count === 0
      ? null
      : {
          position:
            index >= 0
              ? `${String(index + 1)} of ${String(count)}`
              : count === 1
                ? "1 object"
                : `${String(count)} objects`,
          inRow: index >= 0,
        };
  return {
    hidden: count === 0 && state.note === "",
    heading: "",
    hint: selected.length === 0 && count > 0 ? SELECT_HINT : "",
    rows: selected,
    note: state.note,
    undo: state.undo,
    chooser,
  };
}

/** What the list's buttons do; bound once by the creator setup. */
export interface ObjectListHandlers {
  editText(id: string, text: string): void;
  move(id: string): void;
  remove(id: string): void;
  /** Undo the last delete (the note's "Undo"). */
  undo(): void;
  /** Select the next (+1) or previous (-1) object (the AR chooser). */
  step(delta: 1 | -1): void;
}

/** The list as the creator setup drives it. */
export interface ObjectListView {
  bind(handlers: ObjectListHandlers): void;
  render(model: ObjectListModel): void;
}

/**
 * The DOM view over `container` (`#object-list`). Redraws only when the
 * model changed, and keeps an open inline editor's text across a redraw.
 */
export function createObjectListView(
  container: HTMLElement,
  doc: Document,
): ObjectListView {
  let handlers: ObjectListHandlers | null = null;
  let lastKey = "";
  /** The row whose text is being edited, and its typed value. */
  let editing: { id: string; value: string } | null = null;
  let current: ObjectListModel | null = null;

  function button(
    label: string,
    testId: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "btn btn--prose";
    b.textContent = label;
    b.dataset["testid"] = testId;
    b.addEventListener("click", onClick);
    return b;
  }

  /** A row's text: the title and the detail - in AR on ONE line with the
   *  chooser's position between them. */
  function rowText(row: ObjectRowModel, chooserInRow: boolean): HTMLElement[] {
    const title = doc.createElement("span");
    title.className = "object-title";
    title.dataset["testid"] = "object-title";
    title.textContent = row.title;
    const detail = doc.createElement("span");
    detail.className = "object-detail hint--dim";
    detail.dataset["testid"] = "object-detail";
    detail.textContent = row.detail;
    if (!row.compact) return [title, detail];
    const line = doc.createElement("div");
    line.className = "object-line";
    line.append(title, ...(chooserInRow ? [position] : []), detail);
    return [line];
  }

  /**
   * A row's buttons. In AR (compact) short labels - the accessible name
   * keeps the full one, which contains the visible word (WCAG 2.5.3 "label
   * in name") - with the chooser's Previous and Next at the ends of the
   * line when the chooser is drawn into the row.
   */
  function rowButtons(
    row: ObjectRowModel,
    chooserInRow: boolean,
  ): HTMLButtonElement[] {
    const labelled = (
      short: string,
      full: string,
      testId: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const b = button(row.compact ? short : full, testId, onClick);
      if (row.compact && short !== full) b.setAttribute("aria-label", full);
      b.disabled = !row.enabled;
      return b;
    };
    const out: HTMLButtonElement[] = [];
    if (row.canEditText) {
      out.push(
        labelled("Edit", "Edit text", "object-edit", () => {
          editing = { id: row.id, value: row.title };
          redraw();
        }),
      );
    }
    if (row.canMove) {
      out.push(
        labelled("Move", "Move to the reticle", "object-move", () => {
          handlers?.move(row.id);
        }),
      );
    }
    out.push(
      labelled("Delete", "Delete", "object-delete", () => {
        handlers?.remove(row.id);
      }),
    );
    return chooserInRow ? [previous, ...out, next] : out;
  }

  function rowElement(row: ObjectRowModel): HTMLLIElement {
    const li = doc.createElement("li");
    li.className = row.compact
      ? "object-row object-row-compact"
      : "object-row";
    li.dataset["testid"] = "object-row";
    li.dataset["objectId"] = row.id;
    if (row.selected) li.dataset["selected"] = "true";
    const chooserInRow = row.compact && current?.chooser?.inRow === true;
    li.append(...rowText(row, chooserInRow));
    const actions = doc.createElement("div");
    actions.className = "object-actions";
    if (editing?.id === row.id && row.enabled) {
      const input = doc.createElement("input");
      input.className = "input";
      input.type = "text";
      input.autocomplete = "off";
      input.value = editing.value;
      input.dataset["testid"] = "object-edit-input";
      input.addEventListener("input", () => {
        if (editing !== null) editing = { id: row.id, value: input.value };
      });
      actions.append(
        input,
        button("Save the text", "object-edit-save", () => {
          const value = input.value;
          editing = null;
          handlers?.editText(row.id, value);
        }),
        button("Cancel", "object-edit-cancel", () => {
          editing = null;
          redraw();
        }),
      );
      li.append(actions);
      return li;
    }
    actions.append(...rowButtons(row, chooserInRow));
    if (row.busy !== null) {
      const busy = doc.createElement("span");
      busy.className = "object-busy";
      busy.dataset["testid"] = "object-busy";
      busy.textContent = row.busy;
      actions.append(busy);
    }
    li.append(actions);
    return li;
  }

  /** The parts that persist across redraws: the live region must stay the
   *  same element, or a screen reader announces nothing. */
  const heading = doc.createElement("p");
  heading.className = "object-list-heading";
  heading.dataset["testid"] = "object-list-heading";
  const hint = doc.createElement("p");
  hint.className = "hint--dim";
  hint.dataset["testid"] = "object-list-hint";
  // The AR chooser (M4 review #4): one compact line, so every control
  // still fits the first screen of a small phone (ar-layout.spec.js).
  const chooser = doc.createElement("div");
  chooser.className = "object-chooser";
  chooser.dataset["testid"] = "object-chooser";
  // ONE pair of chooser buttons and one position, moved between the
  // chooser's own line and the selected row on each redraw - never two
  // elements with the same test id.
  const previous = button("‹ Previous", "object-previous", () => {
    handlers?.step(-1);
  });
  previous.setAttribute("aria-label", "Previous object");
  const position = doc.createElement("span");
  position.className = "object-position";
  position.dataset["testid"] = "object-position";
  const next = button("Next ›", "object-next", () => {
    handlers?.step(1);
  });
  next.setAttribute("aria-label", "Next object");
  chooser.append(previous, position, next);
  const body = doc.createElement("div");
  const note = doc.createElement("p");
  note.className = "object-list-note";
  note.dataset["testid"] = "object-list-note";
  note.setAttribute("aria-live", "polite");
  // Undo sits with the outcome it undoes (M4 review #5), outside the live
  // region so a screen reader announces the outcome, not the button.
  const undo = button("Undo", "object-undo", () => {
    handlers?.undo();
  });
  const noteLine = doc.createElement("div");
  noteLine.className = "object-list-note-line";
  noteLine.append(note, undo);
  container.replaceChildren(heading, hint, chooser, body, noteLine);

  /** The chooser's buttons and position go back on its own line before
   *  the rows are drawn; a compact selected row takes them over
   *  (`rowButtons`, `rowText`), with "‹" and "›" for labels there. */
  function placeChooser(model: ObjectListModel): void {
    const inRow = model.chooser?.inRow === true;
    position.textContent = model.chooser?.position ?? "";
    previous.textContent = inRow ? "‹" : "‹ Previous";
    next.textContent = inRow ? "›" : "Next ›";
    chooser.append(previous, position, next);
    chooser.hidden = model.chooser === null || inRow;
  }

  function redraw(): void {
    const model = current;
    if (model === null) return;
    // An open editor keeps its typed text across the redraw.
    const typed = body.querySelector<HTMLInputElement>(
      '[data-testid="object-edit-input"]',
    );
    if (editing !== null && typed !== null) {
      editing = { id: editing.id, value: typed.value };
    }
    container.hidden = model.hidden;
    heading.textContent = model.heading;
    heading.hidden = model.heading === "";
    hint.textContent = model.hint;
    hint.hidden = model.hint === "";
    note.textContent = model.note;
    undo.hidden = !model.undo;
    placeChooser(model);
    body.replaceChildren();
    const list = doc.createElement("ul");
    list.className = "object-rows";
    for (const row of model.rows) list.append(rowElement(row));
    body.append(list);
  }

  return {
    bind(bound) {
      handlers = bound;
    },
    render(model) {
      const key = JSON.stringify(model);
      if (key === lastKey) return;
      lastKey = key;
      current = model;
      // An editor whose row went away (deleted, list locked) closes.
      if (
        editing !== null &&
        !model.rows.some((row) => row.id === editing?.id && row.enabled)
      ) {
        editing = null;
      }
      redraw();
    },
  };
}
