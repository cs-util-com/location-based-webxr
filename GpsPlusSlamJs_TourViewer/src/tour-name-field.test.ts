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
});
