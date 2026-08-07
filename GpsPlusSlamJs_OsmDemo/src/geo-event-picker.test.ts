/**
 * @vitest-environment jsdom
 *
 * WHY THESE TESTS MATTER (G1, DEC-G1).
 *
 * The dialog is three controls and every one of them has a failure that looks
 * like nothing happening: a "Search again" that silently searches for `now`
 * while showing the time you typed, a "Clear event" that closes without
 * clearing, and a toggle that reopens instead of closing. None of those would
 * show up in a screenshot.
 *
 * The unparseable-input case is the load-bearing one. Falling back to `now` is
 * the tempting implementation and it is the worst outcome: the user gets a real
 * event, at a time they did not ask for, described by a label that agrees with
 * itself.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GeoEventPicker } from "./geo-event-picker.js";

function setup() {
  // jsdom resolves an `#id` through the document's id map and only THEN checks
  // containment, so a container left by a previous test wins the lookup. See
  // `lessons-learned.md`; this is the documented fix.
  document.body.replaceChildren();
  const container = document.createElement("aside");
  document.body.append(container);
  const onSearch = vi.fn();
  const onClear = vi.fn();
  const picker = new GeoEventPicker({ container, onSearch, onClear });
  const button = (id: string): HTMLButtonElement => {
    const found = container.querySelector<HTMLButtonElement>(`#${id}`);
    if (found === null) throw new Error(`no #${id}`);
    return found;
  };
  const input = (id: string): HTMLInputElement => {
    const found = container.querySelector<HTMLInputElement>(`#${id}`);
    if (found === null) throw new Error(`no #${id}`);
    return found;
  };
  return { container, picker, onSearch, onClear, button, input };
}

describe("GeoEventPicker", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("starts hidden, because the FIRST press must stay one tap", () => {
    // "Find me an event now" is the common case. The dialog is the answer to
    // the second press, not a gate in front of the first.
    const { container, picker } = setup();
    expect(container.hidden).toBe(true);
    expect(picker.isOpen).toBe(false);
  });

  it("opens pre-filled with the instant it is given", () => {
    // Pre-filled rather than blank so the common edit is "two hours later"
    // rather than typing a whole date. Asserted through the input VALUES,
    // which is what the user sees and what "Search again" reads back.
    const { picker, input } = setup();
    picker.open(new Date(2026, 7, 7, 18, 15));

    expect(picker.isOpen).toBe(true);
    expect(input("geo-event-date").value).toBe("2026-08-07");
    expect(input("geo-event-time").value).toBe("18:15");
  });

  it("steps the time box by the event grid, not by the minute", () => {
    // Every instant inside a quarter resolves to the same slot, so a
    // one-minute step would offer digits that silently do nothing.
    const { picker, input } = setup();
    picker.open(new Date(2026, 7, 7, 18, 15));
    expect(input("geo-event-time").step).toBe(String(15 * 60));
  });

  it("searches for the instant in the boxes, and closes", () => {
    const { picker, button, input, onSearch } = setup();
    picker.open(new Date(2026, 7, 7, 18, 15));
    input("geo-event-date").value = "2026-08-09";
    input("geo-event-time").value = "07:30";

    button("geo-event-search").click();

    expect(onSearch).toHaveBeenCalledTimes(1);
    const requested = new Date(onSearch.mock.calls[0]?.[0] as number);
    expect(requested.getFullYear()).toBe(2026);
    expect(requested.getMonth()).toBe(7);
    expect(requested.getDate()).toBe(9);
    expect(requested.getHours()).toBe(7);
    expect(requested.getMinutes()).toBe(30);
    // Closed, or the dialog covers the result it just asked for.
    expect(picker.isOpen).toBe(false);
  });

  it("REFUSES to search when the boxes cannot be read, and says so", () => {
    // WHY THIS TEST MATTERS. Falling back to `now` is the tempting
    // implementation and the worst outcome: a real event, at a time nobody
    // asked for, under a dialog still showing the time they did ask for.
    const { container, picker, button, input, onSearch } = setup();
    picker.open(new Date(2026, 7, 7, 18, 15));
    input("geo-event-date").value = "";

    button("geo-event-search").click();

    expect(onSearch).not.toHaveBeenCalled();
    // Still open: closing would hide the message explaining why nothing ran.
    expect(picker.isOpen).toBe(true);
    expect(container.querySelector(".geo-event-error")?.textContent).toContain(
      "Pick a date",
    );
  });

  it("drops the error once a valid search goes through", () => {
    // A stale "pick a date first" sitting under a successful search is the same
    // class of stale claim as the markers this round removed.
    const { container, picker, button, input, onSearch } = setup();
    picker.open(new Date(2026, 7, 7, 18, 15));
    input("geo-event-time").value = "";
    button("geo-event-search").click();
    expect(container.querySelector(".geo-event-error")?.textContent).not.toBe(
      "",
    );

    input("geo-event-time").value = "09:45";
    button("geo-event-search").click();

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".geo-event-error")?.textContent).toBe("");
  });

  it("clears the event and closes — the control resetUi never had", () => {
    // The #271 review recorded the marker as un-resettable "because no control
    // and no store action removes it". W2 supplied the action; this is the
    // control, and it is for users first — someone who has found an event and
    // wants the map back had no other way either.
    const { picker, button, onClear, onSearch } = setup();
    picker.open(new Date(2026, 7, 7, 18, 15));

    button("geo-event-clear").click();

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSearch).not.toHaveBeenCalled();
    expect(picker.isOpen).toBe(false);
  });

  it("toggles, so a third press puts it away again", () => {
    // The button is the only way in, so it has to be the way out too — a dialog
    // that can only be opened by the control that opens it is a trap.
    const { picker } = setup();
    const at = new Date(2026, 7, 7, 18, 15);

    picker.toggle(at);
    expect(picker.isOpen).toBe(true);
    picker.toggle(at);
    expect(picker.isOpen).toBe(false);
  });
});
