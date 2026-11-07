/**
 * The Ctrl+K palette: one field where a creator types a kind and a place
 * ("long gate") and Enter adds it (`add-palette-model.ts` lists the
 * rows). A dialog over the view, its field a combobox over a listbox: the
 * arrows move the row that Enter adds (`aria-activedescendant`, the focus
 * staying in the field), a click adds a row, Escape and a press on the
 * backdrop close it with the focus back where it was (Escape goes no
 * further: the page's Escape would drop the selection), Tab closes it with
 * the focus back too and lets it move on from there (the palette is the
 * page's last element: from its field the focus would wrap to the page's
 * start).
 *
 * Under the field a chip per kind (`PALETTE_KINDS`) narrows the rows, a
 * second press giving every kind back; a press keeps the focus in the
 * field, so a phone's keyboard stays up. The chips are out of the Tab
 * order, which is the palette's closing key: from the keys, typing the
 * kind's word narrows the same way. The words found are marked in the
 * rows (`highlightParts`), as text, never markup.
 *
 * Ctrl+K opens it wherever the key is no field's: in a line field too (it
 * has no Ctrl+K of its own), not in a text of several lines or an editable
 * element, where it is the field's (the long-text writer's Link key). The
 * shell makes that choice before it asks `isPaletteKey`.
 *
 * @see add-palette.ts.md
 */
import { shellIcon } from "gps-plus-slam-editor-kit/chrome";

import {
  highlightParts,
  PALETTE_KINDS,
  paletteRows,
  type PaletteAdd,
  type PaletteKind,
  type PaletteRow,
  type PaletteStation,
} from "./add-palette-model.js";

export interface AddPalette {
  /** Open with an empty query, the focus in its field. */
  open(): void;
  close(returnFocus: boolean): void;
  isOpen(): boolean;
}

/** Ctrl+K (Cmd+K), no Shift or Alt: by the key's letter, else by its
 *  place where the layout's letter is not Latin. */
export function isPaletteKey(event: KeyboardEvent): boolean {
  const byLetter =
    event.key.toLowerCase() === "k" ||
    (event.code === "KeyK" && !/^[a-z]$/i.test(event.key));
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    byLetter
  );
}

/** `into` holding `text`, the words of `query` marked in it. */
function marked(into: HTMLElement, text: string, query: string): void {
  for (const part of highlightParts(text, query)) {
    if (part.hit) {
      const mark = document.createElement("mark");
      mark.textContent = part.text;
      into.append(mark);
    } else into.append(part.text);
  }
}

export function createAddPalette(deps: {
  /** Where it goes (the page's body). */
  readonly host: HTMLElement;
  /** The tour's stations now, in its order. */
  readonly stations: () => readonly PaletteStation[];
  /** The station the selection is in, or null. */
  readonly selectedStation: () => string | null;
  /** Add what a row adds; run after the palette closed. */
  readonly add: (what: PaletteAdd) => void;
}): AddPalette {
  const back = document.createElement("div");
  back.id = "add-palette-back";
  back.hidden = true;
  const box = document.createElement("div");
  box.id = "add-palette";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Add");
  box.hidden = true;
  const line = document.createElement("div");
  line.className = "pline";
  const field = document.createElement("input");
  field.id = "add-palette-input";
  field.type = "text";
  field.autocomplete = "off";
  field.spellcheck = false;
  field.placeholder = 'Add... a kind and a place, e.g. "long gate"';
  field.setAttribute("role", "combobox");
  field.setAttribute("aria-expanded", "true");
  field.setAttribute("aria-controls", "add-palette-list");
  field.setAttribute("aria-autocomplete", "list");
  field.setAttribute("aria-label", "What to add, and where");
  line.append(shellIcon("plus"), field);
  const filters = document.createElement("div");
  filters.className = "pfil";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Only this kind");
  const chips = PALETTE_KINDS.map((choice) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.tabIndex = -1;
    chip.dataset["pf"] = choice.kind;
    chip.setAttribute("aria-pressed", "false");
    chip.append(shellIcon(choice.icon), choice.label);
    return chip;
  });
  filters.append(...chips);
  const list = document.createElement("div");
  list.id = "add-palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "What it adds");
  const foot = document.createElement("div");
  foot.className = "pfoot";
  foot.textContent =
    "Up and Down choose, Enter adds, Esc closes; the place is the selected station unless you name one";
  box.append(line, filters, list, foot);
  deps.host.append(back, box);

  let rows: PaletteRow[] = [];
  let at = 0;
  /** The kind a chip keeps; null: every kind. */
  let only: PaletteKind | null = null;
  /** Where the focus was when it opened: it goes back there. */
  let before: HTMLElement | null = null;

  const isOpen = (): boolean => !box.hidden;

  function mark(): void {
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    options.forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === at));
    });
    const current = options[at];
    if (current === undefined) field.removeAttribute("aria-activedescendant");
    else {
      field.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView?.({ block: "nearest" });
    }
  }

  function draw(): void {
    rows = paletteRows(
      field.value,
      deps.stations(),
      deps.selectedStation(),
      only,
    );
    at = 0;
    for (const chip of chips) {
      const on = chip.dataset["pf"] === only;
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", String(on));
    }
    list.replaceChildren();
    if (rows.length === 0) {
      const none = document.createElement("div");
      none.className = "pempty";
      none.textContent =
        "Nothing matches. Type a kind (short text, long text, station) and a station's name or number.";
      list.append(none);
    }
    rows.forEach((row, i) => {
      const option = document.createElement("div");
      option.id = `add-palette-option-${String(i)}`;
      option.className = "pr";
      option.setAttribute("role", "option");
      option.dataset["index"] = String(i);
      const label = document.createElement("span");
      label.className = "pl";
      marked(label, row.label, field.value);
      const place = document.createElement("span");
      place.className = "pt";
      marked(place, row.place, field.value);
      option.append(shellIcon(row.icon), label, place);
      list.append(option);
    });
    mark();
  }

  function close(returnFocus: boolean): void {
    if (!isOpen()) return;
    box.hidden = true;
    back.hidden = true;
    const to = before;
    before = null;
    if (returnFocus && to?.isConnected === true) to.focus();
  }

  function pick(index: number): void {
    const row = rows[index];
    if (row === undefined) return;
    close(true);
    deps.add(row.add);
  }

  field.addEventListener("input", draw);
  field.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      at =
        (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      mark();
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(at);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(true);
    }
  });
  // A press on a row or a chip keeps the focus in the field; the click
  // acts.
  for (const keeping of [list, filters]) {
    keeping.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
  }
  filters.addEventListener("click", (event) => {
    const kind = (event.target as Element).closest<HTMLElement>("[data-pf]")
      ?.dataset["pf"] as PaletteKind | undefined;
    if (kind === undefined) return;
    only = only === kind ? null : kind;
    draw();
  });
  list.addEventListener("click", (event) => {
    const option = (event.target as Element).closest<HTMLElement>(
      "[data-index]",
    );
    if (option !== null) pick(Number(option.dataset["index"]));
  });
  back.addEventListener("pointerdown", () => {
    close(true);
  });

  return {
    open() {
      if (isOpen()) {
        field.select();
        return;
      }
      const active = document.activeElement;
      before = active instanceof HTMLElement ? active : null;
      field.value = "";
      only = null;
      back.hidden = false;
      box.hidden = false;
      draw();
      field.focus();
    },
    close,
    isOpen,
  };
}
