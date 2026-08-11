/**
 * The example-location picker (W5, R4-1, DEC-R4-11).
 *
 * WHY THIS EXISTS. The demo opened at Cologne and the only ways to leave were a
 * hand-edited `?lat=&lng=` and the geolocation button — so for three rounds it
 * was looked at in one place, which is the condition that produced the round-3
 * cathedral finding: a defect that could not be reproduced because there was
 * nowhere else to look.
 *
 * WHY IT READS `PICKER_PLACES` AND NOT THE PACKAGE'S CORPUS TABLE (DEC-R6b-1).
 * It used to read the corpus, because two lists drift and the drift's cost is
 * that the places a human can reach stop being the places the suite covers. The
 * sixth session made that untenable: a corpus site earns its place by being
 * **awkward to render**, and several are deliberately unphotogenic — the owner
 * asked for a dropdown of famous places instead.
 *
 * **The anti-drift guarantee moved rather than disappeared.** Every corpus site
 * stays reachable through `?site=<id>`, which `start-position.test.ts` asserts
 * for the whole table; the dropdown is free to list what a visitor wants to
 * click. Reachability rather than membership is what lets "Sylt auf jeden Fall
 * raus" and "the tested places stay visitable" both be true.
 *
 * WHY IT REPORTS A POSITION RATHER THAN DOING ANYTHING. Choosing a site is the
 * same intent as clicking the map and the same intent as the locate button: the
 * user is saying where they are. All three therefore go through ONE action, so
 * there is no second refresh path that could disagree with the first — the rule
 * `LocateControl` already follows.
 *
 * WHY THE CHOICE COSTS A COLD FETCH, and that is accepted rather than hidden
 * (DEC-R4-11): the picker moves the user and the ordinary pipeline fetches. A
 * first visit to a site is a ~15–90 s res-7 Overpass fetch; every later visit
 * is served from OPFS. Loading the committed offline extract instead was
 * offered and rejected — the demo would be showing fixture data while looking
 * identical to live data, which is the "two claims that look the same" defect
 * this project keeps removing.
 *
 * @see site-picker.ts.md
 */

import { PICKER_PLACES, placeById, type PickerPlace } from "./picker-places.js";

export interface SitePickerOptions {
  /** The `<select>` to populate. Emptied first, so a re-attach is idempotent. */
  readonly select: HTMLSelectElement;
  /**
   * Called with the chosen PLACE. Never called for an unknown id.
   *
   * THE WHOLE PLACE RATHER THAN ITS POSITION (DEC-R12-5). The URL writer has to
   * know that a NAMED place was chosen so it can write `?site=<id>` instead of
   * coordinates, and a bare `LatLng` had already thrown that away by the time it
   * reached the caller. Recovering it by matching the position back against the
   * table would be a second representation of the same fact.
   */
  readonly onChoose: (place: PickerPlace) => void;
}

export interface SitePicker {
  dispose(): void;
}

/**
 * The placeholder option's value.
 *
 * Empty string rather than a sentinel id, because an empty `<select>` value is
 * what a browser reports for "nothing selected" anyway — one representation
 * instead of two, and `placeById("")` is already `undefined`.
 */
const NO_SITE = "";

/**
 * Populates the picker and reports choices.
 *
 * NOTHING IS PRESELECTED, and that stayed true when the default moved to
 * Manhattan (DEC-R6b-3). The demo may have started from `?lat=&lng=`, from
 * `?site=`, from the locate button or from a map click, and only some of those
 * are places in this list — a picker reading "Cologne — Cathedral" while the
 * view is in Porto is the control contradicting the picture, which is the
 * defect class round 1 was about. The placeholder stays selected until the user
 * chooses, even though entry 0 is now where the demo opens.
 */
export function attachSitePicker(options: SitePickerOptions): SitePicker {
  const { select, onChoose } = options;

  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = NO_SITE;
  placeholder.textContent = "jump to…";
  select.append(placeholder);

  for (const place of PICKER_PLACES) {
    const option = document.createElement("option");
    option.value = place.id;
    option.textContent = place.name;
    // The note, as a tooltip. It is the one place a user finds out what is
    // worth looking at there before paying for a cold fetch — which is why
    // `picker-places.test.ts` requires every entry to carry one.
    option.title = place.note;
    select.append(option);
  }

  // Held rather than anonymous, so `dispose()` can actually remove it. The same
  // rule every listener in `building-view.ts` follows: an orphaned listener
  // keeps the whole view graph reachable.
  const onChange = (): void => {
    const place = placeById(select.value);
    // Unknown ids are ignored rather than reported or thrown. A browser
    // restores a stale `<select>` value across a reload when the option list
    // has changed, and moving the demo to `undefined` would be worse than
    // doing nothing for a control that is a convenience.
    if (place === undefined) return;
    onChoose(place);
  };
  select.addEventListener("change", onChange);

  return {
    dispose() {
      select.removeEventListener("change", onChange);
    },
  };
}
