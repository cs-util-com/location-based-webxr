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

  it("STAYS COLLAPSED when an error occurs, which DEC-R2-15 used to forbid", () => {
    // RETIRED 2026-08-19 (DEC-U10). Two tests used to live here asserting the
    // opposite: that an error expands the header, and that it then stays
    // expanded. The rule existed because the status line inside the header
    // was the only channel an error could reach, so a collapsed header made
    // failures invisible.
    //
    // The toast removed that premise, and the owner reported the
    // self-expanding header as a bug in the twelfth testing session. Errors
    // now go to a toast that is visible whether or not the header is
    // collapsed, and `writeStatus` no longer renders the error phase at all
    // - both halves together, because retiring only the expand would leave
    // the message in a collapsed header AND in a toast, which is the
    // two-channel state DEC-R2-15 rejected a toast in order to avoid.
    //
    // This test is what stops the rule being reintroduced by someone reading
    // the old comment: there is no longer any API here to expand the header
    // except the user's own toggle.
    const { header, collapse } = setup();
    collapse.set(true);

    expect(header.dataset["collapsed"]).toBe("true");
    expect(collapse.collapsed).toBe(true);
    expect("revealForError" in collapse).toBe(false);
  });

  it("keeps an accessible NAME after the title text was removed (F3b)", () => {
    // WHY THIS TEST EXISTS. The control used to be an <h1> reading "OSM
    // affordance demo", and that text was its accessible name — a screen reader
    // announced "OSM affordance demo, button, expanded". F3b removed the text
    // for a tidier bar, which leaves a role="button" that announces as NOTHING.
    //
    // That is a regression no visual check and no e2e screenshot can see, and
    // the element still looks and behaves correctly to anyone using a mouse. So
    // the name is asserted as an attribute, and asserted to TRACK THE STATE:
    // aria-expanded says what state the control is in, never what it controls.
    const { toggle, collapse } = setup();

    expect(toggle.getAttribute("aria-label")).toBe("Hide details");
    collapse.set(true);
    expect(toggle.getAttribute("aria-label")).toBe("Show details");
    collapse.set(false);
    expect(toggle.getAttribute("aria-label")).toBe("Hide details");
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
