/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W2): the
 * tour's name, description, cover and contact had no place in the editor;
 * the dialog is that place. These pin what a creator relies on: it opens
 * with the details as they stand, Apply hands the whole form to the
 * session and closes with a result the page says (the async-UI rule's
 * final state, success AND refusal), a refusal keeps the dialog open with
 * what was typed and the reason, and Cancel applies nothing.
 */
import { describe, expect, it, vi } from "vitest";

import {
  wireDetailsDialog,
  type DetailsDialogDom,
  type DetailsForm,
  type DetailsOutcome,
} from "./details-dialog.js";

function el() {
  const handlers = new Map<
    string,
    (event: { preventDefault(): void }) => void
  >();
  return {
    value: "",
    hidden: true,
    textContent: "" as string | null,
    focused: 0,
    focus() {
      this.focused += 1;
    },
    addEventListener: (
      type: string,
      handler: (event: { preventDefault(): void }) => void,
    ) => handlers.set(type, handler),
    fire: (type: string) =>
      handlers.get(type)?.({ preventDefault: () => undefined }),
  };
}

const NOW: DetailsForm = {
  name: "The castle",
  description: "Up and back.",
  cover: "f1",
  contact: "guide@example.org",
};

function wire(outcome: DetailsOutcome = { kind: "changed" }) {
  const dom = {
    backdrop: el(),
    form: el(),
    name: el(),
    description: el(),
    contact: el(),
    error: el(),
    cancel: el(),
  };
  let chosen: string | null = null;
  const deps = {
    current: vi.fn(() => NOW),
    showCovers: vi.fn((selected: string | null) => {
      chosen = selected;
    }),
    chosenCover: () => chosen,
    apply: vi.fn((_next: DetailsForm) => outcome),
    onApplied: vi.fn(),
    onClose: vi.fn(),
  };
  const dialog = wireDetailsDialog({
    dom: dom as unknown as DetailsDialogDom,
    ...deps,
  });
  return {
    dom,
    deps,
    dialog,
    choose: (id: string | null) => {
      chosen = id;
    },
  };
}

describe("wireDetailsDialog", () => {
  it("opens with the details as they stand, the cover chosen, the name focused", () => {
    const h = wire();
    h.dialog.open();
    expect(h.dialog.isOpen()).toBe(true);
    expect(h.dom.name.value).toBe("The castle");
    expect(h.dom.description.value).toBe("Up and back.");
    expect(h.dom.contact.value).toBe("guide@example.org");
    expect(h.deps.showCovers).toHaveBeenCalledWith("f1");
    expect(h.dom.name.focused).toBe(1);
    expect(h.dom.error.hidden).toBe(true);
  });

  it("Apply hands the whole form to the session, closes, and says the change", () => {
    const h = wire({ kind: "changed" });
    h.dialog.open();
    h.dom.name.value = "New name";
    h.dom.contact.value = "";
    h.choose(null);
    h.dom.form.fire("submit");
    expect(h.deps.apply).toHaveBeenCalledWith({
      name: "New name",
      description: "Up and back.",
      cover: null,
      contact: "",
    });
    expect(h.dialog.isOpen()).toBe(false);
    expect(h.deps.onApplied).toHaveBeenCalledWith("changed");
    expect(h.deps.onClose).toHaveBeenCalledTimes(1);
  });

  it("an Apply that changes nothing closes and says so too", () => {
    const h = wire({ kind: "unchanged" });
    h.dialog.open();
    h.dom.form.fire("submit");
    expect(h.dialog.isOpen()).toBe(false);
    expect(h.deps.onApplied).toHaveBeenCalledWith("unchanged");
  });

  it("a refusal stays open with what was typed and the session's reason", () => {
    const h = wire({ kind: "refused", reason: "Not a contact." });
    h.dialog.open();
    h.dom.contact.value = "call me";
    h.dom.form.fire("submit");
    expect(h.dialog.isOpen()).toBe(true);
    expect(h.dom.contact.value).toBe("call me");
    expect(h.dom.error.hidden).toBe(false);
    expect(h.dom.error.textContent).toBe("Not a contact.");
    expect(h.deps.onApplied).not.toHaveBeenCalled();
    expect(h.deps.onClose).not.toHaveBeenCalled();
  });

  it("the error goes when the dialog opens again", () => {
    const h = wire({ kind: "refused", reason: "No." });
    h.dialog.open();
    h.dom.form.fire("submit");
    h.dialog.close();
    h.dialog.open();
    expect(h.dom.error.hidden).toBe(true);
  });

  it("Cancel and close apply nothing, and give focus back once", () => {
    const h = wire();
    h.dialog.open();
    h.dom.cancel.fire("click");
    expect(h.dialog.isOpen()).toBe(false);
    expect(h.deps.apply).not.toHaveBeenCalled();
    h.dialog.close();
    expect(h.deps.onClose).toHaveBeenCalledTimes(1);
  });

  it("a submit while closed does nothing", () => {
    const h = wire();
    h.dom.form.fire("submit");
    expect(h.deps.apply).not.toHaveBeenCalled();
  });
});
