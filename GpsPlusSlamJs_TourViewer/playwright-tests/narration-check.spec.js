// @ts-check
import { expect, test } from "@playwright/test";

/** The check page's voice credit (`CHECK_VOICE_CREDIT` in
 *  `src/checks/long-text-check.ts`). */
const CHECK_VOICE_CREDIT =
  "Demo narration: a generated tone pattern standing in for a recorded voice";

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
 *   name starts the first line, the synthetic voice's disclosure and its
 *   credit right after it, then the first words; the scrollbar's thumb
 *   sits where the scroll is; and it lights the voice's word.
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
    // The box fades in: measure it where it comes to rest (the name's
    // breathing while the voice plays never finishes, and moves nothing).
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (a) =>
            a.playState === "finished" ||
            a.effect?.getTiming().iterations === Infinity,
        ),
    );
    const { k, segments } = await demo(page);
    const v = await voice(page);
    const p = v.captionParts;
    const want = expectedBox(viewport);
    for (const name of [
      "box",
      "win",
      "col",
      "who",
      "disc",
      "firstWord",
      "sbar",
      "thumb",
    ]) {
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
    // The thumb: its share of the 62 px track is the share of the lines
    // shown (never under 14 px), its place the share scrolled.
    const lines = v.captions?.lines ?? 0;
    const track = want.rows * want.lineHeight - 4;
    const thumbH = Math.max(14, (track * want.rows) / lines);
    const scrolled = Math.min(
      1,
      Math.max(0, (v.captions?.scroll ?? 0) / (lines - want.rows)),
    );
    near(p.thumb.bottom - p.thumb.top, thumbH);
    near(p.thumb.top - p.sbar.top, scrolled * (track - thumbH));
    // The intended differences from the prototype: the speaker's name is
    // not a line of its own but starts the words, on their first line,
    // and the synthetic voice's disclosure and credit follow it there.
    near(p.who.left, p.col.left);
    // The disclosure is smaller type on the name's baseline, so its box
    // starts lower: "the same line" is within half a line height.
    const sameLine = (a, b) => Math.abs(a - b) < want.lineHeight / 2;
    expect(sameLine(p.disc.top, p.who.top)).toBe(true);
    await expect(page.getByTestId("narration-box-who")).toHaveText("Narrator");
    await expect(page.getByTestId("narration-box-disclosure")).toHaveText(
      ` · synthetic voice · ${CHECK_VOICE_CREDIT}`,
    );
    // The first words run on right after it: on the disclosure's last
    // line, or at the start of the next one when they do not fit there.
    const discEnd = await page
      .getByTestId("narration-box-disclosure")
      .evaluate((el) => {
        const r = [...el.getClientRects()].at(-1);
        return r === undefined ? null : { top: r.top, right: r.right };
      });
    if (discEnd === null) throw new Error("the disclosure has no box");
    // Where the browser put every part, line by line.
    const laid = await page.getByTestId("narration-box").evaluate((box) => {
      const top = (el) => el.getBoundingClientRect().top;
      const who = box.querySelector(".nb-col .nb-who");
      const disc = box.querySelector(".nb-col .nb-disc");
      const rects = disc === null ? [] : [...disc.getClientRects()];
      return {
        who: who === null ? null : top(who),
        discFirstLeft: rects[0]?.left ?? null,
        discTops: rects.map((r) => r.top),
        wordTops: [...box.querySelectorAll(".nb-col .nb-w")].map(top),
      };
    });
    if (laid.who === null || laid.discFirstLeft === null) {
      throw new Error("the name or the disclosure has no box");
    }
    // The disclosure starts right after the name, on its line.
    expect(laid.discFirstLeft).toBeGreaterThanOrEqual(p.who.right - 0.5);
    // Every word sits on the 22 px grid the scroll moves by: smaller type
    // on the first line must not make it taller.
    for (const wordTop of laid.wordTops) {
      const off = (wordTop - laid.who) / want.lineHeight;
      near(off * want.lineHeight, Math.round(off) * want.lineHeight, 1);
    }
    // The box counts every line, the ones only the name and its
    // disclosure take too, so the last line can scroll into view.
    const lineOf = (top) => Math.round((top - laid.who) / want.lineHeight);
    const drawnLines = new Set(
      [laid.who, ...laid.discTops, ...laid.wordTops].map(lineOf),
    ).size;
    expect(v.captions?.lines).toBe(drawnLines);
    if (sameLine(p.firstWord.top, discEnd.top)) {
      expect(p.firstWord.left).toBeGreaterThanOrEqual(discEnd.right - 0.5);
    } else {
      near(p.firstWord.top, discEnd.top + want.lineHeight, want.lineHeight / 2);
      near(p.firstWord.left, p.col.left);
    }
    // The demo's word is lit, and follows the voice.
    expect(v.captions?.word).toBe(segments[k].text);
    await page.evaluate(
      (at) => window.__longTextCheck?.at(at),
      segments[k + 1].startMs + 10,
    );
    expect((await voice(page)).captions?.word).toBe(segments[k + 1].text);
    // At the start of the voice the box opens on the name and its
    // disclosure, even when a long credit puts the first words lower.
    await page.evaluate(() => window.__longTextCheck?.at(0));
    await page.waitForFunction(
      () => window.__longTextCheck?.voice()?.captions?.scroll === 0,
    );
    const opening = await voice(page);
    if (opening.captionParts.who === null) throw new Error("no name drawn");
    expect(opening.captionParts.who.top).toBeGreaterThanOrEqual(
      opening.captionParts.win.top - 0.5,
    );
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

/**
 * Why these tests matter: the read line (the line holding the lit word,
 * or the first word before any is lit) must never leave the box's window
 * while the words are dragged, and the voice must go on from a line the
 * visitor can see. A drag far past either end once pushed the words on
 * (0.3 of the finger, without limit) until the read line was out of the
 * window, and the release left the voice reading words nobody could see.
 * Sampled after every frame of the gesture and of the settle after it,
 * for touch and mouse, slow (4 px a step) and fast (60 px a step), by
 * 600 px past either end from mid-text, and from either end back into
 * the text. Tolerance: 1 px, sub-pixel layout only (a word that left the
 * window by a line is 22 px out).
 */
const IN_VIEW_SLACK_PX = 1;

/** Where the read line and the voice's line are against the window. */
async function readLine(page) {
  return page.evaluate((slack) => {
    // A missing page hook or box throws here, and fails the test.
    const check = window.__longTextCheck;
    const box = document.querySelector('[data-testid="narration-box"]');
    const win = box.querySelector(".nb-win").getBoundingClientRect();
    const words = [...box.querySelectorAll(".nb-col .nb-w")];
    const lit = box.querySelectorAll(".nb-col .nb-w.nb-on");
    const read = lit.length > 0 ? lit[lit.length - 1] : words[0];
    const v = check.voice();
    const now = v.nowMs;
    const k = check.segments.findLastIndex((s) => s.startMs <= now - 0.001);
    const spoken = words[Math.max(0, k)];
    const at = (el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        inside: r.top >= win.top - slack && r.bottom <= win.bottom + slack,
      };
    };
    return {
      read: at(read),
      spoken: at(spoken),
      win: { top: Math.round(win.top), bottom: Math.round(win.bottom) },
      words: words.length,
      segments: check.segments.length,
      scroll: v.captions.scroll,
      nowMs: now,
    };
  }, IN_VIEW_SLACK_PX);
}

