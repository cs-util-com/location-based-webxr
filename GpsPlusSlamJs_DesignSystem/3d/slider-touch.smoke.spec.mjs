// @ts-check
/**
 * Touch gestures on the look-dev control plate's sliders (owner report
 * 2026-09-30): swiping the plate to scroll it, with the finger starting on a
 * slider, changed that slider's value.
 *
 * Why this file matters: the look-dev plate is the representative page for
 * every demo page that puts range inputs in a scrolling panel. Chromium moves
 * a range input's thumb to the finger on `touchstart`, before any scroll
 * intent exists, and locks its own drag direction on the first `touchmove`
 * with no threshold (`SliderContainerElement::HandleTouchEvent`). jsdom has
 * neither behaviour, so only a real touch pipeline can show the bug and its
 * fix: these gestures go through CDP `Input.dispatchTouchEvent`, which runs
 * the browser's own gesture detection, `touch-action` and scrolling.
 *
 * The fix is the framework's `utils/slider-scroll-guard` (`guardSlidersIn`),
 * installed by `panel.js`. Every other slider page is held to loading it by
 * the root repo-config test `slider-pages-load-the-guard.test.js`.
 *
 * Not a phone: headless Chromium with touch emulation. iOS Safari, which only
 * drags from the thumb, is not covered here.
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

/** The first slider of the plate: in view at phone size, with room below. */
const SLIDER = "#elevation";
const BODY = "#lookdev-body";

/** Pixels per synthetic move; small enough to look like a finger's stream. */
const STEP_PX = 12;
const STEPS = 14;

/** Open the plate before load: a phone-width screen starts it folded. */
async function openPlate(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("lookdev.panel", "open");
    } catch {
      // Storage refused: the test clicks the header instead (below).
    }
  });
}

/**
 * Counts the `input`/`change` events that reach the slider itself, which is
 * where the page's own listeners sit, records how long the last press lasted
 * (pointerdown to pointerup, event timestamps), and brings the slider into
 * view with room to scroll below it.
 */
async function prepare(page) {
  await page.evaluate(
    ({ slider, body }) => {
      const input = /** @type {HTMLInputElement} */ (
        document.querySelector(slider)
      );
      const panel = /** @type {HTMLElement} */ (document.querySelector(body));
      const seen = { input: 0, change: 0, downAt: NaN, pressMs: NaN };
      input.addEventListener("input", () => (seen.input += 1));
      input.addEventListener("change", () => (seen.change += 1));
      input.addEventListener("pointerdown", (e) => (seen.downAt = e.timeStamp));
      input.addEventListener(
        "pointerup",
        (e) => (seen.pressMs = e.timeStamp - seen.downAt),
      );
      // @ts-ignore test-only probe
      window.__sliderSeen = seen;
      panel.scrollTop = 0;
    },
    { slider: SLIDER, body: BODY },
  );
  await expect(page.locator(BODY)).toBeVisible();
  const box = await page.locator(SLIDER).boundingBox();
  if (!box) throw new Error("slider has no box");
  return box;
}

/** A point on the slider's track far from its thumb, so a jump would show. */
async function farPoint(page, box) {
  const fraction = await page.evaluate((sel) => {
    const input = /** @type {HTMLInputElement} */ (document.querySelector(sel));
    const min = Number(input.min);
    const max = Number(input.max);
    return (Number(input.value) - min) / (max - min);
  }, SLIDER);
  const target = fraction < 0.5 ? 0.85 : 0.15;
  return { x: box.x + box.width * target, y: box.y + box.height / 2 };
}

async function state(page) {
  return page.evaluate(
    ({ slider, body }) => ({
      value: /** @type {HTMLInputElement} */ (document.querySelector(slider))
        .value,
      scrollTop: /** @type {HTMLElement} */ (document.querySelector(body))
        .scrollTop,
      // @ts-ignore test-only probe
      seen: { ...window.__sliderSeen },
    }),
    { slider: SLIDER, body: BODY },
  );
}

