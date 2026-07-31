/**
 * The example-location picker (W5, R4-1, DEC-R4-11).
 *
 * WHY THIS EXISTS. The demo opened at Cologne and the only ways to leave were a
 * hand-edited `?lat=&lng=` and the geolocation button — so for three rounds it
 * was looked at in one place, which is the condition that produced the round-3
 * cathedral finding: a defect that could not be reproduced because there was
 * nowhere else to look.
 *
 * WHY IT READS THE PACKAGE'S TABLE RATHER THAN ITS OWN LIST. The same six sites
 * are the offline fixture corpus (DEC-R4-1/R4-2). Two lists would drift, and the
 * drift has a specific cost: the places a human can reach would stop being the
 * places the suite covers, which is exactly the blind spot the corpus was built
 * to close. So there is one table, in `gps-plus-slam-osm`, and this file renders
 * it.
 *
 * WHY IT REPORTS A POSITION RATHER THAN DOING ANYTHING. Choosing a site is the
 * same intent as clicking the map and the same intent as the locate button: the
 * user is saying where they are. All three therefore go through ONE action, so
 * there is no second refresh path that could disagree with the first — the rule
 * `LocateControl` already follows.
 *
 * WHY THE CHOICE COSTS A COLD FETCH, and that is accepted rather than hidden
 * (DEC-R4-11): the picker moves the user and the ordinary pipeline fetches. A
 * first visit to a site is an 18-110 s res-7 Overpass fetch; every later visit
 * is served from OPFS. Loading the committed offline extract instead was
 * offered and rejected — the demo would be showing fixture data while looking
 * identical to live data, which is the "two claims that look the same" defect
 * this project keeps removing.
 *
 * @see site-picker.ts.md
 */

import { CORPUS_SITES, siteById, type LatLng } from "gps-plus-slam-osm";

export interface SitePickerOptions {
  /** The `<select>` to populate. Emptied first, so a re-attach is idempotent. */
  readonly select: HTMLSelectElement;
  /** Called with the chosen site's position. Never called for an unknown id. */
  readonly onChoose: (position: LatLng) => void;
}

export interface SitePicker {
  dispose(): void;
}

/**
 * The placeholder option's value.
 *
 * Empty string rather than a sentinel id, because an empty `<select>` value is
 * what a browser reports for "nothing selected" anyway — one representation
 * instead of two, and `siteById("")` is already `undefined`.
 */
const NO_SITE = "";

/**
 * Populates the picker and reports choices.
 *
 * NOTHING IS PRESELECTED. The demo may have started from `?lat=&lng=`, from the
 * locate button, or from a map click, none of which are corpus sites — and a
 * picker reading "Cologne Cathedral" while the view is in Heidelberg is the
 * control contradicting the picture, which is the defect class round 1 was
 * about. The placeholder stays selected until the user chooses.
 */
export function attachSitePicker(options: SitePickerOptions): SitePicker {
  const { select, onChoose } = options;

  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = NO_SITE;
  placeholder.textContent = "jump to…";
  select.append(placeholder);

  for (const site of CORPUS_SITES) {
    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = site.name;
    // The corpus reason, as a tooltip. It is the one place a user can find out
    // why these six places and not six prettier ones.
    option.title = site.reason;
    select.append(option);
  }

  // Held rather than anonymous, so `dispose()` can actually remove it. The same
  // rule every listener in `building-view.ts` follows: an orphaned listener
  // keeps the whole view graph reachable.
  const onChange = (): void => {
    const site = siteById(select.value);
    // Unknown ids are ignored rather than reported or thrown. A browser
    // restores a stale `<select>` value across a reload when the option list
    // has changed, and moving the demo to `undefined` would be worse than
    // doing nothing for a control that is a convenience.
    if (site === undefined) return;
    onChoose(site.position);
  };
  select.addEventListener("change", onChange);

  return {
    dispose() {
      select.removeEventListener("change", onChange);
    },
  };
}
