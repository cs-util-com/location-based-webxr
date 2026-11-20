// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * The setup question and its paths (`src/setup-path.ts`): step 1 asks one
 * question whose four answers only route; step 2 is the chosen path as a
 * short checklist.
 *
 * Why these tests matter: the answer IS the flow, so each must lead to its
 * own checklist and survive a reload. "Start on this phone now, share
 * later" must save the starter zip BEFORE it opens it as the tour (placing
 * needs an open tour, and the saved file is what the maker keeps), and a
 * cancelled save must open nothing. The map is a small inset in portrait,
 * so the step leads, and half the screen in landscape.
 */

const FIRST_VISIT = { cookies: [], origins: [] };

test.describe("a first visit", () => {
  test.use({ storageState: FIRST_VISIT });

  test("asks the question, and each answer routes to its own checklist @pr", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-question")).toBeVisible();
    await expect(page.getByTestId("setup-of")).toHaveText("Step 1 of 2");
    // Nothing is open under the question: an answer only routes.
    await expect(page.locator("#setup-card .step:visible")).toHaveCount(0);

    const paths = /** @type {const} */ ([
      ["share-now", ["host", "link", "print", "hang", "measure", "done"]],
      ["have-link", ["link", "print", "hang", "measure", "done"]],
      ["file-here", ["file", "measure", "done"]],
      ["start-here", ["starter", "measure", "done"]],
    ]);
    for (const [answer, steps] of paths) {
      await page.getByTestId(`answer-${answer}`).click();
      await expect(page.getByTestId("setup-question")).toBeHidden();
      await expect(page.getByTestId("setup-of")).toHaveText("Step 2 of 2");
      await expect(page.locator("#setup-dots .setup-item")).toHaveCount(
        steps.length,
      );
      for (const step of steps) {
        await expect(page.getByTestId(`station-${step}`)).toBeVisible();
      }
      // The path's first step is the one open, and the only one.
      await expect(page.getByTestId(`step-${steps[0]}`)).toHaveAttribute(
        "open",
        "",
      );
      await expect(page.locator("#setup-card .step:visible")).toHaveCount(1);
      await page.getByTestId("setup-change").click();
      await expect(page.getByTestId("setup-question")).toBeVisible();
      await expect(page.locator("#setup-card .step:visible")).toHaveCount(0);
    }

    // The answer survives a reload.
    await page.getByTestId("answer-file-here").click();
    await page.reload();
    await expect(page.getByTestId("step-file")).toHaveAttribute("open", "");
    await expect(page.getByTestId("setup-question")).toBeHidden();
  });

  test("start here: one tap saves the starter zip, opens it as the tour, and leads to placing; Done offers the code @pr", async ({
    page,
  }) => {
    await installTourViewerArFakes(page);
    await page.goto("/?nocache=1");
    await page.getByTestId("answer-start-here").click();
    await expect(page.getByTestId("step-starter")).toHaveAttribute("open", "");
    await expect(page.getByTestId("starter-indoor")).toBeVisible();
    await expect(page.getByTestId("starter-done-note")).toContainText(
      "Done saves your work as the tour zip",
    );

    await page.getByTestId("starter-open").click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-tour-open",
      "settled",
      { timeout: 15000 },
    );
    // Saved through the save seam (never the share sheet), before AR.
    const saved = await page.evaluate(() =>
      /** @type {any} */ (window).__tourViewerTest.downloads.map(
        (/** @type {any} */ d) => `${d.seam}:${d.filename}`,
      ),
    );
    expect(saved).toEqual(["download:tour.zip"]);
    await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");
    await expect(page.getByTestId("starter-open")).toHaveText(
      /saved and opened/i,
    );

    // Done, on this path, offers the code made afterwards.
    await page.getByTestId("station-done").click();
    await expect(page.getByTestId("make-code")).toBeVisible();
    await page.getByTestId("make-code").click();
    await expect(page.getByTestId("station-host")).toBeVisible();
    await expect(page.getByTestId("step-host")).toHaveAttribute("open", "");
    // The open tour's zip goes up, not a starter.
    await expect(page.getByTestId("host-saved-note")).toBeVisible();
    await expect(page.getByTestId("make-code")).toBeHidden();
  });

  test("start here: a cancelled save opens nothing and the button can be tapped again", async ({
    page,
  }) => {
    await installTourViewerArFakes(page, { saveOutcome: false });
    await page.goto("/?nocache=1");
    await page.getByTestId("answer-start-here").click();
    await page.getByTestId("starter-open").click();
    await expect(page.getByTestId("starter-open")).toHaveText(/not saved/i);
    await expect(page.getByTestId("starter-open")).toBeEnabled();
    await expect(page.getByTestId("step-starter")).toHaveAttribute("open", "");
    await expect(page.locator("body")).not.toHaveAttribute(
      "data-tour-open",
      "settled",
    );
  });
});

test("the link step offers the hung code's way in, except on the share-now path", async ({
  page,
}) => {
  await page.goto("/?nocache=1");
  await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
  await page.getByTestId("scan-instead").click();
  await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");

  await page.getByTestId("setup-change").click();
  await page.getByTestId("answer-share-now").click();
  await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
  await expect(page.getByTestId("scan-instead")).toBeHidden();
});

test.describe("the map in portrait", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("is a square inset beside the card's title, well under a quarter of the screen", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    const map = await page.locator(".setup-map-frame").boundingBox();
    const top = await page.locator(".setup-card-top").boundingBox();
    if (map === null || top === null) throw new Error("not laid out");
    expect(Math.abs(map.width - map.height)).toBeLessThanOrEqual(2);
    expect(map.height).toBeLessThan(844 / 4);
    // Beside the title row, inside the card's right edge.
    expect(map.x).toBeGreaterThan(top.x + top.width / 2);
    expect(map.y).toBeLessThan(top.y + top.height);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("the map in landscape", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("takes about half the width beside the card", async ({ page }) => {
    await page.goto("/?nocache=1");
    const map = await page.getByTestId("setup-map").boundingBox();
    const card = await page.getByTestId("setup-card").boundingBox();
    if (map === null || card === null) throw new Error("not laid out");
    expect(card.x).toBeGreaterThanOrEqual(map.x + map.width - 1);
    expect(map.width / (map.width + card.width)).toBeGreaterThan(0.4);
    expect(map.width / (map.width + card.width)).toBeLessThan(0.6);
  });
});
