/**
 * `createConfirmDialog` DOM tests.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfirmDialog, type ConfirmDialog } from "./confirm-dialog.js";

describe("createConfirmDialog", () => {
  let dialog: ConfirmDialog;
  let opener: HTMLButtonElement;

  function setup() {
    opener = document.createElement("button");
    document.body.append(opener);
    const onConfirm = vi.fn();
    dialog = createConfirmDialog({
      testid: "t",
      title: "End tour?",
      confirmLabel: "End",
      cancelLabel: "Cancel",
      onConfirm,
    });
    document.body.append(dialog.element);
    const q = (id: string) =>
      dialog.element.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    return {
      onConfirm,
      cancel: q("t-cancel"),
      confirm: q("t-confirm"),
      box: q("t-dialog"),
    };
  }

  afterEach(() => {
    dialog.destroy();
    opener.remove();
  });

  it("starts closed", () => {
    const { box } = setup();
    expect(dialog.element.hidden).toBe(true);
    expect((box as HTMLDialogElement).open).toBe(false);
  });

  it("open() shows it, labels it, and focuses Cancel", () => {
    const { box, cancel } = setup();
    dialog.open(opener);
    expect(dialog.element.hidden).toBe(false);
    expect((box as HTMLDialogElement).open).toBe(true);
    expect(box.getAttribute("role")).toBe("alertdialog");
    expect(box.textContent).toContain("End tour?");
    expect(document.activeElement).toBe(cancel);
  });

  it("Cancel closes without confirming, and returns focus to the opener", () => {
    const { onConfirm, cancel } = setup();
    dialog.open(opener);
    cancel.click();
    expect(dialog.element.hidden).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("Confirm calls onConfirm once and closes", () => {
    const { onConfirm, confirm } = setup();
    dialog.open(opener);
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(dialog.element.hidden).toBe(true);
  });

  it("Escape cancels", () => {
    const { onConfirm } = setup();
    dialog.open(opener);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dialog.element.hidden).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a backdrop tap cancels", () => {
    const { onConfirm } = setup();
    dialog.open(opener);
    dialog.element.querySelector<HTMLElement>(".hud-confirm-backdrop")!.click();
    expect(dialog.element.hidden).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Tab and Shift+Tab wrap inside the dialog", () => {
    const { cancel, confirm } = setup();
    dialog.open(opener);

    confirm.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(cancel);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
    );
    expect(document.activeElement).toBe(confirm);
  });

  it("Tab from outside the dialog pulls focus back in", () => {
    const { cancel } = setup();
    dialog.open(opener);
    opener.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(cancel);
  });

  it("stops listening for keys once closed", () => {
    setup();
    dialog.open(opener);
    dialog.close();
    opener.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(opener);
  });
});
