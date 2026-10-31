// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { cancelsXrSelect } from "./pin-sheet.js";
import {
  createViewSwitch,
  switchBlocks,
  viewSwitchModel,
} from "./view-switch.js";
import {
  storeVisitorChoice,
  withPreferredView,
  type ViewPlacement,
} from "./visitor-prefs.js";

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
      ["captions", "needs a timing", true, false],
    ]);
    const plain = viewSwitchModel([longText("t", "lectern")], null);
    expect(plain?.current).toBe("Lectern");
    expect(plain?.chosen).toBe(false);
    expect(plain?.rows.map((r) => [r.view, r.tag, r.on])).toEqual([
      ["reading", "", false],
      ["lectern", "creator's choice", true],
      ["captions", "needs a timing", false],
    ]);
  });

  // Why this test matters: the captions row is the visitor's way to the
  // strip; it must be offered on a text whose timing holds (or is not
  // read yet) and greyed "needs a timing" once it is found stale, and the
  // reading row must promise the highlight only where there is one.
  it("offers captions while a timing holds, and greys them once it is stale", () => {
    const narrated = {
      ...longText("t", "reading"),
      narration: { audio: "v", synthetic: false, timing: "timing/t.json" },
    } as TourBlock;
    const stored = withPreferredView(null, "longText", "world", "captions");
    const live = viewSwitchModel([narrated], stored, () => "live");
    expect(live?.current).toBe("Captions");
    expect(live?.rows.map((r) => [r.view, r.tag, r.disabled, r.on])).toEqual([
      ["reading", "creator's choice", false, false],
      ["lectern", "", false, false],
      ["captions", "", false, true],
    ]);
    expect(live?.rows[0]?.line).toBe(
      "The whole text in a sheet, the voice highlighted",
    );
    expect(live?.rows[2]?.line).toBe(
      "A few lines at a time with the voice, eyes on the place",
    );
    const stale = viewSwitchModel([narrated], stored, () => "stale");
    expect(stale?.current).toBe("Reading");
    expect(stale?.rows[2]).toMatchObject({
      tag: "needs a timing",
      disabled: true,
      on: false,
    });
    expect(stale?.rows[0]?.line).toBe(
      "The whole text in a sheet, read at your own pace",
    );
  });
});

