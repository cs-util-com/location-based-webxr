// @ts-check
/**
 * The splat trainer page in a real browser: a synthetic recording through
 * the real reader and planner, the practice trainer from its address flag,
 * and the production page that says the splat maker is not ready yet.
 * Why it matters: the unit tests run the view in jsdom, which has no
 * layout, no file picker and no CSS; this pins that the page loads as its
 * own entry, that a whole run reaches a saved file, that each refusal
 * shows, and where the sheet and the bar sit at desktop sizes.
 */
import { expect, test } from "@playwright/test";

/** @param {import("@playwright/test").Page} page */
async function refuseOtherHosts(page) {
  // Nothing leaves the machine: every other host is refused.
  await page.route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort(),
  );
}

/**
 * Builds a synthetic recording in the page (the dev server serves the test
 * helper) and hands it to the page's file input.
 * @param {import("@playwright/test").Page} page
 * @param {Record<string, unknown>} options
 */
async function chooseRecording(page, options) {
  await page.evaluate(async (opts) => {
    const helper = "/src/test-support/synthetic-recording.ts";
    const m = await import(/* @vite-ignore */ helper);
    const { file } = await m.buildSyntheticRecording(opts);
    const input = /** @type {HTMLInputElement} */ (
      document.querySelector('[data-ref="fileInput"]')
    );
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  }, options);
}

/** A 240 m walk at walking pace: several stretches for the real planner. */
const WALK = { frames: 200, spacingM: 1.2, intervalMs: 1000 };

/**
 * A save dialog stand-in: records what was written, or fails the write.
 * @param {import("@playwright/test").Page} page
 * @param {{ failWrites?: number }} [opts]
 */
async function stubSaveDialog(page, opts = {}) {
  await page.addInitScript((failWrites) => {
    let fails = failWrites;
    /** @type {any} */ (window).__saved = [];
    /** @type {any} */ (window).showSaveFilePicker = async () => ({
      name: "walk-splat.zip",
      createWritable: async () => ({
        write: async (/** @type {Blob} */ blob) => {
          if (fails > 0) {
            fails -= 1;
            throw new Error("disk full");
          }
          /** @type {any} */ (window).__saved.push(blob.size);
        },
        close: async () => {},
        abort: async () => {},
      }),
    });
  }, opts.failWrites ?? 0);
}

const bar = (page) => page.locator('[data-ref="barLine"]');

test.beforeEach(async ({ page }) => {
  await refuseOtherHosts(page);
});

test("a practice run reads, trains, retries and saves a placeholder", async ({
  page,
}) => {
  await stubSaveDialog(page);
  await page.goto("/splat/?trainer=practice&pace=200");
  await expect(
    page.getByRole("heading", { name: "Make a splat" }),
  ).toBeVisible();
  await expect(page.getByText("Practice run")).toBeVisible();
  await chooseRecording(page, WALK);
  await expect(page.locator(".census-lead").first()).toContainText(
    "200 photos",
  );
  const prints = page.locator(".print");
  const count = await prints.count();
  expect(count).toBeGreaterThan(4);

  await page.getByRole("button", { name: "Make the splat" }).click();
  // The practice script makes the fifth stretch not good enough.
  await expect(page.locator('[data-ref="barSub"]')).toContainText(
    "Stretch 5 is not good enough",
  );
  const fifth = prints.nth(4);
  await expect(fifth).toHaveAttribute("data-verdict", "poor");
  await fifth
    .getByRole("button", { name: "Train again with more time" })
    .click();
  await expect(fifth).toHaveAttribute("data-verdict", "weak");
  await expect(page.locator('[data-ref="barSub"]')).toContainText(
    `Ready to save: ${count} stretches go into the file.`,
  );

  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("The file contains where it was recorded."),
  ).toBeVisible();
  await expect(dialog.getByText("placeholder")).toBeVisible();
  await dialog.getByRole("button", { name: "Save to disk" }).click();
  await expect(bar(page)).toHaveText(
    `Saved. ${count} stretches are in the file.`,
  );
  const saved = await page.evaluate(() => /** @type {any} */ (window).__saved);
  expect(saved).toHaveLength(1);
});

