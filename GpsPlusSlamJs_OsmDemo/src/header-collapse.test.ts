/**
 * @vitest-environment jsdom
 *
 * WHY THIS FILE OPTS INTO jsdom AND THE REST OF THE SUITE DOES NOT. The house
 * pattern here is to split pure decisions out and unit-test those, leaving DOM
 * wiring to the e2e suite — `sheet-drag.ts`, `locate-state.ts` and
 * `building-view.ts` all do exactly that, and the project consequently has no test
 * environment configured at all.
 *
 * That pattern does not fit this module, because the behaviour worth pinning IS the
 * wiring: which attributes move together, that a no-op does not fire a resize, and
 * that `role="button"` actually delivers Enter and Space. Extracting a "pure state
 * machine" from a single boolean would be ceremony around nothing and would test
 * none of it.
 *
 * So the environment is declared PER FILE rather than in `vitest.config.ts`: the
 * other ~160 unit tests keep running with no environment and no startup cost, and
 * only this one pays for a DOM.
 *
 * The header's collapse behaviour, and the rule that stops it hiding errors.
 *
 * WHY THESE TESTS MATTER. Two of the three things asserted here are invisible
 * until they bite:
 *
 * - **The resize callback.** Collapsing changes `main`'s height, and neither
 *   Leaflet nor the WebGL renderer notices a container that resized without a
 *   window event. Forget it and the 3D pane goes blank on collapse — the same
 *   finding (R2-3) that made the resize repaint necessary in the first place.
 * - **The error reveal (DEC-R2-15).** A collapsed header hides the status line,
 *   and the status line is where failures are reported. Nothing on screen would
 *   indicate the message was lost; the demo would just look like it did nothing.
 *
 * The keyboard path is here because the toggle is an `<h1>` with `role="button"`,
 * which PROMISES Enter and Space without delivering them — a real `<button>` would
 * have been given them for free, and this one has to implement them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachHeaderCollapse } from "./header-collapse.js";

function setup() {
  document.body.innerHTML = `<header><h1 id="title">OSM affordance demo</h1></header>`;
  const header = document.querySelector("header");
  const toggle = document.querySelector("#title");
  if (!(header instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
    throw new Error("fixture did not build");
  }
  const onToggle = vi.fn();
  const collapse = attachHeaderCollapse({ header, toggle, onToggle });
  return { header, toggle, onToggle, collapse };
}

describe("attachHeaderCollapse", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("starts expanded, and says so where both CSS and AT can read it", () => {
    const { header, toggle } = setup();
    expect(header.dataset["collapsed"]).toBe("false");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // A div-with-onclick is unreachable by keyboard; this is the only control for
    // a bar that hides two others, so it has to be focusable and announced.
    expect(toggle.getAttribute("role")).toBe("button");
    expect(toggle.getAttribute("tabindex")).toBe("0");
  });

  it("toggles on a click and keeps aria-expanded in step", () => {
    const { header, toggle } = setup();
    toggle.click();
    expect(header.dataset["collapsed"]).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(header.dataset["collapsed"]).toBe("false");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("reports EVERY change, so the canvases can be resized", () => {
    // The failure this prevents: collapsing changes main's height, and a WebGL
    // canvas that is not resized-and-repainted goes blank. Called once on attach
    // too, so a caller can size everything from one code path.
    const { toggle, onToggle } = setup();
    expect(onToggle).toHaveBeenCalledTimes(1);
    toggle.click();
    expect(onToggle).toHaveBeenCalledTimes(2);
    toggle.click();
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  it("does not report a no-op change", () => {
    // `set(false)` while already expanded must not fire a resize — the error
    // reveal calls exactly that on every error, and a resize plus repaint per
    // error message would be visible churn on a failing network.
    const { collapse, onToggle } = setup();
    onToggle.mockClear();
    collapse.set(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("expands on an error, because the status line lives inside it", () => {
    // DEC-R2-15. Without this, a locate failure or a fetch failure is written
    // into a hidden element and the demo looks like it did nothing.
    const { header, collapse } = setup();
    collapse.set(true);
    expect(header.dataset["collapsed"]).toBe("true");

    collapse.revealForError();

    expect(header.dataset["collapsed"]).toBe("false");
    expect(collapse.collapsed).toBe(false);
  });

  it("stays expanded after an error rather than collapsing again", () => {
    // Deliberate: re-collapsing would race the user reading the message.
    const { collapse } = setup();
    collapse.set(true);
    collapse.revealForError();
    collapse.revealForError();
    expect(collapse.collapsed).toBe(false);
  });

  it("toggles on Enter and Space, which role=button promises", () => {
    const { toggle, collapse } = setup();
    toggle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(collapse.collapsed).toBe(true);
    toggle.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(collapse.collapsed).toBe(false);
  });

  it("ignores other keys, so typing elsewhere cannot collapse the bar", () => {
    const { toggle, collapse } = setup();
    toggle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    expect(collapse.collapsed).toBe(false);
  });

  it("stops responding once disposed", () => {
    const { toggle, collapse } = setup();
    collapse.dispose();
    toggle.click();
    expect(collapse.collapsed).toBe(false);
  });
});
