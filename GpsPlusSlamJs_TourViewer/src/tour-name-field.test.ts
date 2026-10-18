/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W2): the
 * phone's tour name used to be the poster's title field, and an emptied
 * one silently kept the old title. The name now has its own field, which
 * shows the open tour's title, and says at the Finish exactly what the
 * creator did: typed a name, emptied it (the title goes), or never touched
 * it (null: the tour keeps its own, whatever the field shows).
 */
import { describe, expect, it } from "vitest";

import { wireTourNameField } from "./tour-name-field.js";

function input() {
  let onInput: (() => void) | undefined;
  return {
    value: "",
    addEventListener: (type: string, handler: () => void) => {
      if (type === "input") onInput = handler;
    },
    type(text: string) {
      this.value = text;
      onInput?.();
    },
  };
}

describe("wireTourNameField", () => {
  it("shows the open tour's title, and says nothing until the creator types", () => {
    const el = input();
    const field = wireTourNameField(el);
    field.present("The castle");
    expect(el.value).toBe("The castle");
    expect(field.typed()).toBeNull();
  });

  it("says what was typed, and an emptied name as empty", () => {
    const el = input();
    const field = wireTourNameField(el);
    field.present("The castle");
    el.type("The old castle");
    expect(field.typed()).toBe("The old castle");
    el.type("");
    expect(field.typed()).toBe("");
  });

  it("a newly opened tour starts untouched again, and no tour clears the field", () => {
    const el = input();
    const field = wireTourNameField(el);
    field.present("First");
    el.type("Typed");
    field.present("Second");
    expect(el.value).toBe("Second");
    expect(field.typed()).toBeNull();
    field.present(null);
    expect(el.value).toBe("");
  });

  /** A localStorage slice in memory. */
  function store() {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => {
        items.set(k, v);
      },
      removeItem: (k: string) => {
        items.delete(k);
      },
    };
  }

  it("a typed name outlives a reload of the page, for the same tour while its file still has the title it was typed over", () => {
    // Why (M4a review #12): the poster text survived a reload, the name
    // typed beside it did not - the next Finish then kept the old title.
    const kept = store();
    const first = input();
    wireTourNameField(first, kept).present("The castle", "tour-a");
    first.type("The old castle");
    const again = input();
    const field = wireTourNameField(again, kept);
    field.present("The castle", "tour-a");
    expect(again.value).toBe("The old castle");
    expect(field.typed()).toBe("The old castle");
    // Another tour has its own.
    field.present("The bridge", "tour-b");
    expect(again.value).toBe("The bridge");
    expect(field.typed()).toBeNull();
  });

  it("a kept name is spent once the file carries another title (a Finish wrote it, or it was renamed elsewhere)", () => {
    // Why: a name kept forever would overwrite a title changed since -
    // in the desktop editor, say - at the next Finish.
    const kept = store();
    const first = input();
    wireTourNameField(first, kept).present("The castle", "tour-a");
    first.type("The old castle");
    const again = input();
    const field = wireTourNameField(again, kept);
    field.present("The old castle", "tour-a");
    expect(field.typed()).toBeNull();
    expect(kept.items.size).toBe(0);
  });

  it("works without a store, and with one that throws", () => {
    const el = input();
    const field = wireTourNameField(el, {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    field.present("The castle", "tour-a");
    el.type("Typed");
    expect(field.typed()).toBe("Typed");
  });
});
