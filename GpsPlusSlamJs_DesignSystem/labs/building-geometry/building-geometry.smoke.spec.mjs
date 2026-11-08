/**
 * Every building and camera of the building geometry lab: the page builds the
 * city with no console error, nothing leaves 127.0.0.1, the "today" picture of
 * that camera loads, and the attribution is visible.
 */
import { expect, test } from "@playwright/test";

import { allShots } from "./building-geometry-model.js";

/** Refuses every outside request and collects what the page complains about. */
async function watch(page) {
  const problems = [];
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === "127.0.0.1") return route.continue();
    problems.push(`outside request: ${route.request().url()}`);
    return route.abort();
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      problems.push(`${response.status()} ${response.url()}`);
    }
  });
  return problems;
}

// Why this test matters: a camera whose "today" picture is missing, or a
// fixture that stops building, would leave the owner comparing nothing with
// something; the fast tier opens only the default view.
for (const { id, view } of allShots()) {
  test(`building geometry ${id} ${view}`, async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await watch(page);
    await page.goto(
      `/labs/building-geometry/index.html?building=${id}&view=${view}`,
    );
    await page.waitForFunction(
      () =>
        window.__buildingGeometry?.ready || window.__buildingGeometry?.error,
      null,
      { timeout: 100_000 },
    );
    const state = await page.evaluate(() => {
      const { error, ready, triangles } = window.__buildingGeometry;
      return { error, ready, triangles };
    });
    expect(state.error).toBeNull();
    expect(state.ready).toBe(true);
    expect(state.triangles).toBeGreaterThan(100);
    const today = page.locator("img.bg-picture");
    await expect(today).toBeVisible();
    expect(
      await today.evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    await expect(page.getByText("OpenStreetMap contributors")).toBeVisible();
    expect(problems).toEqual([]);
  });
}

// Why this test matters (M7 review MINOR 3): the "Klassen" link is the only
// way to see the class colours the seeded palette replaced; it must reach
// `buildCity` and draw, not throw or quietly draw the palette again.
test("building geometry draws the class colours behind the Klassen link", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = await watch(page);
  await page.goto("/labs/building-geometry/index.html?building=heidelberg");
  await page.getByRole("link", { name: "Klassen" }).click();
  await page.waitForFunction(
    () => window.__buildingGeometry?.ready || window.__buildingGeometry?.error,
    null,
    { timeout: 100_000 },
  );
  const state = await page.evaluate(() => {
    const { error, palette, triangles } = window.__buildingGeometry;
    return { error, palette, triangles };
  });
  expect(state).toEqual(
    expect.objectContaining({ error: null, palette: "class" }),
  );
  expect(state.triangles).toBeGreaterThan(100);
  await expect(page.getByRole("link", { name: "Klassen" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(problems).toEqual([]);
});
