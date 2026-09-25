/**
 * A small confirm dialog for the HUD (plan 2026-09-20-hud-icon-buttons §4).
 *
 * Uses a real `<dialog>` but opens it by setting `open` — NOT `showModal()`.
 * In WebXR DOM-overlay mode only elements inside the overlay root render, and
 * top-layer rendering is not guaranteed, so the dialog must live in the HUD
 * tree. A non-modal `<dialog>` gives no Escape, no light dismiss and no focus
 * trap, so all three are implemented here: Escape and a backdrop tap cancel,
 * Tab wraps between the two buttons, Cancel takes focus on open.
 *
 * Pure DOM; knows nothing about the HUD or the store.
 */

export interface ConfirmDialogOptions {
  /** Base testid: `${testid}-dialog`, `${testid}-confirm`, `${testid}-cancel`. */
  readonly testid: string;
  readonly title: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
}

export interface ConfirmDialog {
  /** Mount this into the HUD root. Hidden until `open()`. */
  readonly element: HTMLElement;
  /** `returnFocusTo` gets focus back on close. */
  open(returnFocusTo?: HTMLElement): void;
  close(): void;
  destroy(): void;
}

export function createConfirmDialog(
  options: ConfirmDialogOptions,
): ConfirmDialog {
  const root = document.createElement("div");
  root.className = "hud-confirm";
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "hud-confirm-backdrop";

  const dialog = document.createElement("dialog");
  dialog.className = "hud-confirm-dialog";
  dialog.dataset.testid = `${options.testid}-dialog`;
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");

  const heading = document.createElement("h2");
  heading.className = "hud-confirm-title";
  heading.id = `${options.testid}-title`;
  heading.textContent = options.title;
  dialog.setAttribute("aria-labelledby", heading.id);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.dataset.testid = `${options.testid}-cancel`;
  cancel.textContent = options.cancelLabel;

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "hud-confirm-confirm";
  confirm.dataset.testid = `${options.testid}-confirm`;
  confirm.textContent = options.confirmLabel;

  const actions = document.createElement("div");
  actions.className = "hud-confirm-actions";
  actions.append(cancel, confirm);

  dialog.append(heading, actions);
  root.append(backdrop, dialog);

  let opener: HTMLElement | null = null;

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      event.preventDefault();
      cancel.focus();
    } else if (event.shiftKey && active === cancel) {
      event.preventDefault();
      confirm.focus();
    } else if (!event.shiftKey && active === confirm) {
      event.preventDefault();
      cancel.focus();
    }
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    dialog.open = false;
    document.removeEventListener("keydown", onKeydown);
    opener?.focus();
    opener = null;
  }

  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  confirm.addEventListener("click", () => {
    close();
    options.onConfirm();
  });

  return {
    element: root,
    open(returnFocusTo) {
      if (!root.hidden) return;
      opener = returnFocusTo ?? null;
      root.hidden = false;
      dialog.open = true;
      document.addEventListener("keydown", onKeydown);
      cancel.focus(); // the safe default
    },
    close,
    destroy() {
      document.removeEventListener("keydown", onKeydown);
      root.remove();
    },
  };
}
