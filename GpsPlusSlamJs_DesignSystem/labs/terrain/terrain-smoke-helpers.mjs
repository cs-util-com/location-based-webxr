// @ts-check
/**
 * The terrain lab smokes' shared helpers (terrain plan 2026-09-27-0605 §5,
 * §9 finding 4): the request routing that keeps every tile on this machine,
 * the boot, and the hash and pixel helpers. One copy for every terrain spec
 * (DEC-H3), so a change of the routing cannot leave one spec testing the
 * network.
 */
import { expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The smoke server's origin: 5198, or a worktree's `DS_E2E_PORT`. */
export const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
/** The tile URL the lab fetches (the Osm library's TERRARIUM_URL_TEMPLATE). */
const TERRARIUM =
  /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/;
const FIXTURES = fileURLToPath(
  new URL("./fixtures/terrarium/", import.meta.url),
);

/**
 * Routes every request: this origin passes, a tile is answered by
 * `serveTile(key, record)` (a body, a status, or a promise of either),
 * anything else is aborted and recorded. Returns the record.
 */
export async function routeAll(page, serveTile) {
  const record = { external: [], requested: [], served: 0, missing: [] };
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${ORIGIN}/`)) return route.continue();
    const m = TERRARIUM.exec(url);
    if (!m) {
      record.external.push(url);
      return route.abort();
    }
    const key = `${m[1]}/${m[2]}/${m[3]}`;
    record.requested.push(key);
    const answer = await serveTile(key, record);
    if (answer.status !== 200) {
      return route.fulfill({ status: answer.status, body: "" });
    }
    record.served += 1;
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: answer.body,
    });
  });
  return record;
}

/** The committed tile for a key (any place's); a missing one is recorded. */
export function fixtureTile(key, record) {
  const file = `${FIXTURES}${key}.png`;
  if (!existsSync(file)) {
    record.missing.push(key);
    return { status: 404 };
  }
  return { status: 200, body: readFileSync(file) };
}

/** Boots the lab at a hash and waits until it has drawn (or failed). */
export async function boot(page, hash) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/labs/terrain/#${hash}`);
  await page.waitForFunction(
    () => window.__terrainLab?.ready || window.__terrainLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__terrainLab.error)).toBeNull();
  return errors;
}

/** Sets the hash and waits until the page has applied it. */
export async function applyHash(page, hash) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForFunction(
    (h) => window.__terrainLab.state().appliedHash === h,
    hash,
  );
}

export const state = (page) => page.evaluate(() => window.__terrainLab.state());

/** RGBA bytes at normalised canvas points. */
export const readPixels = (page, points) =>
  page.evaluate((p) => window.__terrainLab.readPixels(p), points);

export const luminance = (px) =>
  0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];

/** An n x n grid of normalised canvas points, `half` either side of `c`. */
export const gridAround = (c, half, n) => {
  const points = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      points.push([
        c[0] - half + (2 * half * i) / (n - 1),
        c[1] - half + (2 * half * j) / (n - 1),
      ]);
    }
  }
  return points;
};

/** Pass/fail of a measured value against each tolerance of a sweep. */
export const sweepLine = (value, tolerances, format = (t) => `${t}`) =>
  tolerances
    .map((t) => `${format(t)}:${value <= t ? "pass" : "fail"}`)
    .join(" ");
