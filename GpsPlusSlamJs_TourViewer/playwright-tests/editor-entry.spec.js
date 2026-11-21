// @ts-check
import { expect, test } from "@playwright/test";

import { openAnother, save } from "./editor-menus.js";
import { setNoGps } from "./editor-session.js";

/**
 * The desktop editor's small fixes and its way in (tour editor plan
 * 2026-10-17-1816, W1; plan 2026-10-15-0348 M0 and M5).
 */

// Without WebGL: nothing here is about the view, and the 3D view would
// ask the relief and map hosts for tiles. The file pickers stay: the new
// tour's save question needs them.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (
      /** @type {string} */ kind,
      /** @type {unknown[]} */ ...rest
    ) {
      return kind.startsWith("webgl") ? null : real.call(this, kind, ...rest);
    };
  });
});

test("Save with nothing changed says so in a toast, and saves nothing", async ({
  page,
}) => {
  // Why (plan 2026-10-15-0348 §2.1, M0): the owner pressed Save on the
  // sample and "nothing happened" - the status line already read "No
  // changes", and Save only swapped it for "Nothing to save" in the same
  // spot. A click needs an answer the creator sees (root CLAUDE.md, async
  // feedback).
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator(".start-choice:has(#start-example)").click();
  await page.locator("#start-open").click();
  await expect(page.locator("#topbar")).toBeVisible();
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await save(page);
  await expect(
    page.locator(".toast", { hasText: "Nothing to save" }),
  ).toBeVisible();
  await expect(page.locator("#save-status")).toHaveText("Nothing to save");
  expect(downloads).toBe(0);
});

/**
 * Why these tests matter (W1 step 5): a creator whose tour is hosted had
 * to download the zip before the editor could open it. The link is
 * fetched through the viewer's own transport and opened as a chosen file
 * is; the dialog is busy while it runs and says why a link did not open.
 */
test.describe("open a tour from its link", () => {
  test("opens the tour behind the link, busy until it has @pr", async ({
    page,
  }) => {
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    /** @type {(() => void) | undefined} */
    let release;
    const held = new Promise((resolve) => {
      release = () => {
        resolve(undefined);
      };
    });
    await page.route("**/ranges-ok/sample-tour.zip", async (route) => {
      await held;
      await route.continue();
    });
    await page.locator(".start-choice:has(#start-tour)").click();
    await page
      .locator("#link-input")
      .fill("http://127.0.0.1:5197/ranges-ok/sample-tour.zip");
    const open = page.locator("#start-open");
    await open.click();
    // In progress: the controls are off and the dialog says what runs.
    await expect(open).toBeDisabled();
    await expect(page.locator("#open-status")).toHaveText(
      "Fetching the tour from its link…",
    );
    release?.();
    await expect(page.locator("#topbar")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#tour-file")).toHaveText("sample-tour.zip");
    await expect(page.locator("#open-modal")).toBeHidden();
    await expect(open).toBeEnabled();
  });

  test("says why a link did not open, and gives the controls back", async ({
    page,
  }) => {
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page.locator(".start-choice:has(#start-tour)").click();
    await page
      .locator("#link-input")
      .fill("http://127.0.0.1:5197/no-cors/tour.zip");
    await page.locator("#start-open").click();
    await expect(page.locator("#open-error")).toContainText(
      "Download the file to this computer, then choose it above.",
      { timeout: 15000 },
    );
    await expect(page.locator("#start-open")).toBeEnabled();
    await expect(page.locator("#open-status")).toHaveText("");
  });

  test("refuses text that is not a link, without a request", async ({
    page,
  }) => {
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page.locator(".start-choice:has(#start-tour)").click();
    await page.locator("#link-input").fill("castle.zip");
    await page.locator("#start-open").click();
    await expect(page.locator("#open-error")).toContainText(
      "That is not a web link",
    );
  });
});

/**
 * A stand-in save dialog that waits: `window.__answerSave(name)` answers
 * it with a file of that name in the page's private file system, or
 * `null` dismisses it. `window.__saveAsks` counts the calls.
 * @param {import("@playwright/test").Page} page
 */
async function heldSaveDialog(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__saveAsks = 0;
    w.showSaveFilePicker = () => {
      w.__saveAsks += 1;
      return new Promise((resolve, reject) => {
        w.__answerSave = async (/** @type {string | null} */ name) => {
          if (name === null) {
            reject(
              new DOMException("The user aborted a request.", "AbortError"),
            );
            return;
          }
          const root = await navigator.storage.getDirectory();
          resolve(await root.getFileHandle(name, { create: true }));
        };
      });
    };
  });
}

