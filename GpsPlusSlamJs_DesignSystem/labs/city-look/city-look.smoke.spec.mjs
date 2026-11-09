/**
 * Every page of the city look lab loads each scene: no console error, nothing
 * leaves 127.0.0.1, and the first full frame arrives with something drawn.
 * The variant folders are found on disk, so a variant is covered the moment
 * it lands, by no edit here.
 */
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { SCENES } from "./city-look-model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = readdirSync(HERE, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => existsSync(join(HERE, name, "index.html")))
  .sort();

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

test("the gallery loads", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/labs/city-look/index.html");
  await expect(page.getByRole("heading", { name: "City look" })).toBeVisible();
  expect(problems).toEqual([]);
});

for (const name of PAGES) {
  for (const scene of SCENES) {
    test(`${name} draws ${scene}`, async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await watch(page);
      await page.goto(`/labs/city-look/${name}/index.html?scene=${scene}`);
      await page.waitForFunction(
        () => window.__cityLook?.ready || window.__cityLook?.error,
        null,
        { timeout: 100_000 },
      );
      const look = await page.evaluate(() => {
        const { error, ready, triangles, draws } = window.__cityLook;
        return { error, ready, triangles, draws };
      });
      expect(look.error).toBeNull();
      expect(look.ready).toBe(true);
      expect(look.triangles).toBeGreaterThan(1000);
      expect(look.draws).toBeGreaterThan(1);
      await expect(page.getByText("OpenStreetMap contributors")).toBeVisible();
      expect(problems).toEqual([]);
    });
  }
}
