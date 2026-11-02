// @vitest-environment jsdom
/**
 * Why these tests matter: the preview's phone must keep a real phone's
 * shape in whatever room the inspector leaves (or the sheet's own phone
 * layout is not what the creator sees), and "Show" must light the words
 * the creator went to - not the same words earlier in the text. The frame
 * and the sheet in it are checked in a browser (the long-text e2e).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createLongTextPreview,
  findText,
  flashTarget,
  phoneSize,
  PHONE_H,
  PHONE_MAX_H,
  PHONE_MIN_W,
  PHONE_W,
} from "./long-text-preview.js";

describe("phoneSize", () => {
  it("is as tall as the room allows, up to its tallest", () => {
    expect(phoneSize(2000, 600).height).toBeCloseTo(600);
    expect(phoneSize(2000, 2000).height).toBeCloseTo(PHONE_MAX_H);
  });

  it("narrows to the room's width, never under its narrowest", () => {
    expect(phoneSize(250, 760).width).toBeCloseTo(250);
    expect(phoneSize(50, 760).width).toBeCloseTo(PHONE_MIN_W);
    expect(phoneSize(Number.NaN, Number.NaN).width).toBeCloseTo(PHONE_MIN_W);
  });

  it("keeps a phone's shape for any room", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 4000, noNaN: true }),
        fc.double({ min: -100, max: 4000, noNaN: true }),
        (w, h) => {
          const s = phoneSize(w, h);
          expect(s.height / s.width).toBeCloseTo(PHONE_H / PHONE_W, 6);
          expect(s.scale).toBeCloseTo(s.width / PHONE_W, 9);
          expect(s.width).toBeGreaterThanOrEqual(PHONE_MIN_W - 1e-9);
          expect(s.height).toBeLessThanOrEqual(
            Math.max(PHONE_MAX_H, (PHONE_MIN_W * PHONE_H) / PHONE_W) + 1e-9,
          );
        },
      ),
    );
  });
});

describe("flashTarget and findText", () => {
  it("takes a part's first line and counts the same words before it", () => {
    const body = "a <b>x</b>\nmore\n<b>x</b> again <b>x</b>";
    const second = body.indexOf("<b>x</b>", 12);
    expect(flashTarget(body, second, second + 8)).toEqual({
      needle: "<b>x</b>",
      nth: 1,
    });
    expect(flashTarget(body, 3, 3)).toBeNull();
  });

  it("finds the nth place across the formatted text's pieces", () => {
    document.body.innerHTML =
      "<article><p>one <b>two</b> three</p><p>two three</p></article>";
    const article = document.querySelector("article");
    if (article === null) throw new Error("no article");
    const first = findText(article, "two three", 0);
    expect(first?.toString()).toBe("two three");
    expect(first?.startContainer.parentElement?.tagName).toBe("B");
    const second = findText(article, "two three", 1);
    expect(second?.startContainer.parentElement?.tagName).toBe("P");
    expect(findText(article, "absent", 0)).toBeNull();
    // Fewer than asked: the last one there.
    expect(findText(article, "two three", 5)?.startContainer).toBe(
      second?.startContainer,
    );
  });
});

describe("the frame's sheet", () => {
  it("mounts one sheet even when the frame fires load while it is written", () => {
    // Why: Chromium fires the frame's load event inside `document.close()`
    // of the page being written; the load handler re-mounted into that page
    // before it was marked as mounted, and the visitor's sheet stood twice
    // in the phone (found by the long-text e2e, which jsdom alone misses).
    const box = document.createElement("div");
    const inspector = document.createElement("div");
    document.body.replaceChildren(box, inspector);
    const preview = createLongTextPreview({
      document,
      box,
      inspector,
      tree: null,
      loadAsset: () => Promise.reject(new Error("no pictures here")),
      say: () => undefined,
      onOpen: () => undefined,
    });
    const frame = preview.element.querySelector("iframe");
    const page = frame?.contentDocument ?? null;
    if (frame === null || page === null) throw new Error("no frame page");
    const close = page.close.bind(page);
    page.close = () => {
      close();
      frame.dispatchEvent(new Event("load"));
    };
    preview.setOpen(true);
    preview.show(
      { over: "Station 1", title: "The gate", body: "Words." },
      true,
    );
    expect(
      frame.contentDocument?.querySelectorAll('[data-testid="long-text-text"]'),
    ).toHaveLength(1);
    preview.destroy();
  });

  it("names the text's view in its head", () => {
    // Why: the head's view name was fixed to "Reading sign" whatever the
    // text's view.
    const box = document.createElement("div");
    const inspector = document.createElement("div");
    document.body.replaceChildren(box, inspector);
    const preview = createLongTextPreview({
      document,
      box,
      inspector,
      tree: null,
      loadAsset: () => Promise.reject(new Error("no pictures here")),
      say: () => undefined,
      onOpen: () => undefined,
    });
    const name = () => preview.element.querySelector(".lw-vn")?.textContent;
    expect(name()).toBe("Reading sign");
    preview.setView("Reading stand");
    expect(name()).toBe("Reading stand");
    preview.destroy();
  });

  it("follows no link: a tap on one says so instead", () => {
    // Why: outside AR the visitor's sheet lets a link open by itself, so
    // the preview's own "not followed" opener was never reached and a tap
    // left the editor for the linked page.
    const box = document.createElement("div");
    const inspector = document.createElement("div");
    document.body.replaceChildren(box, inspector);
    const said: string[] = [];
    const preview = createLongTextPreview({
      document,
      box,
      inspector,
      tree: null,
      loadAsset: () => Promise.reject(new Error("no pictures here")),
      say: (text) => said.push(text),
      onOpen: () => undefined,
    });
    preview.setOpen(true);
    preview.show(
      {
        over: "Station 1",
        title: "The gate",
        body: "See [the museum](https://example.com/museum).",
      },
      true,
    );
    const link =
      preview.element
        .querySelector("iframe")
        ?.contentDocument?.querySelector("a[href]") ?? null;
    if (link === null) throw new Error("no link in the sheet");
    const tap = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(tap);
    expect(tap.defaultPrevented).toBe(true);
    expect(said).toEqual([
      "Links open in the visitor's browser; not followed in the preview.",
    ]);
    preview.destroy();
  });
});
