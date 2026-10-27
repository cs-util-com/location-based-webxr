// @vitest-environment jsdom
/**
 * Why these tests matter: the drawn phone is where the film shows what a
 * person does (place, type, add a picture, print, scan). Its parts must
 * follow the story exactly as the reference does (a sheet that is gone is
 * hidden, not only transparent, so it cannot catch a tap or a screen
 * reader; the card types its title letter by letter with the caret only
 * while typing), sit on the spots the scene names, and drop the small
 * print on a narrow screen. The view writes only what changed: a test
 * pins that, because a film that restyles forty parts every frame costs
 * frames on a slow phone.
 */
import { describe, expect, it } from "vitest";

import { buildFilmDom } from "./film-dom.js";
import { filmLayout } from "./film-layout.js";
import {
  anchorPlacement,
  createPhoneView,
  floorAnchors,
  NARROW_SCREEN_PX,
  phoneStyles,
  PILLS,
  screenFontPx,
  typedTitle,
} from "./film-phone.js";
import { blankPhone, frameAt, TYPED_TITLE } from "./film-story.js";

describe("phone styles", () => {
  it("hides a sheet that is gone, and shows one that is up", () => {
    const u = { ...blankPhone(), place: 1, tools: 0 };
    const s = phoneStyles(u);
    expect(s.place).toEqual({
      opacity: "1.000",
      transform: "translateY(0.00em)",
      visibility: "visible",
    });
    expect(s.tools.visibility).toBe("hidden");
  });

  it("keeps the screen covered while the phone is put away", () => {
    expect(
      phoneStyles({ ...blankPhone(), on: false, cover: 0 }).cover.opacity,
    ).toBe("1");
    expect(
      phoneStyles({ ...blankPhone(), on: true, cover: 0.25 }).cover.opacity,
    ).toBe("0.250");
  });

  it("shows the ripple only while it spreads", () => {
    expect(phoneStyles({ ...blankPhone(), ripple: 0 }).ripple.opacity).toBe(
      "0.000",
    );
    expect(phoneStyles({ ...blankPhone(), ripple: 0.5 }).ripple.opacity).toBe(
      "0.450",
    );
    expect(phoneStyles({ ...blankPhone(), ripple: 1 }).ripple.opacity).toBe(
      "0.000",
    );
  });

  it("darkens the place button only while it is pressed", () => {
    expect(
      phoneStyles({ ...blankPhone(), press: 0.5 }).placeBtn.background,
    ).toBe("var(--lf-route-dark)");
    expect(
      phoneStyles({ ...blankPhone(), press: 0.1 }).placeBtn.background,
    ).toBe("");
  });
});

describe("typed title", () => {
  it("types the title letter by letter with the caret, then drops the caret", () => {
    const part4 = (t: number) => typedTitle(frameAt(4, t).u);
    expect(part4(0.95)).toEqual({ text: "", caret: true });
    const mid = part4(1.4);
    expect(mid.text.length).toBeGreaterThan(0);
    expect(TYPED_TITLE.startsWith(mid.text)).toBe(true);
    expect(mid.caret).toBe(true);
    expect(part4(2)).toEqual({ text: TYPED_TITLE, caret: false });
  });

  it("shows the whole title, no caret, outside the typing part", () => {
    expect(typedTitle(frameAt(1, 2).u)).toEqual({
      text: TYPED_TITLE,
      caret: false,
    });
  });
});

