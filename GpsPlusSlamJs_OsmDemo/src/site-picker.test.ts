/**
 * @vitest-environment jsdom
 *
 * Opts into jsdom for the same reason `header-collapse.test.ts` does: the
 * behaviour worth pinning here IS the wiring. Extracting a "pure option list"
 * and testing that alone would assert the one part that cannot drift, while
 * leaving the part that can — that the DOM the user actually touches is built
 * from the shared table — covered by nothing.
 *
 * WHY THESE TESTS MATTER (W5, DEC-R4-11). The picker and the offline fixture
 * corpus read ONE table so that the places a human can reach are exactly the
 * places the suite covers. That guarantee is worth precisely as much as its
 * weakest link, and the weakest link is here: a picker populated from a
 * hand-written list would look identical on screen and silently reintroduce the
 * drift the shared table exists to remove. So the assertion is not "the picker
 * has six options", it is "the picker's options ARE the table".
 */

import { describe, expect, it, vi } from "vitest";
import { CORPUS_SITES } from "gps-plus-slam-osm";

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

    // Identity with the table, in order — not a count, and not a set. A count
    // passes when a site is duplicated and another is missing.
    expect(sites.map((option) => option.value)).toEqual(
      CORPUS_SITES.map((site) => site.id),
    );
    expect(sites.map((option) => option.textContent)).toEqual(
      CORPUS_SITES.map((site) => site.name),
    );
    // The corpus reason travels with the option, so "why these six places" is
    // discoverable from the UI rather than only from a doc.
    expect(sites.map((option) => option.title)).toEqual(
      CORPUS_SITES.map((site) => site.reason),
    );
  });

  it("reports the chosen site's position, and nothing else", () => {
    const select = pickerElement();
    const onChoose = vi.fn();
    attachSitePicker({ select, onChoose });

    const target = CORPUS_SITES[2];
    if (target === undefined) throw new Error("corpus is empty");
    select.value = target.id;
    select.dispatchEvent(new Event("change"));

    // The picker reports a POSITION, not a site id and not an action. It does
    // not know the store exists — the same separation the map has, where a
    // click reports a selection and the store decides who cares.
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(target.position);
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

    const target = CORPUS_SITES[0];
    if (target === undefined) throw new Error("corpus is empty");
    select.value = target.id;
    select.dispatchEvent(new Event("change"));

    // Held rather than anonymous, like every other listener in this app: one
    // that outlives disposal keeps the whole view graph reachable.
    expect(onChoose).not.toHaveBeenCalled();
  });
});
