// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: the reading sheet was built from the
 * narrated-text prototype's "sound off" sheet
 * (`public/prototypes/station-blocks-1-narrated-text/`), whose layout the
 * owner chose: a bottom sheet over 63 % of an upright phone, a side panel
 * 42 px from the top held sideways (at most 56 % wide) and a 520 px panel
 * 48 px from the top on a desktop, with the prototype's header, type and
 * footer spacing. The app's design system zeroes paragraph margins, so a
 * port can lose every gap and still pass a test that only asks whether the
 * sheet is visible. These pin positions and gaps, worked out here from the
 * prototype's CSS numbers (not from the code under test), through the
 * check page `long-text-check.html`, and that a real tap on a sentence
 * moves the reading mark there.
 *
 * Not pinned here: how the page looks beyond its boxes (the side-by-side
 * check against the prototype, by eye), and the mark's own look (the
 * Custom Highlight API draws a flat tint, without the prototype's rounded
 * 3 px halo).
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

/** The prototype's sheet box and type at each viewport. */
function expected(viewport) {
  const { width, height } = viewport;
  if (width / height < 0.85) {
    return {
      sheet: { left: 0, right: width, bottom: height, top: height * 0.37 },
      // border 1 + grab 8 + 4, header padding 12
      headTop: 1 + 8 + 4 + 12,
      // the header starts below the grab: 1 + 8 + 4, then 12 px down
      closeTop: 1 + 8 + 4 + 12,
      titleSize: 24,
      textSize: 18.5,
      prevLeft: 87,
    };
  }
  if (height < 520) {
    const w = Math.min(0.56 * width, 520);
    return {
      sheet: {
        left: width - 8 - w,
        right: width - 8,
        top: 42,
        bottom: height - 8,
      },
      headTop: 1 + 12,
      closeTop: 1 + 18,
      titleSize: 18,
      textSize: 17,
      prevLeft: 124.3,
    };
  }
  return {
    sheet: {
      left: width - 18 - 520,
      right: width - 18,
      top: 48,
      bottom: height - 18,
    },
    headTop: 1 + 20,
    closeTop: 1 + 18,
    titleSize: 24,
    textSize: 19.5,
    prevLeft: 148,
  };
}

async function open(page, viewport) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/long-text-check.html");
  await page.waitForFunction(() => window.__longTextCheck?.state().sheet.open);
  // The sheet slides in: measure it where it comes to rest.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState === "finished"),
  );
  return errors;
}

async function state(page) {
  const s = await page.evaluate(() => window.__longTextCheck?.state());
  if (s === undefined) throw new Error("no check page");
  return s;
}

function near(actual, want, slack = 1.5) {
  expect(
    Math.abs(actual - want),
    `${String(actual)} vs ${String(want)}`,
  ).toBeLessThan(slack);
}

