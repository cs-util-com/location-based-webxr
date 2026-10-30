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
