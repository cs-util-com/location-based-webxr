/**
 * Draws the open dialog's drop area from the store (`entry-drop.ts`): one
 * row per file with its chip, a radio where several tours or several
 * scans came, the scan note, and the ONE action with its question. It
 * holds no state: the page calls it whenever the rows, the picks, the
 * busy flag or the open tour changed, and it reports presses back.
 *
 * @see entry-drop-view.ts.md
 */
import {
  chipLine,
  SCAN_NOTE,
  type EntryAction,
  type EntryPicks,
  type EntryRow,
} from "./entry-drop.js";

/** The drop area's elements, from the page (`edit.html`). */
export interface EntryDropElements {
  /** The list the rows go in. */
  readonly rows: HTMLElement;
  /** The line saying what a scan is and is not. */
  readonly note: HTMLElement;
  /** The action's block: its question and buttons. */
  readonly act: HTMLElement;
  readonly question: HTMLElement;
  /** The one action. */
  readonly go: HTMLButtonElement;
  /** A lone scan, a tour open: add it to that tour instead. */
  readonly addToOpen: HTMLButtonElement;
}

/** What the drop area shows. */
export interface EntryDropView {
  readonly rows: readonly EntryRow[];
  readonly picks: EntryPicks;
  readonly action: EntryAction;
  /** An open, a read or a fetch runs: every control waits. */
  readonly busy: boolean;
}

/** The presses the drop area reports. */
export interface EntryDropHandlers {
  readonly remove: (id: string) => void;
  readonly pick: (id: string) => void;
}

function rowElement(
  row: EntryRow,
  radio: boolean,
  checked: boolean,
  busy: boolean,
  on: EntryDropHandlers,
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "entry-row";
  li.dataset["kind"] = row.chip.kind;
  li.dataset["id"] = row.id;
  // The row is the radio's label: a click anywhere on it picks it.
  const label = document.createElement("label");
  label.className = "entry-main";
  if (radio) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `entry-${row.chip.kind}`;
    input.checked = checked;
    input.disabled = busy;
    input.dataset["id"] = row.id;
    input.addEventListener("change", () => {
      on.pick(row.id);
    });
    label.append(input);
  }
  const name = document.createElement("span");
  name.className = "entry-name";
  name.textContent = row.name;
  name.title = row.name;
  const chip = document.createElement("span");
  chip.className = "entry-chip";
  chip.textContent = chipLine(row.chip);
  label.append(name, chip);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn ghost small entry-remove";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${row.name}`);
  remove.disabled = busy;
  remove.dataset["id"] = row.id;
  remove.addEventListener("click", (event) => {
    // Inside the dialog's drop label a click would also open the chooser.
    event.preventDefault();
    on.remove(row.id);
  });
  li.append(label, remove);
  return li;
}

/** Draws `view` into `el`. Focus on a row's control survives the redraw. */
export function renderEntryDrop(
  el: EntryDropElements,
  view: EntryDropView,
  on: EntryDropHandlers,
): void {
  const focused =
    document.activeElement instanceof HTMLElement &&
    el.rows.contains(document.activeElement)
      ? {
          id: document.activeElement.dataset["id"],
          remove: document.activeElement.classList.contains("entry-remove"),
        }
      : null;
  const count = (kind: string): number =>
    view.rows.filter((r) => r.chip.kind === kind).length;
  const radios = { tour: count("tour") > 1, scan: count("scan") > 1 };
  el.rows.replaceChildren(
    ...view.rows.map((row) =>
      rowElement(
        row,
        (row.chip.kind === "tour" && radios.tour) ||
          (row.chip.kind === "scan" && radios.scan),
        view.picks.tour === row.id || view.picks.scan === row.id,
        view.busy,
        on,
      ),
    ),
  );
  el.rows.hidden = view.rows.length === 0;
  if (focused?.id !== undefined) {
    const selector = focused.remove
      ? `.entry-remove[data-id="${CSS.escape(focused.id)}"]`
      : `input[data-id="${CSS.escape(focused.id)}"]`;
    el.rows.querySelector<HTMLElement>(selector)?.focus();
  }
  el.note.textContent = SCAN_NOTE;
  el.note.hidden = count("scan") === 0;
  const { action } = view;
  el.act.hidden = action.kind === "empty";
  el.addToOpen.hidden = !(
    action.kind === "new-tour-on-scan" && action.addToOpen
  );
  el.addToOpen.disabled = view.busy;
  if (action.kind === "empty") return;
  if (action.kind === "unusable") {
    el.question.textContent = action.line;
    el.question.hidden = false;
    el.go.hidden = true;
    return;
  }
  el.go.hidden = false;
  el.go.textContent = action.label;
  el.go.disabled = view.busy || action.kind === "pick";
  const question = action.kind === "new-tour-on-scan" ? action.question : "";
  el.question.textContent = question;
  el.question.hidden = question === "";
}
