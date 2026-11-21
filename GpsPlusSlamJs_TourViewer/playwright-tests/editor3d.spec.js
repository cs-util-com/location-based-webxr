// @ts-check
import { expect, test } from "@playwright/test";

import { openAnother } from "./editor-menus.js";
import { editorManifest } from "./editor-session.js";
import { answerHosts, gotoEditor } from "./editor3d-fixture.js";

/**
 * Why these tests matter: the desktop editor's 3D view loads three ways
 * (its code, its ground, WebGL), and each can fail. These drive the real
 * view on the sample tour, with the relief's and the map's hosts answered
 * here, and check what a creator sees: a 3D view whose code cannot load is
 * said on a page of its own (`#view3d-failed`), the tour still open behind
 * it; a later try that shows the view takes that page away; a first frame
 * that fails leaves nothing of the view behind; and seventeen opens never
 * run out of the browser's WebGL contexts.
 */

/**
 * Open the sample tour from the start dialog, as a creator does, without
 * waiting for its 3D view.
 * @param {import("@playwright/test").Page} page
 */
async function openExample(page) {
  await gotoEditor(page);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator(".start-choice:has(#start-example)").click();
  await page.locator("#start-open").click();
}

// Why: a tour opened where the 3D view cannot load stays open (its File
// actions on the page that says so).
test("a tour whose 3D view cannot load opens on a page that says so, the tour still open", async ({
  page,
}) => {
  await answerHosts(page);
  await page.route("**/src/editor3d/editor3d-globe.ts*", (route) =>
    route.abort(),
  );
  await openExample(page);
  await expect(
    page.locator("#view3d-failed", {
      hasText: "The 3D view could not be loaded",
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-view", "3d");
  // The tour is the editor's all the same: the sample's three stations.
  await expect
    .poll(async () => (await editorManifest(page))?.stations?.length)
    .toBe(3);
});

// Why: a failure's page stays until the view is tried again (the creator
// asked for something that did not happen) - but once a later try shows
// the view it says what is no longer so, and must go. The first try fails
// for want of WebGL (the page refuses one WebGL context); Try again shows
// it. (A chunk that failed cannot stand in: the browser keeps a failed
// import's answer for the page's life.)
test("a later try that shows the 3D view takes the earlier failure's page away", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await answerHosts(page);
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    let refused = false;
    /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (
      /** @type {string} */ kind,
      /** @type {unknown[]} */ ...rest
    ) {
      if (!refused && kind.startsWith("webgl")) {
        refused = true;
        return null;
      }
      return real.call(this, kind, ...rest);
    };
  });
  await openExample(page);
  const line = page.locator("#view3d-failed", {
    hasText: "cannot draw the 3D view",
  });
  await expect(line).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#view3d canvas")).toHaveCount(0);
  await page.locator("#view3d-failed-retry").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect(line).toBeHidden();
  await expect(page.locator("#view3d canvas")).toHaveCount(1);
});

// Why: an error inside the 3D view's frame loop before its first frame
// left the open waiting for a frame that never came - stuck on "Loading
// 3D view…" - and a failure after the renderer was made left its canvas
// in the box (a second one on the next open). The open must end on its
// page with the reason said and nothing of the view left behind. The
// page's WebGL draw calls throw once, inside three's render.
test("a 3D view whose first frame fails is said on its page, with nothing left", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await answerHosts(page);
  await page.addInitScript(() => {
    let thrown = false;
    for (const proto of [
      WebGL2RenderingContext.prototype,
      WebGLRenderingContext.prototype,
    ]) {
      for (const name of /** @type {const} */ ([
        "drawElements",
        "drawArrays",
      ])) {
        const real = /** @type {any} */ (proto)[name];
        /** @type {any} */ (proto)[name] = function (
          /** @type {unknown[]} */ ...args
        ) {
          if (!thrown) {
            thrown = true;
            throw new Error("a draw call failed (test)");
          }
          return real.apply(this, args);
        };
      }
    }
  });
  await openExample(page);
  await expect(
    page.locator("#view3d-failed", { hasText: "stopped on an error" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#view-loading")).toBeHidden();
  await expect(page.locator("#view3d-failed-retry")).toBeEnabled();
  await expect(page.locator("#view3d")).toBeHidden();
  await expect(page.locator("#view3d canvas")).toHaveCount(0);
  await expect(page.locator("#view3d-credits")).toBeEmpty();
});

// Why: each open makes a WebGL renderer, and a renderer's dispose() does
// not give its context back; anything still holding the renderer (the
// code squares' shared face texture did, through its dispose listener)
// keeps it alive too. A creator opening tour after tour would reach the
// browser's limit (16 in Chromium), which then drops the oldest context -
// the next 3D view's among them. Seventeen opens must never warn of too
// many contexts: a leak of one context per open shows from the 16th, and
// one more keeps a spare.
test("opening a tour seventeen times keeps the browser's WebGL contexts free", async ({
  page,
}) => {
  test.setTimeout(480_000);
  /** @type {string[]} */
  const warnings = [];
  page.on("console", (message) => {
    if (/too many active webgl contexts/i.test(message.text())) {
      warnings.push(message.text());
    }
  });
  // The sample is never edited here, so no open asks about unsaved work;
  // should one ask, it goes on.
  page.on("dialog", (dialog) => void dialog.accept());
  await answerHosts(page);
  // Each open goes straight at the tour, the globe's heavy clouds off
  // (`gotoEditor`): with them each menu click waits on frames of about
  // 0.7 s here, which ran past the budget on a slower CI runner. The
  // contexts are the renderer's, made and given back per open whatever
  // the view draws; seventeen, since fewer than Chromium's 16 could
  // not show a leak.
  await openExample(page);
  for (let i = 0; i < 17; i++) {
    if (i > 0) {
      await openAnother(page);
      await expect(page.locator("#open-modal")).toBeVisible();
      await page.locator(".start-choice:has(#start-example)").click();
      await page.locator("#start-open").click();
    }
    // The start dialog stays, saying "Opening ...", until the tour is
    // the editor's, which on a slow runner takes longer than the default
    // wait.
    await expect(page.locator("#open-modal")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
      timeout: 60_000,
    });
    await expect(page.locator("#view3d canvas")).toHaveCount(1);
  }
  expect(warnings).toEqual([]);
});
