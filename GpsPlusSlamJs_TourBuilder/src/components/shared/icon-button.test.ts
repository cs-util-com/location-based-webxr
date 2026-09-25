/**
 * `createIconButton` DOM tests.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { createIconButton } from "./icon-button.js";

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';

describe("createIconButton", () => {
  it("builds a type=button with the icon, and label on aria-label and title", () => {
    const { element } = createIconButton({ icon: SVG, label: "Show map" });
    expect(element.tagName).toBe("BUTTON");
    expect(element.type).toBe("button");
    expect(element.classList.contains("icon-btn")).toBe(true);
    expect(element.getAttribute("aria-label")).toBe("Show map");
    expect(element.title).toBe("Show map");
    expect(element.querySelector("svg")).not.toBeNull();
    expect(
      element.querySelector(".icon-btn-glyph")!.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("setLabel updates aria-label and title together", () => {
    const button = createIconButton({ icon: SVG, label: "Show map" });
    button.setLabel("Hide map");
    expect(button.element.getAttribute("aria-label")).toBe("Hide map");
    expect(button.element.title).toBe("Hide map");
  });

  it("has aria-pressed only when created as a toggle", () => {
    const action = createIconButton({ icon: SVG, label: "End tour" });
    expect(action.element.hasAttribute("aria-pressed")).toBe(false);
    action.setPressed(true); // no-op for a plain action
    expect(action.element.hasAttribute("aria-pressed")).toBe(false);

    const toggle = createIconButton({
      icon: SVG,
      label: "Map",
      pressed: false,
    });
    expect(toggle.element.getAttribute("aria-pressed")).toBe("false");
    toggle.setPressed(true);
    expect(toggle.element.getAttribute("aria-pressed")).toBe("true");
  });

  it("danger variant adds its class", () => {
    const { element } = createIconButton({
      icon: SVG,
      label: "End",
      variant: "danger",
    });
    expect(element.classList.contains("icon-btn--danger")).toBe(true);
  });

  it("busy sets aria-busy and its class, and keeps the button enabled", () => {
    const button = createIconButton({
      icon: SVG,
      label: "Buildings",
      pressed: false,
    });
    button.setBusy(true);
    expect(button.element.getAttribute("aria-busy")).toBe("true");
    expect(button.element.classList.contains("icon-btn--busy")).toBe(true);
    expect(button.element.disabled).toBe(false);
    button.setBusy(false);
    expect(button.element.hasAttribute("aria-busy")).toBe(false);
    expect(button.element.classList.contains("icon-btn--busy")).toBe(false);
  });

  it("error toggles its class", () => {
    const button = createIconButton({
      icon: SVG,
      label: "Buildings",
      pressed: false,
    });
    button.setError(true);
    expect(button.element.classList.contains("icon-btn--error")).toBe(true);
    button.setError(false);
    expect(button.element.classList.contains("icon-btn--error")).toBe(false);
  });
});