test("a failed save says so, keeps everything and saves on Try again", async ({
  page,
}) => {
  await stubSaveDialog(page, { failWrites: 1 });
  await page.goto("/splat/?trainer=practice&pace=400");
  await chooseRecording(page, { frames: 60, spacingM: 1.2 });
  await page.getByRole("button", { name: "Make the splat" }).click();
  await expect(bar(page)).toContainText("good");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save to disk" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Saving did not work");
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(bar(page)).toContainText("Saved.");
});

test("stop asks first, stops the training stretch and continues it", async ({
  page,
}) => {
  await page.goto("/splat/?trainer=practice&pace=0.5");
  await chooseRecording(page, WALK);
  await page.getByRole("button", { name: "Make the splat" }).click();
  await expect(bar(page)).toContainText("Training stretch 1 of");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Stretch 1 is");
  await expect(
    page.getByRole("button", { name: "Keep training" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(bar(page)).toContainText("Stopped. 0 of");
  await expect(page.locator(".print").first()).toHaveAttribute(
    "data-status",
    "stopped",
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(bar(page)).toContainText("Training stretch 1 of");
});

test("built-in graphics warn before the start", async ({ page }) => {
  await page.goto("/splat/?trainer=practice&gpu=integrated");
  await chooseRecording(page, { frames: 60, spacingM: 1.2 });
  await expect(
    page.getByText("This computer is using its built-in graphics"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Make the splat" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Use the built-in graphics anyway" })
    .click();
  await expect(
    page.getByRole("button", { name: "Make the splat" }),
  ).toBeEnabled();
});

test.describe("refusals", () => {
  test("a phone gets the desktop refusal, with no sideways scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/splat/?trainer=practice");
    await expect(
      page.getByRole("heading", { name: "Use a desktop computer" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy this page's link" }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("no WebGPU refuses the page", async ({ page }) => {
    await page.goto("/splat/?trainer=practice&gpu=no-webgpu");
    await expect(
      page.getByRole("heading", { name: "This browser cannot make splats" }),
    ).toBeVisible();
  });

  test("a recording without camera positions is refused, and another can be chosen", async ({
    page,
  }) => {
    await page.goto("/splat/?trainer=practice");
    await chooseRecording(page, { era: 3 });
    await expect(
      page.getByRole("heading", { name: "This recording cannot be used" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Choose another recording" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Drop a recording here" }),
    ).toBeVisible();
  });
});

test("without the practice flag the page says the splat maker is not ready", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ info: { vendor: "nvidia" } }) },
    });
  });
  await page.goto("/splat/");
  await expect(page.getByText("Practice run")).toBeHidden();
  await chooseRecording(page, { frames: 60, spacingM: 1.2 });
  await expect(
    page.getByText("The splat maker is not ready yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Make the splat" }),
  ).toBeHidden();
});

for (const [width, height, columns] of [
  [1024, 768, 3],
  [1280, 800, 4],
  [1440, 900, 4],
]) {
  test(`layout at ${width}x${height}: ${columns} columns, 16 px gaps, the bar at the bottom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/splat/?trainer=practice&pace=400");
    await chooseRecording(page, WALK);
    await page.getByRole("button", { name: "Make the splat" }).click();
    await expect(page.locator('[data-ref="barSub"]')).toContainText(
      "not good enough",
    );
    const boxes = await page.locator(".print").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    const firstRow = boxes.filter(
      (b) => Math.abs(b.y - (boxes[0]?.y ?? 0)) < 1,
    );
    expect(firstRow).toHaveLength(columns);
    for (let i = 1; i < firstRow.length; i++) {
      const prev = firstRow[i - 1];
      const cur = firstRow[i];
      if (prev === undefined || cur === undefined) continue;
      expect(Math.round(cur.x - (prev.x + prev.w))).toBe(16);
    }
    const second = boxes[columns];
    const first = boxes[0];
    if (second !== undefined && first !== undefined) {
      expect(second.y - (first.y + first.h)).toBeGreaterThanOrEqual(16);
    }
    const barBox = await page.locator('[data-ref="bar"]').boundingBox();
    expect(Math.round((barBox?.y ?? 0) + (barBox?.height ?? 0))).toBe(height);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
