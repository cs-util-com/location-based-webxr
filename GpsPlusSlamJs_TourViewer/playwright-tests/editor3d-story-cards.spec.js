// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, openSampleIn3d } from "./editor3d-fixture.js";

/**
 * Why these tests matter: a story's steps are cards in its inspector, and
 * the way a creator builds a branching story is the cards, the add menu,
 * a choice's jump pickers and the preview working together on the real
 * page: a choice whose answer goes back must read "goes back to step 1"
 * on its card, one that ends "ends the story", and the preview must play
 * the story through the visitor's own panel, the jump back and the end
 * included. A desktop opens a card in place; a phone, upright or on its
 * side, drills into the step. Every size is pinned, as the cards and the
 * preview differ there, and so is what the chosen step-cards prototype
 * set out: the "Story valid" pill on the line under the story's name, and
 * the cards stacked with a small even gap.
 */

// One after another: software-drawn 3D views share the CPU badly.
test.describe.configure({ mode: "default" });

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(
    () => /** @type {any} */ (window).__tourEditor.selected?.() ?? null,
  );
}

/**
 * The box of what `locator` finds, failing the test when it has none, so
 * a measurement never passes by being skipped.
 * @param {import("@playwright/test").Locator} locator
 */
async function boxOf(locator) {
  const box = await locator.boundingBox();
  expect(box, "a box to measure").not.toBeNull();
  if (box === null) throw new Error("no box to measure");
  return box;
}

// `phone`: the panels are sheets; `drill`: a card goes into its step
// rather than opening in place, as on a phone either way round.
const SIZES = [
  { name: "a desktop", width: 1280, height: 800, phone: false, drill: false },
  { name: "a phone", width: 390, height: 844, phone: true, drill: true },
  {
    name: "a phone on its side",
    width: 844,
    height: 390,
    phone: false,
    drill: true,
  },
];

