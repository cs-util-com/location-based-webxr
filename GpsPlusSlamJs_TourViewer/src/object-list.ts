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
 * edit, delete need no AR) and inside the AR overlay. In AR it shows the
 * object selected by a tap (`object-pick.ts`) first, and the rest behind
 * an "All objects" disclosure - a long list over the camera would hide what
 * the creator is looking at.
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
}

interface ObjectRowModel {
  readonly id: string;
  readonly kind: TourObject["kind"];
  /** A pin's text; a photo's caption or "Photo". */
  readonly title: string;
  /** Kind, where it stands (in the zip, changed, new), distance to the code. */
  readonly detail: string;
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
  /** "Objects in this tour (3)" on the page; "" in AR, where the
   *  disclosure's summary carries the count and every line over the camera
   *  costs the creator part of the view. */
  readonly heading: string;
  /** In AR: how to select; on the page: where moving happens. */
  readonly hint: string;
  /** The selected row (AR) or every row (page), shown first. */
  readonly rows: readonly ObjectRowModel[];
  /** In AR, the rows behind the "All objects" disclosure; empty on the page. */
  readonly moreRows: readonly ObjectRowModel[];
  readonly note: string;
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
    detail: [
      object.kind === "pin" ? "Pin" : "Photo",
      standing(entry),
      ...(distance === "" ? [] : [distance]),
    ].join(" · "),
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
      moreRows: [],
      note: state.note,
    };
  }
  const selected = rows.filter((row) => row.selected);
  return {
    hidden: count === 0 && state.note === "",
    heading: "",
    hint: selected.length === 0 && count > 0 ? SELECT_HINT : "",
    rows: selected,
    moreRows: rows.filter((row) => !row.selected),
    note: state.note,
  };
}

/** What the list's buttons do; bound once by the creator setup. */
export interface ObjectListHandlers {
  editText(id: string, text: string): void;
  move(id: string): void;
  remove(id: string): void;
  /** Deselect (the selected row's "Done"). */
  clearSelection(): void;
}

/** The list as the creator setup drives it. */
export interface ObjectListView {
  bind(handlers: ObjectListHandlers): void;
  render(model: ObjectListModel): void;
}

/**
 * The DOM view over `container` (`#object-list`). Redraws only when the
 * model changed, keeps an open inline editor's text across a redraw, and
 * remembers whether the "All objects" disclosure was open.
 */
export function createObjectListView(
  container: HTMLElement,
  doc: Document,
): ObjectListView {
  let handlers: ObjectListHandlers | null = null;
  let lastKey = "";
  /** The row whose text is being edited, and its typed value. */
  let editing: { id: string; value: string } | null = null;
  let moreOpen = false;
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

  function rowElement(row: ObjectRowModel): HTMLLIElement {
    const li = doc.createElement("li");
    li.className = "object-row";
    li.dataset["testid"] = "object-row";
    li.dataset["objectId"] = row.id;
    if (row.selected) li.dataset["selected"] = "true";
    const title = doc.createElement("span");
    title.className = "object-title";
    title.dataset["testid"] = "object-title";
    title.textContent = row.title;
    const detail = doc.createElement("span");
    detail.className = "object-detail hint--dim";
    detail.dataset["testid"] = "object-detail";
    detail.textContent = row.detail;
    li.append(title, detail);
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
    const add = (b: HTMLButtonElement, busyLabel: string | null): void => {
      b.disabled = !row.enabled;
      if (busyLabel !== null) b.textContent = busyLabel;
      actions.append(b);
    };
    if (row.canEditText) {
      add(
        button("Edit text", "object-edit", () => {
          editing = { id: row.id, value: row.title };
          redraw();
        }),
        null,
      );
    }
    if (row.canMove) {
      add(
        button("Move to the reticle", "object-move", () => {
          handlers?.move(row.id);
        }),
        null,
      );
    }
    add(
      button("Delete", "object-delete", () => {
        handlers?.remove(row.id);
      }),
      null,
    );
    if (row.selected) {
      add(
        button("Done", "object-deselect", () => {
          handlers?.clearSelection();
        }),
        null,
      );
    }
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
  const body = doc.createElement("div");
  const note = doc.createElement("p");
  note.className = "object-list-note";
  note.dataset["testid"] = "object-list-note";
  note.setAttribute("aria-live", "polite");
  container.replaceChildren(heading, hint, body, note);

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
    const more = body.querySelector<HTMLDetailsElement>("details");
    if (more !== null) moreOpen = more.open;
    container.hidden = model.hidden;
    heading.textContent = model.heading;
    heading.hidden = model.heading === "";
    hint.textContent = model.hint;
    hint.hidden = model.hint === "";
    note.textContent = model.note;
    body.replaceChildren();
    const list = doc.createElement("ul");
    list.className = "object-rows";
    for (const row of model.rows) list.append(rowElement(row));
    body.append(list);
    if (model.moreRows.length > 0) {
      const details = doc.createElement("details");
      details.dataset["testid"] = "object-list-more";
      details.open = moreOpen;
      const summary = doc.createElement("summary");
      summary.textContent = `All objects (${String(model.moreRows.length)})`;
      const rest = doc.createElement("ul");
      rest.className = "object-rows";
      for (const row of model.moreRows) rest.append(rowElement(row));
      details.append(summary, rest);
      body.append(details);
    }
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
        ![...model.rows, ...model.moreRows].some(
          (row) => row.id === editing?.id && row.enabled,
        )
      ) {
        editing = null;
      }
      redraw();
    },
  };
}
