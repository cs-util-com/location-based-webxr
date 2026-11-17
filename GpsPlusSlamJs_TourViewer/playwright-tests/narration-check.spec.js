// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why these tests matter: a narrated text is read along in two places,
 * the reading sheet and the narration box, and both are driven by a
 * timing file checked against the text it was made for. In a real
 * browser (the Custom Highlight API, layout, the frame loop) these pin
 * through the check page `long-text-check.html?voice=...`:
 * - the sheet marks the sentence and the word the voice is at, and moves
 *   with it;
 * - a stale timing gives plain text with the voice, and says nothing about
 *   it to the visitor;
 * - a timing is read only when its text opens, and once;
 * - the narration box lands where the scroll box prototype put it
 *   (`public/prototypes/hud-calm-r5-1-scroll-box/`, its `.nbox` CSS
 *   numbers, copied here, not from the code under test), with its gaps,
 *   at a phone upright, a phone sideways and a desktop; the speaker's
 *   name starts the first line, on the same line as the first words; and
 *   it lights the voice's word.
 * The page's clock stands still until moved (no sound plays), so what is
 * pinned is the read-along against a known time, not the audio itself.
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

async function open(page, query, viewport = VIEWPORTS[0]) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto(`/long-text-check.html${query}`);
  await page.waitForFunction(() => window.__longTextCheck?.voice() != null);
  return errors;
}

async function voice(page) {
  const v = await page.evaluate(() => window.__longTextCheck?.voice());
  if (v === undefined || v === null) throw new Error("no voice on the page");
  return v;
}

async function sheet(page) {
  const s = await page.evaluate(() => window.__longTextCheck?.state().sheet);
  if (s === undefined) throw new Error("no check page");
  return s;
}

/** The segment the demo position is in, and the one a sentence later. */
async function demo(page) {
  return page.evaluate(() => {
    const check = window.__longTextCheck;
    if (check === undefined) throw new Error("no check page");
    const k = check.segments.findIndex((s) => s.startMs === check.demoMs - 60);
    return { k, ms: check.demoMs, segments: check.segments };
  });
}

function near(actual, want, slack = 1.5) {
  expect(
    Math.abs(actual - want),
    `${String(actual)} vs ${String(want)}`,
  ).toBeLessThan(slack);
}

test("a narrated text reads along in the sheet: the sentence and the word the voice is at", async ({
  page,
}) => {
  const errors = await open(page, "?voice=timed");
  await page.waitForFunction(
    () => window.__longTextCheck?.state().sheet.mode === "live",
  );
  const { k, ms, segments } = await demo(page);
  expect(k).toBeGreaterThan(6);
  await page.evaluate((at) => window.__longTextCheck?.at(at), ms);
  let s = await sheet(page);
  // The prototype's demo: the third sentence, its seventh word.
  expect(s.sentence).toBe(2);
  expect((await voice(page)).wordText).toBe(segments[k].text);
  const sentenceBox = await page.evaluate(() =>
    window.__longTextCheck?.voiceRect(),
  );
  const wordBox = await page.evaluate(() => window.__longTextCheck?.wordRect());
  expect(sentenceBox).not.toBeNull();
  expect(wordBox).not.toBeNull();
  // The voice moves on: the word follows it, then the sentence.
  await page.evaluate(
    (at) => window.__longTextCheck?.at(at),
    segments[k + 1].startMs + 10,
  );
  expect((await voice(page)).wordText).toBe(segments[k + 1].text);
  const sentences = await page.evaluate(
    () => window.__longTextCheck?.state().sheet.sentences,
  );
  expect(sentences).toBeGreaterThan(4);
  const later = segments.findLast((seg) => seg.startMs < ms + 20_000);
  await page.evaluate((at) => window.__longTextCheck?.at(at), later.startMs);
  s = await sheet(page);
  expect(s.sentence).toBeGreaterThan(2);
  expect((await voice(page)).wordText).toBe(later.text);
  // The voice's controls, and no reading-mark readout of the silent sheet.
  await expect(page.getByTestId("long-text-play")).toBeVisible();
  await expect(page.getByTestId("long-text-back")).toBeVisible();
  await expect(page.getByTestId("long-text-position")).toBeHidden();
  await expect(page.getByTestId("long-text-credit")).toContainText(
    "Synthetic voice",
  );
  expect(errors).toEqual([]);
});

test("a stale track shows plain text with the voice, and no notice", async ({
  page,
}) => {
  const errors = await open(page, "?voice=stale");
  await page.waitForFunction(
    () => window.__longTextCheck?.voice()?.verdict === "stale",
  );
  const s = await sheet(page);
  expect(s.mode).toBe("plain");
  expect(s.marked).toBe(false);
  expect(s.word).toBeNull();
  expect(await page.evaluate(() => window.__longTextCheck?.voiceRect())).toBe(
    null,
  );
  expect(await page.evaluate(() => window.__longTextCheck?.markRect())).toBe(
    null,
  );
  // The voice still plays.
  await expect(page.getByTestId("long-text-play")).toBeVisible();
  // Nothing on the page tells the visitor the read-along is off.
  const said = await page.locator("body").innerText();
  expect(said).not.toMatch(
    /stale|timing|read-along|may differ|captions are off/iu,
  );
  // The reason goes where the app sends it (the console), not on screen.
  expect((await voice(page)).warnings.join(" ")).toMatch(/text changed/u);
  expect(errors).toEqual([]);
});

