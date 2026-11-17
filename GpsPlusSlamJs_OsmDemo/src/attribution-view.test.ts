/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";

import { AttributionView, type AttributionEntry } from "./attribution-view.js";

/**
 * WHY THESE TESTS MATTER.
 *
 * This is the one surface in the demo with an obligation attached rather than a
 * preference. The OSMF attribution guidelines ask for "OpenStreetMap" to be
 * credited without the user having to interact, as a link to its copyright
 * page; the elevation sources (CC BY and similar licences) may be credited "in
 * any reasonable manner", which includes a link to a page carrying the
 * attribution - here, the Credits view one tap away beside the map.
 *
 * So the line is "© OpenStreetMap | Credits | Legal": the OSM credit pinned and
 * linked, every other credit in the Credits view, and the legal notice beside
 * them. The assertion that carries the weight is the first one: the OSM credit
 * is in the resting line with no interaction. A test that only checked the
 * expanded state would pass on a control that hides it until tapped.
 */
const OSM: AttributionEntry = {
  short: "© OpenStreetMap",
  full: "© OpenStreetMap contributors",
  href: "https://www.openstreetmap.org/copyright",
  pinned: true,
};
const MAPTERHORN: AttributionEntry = {
  short: "Mapterhorn",
  full: "Elevation data © Mapterhorn (national LiDAR sources, Copernicus GLO-30)",
  href: "https://mapterhorn.com/attribution/",
};
const AWS: AttributionEntry = {
  short: "Mapzen/AWS",
  full: "Elevation data © Mapzen / AWS Open Data Terrain Tiles, sourced from SRTM, NED and others",
};

/** The page's own legal link, as `index.html` carries it. */
function legalLink(): HTMLAnchorElement {
  const link = document.createElement("a");
  link.id = "legal-link";
  link.href = "/legal/";
  link.textContent = "Legal";
  link.setAttribute("aria-label", "Legal notice and privacy");
  document.body.append(link);
  return link;
}

/** A view mounted in the document, so focus behaves as in the page. */
function view(): AttributionView {
  const v = new AttributionView();
  document.body.append(v.element);
  return v;
}

const line = (v: AttributionView): HTMLElement => {
  const el = v.element.querySelector(".map-attribution-line");
  if (!(el instanceof HTMLElement)) throw new Error("no line");
  return el;
};

const panel = (v: AttributionView): HTMLElement => {
  const el = v.element.querySelector(".map-attribution-full");
  if (!(el instanceof HTMLElement)) throw new Error("no panel");
  return el;
};

const toggle = (v: AttributionView): HTMLButtonElement => {
  const button = v.element.querySelector(".map-attribution-toggle");
  if (!(button instanceof HTMLButtonElement)) throw new Error("no toggle");
  return button;
};

const escape = (target: Element): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

