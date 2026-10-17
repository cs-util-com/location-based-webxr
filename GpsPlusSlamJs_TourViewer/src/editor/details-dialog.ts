/**
 * The desktop editor's "Tour details" dialog (tour editor plan
 * 2026-10-17-1816, W2): the tour's name, description, cover and contact,
 * opened from the name in the top bar. It edits nothing itself: Apply
 * hands the form to the editor session (`setDetails`), which checks it by
 * the format's own rules and makes it a pending change like any other
 * edit (autosave applies). A refusal stays in the dialog, in the
 * session's words.
 *
 * @see details-dialog.ts.md
 */

/** The form's values; an empty text (or a null cover) is "none". */
export interface DetailsForm {
  readonly name: string;
  readonly description: string;
  readonly cover: string | null;
  readonly contact: string;
}

export type DetailsOutcome =
  | { readonly kind: "changed" | "unchanged" }
  | { readonly kind: "refused"; readonly reason: string };

interface Listening {
  addEventListener(
    type: string,
    handler: (event: { preventDefault(): void }) => void,
  ): void;
}

/** The dialog's elements (structural, so the unit tests run in node). */
export interface DetailsDialogDom {
  backdrop: Pick<HTMLElement, "hidden">;
  form: Listening;
  name: Pick<HTMLInputElement, "value" | "focus">;
  description: Pick<HTMLTextAreaElement, "value">;
  contact: Pick<HTMLInputElement, "value">;
  error: Pick<HTMLElement, "textContent" | "hidden">;
  cancel: Listening;
}

export interface DetailsDialogDeps {
  dom: DetailsDialogDom;
  /** The tour's details as they stand now (with the pending edits). */
  current: () => DetailsForm;
  /** Draw the cover choices with `selected` chosen (the page's picker). */
  showCovers: (selected: string | null) => void;
  /** The cover chosen in the picker now. */
  chosenCover: () => string | null;
  /** The session's edit (`EditorSession.setDetails`). */
  apply: (next: DetailsForm) => DetailsOutcome;
  /** After Apply closed the dialog: what came of it (the page refreshes,
   *  says it in a toast and lets autosave know). */
  onApplied: (kind: "changed" | "unchanged") => void;
  /** The dialog closed, either way: the page gives focus back. */
  onClose: () => void;
}

export interface DetailsDialog {
  /** Open with the tour's details as they stand. */
  open(): void;
  /** Close without applying (Cancel, Esc). */
  close(): void;
  isOpen(): boolean;
}

export function wireDetailsDialog(deps: DetailsDialogDeps): DetailsDialog {
  const { dom } = deps;

  function sayError(text: string): void {
    dom.error.textContent = text;
    dom.error.hidden = text === "";
  }

  function close(): void {
    if (dom.backdrop.hidden) return;
    dom.backdrop.hidden = true;
    sayError("");
    deps.onClose();
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (dom.backdrop.hidden) return;
    const outcome = deps.apply({
      name: dom.name.value,
      description: dom.description.value,
      cover: deps.chosenCover(),
      contact: dom.contact.value,
    });
    if (outcome.kind === "refused") {
      // Stays open with what was typed: nothing is lost to a refusal.
      sayError(outcome.reason);
      return;
    }
    close();
    deps.onApplied(outcome.kind);
  });
  dom.cancel.addEventListener("click", () => {
    close();
  });

  return {
    open() {
      const now = deps.current();
      dom.name.value = now.name;
      dom.description.value = now.description;
      dom.contact.value = now.contact;
      deps.showCovers(now.cover);
      sayError("");
      dom.backdrop.hidden = false;
      dom.name.focus();
    },
    close,
    isOpen: () => !dom.backdrop.hidden,
  };
}