/**
 * One finger along `points` through the browser's real touch pipeline. The
 * value is read after every move, so a change the page undoes later still
 * counts.
 */
async function touchPath(page, cdp, points) {
  const [first, ...rest] = points;
  const values = [];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: first.x, y: first.y, id: 1 }],
  });
  values.push((await state(page)).value);
  for (const p of rest) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: p.x, y: p.y, id: 1 }],
    });
    values.push((await state(page)).value);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  values.push((await state(page)).value);
  return values;
}

/**
 * A tap whose two events carry timestamps `ms` apart, as a finger's would.
 * Without them the gap is CDP's round trip through a main thread busy
 * rendering on the CPU: 0.6-1.1 s measured (2026-09-30), a slow press by the
 * guard's rule, which it discards on purpose.
 */
async function tap(cdp, point, ms = 80) {
  const t0 = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y, id: 1 }],
    timestamp: t0,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: t0 + ms / 1000,
  });
}

/**
 * A swipe of the finger UP the screen (the panel scrolls down), leaning
 * `angleDeg` off vertical. `firstMove` overrides the first step, to model a
 * finger whose first few pixels go sideways.
 */
function swipeUp(start, angleDeg, firstMove = null) {
  const lean = Math.tan((angleDeg * Math.PI) / 180);
  const points = [start];
  let { x, y } = start;
  for (let i = 0; i < STEPS; i++) {
    const step =
      i === 0 && firstMove ? firstMove : { dx: STEP_PX * lean, dy: -STEP_PX };
    x += step.dx;
    y += step.dy;
    points.push({ x, y });
  }
  return points;
}