for (const size of SIZES) {
  test(`on ${size.name} a two-step story with a jump back and an end is built in its cards and previewed`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: size.width, height: size.height });
    await answerHosts(page);
    await openSampleIn3d(page);
    const inspector = page.locator("#shell-inspector");
    const menu = page.locator("#tree-add-menu");
    const back = page.locator('#shell-inspector [data-act="back"]');

    // A story in the old gate, named in its inspector.
    await page
      .locator("#shell-tree .card", { hasText: "The old gate" })
      .locator(".pick")
      .click();
    await inspector.locator('[data-act="add-content"]').click();
    await menu.locator('[data-kind="story"]').click();
    const name = inspector.locator('[data-field="story-title"]');
    await expect(name).toBeFocused();
    await name.fill("The legend");
    await name.press("Enter");
    await expect(inspector.locator(".scards > .note")).toContainText(
      "This story has no steps yet.",
    );

    // Step 1, a long text; Back comes up to the story again.
    await inspector.locator('[data-act="add-entry"]').click();
    await menu.locator('[data-kind="longText"]').click();
    await expect(inspector.locator(".sub > span:first-child")).toHaveText(
      "Long text, entry 1",
    );
    // The way up shows on every size: Back, and the crumb's levels.
    await expect(back).toBeVisible();
    await expect(
      inspector.locator(".crumbs button", { hasText: "The legend" }),
    ).toBeVisible();
    await back.click();
    await expect(inspector.locator(".scard")).toHaveCount(1);

    // Step 2, a choice: its first answer goes back to step 1, its second
    // ends the story.
    await inspector.locator('[data-act="add-entry"]').click();
    await menu.locator('[data-kind="choice"]').click();
    const pickers = inspector.locator('select[data-act^="step-goto:"]');
    await expect(pickers).toHaveCount(2);
    const toStep1 = await pickers
      .nth(0)
      .locator("option", { hasText: "Go back to step 1" })
      .getAttribute("value");
    expect(toStep1).not.toBeNull();
    await pickers.nth(0).selectOption(toStep1 ?? "");
    await pickers.nth(1).selectOption({ label: "End the story" });
    await expect
      .poll(async () => {
        const gate = (await tourNow(page)).stations.find(
          (/** @type {any} */ s) => s.id === "gate",
        );
        const story = gate.children.find(
          (/** @type {any} */ c) => c.title === "The legend",
        );
        return story?.children[1]?.options.map(
          (/** @type {any} */ o) => o.goto ?? (o.end === true ? "end" : null),
        );
      })
      .toEqual([toStep1, "end"]);
    await back.click();

    // The story's cards say where each answer leads.
    const cards = inspector.locator(".scard");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(1).locator(".kindtag")).toHaveText("Asks");
    await expect(cards.nth(1).locator(".jump")).toHaveText([
      "goes back to step 1",
      "ends the story",
    ]);
    await expect(inspector.locator(".scard.bad")).toHaveCount(0);
    // The pill says the story is valid, on the line under its name, beside
    // where the story sits and inside the details.
    const pill = inspector.locator('.sub [data-act="story-check"]');
    await expect(pill).toHaveText("Story valid");
    const pillBox = await boxOf(pill);
    const whereBox = await boxOf(inspector.locator(".sub > span:first-child"));
    const sheet = await boxOf(inspector);
    expect(pillBox.x).toBeGreaterThanOrEqual(whereBox.x + whereBox.width);
    expect(
      Math.abs(
        pillBox.y + pillBox.height / 2 - (whereBox.y + whereBox.height / 2),
      ),
    ).toBeLessThanOrEqual(3);
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(
      sheet.x + sheet.width,
    );
    // The cards stack with the prototype's small gap: 2 to 8 px apart.
    const top = await boxOf(cards.nth(0));
    const next = await boxOf(cards.nth(1));
    const gap = next.y - (top.y + top.height);
    expect(gap).toBeGreaterThanOrEqual(2);
    expect(gap).toBeLessThanOrEqual(8);
    // The cards sit inside the details with a margin on both sides.
    expect(top.x - sheet.x).toBeGreaterThanOrEqual(8);
    expect(sheet.x + sheet.width - (top.x + top.width)).toBeGreaterThanOrEqual(
      8,
    );

    // A card opens in place on a desktop; on a phone it is the step.
    const storyId = await selected(page);
    await cards.nth(1).locator(".chead").click();
    if (size.drill) {
      await expect(inspector.locator(".sub")).toContainText("Choice");
      await back.click();
      expect(await selected(page)).toBe(storyId);
    } else {
      await expect(inspector.locator(".scard.open")).toHaveCount(1);
      await expect(
        inspector.locator(".scard.open select[data-act^='step-goto:']"),
      ).toHaveCount(2);
      expect(await selected(page)).toBe(storyId);
      await cards.nth(1).locator(".chead").click();
      await expect(inspector.locator(".scard.open")).toHaveCount(0);
    }

    // The preview plays it through the visitor's panel: step 1, the
    // choice, the jump back to step 1, the choice again, the end.
    await inspector.locator('[data-act="preview-story"]').click();
    const preview = page.getByRole("dialog", { name: "Preview: The legend" });
    await expect(preview).toBeVisible();
    const goOn = preview.getByRole("button", { name: "Continue" });
    const answers = preview.locator(".choices button");
    const step1 = preview.locator(".text");
    const body = await step1.textContent();
    expect(body?.trim()).not.toBe("");
    await goOn.click();
    await expect(answers).toHaveCount(2);
    await answers.nth(0).click();
    await expect(step1).toHaveText(body ?? "");
    await goOn.click();
    await answers.nth(1).click();
    await expect(preview.getByText("The story has ended.")).toBeVisible();
    // The dialog stays inside the window, whole on a phone.
    const box = await boxOf(preview);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    if (size.phone) expect(box.width).toBeCloseTo(size.width, 0);
    // Nothing of the editor covers it: its Close is what a tap there hits.
    const close = preview.getByRole("button", { name: "Close" });
    expect(
      await close.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b
        );
      }),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await expect(inspector.locator('[data-act="preview-story"]')).toBeFocused();
    expect(await selected(page)).toBe(storyId);
  });
}

/**
 * The step ids of the story `title` in the old gate, in order.
 * @param {import("@playwright/test").Page} page
 * @param {string} title
 * @returns {Promise<string[]>}
 */