for (const viewport of VIEWPORTS) {
  test(`the sheet lands where the prototype put it, with its gaps (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await open(page, viewport);
    const s = await state(page);
    const want = expected(viewport);
    const p = s.parts;
    if (
      p.sheet === null ||
      p.over === null ||
      p.title === null ||
      p.meta === null ||
      p.close === null ||
      p.wrap === null ||
      p.foot === null ||
      p.prev === null ||
      p.next === null ||
      p.position === null ||
      p.credit === null ||
      s.firstParagraph === null
    ) {
      throw new Error(`a part is not drawn: ${JSON.stringify(p)}`);
    }
    for (const side of ["left", "right", "top", "bottom"]) {
      near(p.sheet[side], want.sheet[side]);
    }
    // The header: the line above the title at its padding, the title 7 px
    // below it, the line under the title 6 px below that.
    near(p.over.top - p.sheet.top, want.headTop);
    near(p.over.left - p.sheet.left, 1 + 24);
    const titleGap = want.titleSize === 18 ? 4 : 7;
    near(p.title.top - p.over.bottom, titleGap);
    near(p.meta.top - p.title.bottom, want.titleSize === 18 ? 2 : 6);
    // The close button: 36 px round, 14 px in from the right edge.
    near(p.close.right, p.sheet.right - 1 - 14);
    near(p.close.top - p.sheet.top, want.closeTop);
    near(p.close.right - p.close.left, 36);
    // The text: the prototype's serif size and 1.62 line height, its
    // first paragraph 14 px into the scrolling area and 24 px in.
    expect(s.fontSize).toBe(want.textSize);
    near(s.lineHeight, want.textSize * 1.62, 0.05);
    near(s.firstParagraph.top - p.wrap.top, 14);
    near(s.firstParagraph.left - p.sheet.left, 1 + 24);
    // Paragraphs 1.05 em apart (the design system zeroes this margin).
    near(s.paragraphGap ?? -1, want.textSize * 1.05, 1);
    // The footer at the bottom; the previous and next buttons 46 px round
    // either side of the readout.
    near(p.foot.bottom, p.sheet.bottom - 1);
    near(p.prev.right - p.prev.left, 46);
    near(p.position.left - p.prev.right, 6);
    near(p.next.left - p.position.right, 6);
    // Where the prototype puts them (measured on its page: the row's
    // space-between leaves the group a little right of the middle).
    near(p.prev.left - p.sheet.left, want.prevLeft);
    expect(p.credit.top).toBeGreaterThan(p.prev.bottom);
    expect(errors).toEqual([]);
  });
}

test("a tap on a sentence moves the mark there; the buttons step it; close shuts the sheet", async ({
  page,
}) => {
  const errors = await open(page, VIEWPORTS[0]);
  expect((await state(page)).highlightRegistered).toBe(true);
  // Where the second sentence is drawn.
  await page.evaluate(() => window.__longTextCheck?.goTo(1));
  const second = await page.evaluate(() => window.__longTextCheck?.markRect());
  await page.evaluate(() => window.__longTextCheck?.goTo(0));
  if (second === null || second === undefined) throw new Error("no mark");
  await page.mouse.click(second.left + 6, (second.top + second.bottom) / 2);
  expect((await state(page)).sheet.sentence).toBe(1);
  await page.getByTestId("long-text-next").click();
  expect((await state(page)).sheet.sentence).toBe(2);
  await expect(page.getByTestId("long-text-position")).toHaveText(
    /^Sentence 3 of \d+$/,
  );
  await page.getByTestId("long-text-close").click();
  await expect(page.getByTestId("long-text-sheet")).toBeHidden();
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: a long text's body is the one place a tour file
 * puts structure of its own into the page, and in AR a link would take
 * the visitor out of the session. Through the check page's rich text
 * (headings, a nested list, a link and two pictures from the tour's own
 * files, `?text=rich&ar=1`), this pins in a real browser what the unit
 * tests can only pin in jsdom: a picture is decoded into an object URL
 * once it is scrolled near, a link tapped during an AR session asks first
 * and opens nothing before the answer, and the sheet holds only the
 * elements the allowlist names: the design's list plus the alt box's
 * `span` (the recorded deviation), copied here, not from the renderer.
 */
const DESIGN_ALLOWLIST = [
  "p",
  "h3",
  "h4",
  "h5",
  "ul",
  "ol",
  "li",
  "blockquote",
  "em",
  "strong",
  "a",
  "img",
  "br",
  "span",
];

test("a rich text: pictures load when scrolled near, a link asks before it leaves AR, only allowlisted tags", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  const popups = /** @type {string[]} */ ([]);
  page.on("popup", (popup) => popups.push(popup.url()));
  await page
    .context()
    .route("https://town.example/**", (route) =>
      route.fulfill({ status: 200, body: "a page", contentType: "text/plain" }),
    );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/long-text-check.html?text=rich&ar=1");
  await page.waitForFunction(() => window.__longTextCheck?.state().sheet.open);
  const text = page.getByTestId("long-text-text");
  const pictures = text.locator('img[src^="blob:"]');
  // The pictures stand far below the first screen: not decoded yet.
  await expect(text.locator("h3")).toHaveCount(1);
  await expect(text.locator("h4")).toHaveCount(1);
  await expect(text.locator("ul li ul li")).toHaveCount(2);
  await expect(pictures).toHaveCount(0);

  // Scrolled to each, it comes in as an object URL of the tour's file
  // (only pictures within a screen of the view are decoded, so the mill is
  // let go again by the time the bell, far below it, is reached).
  for (const alt of ["The mill", "The bell"]) {
    // The alt box is still standing before the scroll: the picture was not
    // decoded while it was far away.
    const found = await page
      .getByTestId("long-text-wrap")
      .evaluate((wrap, want) => {
        const box = [...wrap.querySelectorAll("p > span")].find(
          (s) => s.textContent === want,
        );
        box?.scrollIntoView({ block: "center" });
        return box !== undefined;
      }, alt);
    expect(found, `the alt box of "${alt}" before scrolling`).toBe(true);
    const shown = text.locator(`img[src^="blob:"][alt="${alt}"]`);
    await expect(shown).toHaveCount(1);
    await expect(shown).toBeVisible();
  }
  // The mill stands more than the release distance (two screens) above
  // the bell, so with the bell in view it is let go again: its picture is
  // gone and its alt box back.
  const millAway = await page.getByTestId("long-text-wrap").evaluate((wrap) => {
    const view = wrap.getBoundingClientRect();
    const mill = [...wrap.querySelectorAll("p > span, p > img")].find(
      (e) =>
        e.textContent === "The mill" || e.getAttribute("alt") === "The mill",
    );
    if (mill === undefined) return -1;
    return (view.top - mill.getBoundingClientRect().bottom) / view.height;
  });
  expect(millAway).toBeGreaterThan(2.2);
  await expect(text.locator('img[alt="The mill"]')).toHaveCount(0);

  const tags = await text.evaluate((root) => [
    ...new Set([...root.querySelectorAll("*")].map((e) => e.localName)),
  ]);
  expect(tags.filter((t) => !DESIGN_ALLOWLIST.includes(t))).toEqual([]);
  for (const t of ["h3", "h4", "ul", "li", "a", "img", "strong"]) {
    expect(tags).toContain(t);
  }

  // A link tapped in AR: the question, and nothing opened before it.
  const ask = page.getByTestId("long-text-ask");
  await expect(ask).toBeHidden();
  await text.locator("a").first().click();
  await expect(ask).toBeVisible();
  await expect(ask).toContainText(
    "Open town.example? You may lose your place in the AR view.",
  );
  expect(popups).toEqual([]);
  expect(await page.evaluate(() => window.__longTextCheck?.opened())).toEqual(
    [],
  );
  expect(page.url()).toContain("/long-text-check.html");

  // "Stay" opens nothing; a second tap and "Open" opens the page once.
  await ask.getByRole("button", { name: "Stay" }).click();
  await expect(ask).toBeHidden();
  expect(await page.evaluate(() => window.__longTextCheck?.opened())).toEqual(
    [],
  );
  await text.locator("a").first().click();
  const popup = page.waitForEvent("popup");
  await ask.getByRole("button", { name: "Open" }).click();
  await popup;
  expect(await page.evaluate(() => window.__longTextCheck?.opened())).toEqual([
    "https://town.example/map",
  ]);
  expect(popups).toHaveLength(1);
  expect(errors).toEqual([]);
});
