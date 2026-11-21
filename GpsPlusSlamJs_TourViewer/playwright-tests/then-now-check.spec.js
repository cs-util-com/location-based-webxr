// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: Swipe is a line the visitor drags across the
 * whole screen, and the old picture's shader must be cut exactly where
 * that line stands. The unit tests pin the mapping, the panel and the
 * uniforms one by one in jsdom; only a real browser shows that the three
 * meet: the knob's layer really covers the screen (a transformed host
 * would hold it to the panel's box), a mouse drag moves it through
 * pointer capture, a touch anywhere but the knob goes through the layer
 * to the world, the layer stands aside for the walk sheet's open list,
 * and the drawn frame shows then on the left of the line and today on
 * the right, up to a few pixels from it. The page is `check.html?view=then-now`: one
 * production then-and-now part seen from exactly its viewpoint.
 *
 * What it cannot catch: how the line feels under a thumb on a phone in
 * AR (a field check), and the AR session's own select gesture (the knob
 * is in `pin-sheet.ts`'s overlay list; `then-now-slider.test.ts` pins
 * that the knob cancels a select and the layer, line and labels do not).
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

/** Red (the old picture) clearly over blue (today), or the reverse. */
function isThen([r, , b]) {
  return r > b + 40;
}
function isToday([r, , b]) {
  return b > r + 40;
}

/**
 * What the shader is told. It changes only inside the part's per-frame
 * `show()`, so after a click it lags by a frame or more under software
 * WebGL: every read after an action goes through `expect.poll`.
 */
async function shader(page) {
  const s = await page.evaluate(() => window.__thenNowCheck?.state());
  if (s === null || s === undefined) throw new Error("no picture");
  return s;
}

async function sample(page, x, y) {
  return page.evaluate(
    ([sx, sy]) => window.__thenNowCheck?.sample(sx, sy) ?? [0, 0, 0],
    [x, y],
  );
}

// A software-rendered WebGL page is slow on a busy machine.
test.describe.configure({ timeout: 90_000 });

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__thenNowCheck?.stop());
});

for (const viewport of VIEWPORTS) {
  test(`Swipe cuts the old picture where the line is dragged (${viewport.name})`, async ({
    page,
  }) => {
    const errors = /** @type {string[]} */ ([]);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/check.html?view=then-now");
    await page.waitForFunction(() => window.__thenNowCheck?.state() != null);

    // Lined up: the panel is open in Fade, nothing is cut.
    const swipe = page.getByRole("button", { name: "Swipe" });
    await swipe.waitFor({ state: "visible" });
    await expect.poll(async () => (await shader(page)).on).toBe(false);
    await swipe.click();
    await expect(page.getByText("Drag the line to compare")).toBeVisible();
    const knob = page.getByRole("slider", {
      name: "Line between then and today",
    });
    await expect(knob).toHaveAttribute("aria-valuenow", "50");
    await expect.poll(() => shader(page)).toEqual({ on: true, split: 0.5 });

    // Drag the knob to 30 % of the screen's width.
    const box = await knob.boundingBox();
    if (box === null) throw new Error("no knob");
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(
      2,
    );
    expect(box.width).toBeGreaterThanOrEqual(48);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(viewport.width * 0.3, y, { steps: 6 });
    await page.mouse.up();
    await expect(knob).toHaveAttribute("aria-valuenow", "30");
    await expect.poll(async () => (await shader(page)).on).toBe(true);
    await expect
      .poll(async () => (await shader(page)).split)
      .toBeCloseTo(0.3, 2);

    // Then left of the line, today right of it, in the drawn frame.
    for (const x of [0.15, 0.27]) {
      expect(isThen(await sample(page, x, 0.5)), String(x)).toBe(true);
    }
    for (const x of [0.33, 0.6]) {
      expect(isToday(await sample(page, x, 0.5)), String(x)).toBe(true);
    }

    // Away from the knob a touch reaches the world, not the layer.
    const through = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.closest(".then-now-swipe") ?? null,
      [viewport.width * 0.7, viewport.height * 0.35],
    );
    expect(through).toBeNull();

    // The walk sheet's open list: the line stands aside, and is back
    // once the list closes.
    await page.evaluate(() => {
      const sheet = document.createElement("div");
      sheet.className = "walk-sheet";
      sheet.dataset["sheet"] = "list";
      sheet.id = "stand-in-walk-sheet";
      document.body.append(sheet);
    });
    await expect(knob).toBeHidden();
    await page.evaluate(() => {
      document.getElementById("stand-in-walk-sheet")?.remove();
    });
    await expect(knob).toBeVisible();

    // Back to Fade: the line goes and nothing is cut.
    await page.getByRole("button", { name: "Fade" }).click();
    await expect(knob).toBeHidden();
    await expect.poll(async () => (await shader(page)).on).toBe(false);
    expect(errors).toEqual([]);
  });
}