async function frame(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
  );
}

function expectRead(m, where) {
  expect(
    m.read.inside,
    `${where}: read "${m.read.text}" ${m.read.top}-${m.read.bottom} against the window ${m.win.top}-${m.win.bottom}, scroll ${m.scroll}`,
  ).toBe(true);
}

/** After a release: every frame of the settle keeps the read line in
 *  view (unless `eachFrame` is false), and the voice goes on from a line
 *  in view. */
async function expectSettled(page, where, eachFrame = true) {
  let last = null;
  for (let i = 0; i < 240; i += 1) {
    await frame(page);
    const m = await readLine(page);
    if (eachFrame) expectRead(m, `${where}, settling`);
    if (last !== null && m.scroll === last.scroll) break;
    last = m;
  }
  const m = await readLine(page);
  expectRead(m, `${where}, settled`);
  expect(
    m.spoken.inside,
    `${where}: the voice at ${m.nowMs} ms is on "${m.spoken.text}" ${m.spoken.top}-${m.spoken.bottom}, the window ${m.win.top}-${m.win.bottom}`,
  ).toBe(true);
}

/** Puts the voice at `ms` and waits for the box to come to rest there
 *  (a jump of the voice, not a scroll: the box eases after it). */
async function seat(page, ms) {
  await page.evaluate((at) => window.__longTextCheck?.at(at), ms);
  await expectSettled(page, `seated at ${ms} ms`, false);
}