async function stepsOf(page, title) {
  const gate = (await tourNow(page)).stations.find(
    (/** @type {any} */ s) => s.id === "gate",
  );
  const story = gate.children.find((/** @type {any} */ c) => c.title === title);
  return story.children.map((/** @type {any} */ c) => c.id);
}

/**
 * Touches for CDP from `at` on: down, then each of `moves` (`[ms, dy]`
 * after the press), with the events' own times, so the hold the page
 * reads is the gesture's and not the page's lag.
 * @param {{ x: number, y: number }} at
 * @param {readonly (readonly [number, number])[]} moves
 * @param {number} start seconds since the epoch, as CDP takes them
 */
function fingerOf(at, moves, start) {
  return [
    { type: "touchStart", touchPoints: [at], timestamp: start },
    ...moves.map(([ms, dy]) => ({
      type: "touchMove",
      touchPoints: [{ x: at.x, y: at.y + dy }],
      timestamp: start + ms / 1000,
    })),
  ];
}

/**
 * Sends touches in one burst, in order, and waits for them all.
 * @param {import("@playwright/test").CDPSession} cdp
 * @param {readonly object[]} touches
 */
async function sendTouches(cdp, touches) {
  await Promise.all(
    touches.map((t) => cdp.send("Input.dispatchTouchEvent", t)),
  );
}

// The prototype's footer and grip, measured: a footer button's height and
// a grip's size and place left of the step's number (a phone's are a
// finger's).
// On its side a phone keeps the desktop's buttons, which leave the cards
// more of its short height, and a finger's grip.
const FOOT = {
  desktop: { button: 30, grip: [22, 40], gripLeft: 4, gripTop: 12, toNum: 9 },
  side: { button: 30, grip: [26, 44], gripLeft: 4, gripTop: 12, toNum: 9 },
  phone: { button: 42, grip: [26, 44], gripLeft: 2, gripTop: 14, toNum: 8 },
};

