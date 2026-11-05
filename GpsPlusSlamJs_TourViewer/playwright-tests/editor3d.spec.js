// @ts-check
import { expect, test } from "@playwright/test";

import { viewCommand } from "./editor-menus.js";
import {
  GLOBE_VIEW,
  answerHosts,
  noApproach,
  noClouds,
  openSample,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the desktop editor's 3D view loads three ways
 * (its code, its ground, WebGL), and each can fail. These drive the real
 * view on the sample tour, with the relief's and the map's hosts answered
 * here, and check what a creator sees: a 3D view whose code cannot load is
 * said on a page of its own (`#view3d-failed`), the tour still open behind
 * it; a later open that shows the view takes that page away; a first frame
 * that fails leaves nothing of the view behind; and twenty opens never run
 * out of the browser's WebGL contexts.
 */

/** The view these tests open: the globe the plain link opens. */
const VIEWS = /** @type {const} */ ([["globe", GLOBE_VIEW]]);

// Why: a tour opened where the 3D view cannot load stays open (its File
// actions on the page that says so); the map no longer stands in.
test("a tour whose 3D view cannot load opens on a page that says so, the tour still open", async ({
  page,
}) => {
  await answerHosts(page);
  await page.route("**/src/editor3d/editor3d-scene.ts*", (route) =>
    route.abort(),
  );
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(
    page.locator("#view3d-failed", {
      hasText: "The 3D view could not be loaded",
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-view", "3d");
  await expect(page.locator("#view-switch")).toHaveText("3D view");
  await expect(page.locator(".mk-station")).toHaveCount(3);
  await expect(page.locator("#rail .row-title")).toHaveCount(3);
});

// Why: a failure's page stays until the view is tried again (the creator
// asked for something that did not happen) - but once a later open shows
// the view it says what is no longer so, and must go. The first open fails for want
// of WebGL (the page refuses one WebGL context); the second shows. (A chunk
// that failed cannot stand in: the browser keeps a failed import's answer
// for the page's life.)
for (const [view, link] of VIEWS) {
  test(`a later open that shows the 3D view takes the earlier failure's page away (${view})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await answerHosts(page);
    await openSample(page, link);
    await page.evaluate(() => {
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
    const button = page.locator("#view-switch");
    const line = page.locator("#view3d-failed", {
      hasText: "cannot draw the 3D view",
    });
    await viewCommand(page, "switch");
    await expect(line).toBeVisible();
    await expect(button).toHaveText("3D view");
    await expect(page.locator("#view3d canvas")).toHaveCount(0);
    await viewCommand(page, "switch");
    await expect(button).toHaveText("2D map", { timeout: 60_000 });
    await expect(line).toBeHidden();
    await expect(page.locator("#view3d canvas")).toHaveCount(1);
  });
}

// Why: an error inside the 3D view's frame loop before its first frame
// left the open waiting for a frame that never came - the button stuck on
// "Loading 3D view…" - and a failure after the renderer was made left its
// canvas in the box (a second one on the next open). The open must end on
// its page with the reason said and nothing of the view left behind. The
// page's WebGL draw calls throw once, inside three's render.
for (const [view, link] of VIEWS) {
  test(`a 3D view whose first frame fails is said on its page, with nothing left (${view})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await answerHosts(page);
    await openSample(page, link);
    await page.evaluate(() => {
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
    const button = page.locator("#view-switch");
    await viewCommand(page, "switch");
    await expect(
      page.locator("#view3d-failed", { hasText: "stopped on an error" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(button).toHaveText("3D view");
    await expect(button).toBeEnabled();
    await expect(page.locator("#view3d")).toBeHidden();
    await expect(page.locator("#view3d canvas")).toHaveCount(0);
    await expect(page.locator("#view3d-credits")).toBeEmpty();
  });
}

// Why: each open makes a WebGL renderer, and a renderer's dispose() does
// not give its context back; anything still holding the renderer (the
// code squares' shared face texture did, through its dispose listener)
// keeps it alive too. A creator switching back and forth would reach the
// browser's limit (16 in Chromium), which then drops the oldest context -
// the map's markers or the next 3D view among them. Twenty switches must
// never warn of too many contexts.
for (const [view, link] of VIEWS) {
  test(`switching to 3D and back twenty times keeps the browser's WebGL contexts free (${view})`, async ({
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
    await answerHosts(page);
    // Twenty opens straight at the tour, the globe's heavy clouds off
    // (`noClouds`): with them each menu click waits on frames of about
    // 0.7 s here, which ran past the budget on a slower CI runner. The
    // contexts are the renderer's, made and given back per open whatever
    // the view draws; twenty stays, since fewer than Chromium's 16 could
    // not show a leak.
    await noApproach(page);
    await noClouds(page);
    await openSample(page, link);
    const button = page.locator("#view-switch");
    for (let i = 0; i < 20; i++) {
      await viewCommand(page, "switch");
      await expect(button).toHaveText("2D map", { timeout: 60_000 });
      await viewCommand(page, "switch");
      await expect(button).toHaveText("3D view");
    }
    expect(warnings).toEqual([]);
    await expect(page.locator("#view3d canvas")).toHaveCount(0);
  });
}