test.describe("on a touch screen", () => {
  test.use({
    viewport: { width: 390, height: 780 },
    hasTouch: true,
    isMobile: true,
  });

  test.beforeEach(async ({ page }) => {
    await openPlate(page);
    await boot(page);
    if (await page.locator(BODY).isHidden()) {
      await page.locator(".lookdev-head").click();
    }
  });

  test("a vertical swipe that starts on a slider scrolls the plate and leaves the value alone", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    const box = await prepare(page);
    const start = await farPoint(page, box);
    const before = await state(page);

    const values = await touchPath(page, cdp, swipeUp(start, 5));

    await expect
      .poll(async () => (await state(page)).scrollTop)
      .toBeGreaterThan(before.scrollTop);
    const after = await state(page);
    expect(values.every((v) => v === before.value)).toBe(true);
    expect(after.value).toBe(before.value);
    expect(after.seen.input).toBe(0);
  });

  test("a swipe whose first pixels go sideways is still a scroll", async ({
    page,
  }) => {
    // Why this test matters: Blink locks the slider's own direction on the
    // first touchmove it sees, with no threshold, so a swipe that starts
    // sideways is the case most likely to edit. Measured 2026-09-30 in this
    // browser WITHOUT the guard: only the touch-down jump happened; the 11
    // touchmoves after the pointercancel wrote nothing (a 3 px twitch is
    // probably inside the browser's touch slop and never reaches Blink). The
    // guard's hold until touchend is therefore a defence this run does not
    // prove necessary; this test pins that the case stays a scroll.
    const cdp = await page.context().newCDPSession(page);
    const box = await prepare(page);
    const start = await farPoint(page, box);
    const before = await state(page);

    const values = await touchPath(
      page,
      cdp,
      swipeUp(start, 20, { dx: 3, dy: -1 }),
    );

    await expect
      .poll(async () => (await state(page)).scrollTop)
      .toBeGreaterThan(before.scrollTop);
    const after = await state(page);
    expect(values.every((v) => v === before.value)).toBe(true);
    expect(after.value).toBe(before.value);
    expect(after.seen.input).toBe(0);
  });

  test("a horizontal drag on a slider still moves it", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    const box = await prepare(page);
    const before = await state(page);
    const thumbX = await page.evaluate((sel) => {
      const input = /** @type {HTMLInputElement} */ (
        document.querySelector(sel)
      );
      const r = input.getBoundingClientRect();
      const f =
        (Number(input.value) - Number(input.min)) /
        (Number(input.max) - Number(input.min));
      return r.left + r.width * f;
    }, SLIDER);
    // Towards whichever end has more room.
    const dir = thumbX < box.x + box.width / 2 ? 1 : -1;
    const y = box.y + box.height / 2;
    const points = [];
    for (let i = 0; i <= 10; i++) points.push({ x: thumbX + dir * i * 8, y });

    await touchPath(page, cdp, points);

    const after = await state(page);
    expect(Number(after.value)).not.toBe(Number(before.value));
    expect(Math.sign(Number(after.value) - Number(before.value))).toBe(dir);
    expect(after.seen.input).toBeGreaterThan(0);
  });

  test("a tap on the track sets the value there, as Chromium does without the guard", async ({
    page,
  }) => {
    // Why this test matters: Chromium's own behaviour for a tap is
    // jump-to-finger (the value is written on touchstart and committed on
    // touchend). The guard holds the value during the press and must commit
    // the same result on release, or every slider loses tap-to-set.
    const cdp = await page.context().newCDPSession(page);
    const box = await prepare(page);
    const before = await state(page);
    const point = await farPoint(page, box);

    await tap(cdp, point);

    const after = await state(page);
    // Precondition: the press was a tap by the guard's rule, not a slow
    // press (which the guard discards on purpose).
    expect(after.seen.pressMs).toBeLessThan(300);
    expect(after.value).not.toBe(before.value);
    expect(after.seen.input).toBeGreaterThan(0);
    expect(after.seen.change).toBeGreaterThan(0);
  });

  // Parameter sweep (owner rule 2026-09-13): the lean of a swipe decides
  // whether it is a scroll or an edit, so the verdict is taken across leans
  // rather than at one. The guard's rule is "horizontal when |dx| > |dy|",
  // i.e. a lean under 45 degrees off vertical scrolls.
  for (const lean of [0, 15, 30, 40]) {
    test(`a swipe leaning ${lean} degrees off vertical leaves the value alone`, async ({
      page,
    }) => {
      const cdp = await page.context().newCDPSession(page);
      const box = await prepare(page);
      const start = await farPoint(page, box);
      const before = await state(page);
      // Lean towards the panel's centre so the finger stays on screen.
      const side = start.x < 195 ? lean : -lean;

      await touchPath(page, cdp, swipeUp(start, side));

      const after = await state(page);
      expect(after.value).toBe(before.value);
      expect(after.seen.input).toBe(0);
    });
  }
});

test.describe("with a mouse and a keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("a mouse drag and a click on the track still set the value", async ({
    page,
  }) => {
    // Why this test matters: the guard only holds touch and pen gestures;
    // desktop click-to-set and dragging must be exactly what they were.
    const box = await prepare(page);
    const y = box.y + box.height / 2;
    const before = await state(page);

    const far = await farPoint(page, box);
    await page.mouse.click(far.x, far.y);
    const clicked = await state(page);
    expect(clicked.value).not.toBe(before.value);

    await page.mouse.move(far.x, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, y, { steps: 6 });
    await page.mouse.up();
    const dragged = await state(page);
    expect(dragged.value).not.toBe(clicked.value);
  });

  test("the arrow keys still step the value", async ({ page }) => {
    await prepare(page);
    const slider = page.locator(SLIDER);
    const before = Number(await slider.inputValue());
    const step = Number(await slider.getAttribute("step"));
    const max = Number(await slider.getAttribute("max"));
    await slider.focus();
    const key = before + step <= max ? "ArrowRight" : "ArrowLeft";
    await page.keyboard.press(key);
    const expected = key === "ArrowRight" ? before + step : before - step;
    expect(Number(await slider.inputValue())).toBeCloseTo(expected, 6);
  });
});