test("a timing is read only when its text opens, and once", async ({
  page,
}) => {
  const errors = await open(page, "?voice=timed&open=0");
  let v = await voice(page);
  expect(v.timingReads).toBe(0);
  expect(v.verdict).toBe("unread");
  await page.evaluate(() => window.__longTextCheck?.show());
  await page.waitForFunction(
    () => window.__longTextCheck?.state().sheet.mode === "live",
  );
  expect((await voice(page)).timingReads).toBe(1);
  await page.getByTestId("long-text-close").click();
  await page.evaluate(() => window.__longTextCheck?.show());
  await page.waitForFunction(
    () => window.__longTextCheck?.state().sheet.mode === "live",
  );
  v = await voice(page);
  expect(v.timingReads).toBe(1);
  expect(v.verdict).toBe("live");
  expect(errors).toEqual([]);
});

/** The scroll box prototype's `.nbox` at each viewport, for a text
 *  longer than three lines: as wide as it may be (80 % of the width, at
 *  most 720 px), centred, 18 px over the bottom (10 px on a phone
 *  sideways), padding 9 / 10 / 11 / 14 inside a 1 px border, a window of
 *  three 22 px lines, a 3 px scrollbar at its right edge. */
function expectedBox(viewport) {
  const { width, height } = viewport;
  const w = Math.min(0.8 * width, 720);
  const sideways = width > height && height <= 520;
  return {
    left: (width - w) / 2,
    right: (width + w) / 2,
    bottom: height - (sideways ? 10 : 18),
    pad: { top: 9, right: 10, bottom: 11, left: 14 },
    rows: 3,
    lineHeight: 22,
    bar: 3,
  };
}

for (const viewport of VIEWPORTS) {
  test(`the narration box lands where the prototype put it, with its gaps, the name on the first line, and lights the word (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await open(page, "?voice=timed&view=captions", viewport);
    await page.waitForFunction(
      () => window.__longTextCheck?.voice()?.captions?.shown === true,
    );
    // The box fades in: measure it where it comes to rest.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState === "finished"),
    );
    const { k, segments } = await demo(page);
    const v = await voice(page);
    const p = v.captionParts;
    const want = expectedBox(viewport);
    for (const name of ["box", "win", "col", "who", "firstWord", "sbar"]) {
      if (p[name] === null) throw new Error(`the box's ${name} is not drawn`);
    }
    near(p.box.left, want.left);
    near(p.box.right, want.right);
    near(p.box.bottom, want.bottom);
    // The window inside the padding and the 1 px border, three lines high.
    near(p.win.top - p.box.top, 1 + want.pad.top);
    near(p.win.left - p.box.left, 1 + want.pad.left);
    near(p.box.right - p.win.right, 1 + want.pad.right);
    near(p.box.bottom - p.win.bottom, 1 + want.pad.bottom);
    near(p.win.bottom - p.win.top, want.rows * want.lineHeight);
    expect(v.captions?.rows).toBe(want.rows);
    expect(v.captions?.lines).toBeGreaterThan(want.rows);
    // The scrollbar at the window's right edge, 2 px in from top and bottom.
    near(p.sbar.right, p.win.right);
    near(p.sbar.right - p.sbar.left, want.bar);
    near(p.sbar.top - p.win.top, 2);
    near(p.win.bottom - p.sbar.bottom, 2);
    // The one intended difference from the prototype: the speaker's name
    // is not a line of its own but starts the words, on their first line.
    near(p.who.top, p.firstWord.top, 3);
    expect(p.who.right).toBeLessThanOrEqual(p.firstWord.left + 0.5);
    near(p.who.left, p.col.left);
    await expect(page.getByTestId("narration-box-who")).toHaveText("Narrator");
    // The demo's word is lit, and follows the voice.
    expect(v.captions?.word).toBe(segments[k].text);
    await page.evaluate(
      (at) => window.__longTextCheck?.at(at),
      segments[k + 1].startMs + 10,
    );
    expect((await voice(page)).captions?.word).toBe(segments[k + 1].text);
    expect(errors).toEqual([]);
  });
}

test("a narrated text with a stale track shows no box", async ({ page }) => {
  const errors = await open(page, "?voice=stale&view=captions");
  await page.waitForFunction(
    () => window.__longTextCheck?.voice()?.verdict === "stale",
  );
  expect((await voice(page)).captions?.shown).toBe(false);
  await expect(page.getByTestId("narration-box")).toHaveClass(/nb-off/u);
  expect(errors).toEqual([]);
});