describe("AttributionView: the resting line", () => {
  it("reads '© OpenStreetMap | Credits | Legal' with no interaction", () => {
    // THE LICENCE ASSERTION, on the rendered line itself (separators
    // included), not on the whole control's `textContent`, which would also
    // match text hidden in the closed Credits view.
    const v = view();
    const link = legalLink();
    v.adoptLegalLink(link);
    v.setEntries([OSM, MAPTERHORN, AWS]);

    expect(line(v).textContent).toBe("© OpenStreetMap | Credits | Legal");
    expect(panel(v).hidden).toBe(true);
    link.remove();
  });

  it("links the pinned OSM credit to the copyright page, opened safely", () => {
    // OSMF: the text "OpenStreetMap" as a link to openstreetmap.org/copyright
    // is how the attribution also names the ODbL.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);

    const links = [...line(v).querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe("© OpenStreetMap");
    expect(links[0]?.getAttribute("href")).toBe(
      "https://www.openstreetmap.org/copyright",
    );
    expect(links[0]?.getAttribute("rel")).toContain("noopener");
  });

  it("keeps the unpinned credits out of the line and in the Credits view", () => {
    const v = view();
    v.setEntries([OSM, MAPTERHORN, AWS]);

    expect(line(v).textContent).not.toContain("Mapterhorn");
    expect(line(v).textContent).not.toContain("Mapzen");
    expect(panel(v).textContent).toContain("Copernicus GLO-30");
    expect(panel(v).textContent).toContain("SRTM, NED and others");
  });

  it("hides the pipes from screen readers", () => {
    // Three links in a row read best with a visual separator, but "vertical
    // line" announced between them is noise.
    const v = view();
    const link = legalLink();
    v.adoptLegalLink(link);
    v.setEntries([OSM]);

    const separators = [...line(v).querySelectorAll(".map-attribution-sep")];
    expect(separators).toHaveLength(2);
    for (const sep of separators) {
      expect(sep.getAttribute("aria-hidden")).toBe("true");
      expect(sep.textContent).toBe(" | ");
    }
    link.remove();
  });

  it("adopts the page's legal link rather than building a second one", () => {
    // The link lives in `index.html` so the page works, and the repo-config
    // check finds it, without this script; the line only moves it.
    const v = view();
    const link = legalLink();
    v.adoptLegalLink(link);
    v.setEntries([OSM]);

    expect(line(v).contains(link)).toBe(true);
    expect(document.querySelectorAll("#legal-link")).toHaveLength(1);
    expect(link.getAttribute("href")).toBe("/legal/");
    // The visible word is part of the accessible name (WCAG 2.5.3).
    expect(link.getAttribute("aria-label")).toMatch(/^Legal/);
    link.remove();
  });

  it("adopts the legal link idempotently: a second call leaves one separator", () => {
    // Why this test matters: the line is built by appending, so a repeated
    // adopt would leave a stray pipe in front of the link.
    const v = view();
    const link = legalLink();
    v.adoptLegalLink(link);
    v.adoptLegalLink(link);
    v.setEntries([OSM]);

    expect(line(v).textContent).toBe("© OpenStreetMap | Credits | Legal");
    expect(line(v).querySelectorAll(".map-attribution-sep")).toHaveLength(2);
    link.remove();
  });

  it("adopting another legal link replaces the first, separator and all", () => {
    const v = view();
    const first = legalLink();
    v.adoptLegalLink(first);
    first.remove();
    const second = legalLink();
    v.adoptLegalLink(second);
    v.setEntries([OSM]);

    expect(line(v).contains(second)).toBe(true);
    expect(line(v).textContent).toBe("© OpenStreetMap | Credits | Legal");
    expect(line(v).querySelectorAll(".map-attribution-sep")).toHaveLength(2);
    second.remove();
  });

  it("shows nothing at all when there is nothing to credit and no legal link", () => {
    const v = view();
    v.setEntries([]);
    expect(v.element.hidden).toBe(true);

    // The legal link alone still earns the line a place.
    const link = legalLink();
    v.adoptLegalLink(link);
    expect(v.element.hidden).toBe(false);
    expect(line(v).textContent).toBe("Credits | Legal");
    link.remove();
  });
});

describe("AttributionView: the Credits view", () => {
  it("opens and closes from 'Credits', tracking aria-expanded", () => {
    const v = view();
    v.setEntries([OSM, MAPTERHORN, AWS]);
    const button = toggle(v);

    expect(button.textContent).toBe("Credits");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click();
    expect(panel(v).hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    button.click();
    expect(panel(v).hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("points the toggle at the view it reveals", () => {
    const v = view();
    v.setEntries([OSM]);

    expect(panel(v).id).toBeTruthy();
    expect(toggle(v).getAttribute("aria-controls")).toBe(panel(v).id);
  });

  it("makes every credit with a page a real link, and leaves the rest as text", () => {
    const v = view();
    v.setEntries([OSM, MAPTERHORN, AWS]);
    toggle(v).click();

    const rows = [...panel(v).querySelectorAll(".map-attribution-credit")];
    expect(rows.map((row) => row.textContent)).toEqual([
      OSM.full,
      MAPTERHORN.full,
      AWS.full,
    ]);
    const hrefs = rows.map(
      (row) => row.querySelector("a")?.getAttribute("href") ?? null,
    );
    expect(hrefs).toEqual([OSM.href, MAPTERHORN.href, null]);
    for (const link of panel(v).querySelectorAll("a")) {
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("closes on Escape from inside it and returns focus to 'Credits'", () => {
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    toggle(v).click();
    const link = panel(v).querySelector("a");
    if (!(link instanceof HTMLAnchorElement)) throw new Error("no link");
    link.focus();

    const event = escape(link);

    expect(panel(v).hidden).toBe(true);
    expect(toggle(v).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle(v));
    // Handled here, so a page-level Escape handler does not also act on it.
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Escape alone while closed", () => {
    // A closed Credits view has nothing to close; swallowing the key would
    // break whatever else on the page listens for it.
    const v = view();
    v.setEntries([OSM]);

    const event = escape(toggle(v));
    expect(event.defaultPrevented).toBe(false);
    expect(panel(v).hidden).toBe(true);
  });

  it("KEEPS the open state across a re-render", () => {
    // The reason the demo owns this control: Leaflet's rebuilds its innerHTML
    // on every credit change, which happens on every terrain apply.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    toggle(v).click();

    v.setEntries([OSM, MAPTERHORN, AWS]);

    expect(toggle(v).getAttribute("aria-expanded")).toBe("true");
    expect(panel(v).hidden).toBe(false);
    expect(panel(v).textContent).toContain("SRTM");
  });

  it("leaves focus and the view untouched when the same credits arrive again", () => {
    // `MapView.setTerrainAttribution` passes the same list on every terrain
    // apply. A re-render then would detach the focused link and drop focus to
    // <body>, where Escape no longer reaches this control's handler: the open
    // view could not be closed by keyboard. Equal by VALUE, so fresh copies
    // count as unchanged.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    toggle(v).click();
    const link = panel(v).querySelector("a");
    if (!(link instanceof HTMLAnchorElement)) throw new Error("no link");
    link.focus();

    v.setEntries([{ ...OSM }, { ...MAPTERHORN }]);

    expect(link.isConnected).toBe(true);
    expect(document.activeElement).toBe(link);
    escape(link);
    expect(panel(v).hidden).toBe(true);
    expect(document.activeElement).toBe(toggle(v));
  });

  it("keeps focus inside the control when a changed list re-renders under it", () => {
    // A real change must re-render; focus then moves to the same credit's new
    // link, or to "Credits" when that credit is gone, never to <body>.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    toggle(v).click();
    const links = panel(v).querySelectorAll("a");
    const mapterhorn = links[1];
    if (!(mapterhorn instanceof HTMLAnchorElement)) throw new Error("no link");
    mapterhorn.focus();

    v.setEntries([OSM, MAPTERHORN, AWS]);

    const active = document.activeElement;
    expect(active).not.toBe(mapterhorn);
    expect(panel(v).contains(active)).toBe(true);
    expect(active?.getAttribute("href")).toBe(MAPTERHORN.href);

    v.setEntries([OSM, AWS]);
    expect(document.activeElement).toBe(toggle(v));
    if (document.activeElement === null) throw new Error("no focus");
    escape(document.activeElement);
    expect(panel(v).hidden).toBe(true);
  });

  it("re-renders a list of the same length when only a pinned flag flips", () => {
    // Why this test matters: the unchanged-list check compares by value, and a
    // check that looked only at the length, or skipped `pinned`, would keep a
    // credit out of the resting line that its terms now ask to be visible.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    expect(line(v).textContent).not.toContain("Mapterhorn");

    v.setEntries([OSM, { ...MAPTERHORN, pinned: true }]);
    expect(line(v).textContent).toContain("Mapterhorn");

    v.setEntries([OSM, MAPTERHORN]);
    expect(line(v).textContent).not.toContain("Mapterhorn");
  });

  it("restores focus on a pinned link in the resting line after a re-render", () => {
    // The pinned links re-render too; focus on one must land on its new link,
    // not on <body>.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    const pinned = line(v).querySelector("a.map-attribution-short");
    if (!(pinned instanceof HTMLAnchorElement)) throw new Error("no link");
    pinned.focus();

    v.setEntries([OSM, MAPTERHORN, AWS]);

    const active = document.activeElement;
    expect(active).not.toBe(pinned);
    expect(active?.classList.contains("map-attribution-short")).toBe(true);
    expect(active?.getAttribute("href")).toBe(OSM.href);
  });

  it("never takes focus from outside the control on a re-render", () => {
    // A credit change arrives while the user works elsewhere (a terrain
    // apply); pulling focus into the footer would interrupt them.
    const v = view();
    v.setEntries([OSM, MAPTERHORN]);
    toggle(v).click();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    v.setEntries([OSM, AWS]);

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("drops a source when it stops being on screen", () => {
    // Crediting a DEM source whose tiles all failed would be a claim about
    // what is being shown.
    const v = view();
    v.setEntries([OSM, MAPTERHORN, AWS]);
    v.setEntries([OSM]);

    expect(panel(v).textContent).not.toContain("Mapterhorn");
    expect(line(v).textContent).toContain("© OpenStreetMap");
  });

  it("renders credit text through `textContent`, never as markup", () => {
    // Credits are externally-authored strings; avoiding the HTML sink beats
    // escaping through one.
    const v = view();
    v.setEntries([
      { short: "<b>x</b>", full: "<img src=x onerror=boom>", pinned: true },
    ]);

    expect(v.element.querySelector("b")).toBeNull();
    expect(v.element.querySelector("img")).toBeNull();
    expect(line(v).textContent).toContain("<b>x</b>");
  });
});
