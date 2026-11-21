// @vitest-environment jsdom
/**
 * Why these tests matter: the editor page has two modal mechanisms - the
 * characters panel and its maker are native `<dialog>` elements, while
 * Tour details and Share and publish are backdrops shown by `hidden`,
 * whose focus is kept in by making the rest of the page inert - and a
 * later change makes them one. These pin what the page does today: which
 * layer Escape closes first when several show, and what the backdrop
 * dialogs' hold makes inert and gives back.
 */
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import {
  escapeAction,
  holdOutside,
  type EscapeState,
} from "./editor-modals.js";

const NONE: EscapeState = {
  charactersOpen: false,
  detailsOpen: false,
  doneOpen: false,
  pointPick: false,
  startShown: false,
  tourOpen: false,
  busy: false,
};

describe("escapeAction: what Escape closes first", () => {
  it.each<[string, Partial<EscapeState>, ReturnType<typeof escapeAction>]>([
    ["nothing shows", {}, "deselect"],
    ["the characters' native dialog", { charactersOpen: true }, "native"],
    ["Tour details", { detailsOpen: true }, "details"],
    ["Share and publish", { doneOpen: true }, "done"],
    ["an armed Pick in 3D", { pointPick: true }, "pointPick"],
    [
      "the open dialog over an open tour",
      { startShown: true, tourOpen: true },
      "closeStart",
    ],
    // The open dialog with no tour behind it has nothing to go back to,
    // and a busy one (a tour being opened) stays: Escape clears the
    // selection instead.
    ["the open dialog with no tour", { startShown: true }, "deselect"],
    [
      "the open dialog while busy",
      { startShown: true, tourOpen: true, busy: true },
      "deselect",
    ],
  ])("%s", (_name, state, action) => {
    expect(escapeAction({ ...NONE, ...state })).toBe(action);
  });

  // The order over every combination: the first layer that shows, in
  // the order characters, details, done, pick, open dialog, wins.
  it("takes the first of its layers that shows (property)", () => {
    fc.assert(
      fc.property(
        fc.record({
          charactersOpen: fc.boolean(),
          detailsOpen: fc.boolean(),
          doneOpen: fc.boolean(),
          pointPick: fc.boolean(),
          startShown: fc.boolean(),
          tourOpen: fc.boolean(),
          busy: fc.boolean(),
        }),
        (state) => {
          const expected = state.charactersOpen
            ? "native"
            : state.detailsOpen
              ? "details"
              : state.doneOpen
                ? "done"
                : state.pointPick
                  ? "pointPick"
                  : state.startShown && state.tourOpen && !state.busy
                    ? "closeStart"
                    : "deselect";
          expect(escapeAction(state)).toBe(expected);
        },
      ),
    );
  });
});

describe("holdOutside: the backdrop dialogs' hold on the page", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function page(): {
    backdrop: HTMLElement;
    rail: HTMLElement;
    map: HTMLElement;
    script: HTMLScriptElement;
  } {
    const rail = document.createElement("nav");
    const map = document.createElement("main");
    const backdrop = document.createElement("div");
    const script = document.createElement("script");
    document.body.append(rail, map, backdrop, script);
    return { backdrop, rail, map, script };
  }

  it("makes every other child of the body inert, never the backdrop or a script", () => {
    const { backdrop, rail, map, script } = page();
    holdOutside(backdrop);
    expect(rail.inert).toBe(true);
    expect(map.inert).toBe(true);
    // jsdom has no `inert` of its own: untouched reads undefined there.
    expect(backdrop.inert).not.toBe(true);
    expect(script.inert).not.toBe(true);
  });

  // A part that was inert before the dialog opened (another hold's, or
  // the page's own) stays inert when this one is given back; the release
  // runs once.
  it("gives back only what it made inert, once", () => {
    const { backdrop, rail, map } = page();
    map.inert = true;
    const release = holdOutside(backdrop);
    release();
    expect(rail.inert).toBe(false);
    expect(map.inert).toBe(true);
    rail.inert = true;
    release();
    expect(rail.inert).toBe(true);
  });

  // Only the body's direct children are held: what sits inside them
  // (the dialog's own controls, when the backdrop is nested) is not
  // touched one by one.
  it("holds the body's direct children only", () => {
    const { backdrop, rail } = page();
    const inner = document.createElement("button");
    rail.append(inner);
    holdOutside(backdrop);
    expect(inner.inert).not.toBe(true);
  });
});