describe("anchors", () => {
  it("places the card over the pin, held to the middle of the screen", () => {
    const A = floorAnchors("mill", 160, 300);
    const p = anchorPlacement(A, 160, 300);
    expect(p.at.card?.[0]).toBeCloseTo(0.47 * 160, 6);
    expect(p.at.card?.[1]).toBeCloseTo(0.47 * 300, 6);
    expect(p.at.ret).toEqual(A.ground);
    expect(p.board).toBeNull();
    // the drawn pin reaches from the ground up to its head
    expect(p.pinMarginTop).toBeCloseTo(-(0.705 - 0.47) * 300 - 4, 6);
  });

  it("sizes the halo, the scan box and the drawn code to the board", () => {
    const p = anchorPlacement(floorAnchors("scan", 200, 400), 200, 400);
    const bw = (0.73 - 0.27) * 200;
    expect(p.board?.halo.w).toBeCloseTo(bw + 10, 6);
    expect(p.board?.scan.w).toBeCloseTo(bw + 16, 6);
    expect(p.at.call?.[0]).toBeCloseTo(100, 6);
  });

  it("holds the card on screen when the pin is far to one side", () => {
    const p = anchorPlacement(
      { pin: [5, 10], ground: [5, 200], next: [80, 300] },
      160,
      300,
    );
    expect(p.at.card?.[0]).toBeCloseTo(0.44 * 160, 6);
    expect(p.at.card?.[1]).toBeCloseTo(0.42 * 300, 6);
  });
});

describe("phone text size", () => {
  it("is 6.6 % of the screen, never below 13 px or above 17 px", () => {
    expect(screenFontPx(100)).toBe(13);
    expect(screenFontPx(230)).toBeCloseTo(15.18, 6);
    expect(screenFontPx(400)).toBe(17);
  });
});

describe("phone view", () => {
  it("writes the state into the markup, and the pill once per change", () => {
    const dom = buildFilmDom(document);
    const view = createPhoneView(dom);
    view.apply(frameAt(3, 2.3).u);
    expect(dom.phone.classList.contains("lf-on")).toBe(true);
    expect(dom.parts.pill.innerHTML).toBe(PILLS.make);
    expect(dom.parts.place.style.visibility).toBe("visible");
    const stills = dom.parts.stills.map((s) => s.style.display);
    expect(stills).toEqual(["", "none"]);
    view.apply(frameAt(6, 4).u);
    expect(dom.parts.pill.innerHTML).toBe(PILLS.saved);
    expect(dom.parts.stills.map((s) => s.style.display)).toEqual(["none", ""]);
    expect(view.eye()).toBe("poster");
  });

  it("writes nothing when the state has not changed", () => {
    const dom = buildFilmDom(document);
    const view = createPhoneView(dom);
    const u = frameAt(4, 1.4).u;
    view.apply(u);
    const writes: string[] = [];
    const watch = new MutationObserver((ms) =>
      ms.forEach((m) => writes.push(m.attributeName ?? m.type)),
    );
    watch.observe(dom.root, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    view.apply(u);
    return Promise.resolve().then(() => {
      watch.disconnect();
      expect(writes.filter((w) => w === "style")).toEqual([]);
    });
  });

  it("sizes the phone to the layout and marks a narrow screen", () => {
    const dom = buildFilmDom(document);
    const view = createPhoneView(dom);
    const narrow = filmLayout(300, 375, 320);
    view.layout(narrow);
    expect(narrow.screen.w).toBeLessThan(NARROW_SCREEN_PX);
    expect(dom.screen.classList.contains("lf-narrow")).toBe(true);
    expect(dom.phone.style.width).toBe(`${String(narrow.phone.w)}px`);
    const wide = filmLayout(1100, 619, 1440);
    view.layout(wide);
    expect(dom.screen.classList.contains("lf-narrow")).toBe(false);
    expect(dom.screen.style.getPropertyValue("--lf-sw")).toBe(
      `${String(wide.screen.w)}px`,
    );
  });

  it("gives each mount its own code symbol, so two films never share an id", () => {
    const a = buildFilmDom(document);
    const b = buildFilmDom(document);
    const id = (d: typeof a) => d.root.querySelector("symbol")?.id;
    expect(id(a)).toMatch(/^lf-qr-\d+$/);
    expect(id(a)).not.toBe(id(b));
    expect(b.root.querySelector("use")?.getAttribute("href")).toBe(
      `#${String(id(b))}`,
    );
  });
});
