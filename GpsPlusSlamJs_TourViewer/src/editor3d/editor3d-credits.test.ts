// @vitest-environment jsdom
/**
 * Why these tests matter: the owner replaced the 3D view's credits line (a
 * row of short names over the canvas) with one "Credits" button (now at
 * the bottom bar's left). What the sources ask for must still be one click away and
 * in full: every source with its link, GIBS's acknowledgement word for
 * word, Copernicus's whole notice. The panel is a disclosure (a button
 * with aria-expanded and aria-controls, no dialog role, since nothing
 * traps focus): Esc anywhere and a click outside close it, and focus goes
 * back to the button, or a keyboard user would be stranded in a closed
 * panel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountCredits } from "./editor3d-credits.js";

const CREDITS = [
  {
    short: "Mapterhorn",
    full: "Mapterhorn (terrain tiles)",
    href: "https://mapterhorn.com/attribution",
  },
  {
    short: "Copernicus GLO-30",
    full: "Copernicus GLO-30: © DLR e.V. 2010-2014, Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA. All rights reserved.",
    href: "https://spacedata.copernicus.eu/",
  },
  {
    short: "OpenStreetMap",
    full: "© OpenStreetMap contributors",
    href: "https://www.openstreetmap.org/copyright",
  },
];
const NOTE =
  "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS).";

function mount(options?: Parameters<typeof mountCredits>[2]) {
  const box = document.createElement("div");
  const outside = document.createElement("button");
  outside.textContent = "elsewhere";
  document.body.append(box, outside);
  const unmount = mountCredits(box, CREDITS, options);
  const button = box.querySelector<HTMLButtonElement>("button")!;
  const panel = box.querySelector<HTMLElement>(".view3d-credits-panel")!;
  return { box, outside, unmount, button, panel };
}

const esc = (target: Element) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );

afterEach(() => {
  document.body.replaceChildren();
});

describe("mountCredits", () => {
  it("shows only a Credits button, the overlay closed", () => {
    // Why: the owner's verdict - the line of names over the view goes;
    // one button stays.
    const { box, button, panel } = mount({ note: NOTE });
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("Credits");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.id).not.toBe("");
    expect(panel.hidden).toBe(true);
    expect(panel.getAttribute("aria-label")).toBe("Credits");
    // A disclosure, not a dialog: no popup role that would promise a
    // focus trap the panel does not have.
    expect(panel.hasAttribute("role")).toBe(false);
    expect(button.hasAttribute("aria-haspopup")).toBe(false);
    // Nothing else shows: no short names, no OSM link beside it.
    const shown = [...box.children].filter((c) => !(c as HTMLElement).hidden);
    expect(shown).toEqual([button]);
  });

  it("opens on a click to every source in full, linked, and the note", () => {
    // Why: the sources' terms ask for their full notice and link, and
    // GIBS for its acknowledgement as written.
    const { button, panel } = mount({ note: NOTE });
    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const links = [...panel.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.href])).toEqual(
      CREDITS.map((c) => [c.full, c.href]),
    );
    for (const a of links) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener");
    }
    expect(panel.textContent).toContain(NOTE);
  });

  it("renders the texts as text, never as markup", () => {
    // Why: the credits come from registries and an attribution string;
    // a stray tag in one must not become an element.
    const box = document.createElement("div");
    document.body.append(box);
    mountCredits(
      box,
      [
        {
          short: "x",
          full: "<img src=x onerror=alert(1)>",
          href: "https://x/",
        },
      ],
      { note: "<b>n</b>" },
    );
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelector("b")).toBeNull();
    expect(box.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("closes on Esc and gives focus back to the button", () => {
    const { button, panel } = mount();
    button.focus();
    button.click();
    const link = panel.querySelector("a")!;
    link.focus();
    esc(link);
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("does not swallow Esc while closed", () => {
    // Why: Esc means something else in the editor (leaving a drag, a
    // selection); a closed overlay must leave it alone.
    const { box, button } = mount();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    button.focus();
    expect(esc(button)).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", seen);
    expect(
      box.querySelector(".view3d-credits-panel")?.hasAttribute("hidden"),
    ).toBe(true);
  });

  it("stops Esc at the overlay while open", () => {
    // Why: one Esc closes the overlay and nothing else.
    const { button } = mount();
    button.click();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    expect(esc(button)).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
  });

  it("closes on Esc with focus outside the box, leaving focus where it is", () => {
    // Why: the review found Esc heard only inside the box; a disclosure
    // left open while focus moved on must still close on Esc. Focus that
    // has moved on stays there: pulling it back to the button would
    // throw the keyboard user out of whatever they went on to.
    const { button, panel, outside } = mount();
    button.click();
    outside.focus();
    expect(esc(outside)).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(outside);
  });

  it("gives focus to the button on Esc when focus was on the page itself", () => {
    // Why: with focus on the body (a click on nothing focusable), the
    // button is the nearest place to resume from.
    const { button, panel } = mount();
    button.click();
    button.blur();
    expect(document.activeElement).toBe(document.body);
    esc(document.body);
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("closes on a pointer down outside, not on one inside", () => {
    const { button, panel, outside } = mount();
    button.click();
    panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(panel.hidden).toBe(false);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes again on a second click of the button", () => {
    const { button, panel } = mount();
    button.click();
    button.click();
    expect(panel.hidden).toBe(true);
  });

  it("can show the OSM credit beside the button, off unless asked", () => {
    // Why: the owner may want the map's short credit always in view; the
    // option is named and off, so turning it on is one word.
    expect(mount().box.querySelector(".view3d-credits-beside")).toBeNull();
    document.body.replaceChildren();
    const { box } = mount({ osmBeside: true });
    const beside = box.querySelector<HTMLAnchorElement>(
      ".view3d-credits-beside",
    );
    expect(beside?.textContent).toBe("© OpenStreetMap contributors");
    expect(beside?.href).toBe("https://www.openstreetmap.org/copyright");
  });

  it("unmounts: the box emptied and no listener left", () => {
    // Why: the view's undo runs this on close; an outside listener left
    // on the document would run on every later click.
    const { box, button, unmount, outside } = mount();
    button.click();
    const remove = vi.spyOn(document, "removeEventListener");
    unmount();
    expect(box.childElementCount).toBe(0);
    expect(remove).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
      true,
    );
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    remove.mockRestore();
  });
});