describe("the switch on the page", () => {
  /** Every switch made, disposed after each test: an old one would go on
   *  listening on the document. */
  const made: { dispose(): void }[] = [];
  afterEach(() => {
    for (const sw of made.splice(0)) sw.dispose();
    document.body.replaceChildren();
  });

  /** The switch's clock, moved by the tests. */
  let clockMs = 0;

  function mount(blocks: TourBlock[], keeps = true, initial: unknown = null) {
    let stored: unknown = initial;
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
      now: () => clockMs,
    });
    made.push(sw);
    sw.sync();
    const q = (id: string) =>
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { sw, said, chosen, q };
  }

  /** A `beforexrselect` (the overlay's question before a tap becomes an
   *  AR select) on `target`; whether something cancelled it. */
  function selectCancelled(target: EventTarget): boolean {
    const event = new Event("beforexrselect", {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  // Why this test matters: the menu is a disclosure (a button that shows
  // a list of buttons), not an ARIA menu: menu roles promise arrow-key
  // navigation it does not have, and they put the footer's sentence and
  // its reset inside a "menu". The pill says it is expanded and which
  // box it controls; each row says whether it is the one shown.
  it("is a disclosure: no menu roles, pressed rows, a pill that controls the box", () => {
    const { q } = mount([longText("t", "reading")]);
    const button = q("view-switch-button");
    const menu = q("view-switch-menu");
    expect(document.querySelector("[role]")).toBeNull();
    expect(button?.hasAttribute("aria-haspopup")).toBe(false);
    expect(menu?.id).not.toBe("");
    expect(button?.getAttribute("aria-controls")).toBe(menu?.id);
    button?.click();
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(q("view-switch-reading")?.getAttribute("aria-pressed")).toBe("true");
    expect(q("view-switch-lectern")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(document.querySelector("[aria-checked]")).toBeNull();
  });

  // Why this test matters: a pick redraws the rows, which takes the
  // focused row out of the page; focus would fall to the body, and a
  // keyboard or screen reader user would lose their place. It goes back
  // to the pill.
  it("gives the focus back to the pill after a pick", () => {
    const { q } = mount([longText("t", "reading")]);
    q("view-switch-button")?.click();
    const lectern = q("view-switch-lectern");
    lectern?.focus();
    lectern?.click();
    expect(document.activeElement).toBe(q("view-switch-button"));
  });

  // Why this test matters: re-picking the row already chosen changes
  // nothing, so nothing is stored, nothing is said - and the page does
  // not rebuild the station's parts (a moved toy, an open card, a
  // lectern's page would all reset).
  it("does nothing but close when the stored choice is picked again", () => {
    const { q, said, chosen } = mount(
      [longText("t", "reading")],
      true,
      withPreferredView(null, "longText", "world", "lectern"),
    );
    q("view-switch-button")?.click();
    q("view-switch-lectern")?.click();
    expect(chosen).toEqual([]);
    expect(said).toEqual([]);
    expect(q("view-switch-menu")?.hidden).toBe(true);
    expect(document.activeElement).toBe(q("view-switch-button"));
  });

  // Why this test matters: "Use the creator's choice again" on a browser
  // that cannot store it clears the choice for this visit only; the toast
  // must not claim the device is back to the creator's choice.
  it("says a clear the device could not store lasts the visit", () => {
    const blocked = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new DOMException("refused", "QuotaExceededError");
      },
    };
    let stored: unknown = withPreferredView(
      null,
      "longText",
      "world",
      "lectern",
    );
    const said: string[] = [];
    const sw = createViewSwitch({
      host: document.body,
      read: () => ({ blocks: [longText("t", "reading")], stored }),
      choose: (kind, placement, view) => {
        const result = storeVisitorChoice(
          blocked,
          stored,
          kind,
          placement,
          view,
        );
        stored = result.value;
        return result.kept;
      },
      say: (text) => {
        said.push(text);
      },
      now: () => clockMs,
    });
    made.push(sw);
    sw.sync();
    document
      .querySelector<HTMLElement>('[data-testid="view-switch-button"]')
      ?.click();
    document
      .querySelector<HTMLElement>('[data-testid="view-switch-reset"]')
      ?.click();
    expect(said).toEqual([
      "Back to the creator's choice for this visit: Reading (this browser does not keep the choice).",
    ]);
  });

  // Why this test matters: in AR the tap outside that closes the menu
  // would also reach the world as a select (open a sign, turn a page)
  // behind it. While the menu is open every select is cancelled, and so
  // is the one of the closing tap itself, whichever of the two events
  // the browser sends first; the tap after that reaches the world again.
  it("keeps the closing tap outside from being an AR select, and only that tap", () => {
    const { q } = mount([longText("t", "reading")]);
    const outside = document.createElement("div");
    document.body.append(outside);
    expect(selectCancelled(outside), "menu closed: the world's tap").toBe(
      false,
    );
    q("view-switch-button")?.click();
    // The select before the tap's pointerdown.
    expect(selectCancelled(outside), "menu open").toBe(true);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(q("view-switch-menu")?.hidden).toBe(true);
    // The select after the tap's pointerdown, in the same tap.
    expect(selectCancelled(outside), "the closing tap").toBe(true);
    outside.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(selectCancelled(outside), "the next tap").toBe(false);
  });

  /** A pointer event of `type` by finger `id` on `target`. */
  function finger(target: EventTarget, type: string, id: number): void {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "pointerId", { value: id });
    target.dispatchEvent(event);
  }

  function openOutside() {
    clockMs = 1000;
    const m = mount([longText("t", "reading")]);
    const outside = document.createElement("div");
    document.body.append(outside);
    m.q("view-switch-button")?.click();
    return { ...m, outside };
  }

  // Why this test matters: XR input reaches the page about once a camera
  // frame, so the closing tap's select may be asked for only after its
  // pointerup; it must still be cancelled then, for a short grace, and
  // only that one select: the tap after it reaches the world.
  it("cancels the closing tap's select when it comes just after pointerup, once", () => {
    const { outside } = openOutside();
    finger(outside, "pointerdown", 1);
    finger(outside, "pointerup", 1);
    clockMs += 40;
    expect(selectCancelled(outside), "a frame after pointerup").toBe(true);
    expect(selectCancelled(outside), "the next select").toBe(false);
  });

  // Why this test matters: the grace is short; a select long after the
  // closing tap lifted is a new tap and reaches the world.
  it("lets a select through once the grace after pointerup has passed", () => {
    const { outside } = openOutside();
    finger(outside, "pointerdown", 1);
    finger(outside, "pointerup", 1);
    clockMs += 300;
    expect(selectCancelled(outside)).toBe(false);
  });

  // Why this test matters: one boolean for all fingers let a second
  // finger's pointerup clear the closing finger's mark, so its select
  // reached the world behind the menu.
  it("keeps the closing finger's mark when another finger lifts", () => {
    const { outside } = openOutside();
    finger(outside, "pointerdown", 1);
    finger(outside, "pointerdown", 2);
    finger(outside, "pointerup", 2);
    expect(selectCancelled(outside), "the closing finger's select").toBe(true);
    expect(selectCancelled(outside), "the other finger's select").toBe(false);
  });

  // Why this test matters: a cancelled pointer (a system gesture took
  // it) may still be followed by its select; it is treated as a lift,
  // with the same grace.
  it("treats a pointercancel as a lift, with the same grace", () => {
    const first = openOutside();
    finger(first.outside, "pointerdown", 1);
    finger(first.outside, "pointercancel", 1);
    clockMs += 40;
    expect(selectCancelled(first.outside), "within the grace").toBe(true);
    first.sw.dispose();
    // Without the cancel ending it, the mark would hold for good.
    const second = openOutside();
    finger(second.outside, "pointerdown", 1);
    finger(second.outside, "pointercancel", 1);
    clockMs += 300;
    expect(selectCancelled(second.outside), "after the grace").toBe(false);
  });

  // Why this test matters: close() ends the AR session's switch; a
  // closing tap's mark must not outlive it into the next session.
  it("drops the closing tap's mark on close()", () => {
    const { outside, sw } = openOutside();
    finger(outside, "pointerdown", 1);
    sw.close();
    expect(selectCancelled(outside)).toBe(false);
  });

  // Why this test matters: the menu's open state must not outlive the AR
  // session: the next session would start with it open over the view.
  it("closes on demand (the end of an AR session)", () => {
    const { q, sw } = mount([longText("t", "reading")]);
    q("view-switch-button")?.click();
    expect(q("view-switch-menu")?.hidden).toBe(false);
    sw.close();
    expect(q("view-switch-menu")?.hidden).toBe(true);
    expect(q("view-switch-button")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  // Why this test matters: in AR the switch sits in the DOM overlay; a tap
  // on its menu's text or padding that the overlay does not claim becomes
  // an XR select - the world's tap - behind the open menu.
  it("keeps every tap on the pill and its menu from being an AR select", () => {
    const { q } = mount([longText("a", "lectern")]);
    q("view-switch-button")?.click();
    const menu = q("view-switch-menu");
    expect(menu?.hidden).toBe(false);
    expect(cancelsXrSelect(q("view-switch"))).toBe(true);
    expect(cancelsXrSelect(menu)).toBe(true);
    expect(cancelsXrSelect(menu?.querySelector(".vs-foot") ?? null)).toBe(true);
    expect(cancelsXrSelect(document.body)).toBe(false);
  });

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

describe("the blocks the switch describes", () => {
  const station = (id: string, blocks: TourBlock[]): TourStation => ({
    id,
    geo: { lat: 0, lon: 0, alt: 0, rotation: [0, 0, 0, 1] },
    activateRadiusM: 20,
    foundRadiusM: 5,
    hint: "arrow",
    blocks,
    steps: [],
  });
  const stations = [station("gate", [longText("t", "reading")])];

  // Why this test matters: the switch must not show before the present
  // station's content is placed - it would offer to change a text that is
  // not standing yet (the gate still scanning, the zero not set).
  it("are the present station's free blocks, once its content is placed", () => {
    expect(
      switchBlocks({ stations, presentId: "gate", contentPlaced: false }),
    ).toEqual([]);
    expect(
      switchBlocks({ stations, presentId: "gate", contentPlaced: true }).map(
        (b) => b.id,
      ),
    ).toEqual(["t"]);
    expect(
      switchBlocks({ stations, presentId: null, contentPlaced: true }),
    ).toEqual([]);
    expect(
      switchBlocks({ stations, presentId: "other", contentPlaced: true }),
    ).toEqual([]);
    expect(
      switchBlocks({
        stations: undefined,
        presentId: "gate",
        contentPlaced: true,
      }),
    ).toEqual([]);
  });
});
