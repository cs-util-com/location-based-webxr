// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: a model's card and its notes' discs were built
 * from the views' prototype (`public/prototypes/station-blocks-5-models/`),
 * and the design system zeroes margins, so a port can lose every gap and
 * still pass a test that asks only whether an element is visible. These pin
 * what the prototype chose - the card at the bottom centre, 12 px from the
 * edge, at most 420 px wide; its counter, title and row with their gaps;
 * the discs 28 px round and apart - on a phone, a phone held sideways and a
 * desktop, through the check page `model-views-check.html` (the views
 * without an AR session). A toy's card adds "Back to its place" and lays a
 * gesture layer over the screen.
 *
 * Not pinned here: how the views look (a side-by-side check against the
 * prototype, by eye), and a real touch's pinch.
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

const NOTES = [
  {
    position: [0, 1.0, 0.21],
    normal: [0, 0, 1],
    title: "The post",
    text: "A stone post, two metres tall.",
  },
  {
    position: [0.21, 1.6, 0],
    normal: [1, 0, 0],
    title: "Its side",
    text: "The side faces the light.",
  },
  {
    position: [1.0, 1.91, 0],
    normal: [0, 1, 0],
    title: "The arm",
    text: "A brass arm that swings.",
  },
];

/** The stand-in model 6 m in front of the camera, in `view`. */
function block(view, extra = {}) {
  return {
    id: "post",
    kind: "model",
    view,
    asset: "post",
    sizeM: 2,
    createdAtIso: "2026-10-28T12:00:00.000Z",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    annotations: NOTES,
    ...extra,
  };
}

async function open(page, viewport, b, target = [0.3, 1.3, 0]) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/model-views-check.html");
  await page.waitForFunction(() => window.__modelViewsCheck !== undefined);
  await page.evaluate(
    async ([blockValue, at]) => {
      const check = window.__modelViewsCheck;
      check.lookFrom([0, 1.6, 6], at);
      await check.show(blockValue);
    },
    [b, target],
  );
  return errors;
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("not laid out");
  return b;
}

// A software-rendered WebGL page per worker is slow; the default 30 s
// budget ran out on the desktop size with three workers.
test.describe.configure({ timeout: 90_000 });

// A software-rendered loop drawing every frame kept the closing browser
// busy past the budget; the page stops drawing once a test is done.
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__modelViewsCheck?.stop());
});

for (const viewport of VIEWPORTS) {
  test(`a note's card and the discs sit where the prototype put them (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await open(page, viewport, block("hotspots"));
    const discs = page.locator("button.note-marker:not([hidden])");
    await expect(discs).toHaveCount(NOTES.length);
    await expect(page.locator("#model-card")).toBeHidden();

    // The discs: 28 px round, centred on their points, and apart.
    const centres = [];
    for (let i = 0; i < NOTES.length; i += 1) {
      const disc = await box(discs.nth(i).locator(".note-disc"));
      expect(disc.width).toBeCloseTo(28, 0);
      expect(disc.height).toBeCloseTo(28, 0);
      centres.push([disc.x + disc.width / 2, disc.y + disc.height / 2]);
    }
    for (let i = 0; i < centres.length; i += 1) {
      for (let j = i + 1; j < centres.length; j += 1) {
        const [a, b] = [centres[i], centres[j]];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(28);
      }
    }

    // A tap on a disc opens its note's card.
    await discs.nth(1).click();
    const card = page.locator("#model-card");
    await expect(card).toBeVisible();
    await expect(page.locator("#model-card-num")).toHaveText("Note 2 of 3");
    await expect(page.locator("#model-card-title")).toHaveText("Its side");
    await expect(discs.nth(1)).toHaveClass(/open/);

    // The card: bottom centre, 12 px up, at most 420 px wide.
    const c = await box(card);
    expect(c.width).toBeCloseTo(Math.min(420, viewport.width - 24), 0);
    expect(c.x + c.width / 2).toBeCloseTo(viewport.width / 2, 0);
    expect(viewport.height - (c.y + c.height)).toBeCloseTo(12, 0);
    // Its parts: 15 px of padding above the counter, 3 px to the title,
    // 7 px to the text, 12 px to the row; the close button 30 px round
    // in the top right corner.
    const num = await box(page.locator("#model-card-num"));
    const title = await box(page.locator("#model-card-title"));
    const text = await box(page.locator("#model-card-text"));
    const row = await box(page.locator("#model-card-row"));
    const close = await box(page.locator("#model-card-close"));
    expect(num.y - c.y).toBeCloseTo(16, 0);
    expect(title.y - (num.y + num.height)).toBeCloseTo(3, 0);
    expect(text.y - (title.y + title.height)).toBeCloseTo(7, 0);
    expect(row.y - (text.y + text.height)).toBeCloseTo(12, 0);
    expect(close.width).toBeCloseTo(30, 0);
    expect(c.x + c.width - (close.x + close.width)).toBeCloseTo(9, 0);
    // Previous at the left, Next at the right of the row.
    const prev = await box(page.locator("#model-card-prev"));
    const next = await box(page.locator("#model-card-next"));
    expect(prev.x - c.x).toBeCloseTo(17, 0);
    expect(c.x + c.width - (next.x + next.width)).toBeCloseTo(17, 0);
    await expect(page.locator("#model-card-reset")).toBeHidden();

    await page.locator("#model-card-next").click();
    await expect(page.locator("#model-card-num")).toHaveText("Note 3 of 3");
    await page.locator("#model-card-close").click();
    await expect(card).toBeHidden();
    expect(errors).toEqual([]);
  });

  test(`a toy's card puts it back, over a gesture layer (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await open(
      page,
      viewport,
      block("toy", { annotations: undefined }),
      // Straight at the post, so the screen centre is on it.
      [0, 1.2, 0],
    );
    // A tap on the model opens its card.
    await page.mouse.click(viewport.width / 2, viewport.height / 2);
    const card = page.locator("#model-card");
    await expect(card).toBeVisible();
    await expect(page.locator("#model-card-num")).toHaveText("In your hand");
    const reset = page.locator("#model-card-reset");
    await expect(reset).toBeVisible();
    await expect(reset).toBeDisabled();
    const layer = await box(page.locator("#model-gestures"));
    expect(layer).toEqual({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
    // Nothing to step through: Back to its place alone, at the row's left.
    await expect(page.locator("#model-card-prev")).toBeHidden();
    await expect(page.locator("#model-card-next")).toBeHidden();
    const c = await box(card);
    const middle = await box(reset);
    expect(middle.x - c.x).toBeCloseTo(17, 0);
    expect(c.y + c.height - (middle.y + middle.height)).toBeCloseTo(14, 0);
    // A drag moves the toy; Back to its place undoes it.
    const y = viewport.height / 3;
    await page.mouse.move(viewport.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(viewport.width / 2 + 80, y, { steps: 4 });
    await page.mouse.up();
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(reset).toBeDisabled();
    expect(errors).toEqual([]);
  });
}