async function winCentre(page) {
  const v = await voice(page);
  const win = v.captionParts.win;
  return { x: (win.left + win.right) / 2, y: (win.top + win.bottom) / 2 };
}

/** The drags every input makes: [name, voice ms or "mid"/"end", dy, step]. */
function drags(total) {
  return [
    ["slow, ahead past the end", "mid", -600, 4],
    ["fast, ahead past the end", "mid", -600, 60],
    ["slow, back past the start", "mid", 600, 4],
    ["fast, back past the start", "mid", 600, 60],
    ["slow, back from the end", total, 120, 3],
    ["slow, ahead from the start", 0, -120, 3],
  ];
}

for (const viewport of VIEWPORTS) {
  for (const input of ["touch", "mouse"]) {
    test(`a ${input} drag keeps the read line in the narration box, slow or fast, past either end (${viewport.name}) @pr`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: input === "touch",
        isMobile: input === "touch",
      });
      const page = await context.newPage();
      const errors = await open(page, "?voice=timed&view=captions", viewport);
      await page.waitForFunction(
        () => window.__longTextCheck?.voice()?.captions?.shown === true,
      );
      const check = await page.evaluate(() => ({
        demoMs: window.__longTextCheck?.demoMs ?? 0,
        total: window.__longTextCheck?.segments.at(-1)?.endMs ?? 0,
      }));
      const first = await readLine(page);
      expect(first.words).toBe(first.segments);
      const cdp = input === "touch" ? await context.newCDPSession(page) : null;
      const touch = (type, x, y) =>
        cdp?.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: type === "touchEnd" ? [] : [{ x, y }],
        });
      for (const [name, from, dy, step] of drags(check.total)) {
        const where = `${input} ${name}`;
        await seat(page, from === "mid" ? check.demoMs : from);
        const { x, y } = await winCentre(page);
        // A finger stays on the screen; a mouse may leave the page
        // while the box holds it.
        const reach =
          input === "touch"
            ? Math.max(-(y - 2), Math.min(dy, viewport.height - 2 - y))
            : dy;
        if (input === "touch") await touch("touchStart", x, y);
        else {
          await page.mouse.move(x, y);
          await page.mouse.down();
        }
        const steps = Math.max(1, Math.round(Math.abs(reach) / step));
        for (let i = 1; i <= steps; i += 1) {
          const ny = y + (reach * i) / steps;
          if (input === "touch") await touch("touchMove", x, ny);
          else await page.mouse.move(x, ny);
          await frame(page);
          expectRead(
            await readLine(page),
            `${where}, ${Math.round(ny - y)} px`,
          );
        }
        if (input === "touch") await touch("touchEnd", x, y + reach);
        else await page.mouse.up();
        expect((await voice(page)).captions?.scrubbing).toBe(false);
        await expectSettled(page, where);
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test(`the wheel and the arrow keys keep the read line in the narration box (${viewport.name}) @pr`, async ({
    page,
  }) => {
    const errors = await open(page, "?voice=timed&view=captions", viewport);
    await page.waitForFunction(
      () => window.__longTextCheck?.voice()?.captions?.shown === true,
    );
    const demoMs = await page.evaluate(() => window.__longTextCheck?.demoMs);
    await seat(page, demoMs ?? 0);
    const { x, y } = await winCentre(page);
    await page.mouse.move(x, y);
    for (const dy of [120, 120, 600, -120, -600, -600]) {
      await page.mouse.wheel(0, dy);
      await frame(page);
      expectRead(await readLine(page), `wheel ${dy}`);
    }
    await expectSettled(page, "wheel");
    const box = page.getByTestId("narration-box");
    await box.focus();
    for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp"]) {
      await page.keyboard.press(key);
      await expectSettled(page, key);
    }
    expect(errors).toEqual([]);
  });
}
