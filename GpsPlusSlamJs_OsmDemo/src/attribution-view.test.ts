/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";

import { AttributionView, type AttributionEntry } from "./attribution-view.js";

/**
 * WHY THESE TESTS MATTER (round three, G5, DEC-W1).
 *
 * This is the one surface in the demo with an obligation attached rather than a
 * preference. ODbL requires the OpenStreetMap credit to be reasonably visible
 * wherever the data is shown, and this repo has recorded — in `map-view.ts` and
 * `main.ts` — that the elevation credits are required "the same as the OSM
 * one", which is precisely why they were put in the always-visible attribution
 * bar rather than in the collapsible header.
 *
 * The thirteenth session asked for that bar to become one thin line with "one
 * word per attribution" and an expander. The first plan for it put the
 * elevation credits behind the tap and argued that only ODbL was in play; that
 * was false, and the cold review caught it. What ships instead keeps a SHORT
 * NAME for every source permanently visible and moves only the long text behind
 * the expander — which satisfies the owner's request more literally, not less.
 *
 * So the assertion that carries the weight is the first one: every source is
 * named without anyone interacting. A test that only checked the expanded state
 * would pass on a control that hides a credit until tapped.
 */
const OSM: AttributionEntry = {
  short: "OpenStreetMap",
  full: "© OpenStreetMap contributors",
  href: "https://www.openstreetmap.org/copyright",
};
const MAPTERHORN: AttributionEntry = {
  short: "Mapterhorn",
  full: "Elevation data © Mapterhorn (national LiDAR sources, Copernicus GLO-30)",
};
const AWS: AttributionEntry = {
  short: "Mapzen/AWS",
  full: "Elevation data © Mapzen / AWS Open Data Terrain Tiles, sourced from SRTM, NED and others",
};

const view = (): AttributionView => new AttributionView();

/** What a user can read without touching anything. */
const restingText = (v: AttributionView): string =>
  [...v.element.querySelectorAll(".map-attribution-short")]
    .map((node) => node.textContent)
    .join(" · ");

const detailText = (v: AttributionView): string =>
  v.element.querySelector(".map-attribution-full")?.textContent ?? "";

const toggle = (v: AttributionView): HTMLButtonElement => {
  const button = v.element.querySelector(".map-attribution-toggle");
  if (!(button instanceof HTMLButtonElement)) throw new Error("no toggle");
  return button;
};

describe("AttributionView", () => {
  it("names EVERY source in the resting line, with no interaction", () => {
    // THE LICENCE ASSERTION. Not "the credits exist somewhere in the DOM" —
    // `textContent` matches hidden nodes, which is exactly how the previous
    // e2e guard would have kept passing over an invisible credit.
    const v = view();
    v.setEntries([OSM, MAPTERHORN, AWS]);

    expect(restingText(v)).toBe("OpenStreetMap · Mapterhorn · Mapzen/AWS");
    // THE RENDERED LINE, separators included. `restingText` reads only the
    // name spans and joins them with a separator it supplies itself, so it
    // would pass with `SEPARATOR` set to "" — the assertion that LOOKS like it
    // covers the separator is checking a string the test built.
    expect(v.element.querySelector(".map-attribution-line")?.textContent).toBe(
      "OpenStreetMap · Mapterhorn · Mapzen/AWS",
    );
    expect(v.element.querySelector(".map-attribution-full")).toHaveProperty(
      "hidden",
      true,
    );
  });

  it("reveals the full credit text only when expanded", () => {
    const v = view();
    v.setEntries([OSM, MAPTERHORN, AWS]);

    const details = v.element.querySelector(".map-attribution-full");
    expect(details).toHaveProperty("hidden", true);

    toggle(v).click();
    expect(details).toHaveProperty("hidden", false);
    expect(detailText(v)).toContain("© OpenStreetMap contributors");
    expect(detailText(v)).toContain("Copernicus GLO-30");
    expect(detailText(v)).toContain("SRTM, NED and others");

    toggle(v).click();
    expect(details).toHaveProperty("hidden", true);
  });

  it("tracks the expanded state in `aria-expanded`", () => {
    // The control is a disclosure; `hidden` alone says nothing to a screen
    // reader about what the button does or which state it is in.
    const v = view();
    v.setEntries([OSM]);

    expect(toggle(v).getAttribute("aria-expanded")).toBe("false");
    toggle(v).click();
    expect(toggle(v).getAttribute("aria-expanded")).toBe("true");
  });

  it("points the toggle at the panel it reveals", () => {
    // `aria-expanded` says what STATE the control is in and never what it
    // controls. Without `aria-controls` a screen-reader user has no
    // programmatic route from the button to the revealed content.
    const v = view();
    v.setEntries([OSM]);

    const panel = v.element.querySelector(".map-attribution-full");
    expect(panel?.id).toBeTruthy();
    expect(toggle(v).getAttribute("aria-controls")).toBe(panel?.id);
  });

  it("KEEPS the expanded state across a re-render", () => {
    // THE REASON THIS CONTROL EXISTS AT ALL (F5). Leaflet's own attribution
    // control rebuilds its innerHTML on every `addAttribution` — which fires on
    // every terrain apply, repeatedly during normal use — so an expander living
    // inside it would collapse itself mid-session at random. Owning the
    // rendering is only worth it if re-rendering preserves what the user did.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    toggle(v).click();
    expect(toggle(v).getAttribute("aria-expanded")).toBe("true");

    v.setEntries([OSM, MAPTERHORN, AWS]);

    expect(toggle(v).getAttribute("aria-expanded")).toBe("true");
    expect(v.element.querySelector(".map-attribution-full")).toHaveProperty(
      "hidden",
      false,
    );
    expect(restingText(v)).toBe("OpenStreetMap · Mapterhorn · Mapzen/AWS");
  });

  it("drops a source when it stops being on screen", () => {
    // Removal matters as much as addition: crediting a DEM source whose tiles
    // all failed would be a claim about what is being shown.
    const v = view();
    v.setEntries([OSM, MAPTERHORN, AWS]);
    v.setEntries([OSM]);

    expect(restingText(v)).toBe("OpenStreetMap");
    expect(detailText(v)).not.toContain("Mapterhorn");
  });

  it("links the short name when the source has a canonical page, and not otherwise", () => {
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);

    const links = [...v.element.querySelectorAll(".map-attribution-short a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "https://www.openstreetmap.org/copyright",
    );
    // A cross-origin link opened from the map must not hand the opener over.
    expect(links[0]?.getAttribute("rel")).toContain("noopener");
  });

  it("renders sheet-derived text through `textContent`, never as markup", () => {
    // The same rule `legend-view.ts` follows and for the same reason: this app
    // renders externally-authored strings, and the credit text is a string from
    // a library constant that could one day carry a character with meaning in
    // HTML. Avoiding the sink beats escaping through one.
    const v = view();
    v.setEntries([{ short: "<b>x</b>", full: "<img src=x onerror=boom>" }]);

    expect(v.element.querySelector("b")).toBeNull();
    expect(v.element.querySelector("img")).toBeNull();
    expect(restingText(v)).toBe("<b>x</b>");
  });

  it("shows nothing at all when there is nothing to credit", () => {
    // Not a stray separator or an empty "Attributions" button hanging in the
    // corner of the map.
    const v = view();
    v.setEntries([]);

    expect(v.element.hidden).toBe(true);
  });
});
