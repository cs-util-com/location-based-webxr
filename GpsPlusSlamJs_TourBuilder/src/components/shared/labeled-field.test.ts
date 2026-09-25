// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildLabeledField } from "./labeled-field.js";

describe("buildLabeledField", () => {
  it("wraps the input in a field div with the field testid and the label text", () => {
    const input = document.createElement("input");
    const field = buildLabeledField("Name", input, "tour-name");

    expect(field.tagName).toBe("DIV");
    expect(field.className).toBe("field");
    expect(field.dataset["testid"]).toBe("field-tour-name");
    expect(field.textContent).toContain("Name");
    expect(field.contains(input)).toBe(true);
  });

  it("associates the label text with the input via for/id, not by nesting both in one label", () => {
    const input = document.createElement("input");
    const field = buildLabeledField("Name", input, "tour-name");

    const label = field.querySelector("label");
    expect(label).not.toBeNull();
    expect(label!.htmlFor).toBe(input.id);
    expect(label!.contains(input)).toBe(false);
  });

  it("adds no hint button when hint is omitted", () => {
    const field = buildLabeledField(
      "Name",
      document.createElement("input"),
      "tour-name",
    );
    expect(field.querySelector('[data-testid="hint-tour-name"]')).toBeNull();
  });

  it("adds a hint button carrying the hint text when hint is given", () => {
    const field = buildLabeledField(
      "Prefetch (m)",
      document.createElement("input"),
      "prefetch-wp-1",
      "Starts downloading media at this distance.",
    );
    const hintButton = field.querySelector<HTMLButtonElement>(
      '[data-testid="hint-prefetch-wp-1"]',
    );
    expect(hintButton).not.toBeNull();
    expect(hintButton!.tagName).toBe("BUTTON");
    expect(hintButton!.querySelector(".hint-tip")?.textContent).toBe(
      "Starts downloading media at this distance.",
    );
  });
});