for (const size of SIZES) {
  test.describe(`on ${size.name}, a story's footer and its step grips`, () => {
    // A finger where the size is a phone's, a mouse on the desktop.
    test.use({ hasTouch: size.drill });

    // Why: the chosen step-cards prototype keeps Add step and Preview in
    // a footer at the panel's foot, in sight however far the cards scroll,
    // and moves a step by dragging its grip, the drop's slot shown as a
    // line. On a phone the grip must not steal a flick that scrolls the
    // cards: a finger rests on it first. One drop is one undo step.
    test("stays at the panel's foot while the cards scroll, and a grip drags a step to its new place", async ({
      page,
    }) => {
      // Three steps built through the page, then a drag and its undo: on a
      // desktop's software-drawn 3D view that took 1.3 to 2.2 minutes here.
      test.setTimeout(180_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      await answerHosts(page);
      await openSampleIn3d(page);
      const inspector = page.locator("#shell-inspector");
      const body = page.locator("#inspector-body");
      const menu = page.locator("#tree-add-menu");
      const back = page.locator('#shell-inspector [data-act="back"]');
      await page
        .locator("#shell-tree .card", { hasText: "The old gate" })
        .locator(".pick")
        .click();
      await inspector.locator('[data-act="add-content"]').click();
      await menu.locator('[data-kind="story"]').click();
      const name = inspector.locator('[data-field="story-title"]');
      await name.fill("The legend");
      await name.press("Enter");
      for (let n = 1; n <= 3; n++) {
        await inspector.locator('[data-act="add-entry"]').click();
        await menu.locator('[data-kind="longText"]').click();
        await back.click();
        await expect(inspector.locator(".scard")).toHaveCount(n);
      }
      const cards = inspector.locator(".scard");
      const want = size.phone
        ? FOOT.phone
        : size.drill
          ? FOOT.side
          : FOOT.desktop;

      // The footer: flush with the body's foot at either end of the
      // cards' scroll, Add step and Preview side by side 8 px apart, 12 px
      // in from the panel's sides, a button row's height.
      const foot = inspector.locator(".sfoot");
      const add = foot.locator('[data-act="add-entry"]');
      const play = foot.locator('[data-act="preview-story"]');
      /** @type {number[]} */
      const room = [];
      for (const end of ["top", "bottom"]) {
        await body.evaluate((b, to) => {
          b.scrollTop = to === "top" ? 0 : b.scrollHeight;
        }, end);
        const shown = await boxOf(body);
        const f = await boxOf(foot);
        const a = await boxOf(add);
        const p = await boxOf(play);
        expect(
          Math.abs(f.y + f.height - (shown.y + shown.height)),
          end,
        ).toBeLessThanOrEqual(1);
        expect(a.height).toBeCloseTo(want.button, 0);
        expect(Math.abs(a.y - p.y)).toBeLessThanOrEqual(1);
        expect(p.x - (a.x + a.width)).toBeCloseTo(8, 0);
        expect(a.x - f.x).toBeCloseTo(12, 0);
        expect(f.x + f.width - (p.x + p.width)).toBeCloseTo(12, 0);
        // A phone's two halves; elsewhere Add step takes what Preview leaves.
        if (size.phone) expect(a.width).toBeCloseTo(p.width, 0);
        room.push(shown.height - f.height);
      }
      // What the footer leaves for the cards: at least one card whole.
      await body.evaluate((b) => {
        b.scrollTop = 0;
      });
      const card = await boxOf(cards.nth(0));
      test.info().annotations.push({
        type: "room for the cards",
        description: `${String(room[0])} px of the body's ${String((await boxOf(body)).height)} px; a card is ${String(card.height)} px`,
      });
      expect(room[0]).toBeGreaterThanOrEqual(card.height);

      // A grip left of each step's number, a finger's size on a phone.
      const grip = cards.nth(0).locator(".grip");
      const g = await boxOf(grip);
      const num = await boxOf(cards.nth(0).locator(".num"));
      expect(g.width).toBeCloseTo(want.grip[0], 0);
      expect(g.height).toBeCloseTo(want.grip[1], 0);
      // The card's 1 px border, then the grip's margin.
      expect(g.x - card.x).toBeCloseTo(want.gripLeft + 1, 0);
      expect(g.y - card.y).toBeCloseTo(want.gripTop + 1, 0);
      expect(num.x - (g.x + g.width)).toBeCloseTo(want.toNum, 0);

      // Drag step 1 under step 3: the slot shows as a line under step 3
      // while the step is held, the drop moves it, one undo puts it back.
      const before = await stepsOf(page, "The legend");
      const last = await boxOf(cards.nth(2));
      const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
      const to = last.y + last.height - 4 - from.y;
      const cdp = size.drill ? await page.context().newCDPSession(page) : null;
      if (cdp === null) {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x, from.y + to, { steps: 6 });
      } else {
        // A flick that starts on the grip moves nothing.
        const flick = Date.now() / 1000;
        await sendTouches(cdp, [
          ...fingerOf(
            from,
            [1, 2, 3, 4, 5].map((i) => [i * 16, i * 12]),
            flick,
          ),
          { type: "touchEnd", touchPoints: [], timestamp: flick + 0.1 },
        ]);
        await expect(inspector.locator(".scard.dragging")).toHaveCount(0);
        expect(await stepsOf(page, "The legend")).toEqual(before);
        await body.evaluate((b) => {
          b.scrollTop = 0;
        });
        // A finger that rests 300 ms on the grip, then moves.
        await sendTouches(
          cdp,
          fingerOf(
            from,
            [
              [100, 1],
              [300, 2],
              [320, to / 2],
              [340, to],
            ],
            Date.now() / 1000,
          ),
        );
      }
      await expect(cards.nth(0)).toHaveClass(/\bdragging\b/);
      await expect(cards.nth(2)).toHaveClass(/\bdrop-after\b/);
      const line = await cards
        .nth(2)
        .evaluate((c) => getComputedStyle(c, "::after").height);
      expect(line).toBe("3px");
      if (cdp === null) await page.mouse.up();
      else
        await sendTouches(cdp, [
          { type: "touchEnd", touchPoints: [], timestamp: Date.now() / 1000 },
        ]);
      await expect
        .poll(() => stepsOf(page, "The legend"))
        .toEqual([before[1], before[2], before[0]]);
      await expect(inspector.locator(".scard.dragging")).toHaveCount(0);
      await page.locator("#studio-undo").dispatchEvent("click");
      await expect.poll(() => stepsOf(page, "The legend")).toEqual(before);
    });
  });
}
