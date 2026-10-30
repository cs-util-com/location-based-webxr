// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { createViewSwitch, viewSwitchModel } from "./view-switch.js";
import { withPreferredView, type ViewPlacement } from "./visitor-prefs.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

function longText(id: string, view: string, body = "Words."): TourBlock {
  return {
    id,
    kind: "longText",
    view,
    title: "T",
    body,
    pose: POSE,
  } as TourBlock;
}

const PIN = {
  id: "pin",
  kind: "shortText",
  view: "pin",
  caption: "Sign",
  pose: POSE,
} as TourBlock;

const PICTURE_BODY = "Before.\n\n![x](asset:a)";

describe("the switch's model", () => {
  // Why this test matters: the switch appears only for a block whose
  // creator's view is in a set (design §4); a station of pins and story
  // cards has none.
  it("is null without a block in a set", () => {
    expect(viewSwitchModel([], null)).toBeNull();
    expect(viewSwitchModel([PIN, longText("c", "card")], null)).toBeNull();
  });

  // Why this test matters: the switch offers the set, marks the creator's
  // choice and the view shown, and greys a view that cannot show this
  // block whole, with its reason (design §4).
  it("offers the set, greys a view whose needs fail, and marks the creator's choice", () => {
    const model = viewSwitchModel(
      [PIN, longText("t", "reading", PICTURE_BODY)],
      withPreferredView(null, "longText", "world", "lectern"),
    );
    expect(model).not.toBeNull();
    expect(model?.current).toBe("Reading");
    expect(model?.chosen).toBe(true);
    expect(model?.rows.map((r) => [r.view, r.tag, r.disabled, r.on])).toEqual([
      ["reading", "creator's choice", false, true],
      ["lectern", "shows no pictures", true, false],
    ]);
    const plain = viewSwitchModel([longText("t", "lectern")], null);
    expect(plain?.current).toBe("Lectern");
    expect(plain?.chosen).toBe(false);
    expect(plain?.rows.map((r) => [r.view, r.tag, r.on])).toEqual([
      ["reading", "", false],
      ["lectern", "creator's choice", true],
    ]);
  });
});

describe("the switch on the page", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mount(blocks: TourBlock[], keeps = true) {
    let stored: unknown = null;
    const said: string[] = [];
    const chosen: [string, ViewPlacement, string | null][] = [];
    const sw = createViewSwitch({
      host: document.body,
      read: () => ({ blocks, stored }),
      choose: (kind, placement, view) => {
        chosen.push([kind, placement, view]);
        stored = withPreferredView(stored, kind, placement, view);
        return keeps;
      },
      say: (text) => {
        said.push(text);
      },
    });
    sw.sync();
    const q = (id: string) =>
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { sw, said, chosen, q };
  }

  // Why this test matters: no block in a set, no switch (it must not sit
  // on the screen of a station it cannot change).
  it("hides without a block in a set", () => {
    const { q } = mount([PIN]);
    expect(q("view-switch")?.hidden).toBe(true);
  });

  // Why this test matters: a choice is stored for the kind and placement,
  // the menu closes, the label follows, and the toast names the choice
  // and whether the device keeps it (design §4, the plan's acceptance).
  it("stores a choice, closes, relabels and says it is kept", () => {
    const { q, said, chosen } = mount([longText("t", "reading")]);
    expect(q("view-switch")?.hidden).toBe(false);
    expect(q("view-switch-current")?.textContent).toBe("Reading");
    q("view-switch-button")?.click();
    expect(q("view-switch-menu")?.hidden).toBe(false);
    expect(q("view-switch-button")?.getAttribute("aria-expanded")).toBe("true");
    q("view-switch-lectern")?.click();
    expect(chosen).toEqual([["longText", "world", "lectern"]]);
    expect(q("view-switch-menu")?.hidden).toBe(true);
    expect(q("view-switch-current")?.textContent).toBe("Lectern");
    expect(said).toEqual([
      "Lectern from now on, for every long text on this phone.",
    ]);
    q("view-switch-button")?.click();
    q("view-switch-reset")?.click();
    expect(chosen.at(-1)).toEqual(["longText", "world", null]);
    expect(said.at(-1)).toBe("Back to the creator's choice: Reading.");
    expect(q("view-switch-current")?.textContent).toBe("Reading");
  });

  // Why this test matters: blocked storage keeps the choice for the visit
  // only, and the toast must say so (design §4).
  it("says a choice the device does not keep lasts the visit", () => {
    const { q, said } = mount([longText("t", "reading")], false);
    q("view-switch-button")?.click();
    q("view-switch-lectern")?.click();
    expect(said).toEqual([
      "Lectern for this visit (this browser does not keep the choice).",
    ]);
  });

  // Why this test matters: on a phone held sideways the open menu covers
  // the walk's card; a tap anywhere else must close it without a choice,
  // and a tap inside must not.
  it("closes on a tap outside, not on one inside", () => {
    const { q, chosen } = mount([longText("t", "reading")]);
    const outside = document.createElement("div");
    document.body.append(outside);
    q("view-switch-button")?.click();
    q("view-switch-menu")?.dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    expect(q("view-switch-menu")?.hidden).toBe(false);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(q("view-switch-menu")?.hidden).toBe(true);
    expect(q("view-switch-button")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(chosen).toEqual([]);
  });

  // Why this test matters: a greyed view cannot be chosen, and "Use the
  // creator's choice again" shows only while a choice is stored.
  it("refuses a greyed view and offers the way back only after a choice", () => {
    const { q, chosen } = mount([longText("t", "reading", PICTURE_BODY)]);
    q("view-switch-button")?.click();
    const lectern = q("view-switch-lectern") as HTMLButtonElement | null;
    expect(lectern?.disabled).toBe(true);
    expect(lectern?.textContent).toContain("shows no pictures");
    lectern?.click();
    expect(chosen).toEqual([]);
    expect(q("view-switch-reset")).toBeNull();
  });
});
