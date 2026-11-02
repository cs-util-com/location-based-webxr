// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why these tests matter: a narrated text is read along in two places,
 * the reading sheet and the captions strip, and both are driven by a
 * timing file checked against the text it was made for. In a real
 * browser (the Custom Highlight API, layout, the frame loop) these pin
 * through the check page `long-text-check.html?voice=...`:
 * - the sheet marks the sentence and the word the voice is at, and moves
 *   with it;
 * - a stale timing gives plain text with the voice, and says nothing about
 *   it to the visitor;
 * - a timing is read only when its text opens, and once;
 * - the captions strip lands where the narrated-text prototype put it
 *   (`public/prototypes/station-blocks-1-narrated-text/`, its `#caption`
 *   CSS numbers, copied here, not from the code under test), with its
 *   gaps, at a phone upright, a phone sideways and a desktop, and marks
 *   the voice's word.
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

/** The prototype's `#caption` box and type at each viewport. */
function expectedStrip(viewport) {
  const { width, height } = viewport;
  if (width / height < 0.85) {
    return {
      left: 10,
      right: width - 10,
      bottom: height - 16,
      pad: { top: 15, side: 18, bottom: 10 },
      textSize: 22,
      lines: 3,
      play: 44,
    };
  }
  if (height < 520) {
    const w = Math.min(660, 0.8 * width);
    return {
      left: (width - w) / 2,
      right: (width + w) / 2,
      bottom: height - 8,
      pad: { top: 11, side: 16, bottom: 7 },
      textSize: 19,
      lines: 2,
      play: 48,
    };
  }
  return {
    left: (width - 780) / 2,
    right: (width + 780) / 2,
    bottom: height - 26,
    pad: { top: 20, side: 26, bottom: 12 },
    textSize: 27,
    lines: 2,
    play: 44,
  };
}

for (const viewport of VIEWPORTS) {
  test(`the captions strip lands where the prototype put it, with its gaps, and marks the word (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await open(page, "?voice=timed&view=captions", viewport);
    await page.waitForFunction(
      () => window.__longTextCheck?.voice()?.captions?.shown === true,
    );
    // The strip fades in: measure it where it comes to rest.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState === "finished"),
    );
    const { k, segments } = await demo(page);
    const v = await voice(page);
    const p = v.captionParts;
    const want = expectedStrip(viewport);
    for (const name of [
      "strip",
      "text",
      "row",
      "play",
      "back",
      "title",
      "sub",
      "full",
      "bar",
    ]) {
      if (p[name] === null) throw new Error(`the strip's ${name} is not drawn`);
    }
    near(p.strip.left, want.left);
    near(p.strip.right, want.right);
    near(p.strip.bottom, want.bottom);
    // The text inside the padding (and the 1 px border), at least as
    // tall as its lines.
    near(p.text.top - p.strip.top, 1 + want.pad.top);
    near(p.text.left - p.strip.left, 1 + want.pad.side);
    near(p.strip.right - p.text.right, 1 + want.pad.side);
    expect(p.text.bottom - p.text.top).toBeGreaterThan(
      want.textSize * 1.33 * want.lines - 0.5,
    );
    // The controls 10 px below the text, the bar 9 px below them, the
    // padding under the bar.
    near(p.row.top - p.text.bottom, 10);
    near(p.play.right - p.play.left, want.play);
    near(p.back.right - p.back.left, 40);
    near(p.back.left - p.play.right, 8);
    near(p.full.bottom - p.full.top, 34);
    near(p.strip.right - 1 - want.pad.side, p.full.right);
    near(p.bar.top - p.row.bottom, 9);
    near(p.bar.bottom - p.bar.top, 3);
    near(p.strip.bottom - p.bar.bottom, want.pad.bottom + 1);
    // The demo's word is marked, and the chunk holds it.
    expect(v.captions?.word).toBe(segments[k].text);
    expect(v.captions?.chunk).toContain(segments[k].text);
    await expect(page.getByTestId("captions-title")).toHaveText(
      "The Guild House and the Burnt Hall",
    );
    await expect(page.getByTestId("captions-sub")).toContainText(
      "Synthetic voice",
    );
    // The word follows the voice.
    await page.evaluate(
      (at) => window.__longTextCheck?.at(at),
      segments[k + 1].startMs + 10,
    );
    expect((await voice(page)).captions?.word).toBe(segments[k + 1].text);
    expect(errors).toEqual([]);
  });
}

test("captions with a stale track show nothing, and Full text opens the sheet", async ({
  page,
}) => {
  const errors = await open(page, "?voice=stale&view=captions");
  await page.waitForFunction(
    () => window.__longTextCheck?.voice()?.verdict === "stale",
  );
  expect((await voice(page)).captions?.shown).toBe(false);
  await expect(page.getByTestId("captions-strip")).toHaveClass(/cs-hide/u);

  // With a timing that fits, "Full text" opens the sheet, reading along.
  await page.goto("/long-text-check.html?voice=timed&view=captions");
  await page.waitForFunction(
    () => window.__longTextCheck?.voice()?.captions?.shown === true,
  );
  await page.getByTestId("captions-full").click();
  await page.waitForFunction(
    () => window.__longTextCheck?.state().sheet.mode === "live",
  );
  expect((await sheet(page)).sentence).toBe(2);
  expect(errors).toEqual([]);
});