/**
 * Why these tests matter: the start card asks where the creator starts
 * from, then opens the editor with one button. A new tour must ask where
 * it is saved while the question shows, and must never be offered an
 * earlier new tour's changes; the example is only looked at, so it never
 * asks where to save before anything is seen.
 */
test.describe("the start card", () => {
  test("a new tour asks where it is saved with the question shown, then opens with the first station's hint", async ({
    page,
  }) => {
    await heldSaveDialog(page);
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    const open = page.locator("#start-open");
    await expect(open).toBeDisabled();
    await expect(page.locator("#start-summary")).toHaveText(
      "Choose where you start from.",
    );
    await page.locator(".start-choice:has(#start-new)").click();
    await expect(open).toBeEnabled();
    await open.click();
    const question = page.locator(".toast", {
      hasText: "Where should your new tour be saved?",
    });
    await expect(question).toBeVisible();
    await page.evaluate(() =>
      /** @type {any} */ (window).__answerSave("first.zip"),
    );
    await expect(question).toHaveCount(0);
    await expect(page.locator("#open-modal")).toBeHidden();
    await expect(page.locator("#tour-file")).toHaveText("first.zip");
    await expect(
      page.locator(".toast", {
        hasText: "Right-click the ground to place your first station.",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => /** @type {any} */ (window).__saveAsks),
    ).toBe(1);
  });

  test("a second new tour is never offered the first one's changes", async ({
    page,
  }) => {
    await heldSaveDialog(page);
    await page.goto("/edit.html");
    await page.locator(".start-choice:has(#start-new)").click();
    await page.locator("#start-open").click();
    await page.evaluate(() => /** @type {any} */ (window).__answerSave(null));
    await expect(page.locator("#topbar")).toBeVisible();
    await setNoGps(page, true);
    await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
    // The unsaved-work guard asks before the card shows again.
    let asked = 0;
    page.on("dialog", (dialog) => {
      asked += 1;
      void dialog.accept();
    });
    await openAnother(page);
    expect(asked).toBe(1);
    await page.locator(".start-choice:has(#start-new)").click();
    await page.locator("#start-open").click();
    await page.evaluate(() => /** @type {any} */ (window).__answerSave(null));
    await expect(page.locator("#open-modal")).toBeHidden();
    await expect(page.locator(".toast.draft-offer")).toHaveCount(0);
    await page.locator("#tour-name").click();
    await expect(page.locator("#details-no-gps")).not.toBeChecked();
  });

  test("the example opens to look around and asks nowhere to save", async ({
    page,
  }) => {
    await heldSaveDialog(page);
    await page.goto("/edit.html");
    await page.locator(".start-choice:has(#start-example)").click();
    await expect(page.locator("#start-scan-step")).toBeHidden();
    await expect(page.locator("#start-summary")).toHaveText(
      "Opens the example tour to look around. Nothing is saved unless you choose Save.",
    );
    await page.locator("#start-open").click();
    await expect(page.locator("#topbar")).toBeVisible();
    await expect(page.locator("#tour-file")).toHaveText("marienplatz-tour.zip");
    expect(
      await page.evaluate(() => /** @type {any} */ (window).__saveAsks),
    ).toBe(0);
  });
});
