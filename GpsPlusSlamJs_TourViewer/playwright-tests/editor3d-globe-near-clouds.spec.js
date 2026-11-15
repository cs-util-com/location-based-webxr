// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  keepRejections,
  noApproach,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why this test matters: the near clouds are experimental, and the editor
 * opens with the old clouds unless the link says `clouds=new`. The unit
 * tests read the link's switch and what the editor passes to the globe;
 * this reads the real page: the view's near clouds (their pixels and tier,
 * which the step-down drives) are there with `clouds=new` and absent by
 * default. It does not read whether their bake finished: the view reports
 * the near clouds' driver, which stays when a failed bake falls back to the
 * old clouds.
 */

/**
 * The editor with the sample tour in its 3D view on the globe, the
 * approach off and the clouds on, at `query`.
 * @param {import("@playwright/test").Browser} browser
 * @param {string} query
 */
async function opened(browser, query) {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await noApproach(page);
  await page.goto(`/edit.html?globe=1&buildings=0${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect
    .poll(async () => (await view3d(page))?.globe?.air?.clouds?.on, {
      timeout: 120_000,
    })
    .toBe(true);
  return page;
}

test("the near clouds draw only with clouds=new", async ({ browser }) => {
  test.setTimeout(600_000);
  const plain = await opened(browser, "");
  try {
    expect((await view3d(plain)).globe.air.clouds.near).toBeNull();
    expect(await rejections(plain)).toEqual([]);
  } finally {
    await plain.close();
  }
  const near = await opened(browser, "&clouds=new");
  try {
    await expect
      .poll(async () => (await view3d(near))?.globe?.air?.clouds?.near ?? null)
      .not.toBeNull();
    expect((await view3d(near)).globe.air.clouds.near.tier).toMatch(
      /^(low|medium|high)$/,
    );
    expect(await rejections(near)).toEqual([]);
  } finally {
    await near.close();
  }
});
