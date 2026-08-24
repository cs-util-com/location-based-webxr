/**
 * @vitest-environment jsdom
 *
 * Opts into jsdom for the same reason `header-collapse.test.ts` does: the
 * behaviour worth pinning here IS the wiring. Extracting a "pure option list"
 * and testing that alone would assert the one part that cannot drift, while
 * leaving the part that can — that the DOM the user actually touches is built
 * from the shared table — covered by nothing.
 *
 * WHY THESE TESTS MATTER (W5, DEC-R4-11, and DEC-R6b-1 which revised it). The
 * picker used to read the fixture corpus itself, so that the places a human
 * could reach were exactly the places the suite covered. **Round 7 split the
 * two** — the corpus earns entries by being awkward to render, and the sixth
 * session asked the dropdown for the opposite.
 *
 * The anti-drift guarantee therefore moved rather than disappeared, and it is
 * important to know where: it now lives in `start-position.test.ts`, which
 * asserts every `CORPUS_SITES` entry stays reachable through `?site=`. What is
 * pinned HERE is the other half — that the DOM the user touches is built from
 * `PICKER_PLACES` and not from a hand-written list that would look identical on
 * screen. So the assertion is not "the picker has fourteen options", it is "the
 * picker's options ARE the list", tooltips included.
 */

import { describe, expect, it, vi } from "vitest";
import { PICKER_PLACES } from "./picker-places.js";

import { attachSitePicker } from "./site-picker.js";

function pickerElement(): HTMLSelectElement {
  const select = document.createElement("select");
  document.body.append(select);
  return select;
}

describe("attachSitePicker", () => {
  it("builds its options from the shared corpus table", () => {
    const select = pickerElement();
    attachSitePicker({ select, onChoose: () => {} });

    // Option 0 is the "nothing chosen" placeholder — see the last test for why
    // it exists. Everything after it is the table.
    const sites = [...select.options].slice(1);

    // ITS WORDING IS PINNED, because the placeholder is the picker's resting
    // face: it is what a user reads before they know the control is a list of
    // cities at all, and "jump to…" left the thirteenth session asking what it
    // jumped to. Capital J and the noun are both the owner's wording (G4).
    expect(select.options[0]?.textContent).toBe("Jump to City");

    // Identity with the table, in order — not a count, and not a set. A count
    // passes when a site is duplicated and another is missing.
    expect(sites.map((option) => option.value)).toEqual(
      PICKER_PLACES.map((place) => place.id),
    );
    expect(sites.map((option) => option.textContent)).toEqual(
      PICKER_PLACES.map((place) => place.name),
    );
    // The note travels with the option as its tooltip, so "what will I see
    // there" is answerable from the UI rather than only from a doc. This is
    // also why `picker-places.test.ts` requires every entry to have one
    // (Q-R6b-1) — a missing note is a silently tooltip-less row.
    expect(sites.map((option) => option.title)).toEqual(
      PICKER_PLACES.map((place) => place.note),
    );
  });

  it("reports the chosen PLACE — position and id — and nothing else", () => {
    const select = pickerElement();
    const onChoose = vi.fn();
    attachSitePicker({ select, onChoose });

    const target = PICKER_PLACES[2];
    if (target === undefined) throw new Error("the picker list is empty");
    select.value = target.id;
    select.dispatchEvent(new Event("change"));

    // THE ID TRAVELS WITH THE POSITION SINCE DEC-R12-5, and the reason is that
    // it was the missing fact: the URL writer needs to know a NAMED place was
    // chosen, and by the time a bare `LatLng` reached the caller that was no
    // longer knowable. Reverse-matching a position back to a place would be a
    // second representation of the same fact, which is the drift the shared
    // table exists to prevent.
    //
    // It is still a REPORT rather than an action: the picker does not know the
    // store exists — the same separation the map has, where a click reports a
    // selection and the store decides who cares.
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(target);
  });

  it("ignores a value that is not a known site", () => {
    const select = pickerElement();
    const onChoose = vi.fn();
    attachSitePicker({ select, onChoose });

    // Reachable: the browser restores a stale `<select>` value across a reload
    // when the option list has changed. Moving the demo to `undefined` would
    // be worse than doing nothing, and throwing would take the app down for a
    // control that is a convenience.
    select.value = "";
    select.dispatchEvent(new Event("change"));

    expect(onChoose).not.toHaveBeenCalled();
  });

  it("does not preselect a site, because the demo may have started elsewhere", () => {
    const select = pickerElement();
    attachSitePicker({ select, onChoose: () => {} });

    // `?lat=&lng=` and the locate button both put the user somewhere that is
    // not a corpus site. A picker showing "Cologne Cathedral" while the demo is
    // in Heidelberg is the status line contradicting the picture, which is the
    // defect class round 1 was about — so the placeholder is selected until the
    // user chooses.
    expect(select.value).toBe("");
    expect(select.selectedIndex).toBe(0);
  });

  it("stops reporting after dispose", () => {
    const select = pickerElement();
    const onChoose = vi.fn();
    const picker = attachSitePicker({ select, onChoose });
    picker.dispose();

    const target = PICKER_PLACES[0];
    if (target === undefined) throw new Error("the picker list is empty");
    select.value = target.id;
    select.dispatchEvent(new Event("change"));

    // Held rather than anonymous, like every other listener in this app: one
    // that outlives disposal keeps the whole view graph reachable.
    expect(onChoose).not.toHaveBeenCalled();
  });
});
