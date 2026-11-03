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

import type { DetailsForm } from "../tour-details-form.js";
import {
  wireDetailsDialog,
  type DetailsDialogDom,
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

/** The dialog with its "needs no GPS" setting (the 3D view's only place
 *  for it). */
function wireNoGps(
  outcome: DetailsOutcome = { kind: "unchanged" },
  setting: { on: boolean } = { on: false },
) {
  const input = {
    checked: false,
    ...el(),
  };
  const noGps = {
    input,
    current: vi.fn(() => setting.on),
    preview: vi.fn((_on: boolean) => undefined),
  };
  const dom = {
    backdrop: el(),
    form: el(),
    name: el(),
    description: el(),
    contact: el(),
    error: el(),
    cancel: el(),
  };
  const deps = {
    current: vi.fn(() => NOW),
    showCovers: vi.fn(),
    chosenCover: () => "f1",
    // The session's one edit of both (`setDetails`): the setting is a
    // change of its own when the fields are not.
    apply: vi.fn((_next: DetailsForm, on?: boolean): DetailsOutcome => {
      if (outcome.kind === "refused" || on === undefined) return outcome;
      const settingChanged = on !== setting.on;
      setting.on = on;
      return settingChanged ? { kind: "changed" } : outcome;
    }),
    onApplied: vi.fn(),
    onClose: vi.fn(),
  };
  const dialog = wireDetailsDialog({
    dom: dom as unknown as DetailsDialogDom,
    ...deps,
    noGps,
  });
  return { dom, deps, dialog, noGps, setting };
}

// Why: the 3D view has no rail, so "This tour needs no GPS" lives in Tour
// details there. It is part of the form: shown as it stands, its warnings
// previewed while it is ticked, written only by Apply (one change with the
// others), and never by Cancel or a refused Apply.
describe("wireDetailsDialog's 'needs no GPS'", () => {
  it("opens with the setting as it stands and its warnings previewed", () => {
    const h = wireNoGps(undefined, { on: true });
    h.dialog.open();
    expect(h.noGps.input.checked).toBe(true);
    expect(h.noGps.preview).toHaveBeenLastCalledWith(true);
  });

  it("previews the warnings as the box changes, writing nothing", () => {
    const h = wireNoGps();
    h.dialog.open();
    expect(h.noGps.preview).toHaveBeenLastCalledWith(false);
    h.noGps.input.checked = true;
    h.noGps.input.fire("change");
    expect(h.noGps.preview).toHaveBeenLastCalledWith(true);
    expect(h.deps.apply).not.toHaveBeenCalled();
  });

  // One edit with the details (one undo step), not a second one after.
  it("Apply hands it to the details' one edit, and a change of it alone says changed", () => {
    const h = wireNoGps({ kind: "unchanged" });
    h.dialog.open();
    h.noGps.input.checked = true;
    h.dom.form.fire("submit");
    expect(h.deps.apply).toHaveBeenCalledTimes(1);
    expect(h.deps.apply).toHaveBeenCalledWith(
      expect.objectContaining({ cover: "f1" }),
      true,
    );
    expect(h.setting.on).toBe(true);
    expect(h.dialog.isOpen()).toBe(false);
    expect(h.deps.onApplied).toHaveBeenCalledWith("changed");
  });

  it("an Apply that changes neither says unchanged", () => {
    const h = wireNoGps({ kind: "unchanged" });
    h.dialog.open();
    h.dom.form.fire("submit");
    expect(h.deps.onApplied).toHaveBeenCalledWith("unchanged");
  });

  it("a refused Apply or Cancel leaves it as it was", () => {
    const refused = wireNoGps({ kind: "refused", reason: "No." });
    refused.dialog.open();
    refused.noGps.input.checked = true;
    refused.dom.form.fire("submit");
    expect(refused.setting.on).toBe(false);
    expect(refused.dialog.isOpen()).toBe(true);

    const cancelled = wireNoGps();
    cancelled.dialog.open();
    cancelled.noGps.input.checked = true;
    cancelled.dom.cancel.fire("click");
    expect(cancelled.deps.apply).not.toHaveBeenCalled();
    // Opened again, it shows the setting as it stands, not the tick.
    cancelled.dialog.open();
    expect(cancelled.noGps.input.checked).toBe(false);
  });
});
